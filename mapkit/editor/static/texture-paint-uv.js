// Pure UV math shared by the 3D paint view and its tests. Coordinates returned
// here are canvas coordinates: x grows right, y grows down. UE1 model UVs and
// the editor's game textures use flipY=false.
const EPS = 1e-8;
const mode = value => value === 1000 ? 'repeat' : value === 1002 ? 'mirror' : value === 1001 ? 'clamp' : value || 'repeat';

export function transformedUV(uv, options = {}) {
  const u = uv.x ?? uv[0], v = uv.y ?? uv[1], m = options.matrix?.elements || options.matrix;
  return m ? [m[0] * u + m[3] * v + m[6], m[1] * u + m[4] * v + m[7]] : [u, v];
}
function wrapped(value, wrapping) {
  if (value >= 0 && value <= 1) return value;
  if (mode(wrapping) === 'clamp') return Math.max(0, Math.min(1, value));
  if (mode(wrapping) === 'mirror') return Math.abs(Math.floor(value) % 2) ? Math.ceil(value) - value : value - Math.floor(value);
  return value - Math.floor(value);
}
export function textureUVToPoint(uv, width, height, options = {}) {
  const [rawU, rawV] = transformedUV(uv, options);
  if (![rawU, rawV, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
  const u = wrapped(rawU, options.wrapS), v0 = wrapped(rawV, options.wrapT), v = options.flipY ? 1 - v0 : v0;
  return { x: Math.max(0, Math.min(width - EPS, u * width)), y: Math.max(0, Math.min(height - EPS, v * height)),
    u, v, rawU, rawV,
    tileU: mode(options.wrapS) === 'clamp' ? 0 : Math.floor(rawU),
    tileV: mode(options.wrapT) === 'clamp' ? 0 : Math.floor(rawV) };
}

// Join triangles only along an edge whose geometric AND texture coordinates
// agree. Merely touching in the UV picture must not join separate body parts.
export function buildUVIslands(triangles, precision = 1e-5) {
  const parent = triangles.map((_, i) => i), edges = new Map(), adjacent = new Map();
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const key = values => values.map(n => Math.round(n / precision)).join(',');
  triangles.forEach((triangle, i) => {
    adjacent.set(triangle.faceIndex, new Set());
    const vertices = triangle.positions.map((p, v) => key([...p, ...triangle.uvs[v]]));
    for (let j = 0; j < 3; j++) {
      const edge = [vertices[j], vertices[(j + 1) % 3]].sort().join('|');
      for (const previous of edges.get(edge) || []) {
        parent[root(i)] = root(previous);
        adjacent.get(triangle.faceIndex).add(triangles[previous].faceIndex);
        adjacent.get(triangles[previous].faceIndex).add(triangle.faceIndex);
      }
      if (!edges.has(edge)) edges.set(edge, []);
      edges.get(edge).push(i);
    }
  });
  const ids = new Map(), byFace = new Map(), islands = new Map();
  triangles.forEach((triangle, i) => {
    const r = root(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    const id = ids.get(r);
    byFace.set(triangle.faceIndex, id);
    if (!islands.has(id)) islands.set(id, []);
    islands.get(id).push(triangle);
  });
  return { byFace, islands, adjacent };
}

// Break a stroke when a pointer crosses an occluder, another shell, a UV wrap
// or a nonadjacent face. Screen-space ray samples make adjacent-face movement
// smooth, without inventing a long line through the texture atlas.
export function continuousUVHits(previous, next, { width, height, brushSize = 1 } = {}) {
  if (!previous || !next || previous.objectId !== next.objectId || previous.islandId !== next.islandId) return false;
  if (previous.tileU !== next.tileU || previous.tileV !== next.tileV) return false;
  if (previous.faceIndex !== next.faceIndex && !next.adjacentFaces?.has(previous.faceIndex)) return false;
  const limit = Math.max(8, brushSize * 2, Math.min(width || 1, height || 1) / 16);
  return Math.hypot(previous.x - next.x, previous.y - next.y) <= limit;
}

function clipHalfPlane(points, axis, boundary, keepGreater) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const insideA = keepGreater ? a[axis] >= boundary - EPS : a[axis] <= boundary + EPS;
    const insideB = keepGreater ? b[axis] >= boundary - EPS : b[axis] <= boundary + EPS;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = (boundary - a[axis]) / (b[axis] - a[axis]);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}
function signedArea(points) {
  return points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
}

// Clip each repeated tile before wrapping it. Wrapping just the three corners
// produces a diagonal across the atlas for triangles which straddle a seam.
export function triangleCanvasPolygons(uvs, options = {}) {
  const raw = uvs.map(uv => transformedUV(uv, options));
  if (!raw.flat().every(Number.isFinite)) return [];
  const bounds = [0, 1].map(axis => {
    const wrap = mode(axis ? options.wrapT : options.wrapS);
    const values = raw.map(p => p[axis]);
    if (wrap === 'clamp') return [0, 0];
    return [Math.floor(Math.min(...values)), Math.floor(Math.max(...values) - EPS)];
  });
  // A malformed imported UV must not hang the editor.
  if ((bounds[0][1] - bounds[0][0] + 1) * (bounds[1][1] - bounds[1][0] + 1) > 4096) throw new RangeError('UV tiling exceeds the paint limit');
  const result = [];
  for (let tx = bounds[0][0]; tx <= bounds[0][1]; tx++) for (let ty = bounds[1][0]; ty <= bounds[1][1]; ty++) {
    let points = raw;
    for (let axis = 0; axis < 2; axis++) {
      const tile = axis ? ty : tx, wrapping = mode(axis ? options.wrapT : options.wrapS);
      // Clamped portions outside the texture collapse to its border and have
      // no texel area; clipping preserves the interior edge intersections.
      points = clipHalfPlane(points, axis, wrapping === 'clamp' ? 0 : tile, true);
      points = clipHalfPlane(points, axis, wrapping === 'clamp' ? 1 : tile + 1, false);
    }
    if (points.length < 3 || Math.abs(signedArea(points)) < EPS) continue;
    points = points.map(p => {
      let x = mode(options.wrapS) === 'clamp' ? p[0] : p[0] - tx;
      let y = mode(options.wrapT) === 'clamp' ? p[1] : p[1] - ty;
      if (mode(options.wrapS) === 'mirror' && Math.abs(tx % 2)) x = 1 - x;
      if (mode(options.wrapT) === 'mirror' && Math.abs(ty % 2)) y = 1 - y;
      if (options.flipY) y = 1 - y;
      return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
    });
    // Consistent winding prevents overlapping triangles cancelling in a mask.
    if (signedArea(points) < 0) points.reverse();
    result.push(points);
  }
  return result;
}
