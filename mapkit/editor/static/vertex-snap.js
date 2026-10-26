// Vertex snapping, as Unity's: hold V while moving something with the gizmo and the corner of the selection nearest
// the pointer goes onto the corner of the map or of another object nearest the pointer, when one is within SNAP_PX
// pixels of it; else the move goes on as the gizmo makes it (on the grid with Grid snap). Corners are points of any
// kind; toScreen(point) says where one shows in the 3D view, [x, y] in pixels, or null behind the camera. No page:
// app.js gathers the corners (a block's, a model's bounds and pivot, the vertices of a structure, a Piece or a
// drawing; under the pointer, the corners of the triangles its rays meet) and moves the selection.

export const SNAP_PX = 12;                // how near the pointer a corner is snapped onto, in pixels

// where the rays round the pointer go, [dx, dy] in pixels: the pointer itself and a ring of n inside `px`, so a
// corner is found from a little off the edge of what it is the corner of (the sky, a gap)
export function ringAround(px = SNAP_PX, n = 6) {
  const r = px * 0.6;
  return [[0, 0], ...Array.from({ length: n }, (_, i) => [r * Math.cos(i * 2 * Math.PI / n), r * Math.sin(i * 2 * Math.PI / n)])];
}

// the point nearest `at` ([x, y] pixels) on the screen, within maxPx: { i, d } or null
export function nearestOnScreen(points, at, toScreen, maxPx = Infinity) {
  let best = null;
  points.forEach((p, i) => {
    const q = toScreen(p);
    if (!q) return;
    const d = Math.hypot(q[0] - at[0], q[1] - at[1]);
    if (d <= maxPx && (!best || d < best.d)) best = { i, d };
  });
  return best;
}

// the eight corners of a box between its lowest and highest corners
export function boxCorners(lo, hi) {
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
}

// A move snapped by its corner: { from, to }, the selection's corner nearest the pointer (however far) and the
// corner near the pointer it goes onto, `to` null when no corner of the rest is within maxPx (the move goes on as
// the gizmo makes it; the view still marks `from`); null when the selection has no corner in front of the camera.
export function vertexSnap(sources, targets, at, toScreen, maxPx = SNAP_PX) {
  const s = nearestOnScreen(sources, at, toScreen), t = s && nearestOnScreen(targets, at, toScreen, maxPx);
  return s && { from: sources[s.i], to: t ? targets[t.i] : null };
}
