// Preview only the addressed source polygons, even when BSP batches many faces in one mesh.
// Each mesh's shared geometry/material is restored before rebuilding, relighting or Undo.
// The faces' queued alignment too (pan, scale, rotate, the flips, Floor, Wall, One Tile, a texture's size) as the host
// will leave it, and the Texture Slip's while it goes on (texture-slip.js): a face's UVs from its mapping now on its
// corners as the last Rebuild built them. A face it cannot know (Around a cylinder, a texture of unknown size, the rows
// built not known, Floor or Wall on a structure moved since, any on one resized since) keeps its UVs: only a Rebuild
// shows it (apply says which).
import { mappingOf, pendingMappings, uvOf, isRefusal, piecesOf, sourceNormal } from './texture-slip.js';

// operations anchored to the world's axes and origin: not known on a structure moved or turned since the Rebuild
const ANCHORED = new Set(['floor', 'wall']);
// a triangle's UVs from a mapping on its corners (pos: 9 numbers a triangle, the map's frame): the texel over the
// tile, as data.py writes them
function writeUV(uv, pos, triangle, mapping) {
  for (let j = 0; j < 3; j++) {
    const at = (triangle * 3 + j) * 3, [u, v] = uvOf(mapping, [pos[at], pos[at + 1], pos[at + 2]]);
    uv.setXY(triangle * 3 + j, u, v);
  }
}

