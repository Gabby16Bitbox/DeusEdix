// The grid, as Unity's grid snapping has it: Push to grid (Edit menu, Ctrl+\) puts what is selected onto the nearest
// grid points, Ctrl+[ and Ctrl+] halve or double the grid step, Ctrl held while the gizmo drags turns grid snap the
// other way for that moment (Ctrl+Shift is surface snapping), a slide over a surface goes on the grid along it, and
// the 3D view's grid lies at a height and shows round the camera. No page: app.js moves the objects, view-grid.js
// draws the grid. Points are [x, y, z] in any one frame of axes: the grid's lines go through the map's origin along
// its axes, whichever way round the axes are named.

export const GRID_LIMITS = [0.5, 4096];       // the smallest and the largest grid step, in units (the toolbar's box too)
export const GRID_MAJOR = 8;                   // a brighter line every 8 cells of the 3D view's grid
const MAX_CELLS = 96;                          // the most cells the 3D view's grid shows from the camera to its edge

const roundTo = (v, step) => Math.round(v / step) * step || 0;      // || 0: never -0

// the point on the grid nearest to v along the axes listed; the others stay
export const onGrid = (v, step, axes = [0, 1, 2]) => v.map((x, k) => (axes.includes(k) ? roundTo(x, step) : x));

// Ctrl+[ (dir -1) halves the grid step, Ctrl+] (1) doubles it, within GRID_LIMITS
export function nextGridStep(step, dir) {
  const v = dir < 0 ? step / 2 : step * 2;
  return Math.min(GRID_LIMITS[1], Math.max(GRID_LIMITS[0], Math.round(v * 100) / 100));
}

// grid snap at this moment of a gizmo drag (keys: the pointer event's): Ctrl alone turns the toggle the other way,
// Ctrl+Shift does not (it slides the object over the surfaces instead)
export const dragSnap = (on, keys) => on !== !!(keys.ctrlKey && !keys.shiftKey);

// A slide over a surface with grid snap: the point under the pointer on the grid along the two axes the surface runs
// along most; the axis most across it stays (the object rests on the surface along its normal anyway).
export function surfaceOnGrid(point, normal, step) {
  const size = normal.map(Math.abs), across = size.indexOf(Math.max(...size));
  return onGrid(point, step, [0, 1, 2].filter((k) => k !== across));
}

// Push to grid: the move [dx, dy, dz] (game axes) that puts `anchor` on the grid, null when it is there already.
// The anchor is a block's lowest corner when it is not turned (a block a whole number of steps long then has every
// side on the grid), else the pivot. keepHeight: an object stands on its floor by its collision, its height stays.
export function pushMove(anchor, step, keepHeight = false) {
  const to = onGrid(anchor, step, keepHeight ? [0, 1] : [0, 1, 2]), d = to.map((v, k) => v - anchor[k]);
  return d.some((v) => Math.abs(v) > 1e-6) ? d : null;
}

// The 3D view's grid: the height it lies at (the bottom of what is selected, else the floor under the camera) on the
// grid, how far round the camera it shows (further from higher up), and its cell: the grid step, doubled while more
// than MAX_CELLS cells would fit in that radius (too fine to read), a line every GRID_MAJOR cells brighter.
// floor, eye: the heights of the floor and of the camera.
export function gridView(step, floor, eye) {
  const level = roundTo(floor, step);
  const radius = Math.min(32768, Math.max(1024, Math.abs(eye - level) * 12));
  let cell = step;
  while (radius / cell > MAX_CELLS) cell *= 2;
  return { level, radius, cell, major: cell * GRID_MAJOR };
}
