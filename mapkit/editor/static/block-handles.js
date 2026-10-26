// The sides of a box as drag handles, as Unity's box bounds handle (Edit Collider): a dot in the middle of each side;
// dragging one moves that side alone and the opposite side stays where it is, so a wall reaches the next room without
// a second move. Alt moves both sides (the middle stays), Shift makes the other sides grow by the same share. A side
// never crosses the opposite one: the box keeps a thickness. On the grid a side facing along the map's axes goes onto
// the map's grid (no slivers in the game's CSG); a turned one makes the box a whole number of steps thick.
// A box here is { centre, size, axes }: its middle (the game's x, y, z), its size along its own three axes and those
// axes as unit vectors in the game's axes (a turned block's frame; the map's own axes for a collision box). No page:
// drag-handles.js draws and drags the dots, app.js writes the block (lo/hi round its middle) or the collision box.

export const MIN_SIDE = 4;                 // the thinnest a block gets, as a block resized without the grid
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (p, d, t) => p.map((v, k) => v + d[k] * t);

// How far along a handle's line (from `origin`, along the unit `dir`) the point nearest to the pointer's ray is (from
// rayOrigin along rayDir): where a dot dragged on its line goes. null when the ray runs along the line, or meets it
// only behind the camera: nothing to drag in that view.
export function lineParam(origin, dir, rayOrigin, rayDir) {
  const w = origin.map((v, k) => v - rayOrigin[k]);
  const a = dot(dir, dir), b = dot(dir, rayDir), c = dot(rayDir, rayDir), d = dot(dir, w), e = dot(rayDir, w);
  const den = a * c - b * b;
  if (den <= 1e-6 * a * c) return null;
  if ((a * e - b * d) / den < 0) return null;
  return (b * e - c * d) / den;
}

// the six sides: which of the box's axes, and which way along it
export const FACES = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]].map(([axis, sign]) => ({ axis, sign }));
// a side's handle: its line goes out from the box's middle along the side's normal, its dot is `t` out on it
export function faceHandle(box, face) {
  const dir = box.axes[face.axis].map((v) => v * face.sign), t = box.size[face.axis] / 2;
  return { part: 'face', face, origin: box.centre.slice(), dir, t, at: along(box.centre, dir, t) };
}
export const faceHandles = (box) => FACES.map((face) => faceHandle(box, face));

// The box when its side `face` is dragged to `t` out from its middle: { centre, size, t } (t: where the side went).
// opts: alt (both sides, about the middle), shift (the other sides by the same share, about their middle), step (the
// grid, 0 for none), min (the thinnest along any axis).
export function moveFace(box, face, t, { alt = false, shift = false, step = 0, min = MIN_SIDE } = {}) {
  const k = face.axis, h = box.size[k] / 2, dir = box.axes[k].map((v) => v * face.sign);
  // the size the drag asks for along that axis: from the opposite side, or with Alt twice the distance from the middle
  const share = alt ? 0.5 : 1;
  let size = Math.max(min, (alt ? 0 : h) + t / share);
  if (step > 0) {
    const j = dir.findIndex((v) => Math.abs(Math.abs(v) - 1) < 1e-6);     // the map's axis the side faces, if it faces one
    if (j >= 0) {
      // the side's own coordinate onto the map's grid, measured from what stays: the opposite side or the middle
      const s = Math.sign(dir[j]), base = box.centre[j] - (alt ? 0 : s * h);
      let w = Math.round((base + s * size * share) / step) * step;
      if (s * (w - base) < min * share) w = (s > 0 ? Math.ceil((base + min * share) / step) : Math.floor((base - min * share) / step)) * step;
      size = s * (w - base) / share;
    } else size = Math.max(Math.ceil(min / step), Math.round(size / step)) * step;
  }
  const ratio = size / box.size[k];
  const sizes = box.size.map((v, i) => (i === k ? size : shift ? Math.max(min, v * ratio) : v));
  // the middle stays with Alt; else it goes half the growth toward the side dragged, so the opposite side stays
  const centre = alt ? box.centre.slice() : along(box.centre, dir, (size - box.size[k]) / 2);
  return { centre, size: sizes, t: alt ? size / 2 : size - h };
}

// whether a side faces away from a view looking along `look` (the unit direction from its eye toward the side): drawn
// dimmer; a side seen edge on (an orthographic view's sides) does not
export const faceAway = (handle, look) => dot(handle.dir, look) > 1e-6;