// cornersOf(mesh): { pos: its corners as built (geometry.json's pos), piece: each triangle's BSP polygon }, or null;
// tileOf(texture): its tile [w, h], or null when not known; frameOf(mesh): { moved, resized } since the Rebuild
export function createSurfaceTexturePreview({ THREE, textureInfo, materialFor, cornersOf = () => null, tileOf = () => null,
  frameOf = () => ({}) }) {
  let snapshots = [], copies = new Map();
  // the faces as the last Rebuild built them (their mappings: geometry.json's map), the meshes apply was given, where
  // each face shows in them, the faces' shapes, the meshes' frames, and the faces' mappings now (pendingMappings)
  let built = { faces: null, known: [] }, meshList = [], triangles = null, shapes = new Map(), frames = new Map(), now = new Map();
  function restore() {
    for (const state of snapshots) {
      // (a copy texture-scale.js put on the mesh since, a structure resized: its UVs are that, it stays)
      if (state.mesh.geometry === state.preview) state.mesh.geometry = state.geometry;
      state.mesh.material = state.material;
      state.preview.dispose();
      for (const material of state.materials) material.dispose();
    }
    snapshots = [];
    copies = new Map();
  }
  // the faces of a geometry loaded: each one's mapping as built, once
  function know(faces) {
    if (built.faces === faces) return;
    built = { faces, known: faces.map((f) => ({ brush: f.brush, poly: f.poly, mapping: Array.isArray(f.map) ? mappingOf(f.map, f.tex) : null })) };
    shapes = new Map();
    now = new Map();
  }
  const frame = (mesh) => { if (!frames.has(mesh)) frames.set(mesh, frameOf(mesh) || {}); return frames.get(mesh); };
  // where a face shows: [{ mesh, triangle }], from the meshes apply was given
  function trianglesOf(id) {
    if (!triangles) {
      triangles = new Map();
      for (const mesh of meshList) (mesh.userData.faces || []).forEach((face, triangle) => {
        if (!triangles.has(face)) triangles.set(face, []);
        triangles.get(face).push({ mesh, triangle });
      });
    }
    return triangles.get(id) || [];
  }
  // a face's shape for mappingAfter: its BSP pieces (put together again from its triangles: piecesOf), their normal
  // (its brush's csg), its corners, the textures' tiles; no plane nor corners when its meshes' are not known
  function shapeOf(id) {
    if (!shapes.has(id)) {
      const pieces = [], byMesh = new Map();
      for (const { mesh, triangle } of trianglesOf(id)) byMesh.set(mesh, [...(byMesh.get(mesh) || []), triangle]);
      for (const [mesh, list] of byMesh) {
        const corners = cornersOf(mesh);
        if (corners) pieces.push(...piecesOf(corners.pos, corners.piece, list).pieces);
      }
      shapes.set(id, { pieces, normal: pieces.length ? sourceNormal(pieces, built.faces?.[id]?.csg) : null, points: pieces.flat(), tileOf });
    }
    return shapes.get(id);
  }
  // pendingMappings' shape: none for Floor or Wall on a structure moved since the Rebuild
  function shapeFor(id, rows) {
    const at = trianglesOf(id)[0];
    return at && frame(at.mesh).moved && rows.some((row) => ANCHORED.has(row.op)) ? null : shapeOf(id);
  }
  // a face's mapping as the last Rebuild built it, whatever is queued on it since (null: none known)
  const asBuilt = (id) => built.known[id]?.mapping ?? null;
  // a face's mapping now: as its queued rows leave it (null: only a Rebuild shows it; or a refusal), else as built
  const current = (id) => (now.has(id) ? now.get(id) : asBuilt(id));
  // a face's new mapping to draw: known, not a refusal, not the one it was built with
  function drawn(id) {
    const m = now.get(id);
    return m && !isRefusal(m) && m !== asBuilt(id) ? m : null;
  }
  // a mesh's copy whose UVs the preview writes: apply's, or one made now (put back by restore)
  function own(mesh) {
    if (copies.has(mesh)) return copies.get(mesh);
    if (Array.isArray(mesh.material) || mesh.geometry.index) return null;
    const state = { mesh, geometry: mesh.geometry, material: mesh.material, preview: mesh.geometry.clone(), materials: [] };
    snapshots.push(state);
    copies.set(mesh, state.preview);
    mesh.geometry = state.preview;
    return state.preview;
  }
  // meshes: the built geometry shown; faces: geometry.json's; built: the rows it was built with ({ maybe: rows } or null:
  // not known, see pendingMappings).
  // It gives what the view cannot show: { later: the faces with rows only a Rebuild shows, refused: [{ id, refused,
  // row, stage }] the faces whose rows Save ('save') or the Rebuild ('rebuild') would refuse }.
  function apply(meshes, faces, edits, builtRows = []) {
    restore();
    know(faces);
    meshList = meshes; triangles = null; frames = new Map();
    now = pendingMappings(built.known, builtRows, edits.surfaces || [], shapeFor);
    const exact = new Map(), brushes = new Map();
    let order = 0;
    for (const row of edits.surfaces || []) {
      if (row.op !== 'texture') continue;
      order++;
      for (const target of row.targets || []) {
        const entry = { order, ref: row.args[0] };
        if (target.poly === '*') brushes.set(target.brush, entry);
        else exact.set(`${target.brush}|${target.poly}`, entry);
      }
    }
    const byFace = new Map();
    faces.forEach((face, id) => {
      const a = exact.get(`${face.brush}|${face.poly}`), b = brushes.get(face.brush);
      const entry = !a ? b : !b || a.order > b.order ? a : b;
      if (entry) byFace.set(id, entry.ref);
    });
    const waits = new Set();                      // faces with rows drawn on none of their meshes (resized)
    for (const mesh of meshes) {
      const ids = mesh.userData.faces || [], changes = ids.map(id => byFace.get(id));
      // a structure resized since the Rebuild: texture-scale.js has its UVs, its rows' alignment only a Rebuild shows
      // (a texture swap still does, as before)
      const resized = frame(mesh).resized, corners = resized ? null : cornersOf(mesh);
      if (resized) for (const id of ids) if (drawn(id)) waits.add(id);
      const swaps = changes.some((ref, triangle) => ref && ref !== faces[ids[triangle]]?.tex && textureInfo(ref)?.url);
      if (!swaps && !(corners && ids.some(drawn))) continue;
      if (Array.isArray(mesh.material) || mesh.geometry.index) continue;
      const geometry = mesh.geometry, material = mesh.material, preview = geometry.clone();
      const uv = preview.getAttribute('uv'), originalInfo = textureInfo(mesh.userData.tex);
      const materials = [], materialIds = new Map(), indices = [];
      ids.forEach((id, triangle) => {
        const mapping = corners && drawn(id);
        if (mapping && uv) writeUV(uv, corners.pos, triangle, mapping);
        const ref = changes[triangle], info = ref && ref !== faces[id]?.tex ? textureInfo(ref) : null;
        if (!info?.url) { indices.push(0); return; }
        if (!materialIds.has(ref)) { materials.push(materialFor(info, mesh)); materialIds.set(ref, materials.length); }
        indices.push(materialIds.get(ref));
        // UE stores U/V axes in texels; the exported preview UVs are normalized by the OLD image (a face whose
        // mapping is known has its UVs from it, on the new texture's tile).
        if (!mapping && uv && originalInfo?.w > 0 && originalInfo?.h > 0 && info.w > 0 && info.h > 0) {
          for (let vertex = triangle * 3; vertex < triangle * 3 + 3; vertex++) uv.setXY(vertex,
            uv.getX(vertex) * originalInfo.w / info.w, uv.getY(vertex) * originalInfo.h / info.h);
        }
      });
      if (swaps) {
        preview.clearGroups();
        let start = 0;
        for (let i = 1; i <= indices.length; i++) if (i === indices.length || indices[i] !== indices[start]) {
          preview.addGroup(start * 3, (i - start) * 3, indices[start]); start = i;
        }
      }
      if (uv) uv.needsUpdate = true;
      snapshots.push({ mesh, geometry, material, preview, materials });
      copies.set(mesh, preview);
      mesh.geometry = preview;
      if (swaps) mesh.material = [material, ...materials];
    }
    const later = [], refused = [];
    for (const [id, m] of now) {
      if (m === null || waits.has(id)) later.push(id);
      else if (isRefusal(m)) refused.push({ id, ...m });
    }
    return { later, refused };
  }
  // The Texture Slip's faces as it would leave them (id -> mapping; null: as they are): their UVs written again at each
  // call, on a copy of each mesh made once (apply, or restore, puts the meshes back)
  function slip(mappings) {
    for (const [id, mapping] of mappings) {
      if (!mapping) continue;
      for (const { mesh, triangle } of trianglesOf(id)) {
        const corners = cornersOf(mesh), uv = corners && !frame(mesh).resized && own(mesh)?.getAttribute('uv');
        if (!uv) continue;
        writeUV(uv, corners.pos, triangle, mapping);
        uv.needsUpdate = true;
      }
    }
  }
  return { restore, apply, slip, current, asBuilt, shapeOf, trianglesOf };
}
