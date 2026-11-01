// Texture Slip, as Premiere's slip tool: with faces selected (Face selection, Q), Y rolls their texture in any
// direction, following the pointer on the face under it, and the wheel makes it larger or smaller round the point
// under the pointer. What it leaves is what the Surface panel's Scale and Pan queue (edits.surfaces rows, surfaces.py,
// the host's UC_SURFACE), so the view can show it before a Rebuild as the game will have it, and the faces' queued
// changes too. No page code here.
//
// A face's mapping is the engine's (UCEngineBridge.cpp dumpBsp, data.py polys.json): base, TextureU and TextureV (texels
// per Unreal unit, in the world), pan (PanU, PanV, whole texels) and tile (the texture's USize and VSize times its
// Scale: the texels of one repeat). A world point P shows the texel s = (P - base) . U + PanU (t likewise with V), and
// the view's UV is (s / tile w, t / tile h), as data.py's _assemble and the engine's renderer. Points and vectors are
// [x, y, z] in Unreal units (x, y on the floor, z up).
//
// A row the build cannot take is not skipped, and it stops more than its own faces. surfaces.py checks every row of
// edits.surfaces (commands: the operation, its arguments and targets, and no more than ROW_LIMIT rows) whenever the
// map's edits are saved (server.py check_edits: /api/edits answers 400, autosave too) and a Rebuild saves first, so one
// such row leaves the map unsaved and nothing built: the page checks rows with rowProblem (queueProblem for the whole
// queue) before it queues them. The host checks each face a row edits during the Rebuild (editSurface: a pan beyond
// 16 bits, One Tile on a face with no size or no texture) and fails the whole Rebuild (kit.py stops at any
// "UCMapKit|failed" line), not that face alone: only those refusals reach a Rebuild. So a face such a row edits has no
// mapping after it but a refusal, { refused: the reason in the build's words, row: that row, stage: 'save' (surfaces.py)
// or 'rebuild' (the host) }, for the page to warn before it happens. isRefusal tells one.
//
// The map's queue holds ROW_LIMIT rows for good (Undo does not outlive the map's opening): foldRows puts a slip's rows
// together with the pan and scale rows before them, so slipping the same faces again and again takes no more room.
// The view's side (pendingMappings, piecesOf) shows every face as its queued rows leave it, from what the last Rebuild
// built.
import { faceShapes, sharedSides, piecesFromFans, EDGE_TOLERANCE } from './face-grow.js';

export const PAN_LIMIT = 32767;            // the engine keeps PanU/PanV in 16 bits (UC_SURFACE refuses a pan beyond)
export const SCALE_MIN = 0.001;            // the factors UC_SURFACE scale and surfaces.py take
export const SCALE_MAX = 1000;
export const ROW_LIMIT = 4096;             // the rows edits.surfaces may hold (surfaces.py commands), the map's whole queue
export const TARGET_LIMIT = 8192;          // the faces one row may name (surfaces.py commands)
export const SLIP_ROWS = ROW_LIMIT / 8;    // the most rows one slip queues: an eighth of the map's, room for the rest
export const WHEEL_NOTCH = 1 / 4;          // a wheel notch: a quarter of a doubling (4 notches: twice as large)
const WHEEL_PIXELS = 100;                  // a wheel notch in pixels until one is seen (learnNotch): Windows'
const WHEEL_TURN = 50;                     // a pixel step this large or more is a wheel's notch, or several merged (Linux
                                           // gives 53, a screen scaled up 125 or 150); smaller, a trackpad's part of one
const WHEEL_PAUSE = 250;                   // milliseconds with no wheel event before a step the notch is learnt from (a
                                           // trackpad's swipe sends its steps a frame or two apart)
const WHEEL_LINES = 3;                     // a notch in lines (deltaMode 1, as Firefox gives it)
export const FINE_NOTCH = 1 / 16;          // with Shift
export const FINE_DRAG = 1 / 8;            // with Shift the texture goes an eighth of the pointer's way
export const SNAP_PARTS = 8;               // with Ctrl the pan snaps to an eighth of the texture's tile (16 texels of 128)
export const GRAZING = 0.02;               // a pointer ray this close to the face's plane (its cosine) moves nothing
const SMALL = 1e-8;                        // the engine's SMALL_NUMBER: a vector shorter than its root has no direction
const FLAT = 2e-3;                         // two faces whose normals are this near (the sine between them) are one plane:
                                           // the view's corners are rounded to 2 decimals, so a small face's normal is
                                           // known to about 1e-3 (pipe facets 5.7 wide in NYC Ship Below)
const DRIFT = 0.5;                         // texels two faces' textures may go apart along the side they share, from one
                                           // end to the other, and still run on: a seam within half a texel shows as one
                                           // texture. It takes the view's rounding too (the side's ends 0.02 across it at
                                           // most: 0.08 texel on a texture mirrored over it at 2 texels a unit). Judged
                                           // at the scale the faces were built at before the first slip kept on them,
                                           // each axis (startSlip's built), so a side keeps its verdict however many
                                           // slips of the same faces are kept, an Undo, a Pan, a Rebuild or a face left
                                           // out of one between them
const STEP = 1;                            // texels two faces' textures may go apart at the middle of a side and show
                                           // no step there (beyondStep: on a side of one texture whole tiles taken off,
                                           // stepRank and steppedSince; on a side between two textures since the first
                                           // slip kept on its faces, partedSince)
const NOISE = 1e-6;                        // texels of float noise an exact pan may carry (a Pan, an Undo, a Rebuild's
                                           // read-back leave its last bits): a step of STEP give or take it is none
                                           // (beyondStep), so a side that steps by one texel as built (whole pans, grid
                                           // bases) ranks the same whatever they left
const ALONG = 1;                           // texels an axis must change along a side, end to end, for a step on it to
                                           // count as one along the side (stepRank); less, as a riser's V over a
                                           // tread's, it is across
const DIGITS = 6;                          // a scale factor is kept to 6 significant digits, as it goes in the row;
                                           // the dump keeps its numbers to as many (UCEngineBridge.cpp digits)
const SAME_AXES = 5 * 10 ** -DIGITS;       // two faces in one plane have the same axes when they are this near over it,
                                           // a part of the larger axis: the same to the dump's digits (faces of one
                                           // texture from different base points, which keep their own mapping). Axes
                                           // further apart, each scaled round its own point, part the seam by their
                                           // difference times the pointer's distance (UNATCO HQ, V 1.99918 against 2:
                                           // 5.7 texels at -8 notches)
const AS_LEFT = 4 * SAME_AXES;             // a mapping is the one a kept slip left a face when its base, U, V and tile
                                           // are this near that one's, a part of the larger of each (1 at least: a base
                                           // at the world's origin): a Rebuild reads them back from the dump, rounded
                                           // to its digits from the engine's floats, and the slip may have started from
                                           // a dump too (exactAgain)
const REPEATS = 64;                        // a tile is whole texels within this many repeats, or has no repeat

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const times = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
const minus = (x) => (x === 0 ? 0 : -x);              // no -0 in rows and mappings
const flip = (a) => a.map(minus);
// the engine's FVector ^ (x, y, z with z up)
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// the engine's SafeNormal: the direction, [0, 0, 0] for none
function safeNormal(a) {
  const square = dot(a, a);
  return square < SMALL ? [0, 0, 0] : times(a, 1 / Math.sqrt(square));
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const tidy = (x) => Number(x.toPrecision(DIGITS));
const isPoint = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

// ---------------------------------------------------------------- tiles

// A tile's repeat in whole texels: [texels, tiles], the fewest tiles (up to REPEATS) that make whole texels; null for
// none. The dump keeps 6 significant digits (a Scale of 1/3 on 64 texels is 21.3333), so n tiles count as whole when
// they are within n times its rounding of whole texels.
function repeatOf(tile) {
  if (!(tile > 0) || !Number.isFinite(tile)) return null;
  const rounding = 0.5 * 10 ** (Math.floor(Math.log10(tile)) - DIGITS + 1);
  for (let n = 1; n <= REPEATS; n++) {
    const texels = Math.round(tile * n);
    if (texels >= 1 && Math.abs(tile * n - texels) <= n * rounding + 1e-9) return [texels, n];
  }
  return null;
}
// the tile as the fraction the dump's digits stand for (21.3333: 64 / 3), so whole repeats added to a pan (the wrap
// below) show exactly the same, however many; a tile with no repeat stays as it is
function exactTile(tile) {
  const repeat = repeatOf(tile);
  return repeat ? repeat[0] / repeat[1] : tile;
}

// ---------------------------------------------------------------- mappings

// data.py's 13 numbers of a polygon (polys.json, test_surfaces.py's uv): base 3, U 3, V 3, pan u v, tile w h (0: 128,
// as data.py reads a face with no texture); texture: the face's texture as the dump names it (geometry.json's tex),
// 'none' for no texture (the dump's tile is then 128), which One Tile cannot fit (bare)
export function mappingOf(nums, texture) {
  const m = { base: nums.slice(0, 3), u: nums.slice(3, 6), v: nums.slice(6, 9), pan: [nums[9], nums[10]],
    tile: [exactTile(nums[11] || 128), exactTile(nums[12] || 128)] };
  if (texture === 'none') m.bare = true;
  return m;
}
export function numsOf(m) { return [...m.base, ...m.u, ...m.v, ...m.pan, ...m.tile]; }

// a refusal (see the top): what mappingAfter gives for a face when Save or the build refuses a row that edits it
export const isRefusal = (x) => !!x && typeof x === 'object' && typeof x.refused === 'string';
function mappingNeeded(m, what) {
  if (!m || !Array.isArray(m.u)) {
    throw new TypeError(`${what}: ${isRefusal(m) ? `a refusal (${m.refused})` : String(m)} is not a mapping (check what mappingNow gives first)`);
  }
}

// the texel a world point shows: [s, t]
export function texelOf(m, point) {
  mappingNeeded(m, 'texelOf');
  const d = sub(point, m.base);
  return [dot(d, m.u) + m.pan[0], dot(d, m.v) + m.pan[1]];
}
// the view's UV of a world point, as data.py's _assemble and the engine's renderer: the texel over the tile
export function uvOf(m, point) {
  const [s, t] = texelOf(m, point);
  return [s / m.tile[0], t / m.tile[1]];
}

// a polygon's area vector from its corners: its normal times twice its area, as the engine's FPoly::CalcNormal sums
// it before making it a unit
function areaOf(points) {
  let n = [0, 0, 0];
  for (let i = 2; i < points.length; i++) n = add(n, cross(sub(points[i - 1], points[0]), sub(points[i], points[0])));
  return n;
}
// The normal of a polygon from its corners, as the engine's FPoly::CalcNormal: the visible side of the BSP polygons
// the dump gives. One polygon only: the corners of several pieces in one list make a polygon that jumps from piece to
// piece, whose normal can come out the other way (16,744 faces of the cached maps): see piecesNormal.
export function faceNormal(points) {
  return safeNormal(areaOf(points));
}
// The normal of a face the CSG cut into BSP pieces (each a list of its corners, all facing the face's way): the sum of
// each piece's own area vector. null when a piece faces away from it (more than a right angle: a piece left from an
// older build, mirrored, or of another plane: 104 of the 1,014,134 faces of the cached maps) or the pieces have no
// area: only a Rebuild shows such a face's alignment.
export function piecesNormal(pieces) {
  if (!Array.isArray(pieces)) return null;
  const areas = pieces.map(areaOf), n = safeNormal(areas.reduce(add, [0, 0, 0]));
  if (!dot(n, n) || areas.some((a) => dot(a, n) < 0)) return null;
  return n;
}
const isPieces = (x) => Array.isArray(x) && Array.isArray(x[0]) && Array.isArray(x[0][0]);
// The normal of the source polygon, the one UC_SURFACE edits, from the face's corners: those of one polygon (one BSP
// piece, or a triangle of one), or the face's pieces, a list of them (piecesNormal: null when they face opposite
// ways). null too for corners with no area (on a line: a plane they do not make). A subtractive brush (csg 2,
// UC_BRUSHES) had its polygons reversed by the CSG, so its source polygon faces the other way.
export function sourceNormal(points, csg) {
  const n = isPieces(points) ? piecesNormal(points) : faceNormal(points);
  if (!n || !dot(n, n)) return null;
  return csg === 2 ? flip(n) : n;
}

// ---------------------------------------------------------------- the host's operations

// what surfaces.py takes (MODES, FLAGS): the operations and the Look bits
const HOST_OPS = new Set(['floor', 'wall', 'tile', 'tile-u', 'tile-v', 'cylinder', 'pan', 'scale', 'rotate', 'flip-u',
  'flip-v', 'texture', 'shadows', 'flags']);
const FLAG_MASK = 0x1 | 0x2 | 0x4 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800 | 0x100000 | 0x400000 | 0x8000000;
const TEXTURE_NAME = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
const BRUSH_NAME = /^[A-Za-z0-9_]{1,127}$/;
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isBits = (v) => Number.isInteger(v) && v >= 0 && v <= FLAG_MASK;   // (no larger: JS bit operations keep 32 bits)
// the host's own refusals of a face (editSurface), in its words
const PAN_REFUSED = "Pan exceeds the engine's signed 16-bit range";
const FIT_REFUSED = 'Cannot fit this face: degenerate UVs or no texture';

// surfaces.py's checks of a row's operation and arguments (commands()): its reason, '' when it takes them. No args is
// none (row.get('args', [])); args null is not a list.
function argsProblem(row) {
  const { op } = row, args = row.args === undefined ? [] : row.args;
  if (!HOST_OPS.has(op)) return 'Unknown surface operation.';
  if (!Array.isArray(args)) return 'Invalid surface arguments.';
  if (op === 'pan' || op === 'scale') {
    if (args.length !== 2 || !args.every(isNumber)) return 'U and V must be finite numbers.';
    if (op === 'scale' && !args.every((v) => v >= SCALE_MIN && v <= SCALE_MAX)) return 'Scale factors must be between 0.001 and 1000.';
    if (op === 'pan' && !args.every((v) => Number.isInteger(v) && Math.abs(v) <= PAN_LIMIT)) return 'Pan uses whole texels, between -32767 and 32767.';
  } else if (op === 'shadows') {
    if (args.length !== 1 || !['low', 'normal', 'high'].includes(args[0])) return 'Shadow detail must be Low, Normal or High.';
  } else if (op === 'flags') {
    if (args.length !== 2 || !args.every(isBits) || ((args[0] | args[1]) & ~FLAG_MASK) || (args[0] & args[1])) {
      return 'Surface flags: set and clear are bits of the Look list, never the same one.';
    }
  } else if (op === 'texture') {
    if (args.length !== 1 || typeof args[0] !== 'string' || !TEXTURE_NAME.test(args[0]) || args[0].length > 240) {
      return 'Choose a loaded texture by its package and name.';
    }
  } else if (args.length) return 'This surface operation takes no arguments.';
  return '';
}
// A row of edits.surfaces as surfaces.py checks it (in its order, with its reason), '' when it takes it. One refused
// row fails every Save of the map's edits (and so every Rebuild, which saves first), whichever faces it aims at: the
// page checks a row before it queues it.
export function rowProblem(row) {
  if (!row || typeof row !== 'object' || !HOST_OPS.has(row.op)) return 'Unknown surface operation.';
  const { targets } = row;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > TARGET_LIMIT) return 'Select one or more source faces.';
  const why = argsProblem(row);
  if (why) return why;
  for (const t of targets) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return 'Invalid source face target.';
    if (typeof t.brush !== 'string' || !BRUSH_NAME.test(t.brush)) return 'Invalid source brush name.';
    if (t.poly !== '*' && !(Number.isInteger(t.poly) && t.poly >= 0 && t.poly <= 65535)) return 'Invalid source face index.';
    if (row.op === 'cylinder' && t.poly !== '*') return 'Cylinder alignment applies to all the brush side faces.';
  }
  return '';
}
// The whole of edits.surfaces as surfaces.py checks it on Save (commands()): a list (none: none) of no more than
// ROW_LIMIT rows, each taken by rowProblem; its first reason, '' when it takes it all.
export function queueProblem(rows) {
  const queue = rows || [];
  if (!Array.isArray(queue) || queue.length > ROW_LIMIT) return 'Surface edits must be a list (up to 4096 operations).';
  for (const row of queue) {
    const why = rowProblem(row);
    if (why) return why;
  }
  return '';
}

// Floor and Wall (editSurface in UCEngineBridge.cpp): U level (a wall's along the wall, a floor's along x), V the
// normal's turn of it, the base where the plane meets the normal through the world's origin, no pan. Anchored to the
// world's axes and origin: see the frame under mappingAfter.
function aligned(m, shape, wall) {
  if (!shape.normal || !shape.points?.length) return null;
  const n = safeNormal(shape.normal);
  let u = wall && Math.abs(n[2]) < 0.999 ? safeNormal(cross(n, [0, 0, 1])) : safeNormal(sub([1, 0, 0], times(n, n[0])));
  if (dot(u, u) < 0.5) u = safeNormal(sub([0, 1, 0], times(n, n[1])));
  return { ...m, base: times(n, dot(shape.points[0], n)), u, v: wall ? cross(n, u) : cross(u, n), pan: [0, 0] };
}
// One Tile, One Tile U / V (fitSurface): one tile over the face's width and height along its U and V (V made square to
// U), from its corners. The view has the corners of the BSP pieces it sees, so this is exact when the whole face shows.
// The host refuses a face with no width or height along them, or with no texture.
function fitted(m, shape, mode) {
  const { normal, points } = shape;
  if (!normal || !points || points.length < 3) return null;
  const n = safeNormal(normal);
  let u = safeNormal(sub(m.u, times(n, dot(m.u, n))));
  if (dot(u, u) < 0.5) u = safeNormal(sub(points[1], points[0]));
  let v = safeNormal(sub(sub(m.v, times(n, dot(m.v, n))), times(u, dot(m.v, u))));
  if (dot(v, v) < 0.5) v = cross(u, n);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of points) {
    const d = sub(p, points[0]), x = dot(d, u), y = dot(d, v);
    u0 = Math.min(u0, x); u1 = Math.max(u1, x); v0 = Math.min(v0, y); v1 = Math.max(v1, y);
  }
  if (u1 - u0 < 0.001 || v1 - v0 < 0.001 || m.bare) return FIT_REFUSED;
  let su = m.tile[0] / (u1 - u0), sv = m.tile[1] / (v1 - v0);
  if (mode === 'tile-u') sv = su;
  if (mode === 'tile-v') su = sv;
  return { ...m, base: add(points[0], add(times(u, u0), times(v, v0))), u: times(u, su), v: times(v, sv), pan: [0, 0] };
}
const pannable = (m, x, y) => Math.abs(m.pan[0] + x) <= PAN_LIMIT && Math.abs(m.pan[1] + y) <= PAN_LIMIT;

// Whether Around a cylinder wraps a face, as the host's wrapSurfaceCylinder (UCEngineBridge.cpp) picks its brush's
// faces: a side, its normal level (z within 0.001; normal: its source polygon's either way, as mappingAfter's shape has
// it from its pieces), or a face whose plane is not known (it may be one). A cap keeps its mapping (OPS.cylinder,
// resetsOf)
const wrapsSide = (normal) => !normal || Math.abs(safeNormal(normal)[2]) <= 0.001;

// What each operation does to a face's mapping, as editSurface (UCEngineBridge.cpp) does it to the source polygon in
// the world, its arguments already checked (argsProblem): (mapping, args, shape) -> the mapping after it, null when
// the view cannot know it, or the host's reason when it refuses the face (which fails the whole Rebuild).
const OPS = {
  // whole texels added to the pan; beyond the engine's 16 bits the host refuses it
  pan: (m, [x, y]) => (pannable(m, x, y) ? { ...m, pan: [m.pan[0] + x || 0, m.pan[1] + y || 0] } : PAN_REFUSED),
  // U and V divided by the factors: 2 makes the texture twice as large, round the base point (the pan stays)
  scale: (m, [x, y]) => ({ ...m, u: m.u.map((c) => c / x || 0), v: m.v.map((c) => c / y || 0) }),
  // a quarter turn: U takes V, V takes -U, and their pans with them
  rotate: (m) => ({ ...m, u: m.v, v: flip(m.u), pan: [m.pan[1], minus(m.pan[0])] }),
  'flip-u': (m) => ({ ...m, u: flip(m.u), pan: [minus(m.pan[0]), m.pan[1]] }),
  'flip-v': (m) => ({ ...m, v: flip(m.v), pan: [m.pan[0], minus(m.pan[1])] }),
  floor: (m, args, shape) => aligned(m, shape, false),
  wall: (m, args, shape) => aligned(m, shape, true),
  tile: (m, args, shape) => fitted(m, shape, 'tile'),
  'tile-u': (m, args, shape) => fitted(m, shape, 'tile-u'),
  'tile-v': (m, args, shape) => fitted(m, shape, 'tile-v'),
  // round all the brush's sides at once (wrapsSide): a side's share is known only after a Rebuild (and whether the host
  // takes the brush: its sides must close round it with one texture); caps keep theirs
  cylinder: (m, args, shape) => (wrapsSide(shape.normal) ? null : m),
  // the same mapping on another texture: its tile (whether the host finds the texture loaded shows at the Rebuild)
  texture: (m, [ref], shape) => {
    const tile = shape.tileOf?.(ref);
    if (!(tile && tile[0] > 0 && tile[1] > 0)) return null;
    const { bare, ...textured } = m;
    return { ...textured, tile: [exactTile(tile[0]), exactTile(tile[1])] };
  },
  shadows: (m) => m,
  flags: (m) => m,
};

// A face's mapping after rows of edits.surfaces (their op and args; the targets are not looked at), in their order:
// exactly as the host leaves it; null when an operation's result shows only after a Rebuild (Around a cylinder, an
// alignment with no shape, a texture whose tile is not known, a row pendingRows could not take back: op 'unknown');
// a refusal (see the top): stage 'save' when surfaces.py refuses one of the rows, whatever their order (it checks
// them all first), stage 'rebuild' when the host refuses this face. Given a refusal, it gives it back.
// shape: { normal: the source polygon's normal as the host has it: sourceNormal of the face's pieces (or of one of
// them), never of all its pieces' corners in one list (see faceNormal); points: the face's corners in the world, every
// piece's (One Tile spans them all); tileOf(texture): the tile [w, h] of a texture a texture row puts on it }.
// The frame: the mapping and shape as the next Rebuild will find the brush (where it is now). Floor and Wall are
// anchored to the world's axes and origin, so on a structure moved or turned since the Rebuild they come out otherwise
// than in the frame it was built in (moved by t: by t . U texels); pan, scale, rotate, the flips and One Tile go with
// the brush, and give the same in either frame.
export function mappingAfter(mapping, rows, shape = {}) {
  if (isRefusal(mapping)) return mapping;
  for (const row of rows) {                      // surfaces.py checks every row before the host runs one
    const why = row.op === 'unknown' ? '' : argsProblem(row);
    if (why) return { refused: why, row, stage: 'save' };
  }
  let m = mapping;
  for (const row of rows) {
    if (!m) return null;
    const after = row.op === 'unknown' ? null : OPS[row.op](m, row.args ?? [], shape);
    if (typeof after === 'string') return { refused: after, row, stage: 'rebuild' };
    m = after;
  }
  return m;
}

// ---------------------------------------------------------------- the rows of a face

const INDEXED = Symbol('rows by face');
// Rows of edits.surfaces indexed by the faces they name, once for many faces (every face of the view, a slip's
// preview): rowsFor and mappingNow take it in place of the rows and find a face's rows without going through them all.
// Built from the rows as they are: index them again after the queue changes.
export function indexRows(rows = []) {
  const brushes = new Map();
  rows.forEach((row, at) => {
    if (!Array.isArray(row?.targets)) return;
    for (const t of row.targets) {
      if (!t) continue;
      if (!brushes.has(t.brush)) brushes.set(t.brush, new Map());
      const polys = brushes.get(t.brush);
      if (!polys.has(t.poly)) polys.set(t.poly, []);
      polys.get(t.poly).push(at);                // once per target that names it
    }
  });
  return { [INDEXED]: true, rows, brushes };
}
// The rows that edit a face ({brush, poly}): those aimed at it or at its whole brush ('*'), in their order, each once
// per target that names it, as surfaces.py sends a UC_SURFACE per target (a row aimed at '*' and at the face, or at the
// face twice, edits it twice). rows: the rows, gone through (for a face or a few), or indexRows of them, looked up (for
// many faces: going through them for each face of a big map takes seconds).
export function rowsFor(face, rows) {
  if (!rows?.[INDEXED]) {
    const names = (t) => !!t && t.brush === face.brush && (t.poly === '*' || t.poly === face.poly);
    return (rows || []).flatMap((r) => (Array.isArray(r?.targets) ? r.targets.filter(names).map(() => r) : []));
  }
  const polys = rows.brushes.get(face.brush);
  if (!polys) return [];
  const own = polys.get(face.poly) || [], all = polys.get('*') || [], at = [];
  // the face's own and its brush's, each in the rows' order already: merged into it
  for (let i = 0, j = 0; i < own.length || j < all.length;) at.push(j >= all.length || (i < own.length && own[i] <= all[j]) ? own[i++] : all[j++]);
  return at.map((k) => rows.rows[k]);
}
// a face's mapping now: the one the view was built with (face.mapping) after the rows not built yet that edit it
// (null, or a refusal, as mappingAfter); rows: those rows, or indexRows of them (for many faces)
export function mappingNow(face, rows, shape = {}) {
  return face.mapping ? mappingAfter(face.mapping, rowsFor(face, rows), shape) : null;
}

// ---------------------------------------------------------------- the rows the view does not show yet

const sameList = (a = [], b = [], same = (x, y) => x === y) => a.length === b.length && a.every((x, i) => same(x, b[i]));
const sameTarget = (a, b) => a.brush === b.brush && a.poly === b.poly;
function sameRow(a, b) {
  return a.op === b.op && sameList(a.args, b.args) && sameList(a.targets, b.targets, sameTarget);
}
// what takes a row back, on the mapping (shadows and flags do not touch it); none for those that forget the mapping
const UNDO = {
  pan: (r) => [{ ...r, args: r.args.map(minus) }],
  scale: (r) => [{ ...r, args: r.args.map((x) => 1 / x) }],
  rotate: (r) => [r, r, r],
  'flip-u': (r) => [r],
  'flip-v': (r) => [r],
  shadows: () => [],
  flags: () => [],
};
// The rows of edits.surfaces the faces shown do not have: built, the rows the last Rebuild replayed (they are replayed
// from the source map every time, so the view's mappings have them all); current, edits.surfaces now. Rows taken back
// since (Undo after a Rebuild) come first, undone in reverse order; one that cannot be undone (an alignment, a texture)
// becomes an 'unknown' row on its faces, which mappingAfter leaves to a Rebuild.
export function pendingRows(built = [], current = []) {
  let same = 0;
  while (same < built.length && same < current.length && sameRow(built[same], current[same])) same++;
  const back = built.slice(same).reverse().flatMap((r) => UNDO[r.op]?.(r) || [{ op: 'unknown', args: [], targets: r.targets }]);
  return [...back, ...current.slice(same)];
}

// ---------------------------------------------------------------- faces round an edge

// Where faces a and b (each { normal: a unit vector }) meet, on a side they share as each has it (face-grow.js
// sharedSides': onA and onB, [from, to] on each one's own edge, from their corners as the view has them, not from their
// planes: a corner the engine left a little off its plane turns those): { spans: from one end of the side to the other
// on each, points: its middle on each, plane: the normal of faces in one plane (none for faces at an angle) }; back to
// back, nowhere a texture runs on from one to the other (null).
function meeting(a, b, onA, onB) {
  const sin = Math.hypot(...cross(a.normal, b.normal));
  if (sin < FLAT && dot(a.normal, b.normal) <= 0) return null;
  const middle = (side) => times(add(side[0], side[1]), 0.5);
  return { spans: [sub(onA[1], onA[0]), sub(onB[1], onB[0])], points: [middle(onA), middle(onB)], plane: sin < FLAT ? a.normal : null };
}
// Whether the texture runs on from mapping m to mapping n over the side their faces share (meeting's, m and n in its
// order): what their U and V show there, each face along its own edge, goes apart by no more than DRIFT texels from one
// end of the side to the other, at the scale the faces were built at (scaled: [U, V], what the rows since the faces
// were built before the first slip kept on them, queued or rebuilt since, have made the texture larger by on each axis,
// see scaledOf; a texture made smaller by k shows a drift 1 / k times as many texels). Across the side they need not
// agree: a box's Floor and Wall meet there mirrored, two faces of one floor can be mirrored or stretched over the seam
// between them.
function runsOn(m, n, meet, scaled) {
  const keeps = (a, b, k) => Math.abs(dot(a, meet.spans[0]) - dot(b, meet.spans[1])) * scaled[k] <= DRIFT;
  return keeps(m.u, n.u, 0) && keeps(m.v, n.v, 1);
}
// whether mappings m and n of faces in one plane (normal: the plane's) have the same axes all over it: U and V along
// the plane within SAME_AXES of the larger axis
function samePlaneAxes(m, n, normal) {
  const most = SAME_AXES * Math.max(...[m.u, m.v, n.u, n.v].map((a) => Math.hypot(...a)));
  const along = (d) => Math.hypot(...sub(d, times(normal, dot(d, normal))));
  return along(sub(m.u, n.u)) <= most && along(sub(m.v, n.v)) <= most;
}
// What mapping m shows more than mapping n where their faces meet, [U, V] in texels (at: the middle of the side they
// share on m's face's edge and on n's, meeting's points): what carriedOn, stepRank and shownSince weigh a side by
function showsMore(m, n, [atM, atN]) {
  const a = texelOf(m, atM), b = texelOf(n, atN);
  return [a[0] - b[0], a[1] - b[1]];
}
// The mapping c a face g scales round, carried on to its neighbour f (f and g: their mappings) where they meet (at:
// meeting's points): the same axes, the pan moved by what f shows there more than g (showsMore). Where the texture runs
// on that is the same all along the side, whatever the angle and whatever the texture does across it, so the two scale
// round texels that stay that far apart: the edge stays as it was.
function carriedOn(c, f, g, at) {
  const more = showsMore(f, g, at);
  return { ...c, pan: [c.pan[0] + more[0], c.pan[1] + more[1]] };
}
// Where the texture runs on from face g to its neighbour f (sf and sg: theirs in carriedRound's solid; f and g: the
// faces, startSlip's; scaled: the larger of their scales on each axis, see runsOn), over one of the sides they share
// (sides: [on g, on f] each): { meet: meeting's, rank: between two textures 0, or -1 where a slip has parted it since
// the first slip kept on the faces (partedSince); of one texture sideRank's: 0.5 where it steps and a slip has parted
// it since, else its stepRank on the faces' exact mappings } on the side of the highest rank among those it runs on
// over, then the one nearest the pointer's point (a face set in another shares four, the texture may run on over two
// and not the others: one where it already steps parts first), or null.
function crossing(sf, sg, f, g, sides, point, scaled) {
  let best = null, nearest = Infinity;
  for (const [onG, onF] of sides) {
    const meet = meeting(sf, sg, onF, onG);
    if (!meet || !runsOn(f.mapping, g.mapping, meet, scaled)) continue;
    const rank = f.tex === g.tex ? sideRank(f, g, meet) : partedSince(f, g, meet) ? -1 : 0;
    const away = Math.hypot(...sub(meet.points[0], point));
    if (!best || rank > best.rank || (rank === best.rank && away < nearest)) { best = { meet, rank }; nearest = away; }
  }
  return best;
}
// The faces that share a piece of an edge, of shapes (face-grow.js faceShapes'): Map id -> the faces beside it, [{ id,
// sides: those they share (face-grow.js sharedSides), each [on this face's edge, on that face's] }], in their ids' order.
// The faces' boxes are swept along the axis they spread most, only those that overlap on it compared.
function neighbours(shapes) {
  const list = [...shapes], near = new Map(list.map(([id]) => [id, []]));
  const spread = [0, 1, 2].map((k) => list.reduce((hi, [, s]) => Math.max(hi, s.hi[k]), -Infinity)
    - list.reduce((lo, [, s]) => Math.min(lo, s.lo[k]), Infinity));
  const axis = spread.indexOf(Math.max(...spread));
  list.sort((a, b) => a[1].lo[axis] - b[1].lo[axis]);
  list.forEach(([a, s], i) => {
    for (let j = i + 1; j < list.length && list[j][1].lo[axis] <= s.hi[axis] + EDGE_TOLERANCE; j++) {
      const [b, o] = list[j], sides = sharedSides(s, o);
      if (!sides.length) continue;
      near.get(a).push({ id: b, sides });
      near.get(b).push({ id: a, sides: sides.map(([here, there]) => [there, here]) });
    }
  });
  for (const beside of near.values()) beside.sort((x, y) => x.id - y.id);
  return near;
}
// A binary heap: push, and pop (the item before() puts first, taken off), each a path between the top and a leaf (the
// walk below offers sides by the thousand on a big selection, never gone through one by one); size: the items in it.
export function heapOf(before) {
  const items = [];
  const swap = (i, j) => { [items[i], items[j]] = [items[j], items[i]]; };
  return {
    get size() { return items.length; },
    push(item) {
      items.push(item);
      for (let i = items.length - 1; i > 0 && before(items[i], items[(i - 1) >> 1]); i = (i - 1) >> 1) swap(i, (i - 1) >> 1);
    },
    pop() {
      const top = items[0], last = items.pop();
      if (items.length) {
        items[0] = last;
        for (let i = 0, next = 0; ; i = next) {
          for (const child of [2 * i + 1, 2 * i + 2]) if (child < items.length && before(items[child], items[next])) next = child;
          if (next === i) break;
          swap(i, next);
        }
      }
      return top;
    },
  };
}
// Whether texels d apart show a step: more than STEP texels (give or take NOISE), whole tiles of tile texels taken off
// first (none: 0). The one threshold of stepsBy and partedSince
const beyondStep = (d, tile = 0) => Math.abs(tile > 0 ? d - tile * Math.round(d / tile) : d) > STEP + NOISE;
// Whether the mappings m and n of two faces of one texture show a step where one shows d texels more than the other on
// axis k (beyondStep): whole tiles taken off when the two have the same tile
function stepsBy(d, m, n, k) {
  return beyondStep(d, m.tile[k] === n.tile[k] ? m.tile[k] : 0);
}
// How a side between faces of one texture shows it now (m and n: their exact mappings, meet: meeting's): what m shows
// more than n at its middle (showsMore), a step or none as stepsBy: 3 no step (on both axes), 2 a step only across the
// side (faces at an angle, on an axis whose texels change by less than ALONG along it: a ring's corner where its
// texture steps as built, a riser's V over a tread's), 1 a step along it (faces in one plane: a step on either axis)
function stepRank(m, n, meet) {
  const more = showsMore(m, n, meet.points), steps = (k) => stepsBy(more[k], m, n, k);
  const along = (k) => !!meet.plane || Math.abs(dot([m.u, m.v][k], meet.spans[0])) >= ALONG;
  if ([0, 1].some((k) => along(k) && steps(k))) return 1;
  return [0, 1].some(steps) ? 2 : 3;
}
// How far a side has gone apart since the first slip kept on its faces (f and g: startSlip's faces, meet: meeting's):
// what f shows more than g at the side's middle (showsMore) on their exact mappings, less what it showed on their
// mappings before that slip (startSlip's before), [U, V] in texels; null without both mappings before. What partedSince
// and steppedSince weigh a side by
function shownSince(f, g, meet) {
  if (!f.before || !g.before) return null;
  const now = showsMore(exactMapping(f), exactMapping(g), meet.points), then = showsMore(f.before, g.before, meet.points);
  return [now[0] - then[0], now[1] - then[1]];
}
// Whether a slip has parted a side between two textures since the first slip kept on its faces (f and g: startSlip's
// faces, meet: meeting's): shownSince beyond a step on an axis (beyondStep). A slip keeps it at every side it crosses
// (the face carried on, both scaled round the texels carried), so it moves where a ring parted, where a Pan, a Scale or
// an alignment was queued on one of the faces alone, and where a Scale or an alignment queued on both moves what one
// face shows at the side by more than STEP against the other (each face scales round its own base point: faces mapped
// from one base point with the same axes, as the panel's Floor alignment leaves them, or from base points close
// together, do not part; the sides that do count as parted, and crossedFirst's order decides); false without both
// mappings before
function partedSince(f, g, meet) {
  return !!shownSince(f, g, meet)?.some((d) => beyondStep(d));
}
// Whether a slip has parted a side of one texture since the first slip kept on its faces (f and g: startSlip's faces,
// meet: meeting's): shownSince a step on an axis as stepsBy (whole tiles taken off when the two have the same tile: a
// slip that made the texture smaller shows a side's whole tiles as more texels); false without both mappings before
function steppedSince(f, g, meet) {
  return !!shownSince(f, g, meet)?.some((d, k) => stepsBy(d, exactMapping(f), exactMapping(g), k));
}
// How the walk ranks a side between faces of one texture (f and g: startSlip's faces, meet: meeting's): its stepRank on
// their exact mappings, or 0.5 where it steps and a slip has parted it since the first slip kept on its faces
// (steppedSince); a side lined up since (a roll of one face alone, a Pan of one) shows no step and ranks as one
function sideRank(f, g, meet) {
  const rank = stepRank(exactMapping(f), exactMapping(g), meet);
  return rank < 3 && steppedSince(f, g, meet) ? 0.5 : rank;
}
// Which of two sides on offer the walk crosses first (carriedRound): the higher rank (crossing's: of one texture its
// stepRank, no step, then a step only across the side, then one along it, then 0.5 where it steps and a slip has parted
// it since the first slip kept on its faces, sideRank; 0 for a side between two textures, -1 for one a slip has parted
// since), then the longer (in whole units: the view's rounding decides nothing), then the lower order (carriedRound's:
// below a rank of 1, a side a slip parted or one between two textures, by their faces' brushes and polygons, the same
// whichever face the walk starts from; else the order offered)
export const crossedFirst = (a, b) => (a.rank !== b.rank ? a.rank > b.rank
  : a.length !== b.length ? a.length > b.length : a.order < b.order);
// the mapping a face's slip works on: as the slip before left it, its pan not rounded to whole texels (startSlip's
// exact), or as it is; none for a face left out
const exactMapping = (f) => f.mapping && (f.exact || f.mapping);
// the scale the rows since startSlip's built (the face as built before the first slip kept on it) have given it on
// each axis, [U, V]: the length of the axis as built that the axis now lies along, picked by direction (a Rotate swaps
// U and V; by their dot product a longer skewed axis would win), over its length now; [1, 1] with none: what its sides'
// drift is judged at (runsOn)
const scaledOf = (f) => (f.built && f.mapping ? [f.mapping.u, f.mapping.v].map((a) => {
  const along = (b) => Math.abs(dot(a, b)) / Math.hypot(...b), b = along(f.built.u) >= along(f.built.v) ? f.built.u : f.built.v;
  return Math.hypot(...b) / Math.hypot(...a);
}) : [1, 1]);
// Each face's place among the faces sorted by brush, then polygon: a key of the face itself, whatever order the faces
// were selected in or the walk reaches them in
function placesOf(faces) {
  const sorted = faces.map((f, i) => i).sort((a, b) => (faces[a].brush < faces[b].brush ? -1 : faces[a].brush > faces[b].brush ? 1
    : faces[a].poly - faces[b].poly));
  const place = [];
  sorted.forEach((i, at) => { place[i] = at; });
  return place;
}
// Each face's mapping carried round the edges from the face under the pointer (faces, ref, point: startSlip's; each
// face's exact mapping, see startSlip): the texel it shows at the pointer's point is the one the face scales round
// (slipScale), so a texture that runs on round an edge (a room's corners, the sides of a column, two faces of a floor
// mirrored over their seam) stays one there. From that face over the edges where the texture runs on (runsOn: not from
// a wall onto a floor aligned otherwise), the best side on offer crossed first (Prim's tree, crossedFirst: a side of
// one texture that shows no step, then one that steps only across it, then along it, then one that steps where a slip
// has parted it since the first slip kept on its faces, a side between two textures after those, and last of all one of
// those a slip has parted since; then the longer, ties in the order offered, or below a rank of 1 in the order of their
// faces' brushes and polygons), each face given its neighbour's carried on to it at the middle of the side they share
// (carriedOn; of two faces sharing several the texture runs on over, the side of the highest rank, then the one nearest
// the pointer's point: crossing); in that walk a face in the plane of one that keeps its own mapping, with the same
// axes all over it (samePlaneAxes), keeps its own too, so the face under the pointer and the faces beside it in its
// plane scale round the pointer's point as ever. The faces that walk does not reach get one of their own, from the one
// nearest the pointer's point (by its middle; ties in the faces' order), which keeps its own mapping, the others
// carried on from it (the pointer's point is off their plane, where axes that leave it otherwise part them): so a
// room's walls stay one with the pointer on its floor. A face no edge joins keeps its own; a face left out (no mapping:
// only a Rebuild shows it) joins none, null. A closed ring (a room's walls, round a column, a face set in another)
// closes at one side, the one that parts (a texture n tiles round, scaled by k, would be n / k): a side between two
// textures when it has one (what one texture shows more than another there means nothing), first one a slip has parted
// since the first slip kept on its faces (partedSince); then a side of one texture that steps where a slip has parted
// it since (steppedSince, sideRank: one lined up since, by a roll of one face alone or a Pan, shows no step and ranks
// as one, stepRank's 3: the ring parts at a side that still steps, and where none does at one that shows no step,
// perhaps one lined up), so a slip kept after another parts the ring again where that one did while its texture still
// steps there, not at another side where its texture steps; of two alike the shorter, then the one whose pair of faces
// comes later by brush and polygon (pairOrder: the lower place first, then the higher), whichever face the walk starts
// from; then one where its texture already steps (stepRank); else its shortest; of equal sides of one texture, the one
// farthest round from where its walk starts.
function carriedRound(faces, ref, point) {
  // the faces with a mapping and a plane: their normal, the middle of their corners and the scale their sides' drift
  // is judged at (scaledOf)
  const solid = faces.map((f) => {
    const normal = f.mapping && piecesNormal(f.pieces);
    if (!normal) return null;
    const points = f.pieces.flat();
    return { normal, middle: times(points.reduce(add, [0, 0, 0]), 1 / points.length), scaled: scaledOf(f) };
  });
  // their triangles as face-grow.js takes a mesh's (their pieces' fans: each face's box and normal), and their pieces as
  // they are (each face's outline)
  const pos = [], owner = [], pieces = new Map();
  faces.forEach((f, i) => {
    if (!solid[i]) return;
    pieces.set(i, f.pieces);
    for (const piece of f.pieces) for (let j = 2; j < piece.length; j++) { pos.push(...piece[0], ...piece[j - 1], ...piece[j]); owner.push(i); }
  });
  const near = neighbours(faceShapes([{ pos, faces: owner, matrix: null, pieces }]));
  // each face's mapping once reached, and whether it is its own; the sides offered, counted; each face's place by brush
  // and polygon, whose pairs order the sides ranked below 1 (a slip parted them, or they are between two textures): a
  // number for each pair (the lower place times the faces' count, plus the higher), the same from either face
  const carried = faces.map(() => null), own = faces.map(() => false), place = placesOf(faces);
  const pairOrder = (f, g) => Math.min(place[f], place[g]) * faces.length + Math.max(place[f], place[g]);
  let offered = 0;
  const walk = (root) => {
    carried[root] = exactMapping(faces[root]);
    own[root] = true;
    // the sides on offer: from each face reached to the neighbours not reached yet its texture runs on to
    const offers = heapOf(crossedFirst);
    const offer = (g) => {
      for (const { id: f, sides } of near.get(g) || []) {
        if (carried[f]) continue;
        const scaled = [0, 1].map((k) => Math.max(solid[f].scaled[k], solid[g].scaled[k]));
        const best = crossing(solid[f], solid[g], faces[f], faces[g], sides, point, scaled);
        if (best) offers.push({ f, g, meet: best.meet, rank: best.rank, length: Math.round(Math.hypot(...best.meet.spans[0])),
          order: best.rank >= 1 ? offered++ : pairOrder(f, g) });
      }
    };
    offer(root);
    while (offers.size) {
      const { f, g, meet } = offers.pop();
      if (carried[f]) continue;
      own[f] = own[g] && root === ref && !!meet.plane && samePlaneAxes(faces[f].mapping, faces[g].mapping, meet.plane);
      carried[f] = own[f] ? exactMapping(faces[f]) : carriedOn(carried[g], exactMapping(faces[f]), exactMapping(faces[g]), meet.points);
      offer(f);
    }
  };
  const away = (i) => Math.hypot(...sub(solid[i].middle, point));
  const rest = faces.map((f, i) => i).filter((i) => solid[i] && i !== ref).sort((a, b) => away(a) - away(b));
  for (const root of solid[ref] ? [ref, ...rest] : rest) if (!carried[root]) walk(root);
  return faces.map((f, i) => carried[i] || exactMapping(f));
}

// ---------------------------------------------------------------- the slip

// Starts a slip. faces: the faces selected, [{ id (the page's, given back), brush, poly, mapping: as it is now
// (mappingNow): null when only a Rebuild shows it, then the face is left out of the slip; pieces: its BSP pieces, each
// the list of its corners, where the point is (piecesOf; none: no edge joins it to the others, see carriedRound); tex:
// its texture now (the one built, or a queued texture row's): the walk crosses sides between two textures last (faces
// given none count as one texture); exact: none, or its mapping as the slip kept last on it in this state left it, its
// pan not rounded to whole texels (slipResult's preview), while its mapping is still that one (exactsNow): the slip
// works on it and rounds once, so slips kept one after the other do not add up their rounding; built: none, or its
// mapping as built before the first slip kept on it (as the last Rebuild built it, the one its queued rows start from,
// when no slip was), whose scale its sides' drift is judged at (DRIFT), so a side runs on over every slip of the same
// faces or none, whatever is queued or rebuilt between them; before: none, or its mapping before the first slip kept on
// it in the map's state now (the slips the Undo history has not taken back; its mapping now when no slip was), against
// which a side is known parted (partedSince between two textures, steppedSince of one) }]; ref: the one under the
// pointer (its index in faces), the face the texture follows; point: the point of it under the pointer, [x, y, z];
// normal: its plane's (either side).
// It gives a session, or { error } (no faces, no point or plane, the face under the pointer only a Rebuild shows, a
// selected face whose queued rows Save or the build would refuse): the page checks .error first. Given that { error }
// instead of a session, the functions below keep to it: those that give a session give it back, slipResult has no
// rows and says the error, slipHud says it, rayPoint and snapStep give null. Anything else throws a TypeError.
// A session is data: the functions below give a new one. Esc is dropping it.
export function startSlip({ faces, ref = 0, point, normal } = {}) {
  if (!Array.isArray(faces) || !faces.length) return { error: 'Select faces first.' };
  if (!Number.isInteger(ref) || !faces[ref]) return { error: 'Point at one of the selected faces.' };
  const refused = faces.find((f) => isRefusal(f.mapping));
  if (refused) {
    const why = refused.mapping.refused.replace(/\.$/, '');
    return { error: refused.mapping.stage === 'save'
      ? `The map could not be saved with a change queued on a selected face (${why}): take that change back first.`
      : `The Rebuild would fail on a selected face (${why}): take that change back first.` };
  }
  if (!faces[ref].mapping) return { error: 'Rebuild first: a change queued on this face shows only after a Rebuild.' };
  if (!isPoint(point)) return { error: 'No point of the face under the pointer.' };
  const n = isPoint(normal) ? safeNormal(normal) : [0, 0, 0];
  if (!dot(n, n)) return { error: 'This face has no plane to slip on.' };
  // e: the scale as a power of two (4 notches are exactly twice as large), k: the factor as the row has it;
  // drag: the pan the pointer gave (every face gets it); comp: each face's own pan that keeps the point under the
  // pointer where it was when scaling (null for a face left out); carried: each face's mapping carried round the edges
  // from the face under the pointer (carriedRound), whose texel at the pointer's point the face scales round
  return { faces, ref, plane: { point, normal: n }, at: point, e: 0, k: 1, drag: [0, 0],
    comp: faces.map((f) => (f.mapping ? [0, 0] : null)), carried: carriedRound(faces, ref, point), fine: false, snap: false };
}
// true for startSlip's { error }; a TypeError for what is neither that nor a session
function failed(s) {
  if (s && typeof s === 'object' && s.error) return true;
  if (!s || typeof s !== 'object' || !s.plane || !Array.isArray(s.faces)) {
    throw new TypeError('Texture Slip: not a session (startSlip gives one, or { error })');
  }
  return false;
}

// where a ray of the pointer (origin and direction, in the map's frame) meets the face's plane; null when it runs
// along the plane or meets it behind
export function rayPoint(s, origin, direction) {
  if (failed(s) || !isPoint(origin) || !isPoint(direction)) return null;
  const n = s.plane.normal, along = dot(direction, n), length = Math.hypot(...direction);
  if (!length || Math.abs(along) < GRAZING * length) return null;
  const t = dot(sub(s.plane.point, origin), n) / along;
  return t > 0 ? add(origin, times(direction, t)) : null;
}
const onPlane = (s, p) => sub(p, times(s.plane.normal, dot(sub(p, s.plane.point), s.plane.normal)));
const reference = (s) => s.faces[s.ref].mapping;
const held = (mods) => ({ fine: !!mods.shift, snap: !!mods.ctrl });

// The pointer at a point of the face's plane: the texture follows it, the texel that was under the pointer stays under
// it (Shift: it goes an eighth of the way; Ctrl: the pan snaps, see slipResult). No point (rayPoint found none): it stays.
export function slipPan(s, point, mods = {}) {
  if (failed(s)) return s;
  if (!isPoint(point)) return { ...s, ...held(mods) };
  const p = onPlane(s, point), m = reference(s), d = times(sub(p, s.at), mods.shift ? FINE_DRAG : 1);
  return { ...s, ...held(mods), at: p, drag: [s.drag[0] - dot(d, m.u) / s.k, s.drag[1] - dot(d, m.v) / s.k] };
}
// whole texels more on the pan, as the panel's Pan U/V (an arrow key); with Ctrl, steps of the snap
export function slipNudge(s, du, dv, mods = {}) {
  if (failed(s)) return s;
  const [a, b] = mods.ctrl ? snapStep(s) : [1, 1];
  return { ...s, ...held(mods), drag: [s.drag[0] + (Number.isFinite(du) ? du : 0) * a, s.drag[1] + (Number.isFinite(dv) ? dv : 0) * b] };
}
// the pan's snap: an eighth of the tile of the face under the pointer, in texels
export function snapStep(s) {
  if (failed(s)) return null;
  const m = reference(s);
  return [m.tile[0] / SNAP_PARTS, m.tile[1] / SNAP_PARTS];
}
const E_MIN = Math.log2(SCALE_MIN), E_MAX = Math.log2(SCALE_MAX);
// the scale after wheel notches (positive: larger), as a power of two; Ctrl: the next power of two each notch
function nextPower(e, notches, mods) {
  if (mods.ctrl) return (notches > 0 ? Math.floor(e + 1e-9) : Math.ceil(e - 1e-9)) + notches;
  return e + notches * (mods.shift ? FINE_NOTCH : WHEEL_NOTCH);
}
// Wheel notches: the texture larger (positive) or smaller round the point under the pointer, which keeps its texel on
// every face (each its own pan, so faces showing one texture from different base points stay one, to the whole texels
// of a pan: see slipResult); on a face the texture runs on to round an edge, round the texel carried round to it
// (carriedRound), so a texture running round a corner stays one. With Ctrl only whole notches count: the page adds up a
// trackpad's fractions.
export function slipScale(s, notches, mods = {}) {
  if (failed(s)) return s;
  const count = mods.ctrl ? Math.trunc(notches) : notches;
  if (!count || !Number.isFinite(count)) return { ...s, ...held(mods) };
  const e = clamp(nextPower(s.e, count, mods), E_MIN, E_MAX), k = clamp(tidy(2 ** e), SCALE_MIN, SCALE_MAX);
  if (k === s.k) return { ...s, ...held(mods) };
  // a texel shows at (texel - pan) / k + pan + the face's slip pan: the pan that keeps the pointer's point on each face
  // (its exact pan: see startSlip)
  const change = 1 / s.k - 1 / k;
  const comp = s.faces.map((f, i) => {
    if (!f.mapping) return null;
    const here = texelOf(s.carried[i], s.at), pan = exactMapping(f).pan;
    return [s.comp[i][0] + (here[0] - pan[0]) * change, s.comp[i][1] + (here[1] - pan[1]) * change];
  });
  return { ...s, ...held(mods), e, k, comp };
}
// Shift or Ctrl pressed or let go with the pointer still: the snap and the fine mode of the next result
export function slipMods(s, mods = {}) { return failed(s) ? s : { ...s, ...held(mods) }; }

// to whole texels: a half up, and a millionth short of a half too (sums that should give a half come a hair either
// side of it)
const whole = (x) => Math.floor(x + 0.5 + 1e-6) || 0;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// the fewest whole texels that are whole repeats of every tile (0: none)
function commonRepeat(tiles) {
  let all = 1;
  for (const tile of tiles) {
    const repeat = repeatOf(tile);
    if (!repeat) return 0;
    all = all / gcd(all, repeat[0]) * repeat[0];
    if (!Number.isSafeInteger(all)) return 0;
  }
  return all;
}
// One axis of a pan row, for faces with these pans and tiles: as it is when the row's pan and every face's pan after
// it stay within the engine's 16 bits; otherwise moved by whole repeats common to their tiles (each face shows the
// same: its texture repeats) to bring them within, as near as can be to centring the faces' pans on 0. null when no
// whole repeat does. Only when needed: a detail or macro texture, or another texture queued later, does not repeat
// with the tile.
function wrapPan(pan, pans, tiles) {
  const fits = (p) => Math.abs(p) <= PAN_LIMIT && pans.every((q) => Math.abs(q + p) <= PAN_LIMIT);
  if (fits(pan)) return pan;
  const repeat = commonRepeat(tiles);
  if (!repeat) return null;
  // (the centre always fits: the faces' pans are within the bits, so it is within them and within each face's room)
  const centre = -(Math.min(...pans) + Math.max(...pans)) / 2, j = Math.round((centre - pan) / repeat);
  const near = [j, j - 1, j + 1].map((n) => pan + n * repeat).filter(fits);
  near.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
  return near.length ? near[0] || 0 : null;
}
// a row's targets in rows of no more than TARGET_LIMIT (surfaces.py's), each face in one of them
export function splitTargets(targets) {
  const out = [];
  for (let i = 0; i < targets.length; i += TARGET_LIMIT) out.push(targets.slice(i, i + TARGET_LIMIT));
  return out;
}
// Items grouped by a pair of values (a pan's U and V, a scale's factors, a face's brush and polygon), looked up by value
// in a Map of Maps (no key built as a string): [{ key: the pair, items }], each pair once, in the order first seen, its
// items in theirs. pairOf(item): its pair, null to leave it out.
export function groupBy(items, pairOf) {
  const firsts = new Map(), groups = [];
  for (const item of items) {
    const pair = pairOf(item);
    if (!pair) continue;
    if (!firsts.has(pair[0])) firsts.set(pair[0], new Map());
    const seconds = firsts.get(pair[0]);
    if (!seconds.has(pair[1])) { seconds.set(pair[1], { key: pair, items: [] }); groups.push(seconds.get(pair[1])); }
    seconds.get(pair[1]).items.push(item);
  }
  return groups;
}
// the rows of an operation for groups of faces (groupBy's): one a group, its pair the arguments, naming no more than
// TARGET_LIMIT of its faces (more make more rows); targetOf(item): the face a row names
const rowsOf = (op, groups, targetOf) => groups.flatMap(({ key, items }) => splitTargets(items.map(targetOf)).map((targets) => ({ op, args: key, targets })));
// Why a slip that needs more rows than it may have queues none, in the user's words, and what to do instead: the
// plain slip when it fits, fewer faces (one face takes a scale and a pan at most), or room made. needed: its rows;
// added: the rows the map's queue grows by with them (folded); space: the rows the map can still take; share: the most
// one slip may queue.
function roomProblem(needed, added, space, share, plain, plainFits) {
  const short = added > space;
  if (short && space < 1) return `The map already has ${ROW_LIMIT} queued surface changes, the most it can save: take some back before slipping.`;
  const instead = plainFits ? 'slip fewer faces at once, or slip them all with one pan (the face under the pointer keeps its place; '
      + 'seams may show between the others)'
    : !short ? 'slip fewer faces at once'
      : space > 1 ? 'slip fewer faces at once, or take some queued changes back' : 'take some queued changes back first';
  if (short) {
    return `This slip needs ${added} queued surface changes and the map has room for ${space} more (${ROW_LIMIT} at most): ${instead}.`;
  }
  return `${plain ? 'This slip' : "Keeping each face's texture in place"} needs ${needed} queued surface changes, more than one `
    + `slip may add (${share} of the map's ${ROW_LIMIT}): ${instead}.`;
}

// What the slip leaves, as one undo step of edits.surfaces rows:
// rows: a scale for every face slipped, then a pan per group of faces with the same pan (each face its own: the shared
// drag, and the pan that keeps the pointer's point when scaling), only what changed: none for no change; a row names
// no more than TARGET_LIMIT faces (more make more rows);
// targets: the faces slipped (each once; a face only a Rebuild shows is left out);
// preview: every face given, as the host will leave it after the rows ({ id, brush, poly, mapping }, null for one left
// out): faces aligned otherwise get the same drag and show what it really does to them; and exact, asked for with
// { exact: true } (the slip kept: the page's frames draw the mappings alone): its mapping with its pan not rounded to
// whole texels (less the rounding taken, wrapped as the rows wrap it), for the next slips of these faces (exactsKept,
// startSlip's exact); none when not asked for, with no rows, for one pan for all (it parts the faces anyhow)
// and for a face left out;
// left: the ids of the faces left out (each source face once);
// scale and pan: the scale row's factor and the pan row of the face under the pointer; moved: the pan the pointer gave
// (without the one that keeps the point under it when scaling, for the HUD);
// needed: the rows the slip takes (or would take); added: the rows the map's queue grows by with them, folded into the
// pans and scales at its end (queue: edits.surfaces, as the page queues them: foldRows), worked out only when the room
// is short or would be left under ROOM_WARN (needed otherwise, and with no queue); plain: whether it is the plain slip
// (below); plainFits: when there are no rows for want of room, whether the plain slip fits;
// error: why there are no rows: a pan beyond 16 bits no whole repeat brings back, or more rows added than the map has
// room for (room: the rows edits.surfaces can still take, ROW_LIMIT less those queued) or more rows than one slip may
// queue (most: SLIP_ROWS, unfolded). Each face's own pan can need a row of its own on a large selection ("Select same
// texture" on the original maps: 0.72 rows a face at the median, 3417 rows for the 3584 glass faces of NYC Ship Below);
// the error says what to do instead: slip fewer faces, or the plain slip.
// The plain slip ({ plain: true }): one pan for every face, the one the face under the pointer gets: a scale and a pan
// row (more only to keep pans within 16 bits, or past TARGET_LIMIT faces); the face under the pointer keeps its texel,
// the others move with it and may part from their neighbours (seams).
// With Ctrl the face under the pointer's own pan snaps to its snap step; the others move with it.
export function slipResult(s, { room = ROW_LIMIT, most = SLIP_ROWS, plain = false, queue = null, exact: withExact = false } = {}) {
  if (failed(s)) {
    return { rows: [], targets: [], preview: [], left: [], scale: 1, pan: [0, 0], moved: [0, 0], needed: 0, added: 0, plain: !!plain,
      plainFits: false, error: s.error };
  }
  const m0 = exactMapping(s.faces[s.ref]), c0 = s.comp[s.ref];
  // what Ctrl adds to every face: the pointer's face onto its snap (its exact pan: see startSlip)
  const snapped = [0, 1].map((axis) => {
    if (!s.snap) return 0;
    const exact = s.drag[axis] + c0[axis], step = m0.tile[axis] / SNAP_PARTS;
    return Math.round((m0.pan[axis] + exact) / step) * step - m0.pan[axis] - exact;
  });
  // each face's pan: the shared drag, its own compensation and what Ctrl adds; in whole texels, every face rounded by
  // the same offset as the face under the pointer (rounded each on its own, two faces a hair either side of half a
  // texel would part by one). So a face parts from the face under the pointer by what its exact pan differs from that
  // face's beyond whole texels: nothing when that is whole texels (one texture from bases whole texels apart, made
  // smaller by whole factors, as Ctrl's halves: their offset times 1/k before less 1/k after is whole; made larger, or
  // by a fraction, it is not: x2 with bases a texel apart parts them by half a texel), within half a texel otherwise,
  // the best whole pans allow; any two faces within a texel. A face's texel at the pointer is within a texel of where
  // it was, the one under the pointer within half. Rounded once: a face's exact pan (see startSlip) less its queued
  // one goes in too, so its pan row takes its queued pan to its exact pan after the slip, rounded. Each face's exact pan
  // and whole pan worked out once (none for a face left out).
  const exacts = s.faces.map((f, i) => f.mapping && [0, 1].map((axis) => s.drag[axis] + s.comp[i][axis] + snapped[axis]
    + exactMapping(f).pan[axis] - f.mapping.pan[axis]));
  const exact0 = exacts[s.ref], whole0 = exact0.map(whole), offset = whole0.map((p, axis) => p - exact0[axis]);
  const wholes = exacts.map((e) => e && (plain ? whole0 : e.map((p, axis) => whole(p + offset[axis]))));
  // each source face once (the first given: by its brush and polygon), with its place in s.faces
  const sources = groupBy(s.faces.map((f, i) => ({ f, i })), ({ f }) => [f.brush, f.poly]);
  const firsts = sources.map((g) => g.items[0]), slipped = firsts.filter(({ f }) => f.mapping);
  const left = firsts.filter(({ f }) => !f.mapping).map(({ f }) => f.id);
  const pointed = sources.find((g) => g.items.some(({ i }) => i === s.ref)).items[0];    // the face under the pointer's
  // the pan the pointer gave (and Ctrl's snap), rounded as the face under the pointer's: neither its compensation nor
  // what its exact pan has more than its queued one (a slip kept after another, not dragged, said U +1)
  const moved = whole0.map((p, axis) => whole(p - exact0[axis] + s.drag[axis] + snapped[axis]));
  // the faces grouped by their pan in whole texels, each group's pan within the 16 bits (a group whose faces no one wrap
  // brings within, each face wrapped on its own); groups that end on the same pan share a row
  const wrapped = (pan, items) => {
    const both = [0, 1].map((axis) => wrapPan(pan[axis], items.map(({ f }) => f.mapping.pan[axis]), items.map(({ f }) => f.mapping.tile[axis])));
    return both.includes(null) ? null : both;
  };
  const panned = [];                            // { face, pan } for each face slipped
  let tooFar = false;
  for (const { key, items } of groupBy(slipped, ({ i }) => wholes[i])) {
    const shared = wrapped(key, items), parts = items.map((face) => ({ face, pan: shared || wrapped(key, [face]) }));
    if (parts.some((part) => !part.pan)) { tooFar = true; break; }
    panned.push(...parts);
  }
  const target = ({ f }) => ({ brush: f.brush, poly: f.poly }), targets = slipped.map(target);
  let rows = tooFar ? [] : [...(s.k !== 1 ? rowsOf('scale', [{ key: [s.k, s.k], items: slipped }], target) : []),
    ...rowsOf('pan', groupBy(panned, ({ pan }) => (pan[0] || pan[1] ? pan : null)), ({ face }) => target(face))];
  // the room: what the map can still take (no more than its whole), the rows added after the fold into the queue; and
  // no more rows than one slip may queue
  const space = Math.max(0, Math.min(Number.isFinite(room) ? room : ROW_LIMIT, ROW_LIMIT)), share = most >= 0 ? most : SLIP_ROWS;
  const needed = rows.length;
  const added = queue && (needed > space || space - needed < ROOM_WARN) ? foldRows(queue, rows).length - queue.length : needed;
  const over = needed > share || added > space;
  const plainFits = over && !plain && !slipResult(s, { room, most, plain: true, queue }).error;
  const error = tooFar ? `The pan would go beyond the engine's ${PAN_LIMIT} texels.` : over ? roomProblem(needed, added, space, share, plain, plainFits) : '';
  if (over) rows = [];
  // each face as its rows leave it (the rows indexed once: a face's rows found without going through them all), and,
  // asked for, its exact mapping: the rounding its source face's pan row took (the first given's) taken off
  const index = indexRows(rows), firstOf = withExact && new Map(sources.flatMap(({ items }) => items.map(({ i }) => [i, items[0].i])));
  const rounding = (j) => wholes[j].map((p, axis) => p - exacts[j][axis]);
  const preview = s.faces.map((f, i) => {
    const mapping = f.mapping && mappingAfter(f.mapping, rowsFor(f, index)), j = firstOf && firstOf.get(i);
    const taken = firstOf && mapping && rows.length && !plain && s.faces[j].mapping ? rounding(j) : null;
    return { id: f.id, brush: f.brush, poly: f.poly, mapping, exact: taken && { ...mapping, pan: mapping.pan.map((p, axis) => p - taken[axis]) } };
  });
  return { rows, targets, preview, left, scale: s.k, pan: (!tooFar && panned.find(({ face }) => face === pointed)?.pan) || whole0, moved,
    needed, added, plain: !!plain, plainFits, error };
}
// what a face's pan has gone on by since a mapping it had (from), [U, V] in texels
const pannedFrom = (from, now) => now.pan.map((p, k) => p - from.pan[k]);
// The exact mapping a kept slip left a face (left: the mapping it left, exact: its exact one), again, for its mapping
// now: its mapping now, its pan moved by what that exact pan has more than left's, while it is left by value: base, U,
// V and tile within AS_LEFT (a Rebuild reads them back from the dump), its pan off by whole texels on each axis
// (pannedFrom); null otherwise (a Scale queued since, a texture of another size, a pan of part of a texel) and without
// them. Asked of the one entry the map's state now holds for the face (exactsNow), and of the plain slip's start for
// its end (exactsKept): by value alone it cannot tell a Pan queued since from a slip's own rounding of the face
// (another state, another fraction), nor from an alignment that only took its pan back to 0 (exactsNow counts those).
export function exactAgain(left, exact, now) {
  if (!left || !exact || !now || !Array.isArray(now.u)) return null;
  const near = (a, b) => Math.hypot(...a.map((x, k) => x - b[k])) <= AS_LEFT * Math.max(Math.hypot(...a), Math.hypot(...b), 1);
  const panned = pannedFrom(left, now);
  if (!(near(now.base, left.base) && near(now.u, left.u) && near(now.v, left.v) && near(now.tile, left.tile) && panned.every(Number.isInteger))) {
    return null;
  }
  return { ...now, pan: now.pan.map((p, k) => p + exact.pan[k] - left.pan[k]) };
}
// The operations that put a face's mapping somewhere new rather than move it: the alignments (Floor, Wall), One Tile
// (and its U and V), Around a cylinder (on the faces it wraps), Rotate and the flips. A row of one queued on a face
// since a slip kept left it drops the exact mapping that slip left (exactsNow), though by value the mapping may then be
// the slip's own, panned: a Wall or One Tile on a face aligned so before takes its pan back to 0 and keeps its base, U
// and V. Never folded (foldRows folds pans and scales), so their count on a face is the same however the queue is
// folded.
const RESETS = new Set(['floor', 'wall', 'tile', 'tile-u', 'tile-v', 'cylinder', 'rotate', 'flip-u', 'flip-v']);
// How many rows of those change a face (face: { brush, poly, pieces: its BSP pieces }; rows: the queue, or indexRows of
// it), each as often as rowsFor gives it: Around a cylinder only where it wraps the face (wrapsSide of its pieces'
// normal, as the view takes it), not on a cap, whose mapping it keeps
function resetsOf(face, rows) {
  const resets = rowsFor(face, rows).filter((row) => RESETS.has(row.op));
  const cap = resets.some((row) => row.op === 'cylinder') && !wrapsSide(piecesNormal(face.pieces));
  return cap ? resets.filter((row) => row.op !== 'cylinder').length : resets.length;
}
// Each face's exact mapping (startSlip's exact) from the exact mappings of the map's state now (exacts: exactsKept's,
// none; faces: [{ brush, poly, mapping: its mapping now, pieces: its BSP pieces (resetsOf) }]; rows: the queue now,
// edits.surfaces), or null: the one the slip kept last on it left it, while no row of RESETS was queued on it since (as
// many as then: resetsOf) and its mapping is still the one it left, by value, its pan moved by whole texels
// (exactAgain: a Pan queued since, the map rebuilt, its numbers read back from the dump); none for a face no slip kept
// on in this state, or changed otherwise since (a Scale, a texture of another size). The state is the page's own: the
// Undo history holds each state's exact mappings with its edits (texture-slip-ui.js held and hold), so a face has one
// to look at, never one of several states guessed by value. Still judged by value: a Scale brought back (x2, then x0.5)
// keeps it, as if both were undone.
export function exactsNow(exacts, faces, rows) {
  const index = indexRows(rows);
  return faces.map((f) => {
    const kept = f.mapping && exacts?.get(f.brush)?.get(f.poly);
    return kept && kept.resets === resetsOf(f, index) ? exactAgain(kept.left, kept.exact, f.mapping) : null;
  });
}
// The exact mappings of the state a slip kept makes (exacts: those of the state it started from, exactsKept's, none;
// faces: the slip's, startSlip's; preview: its slipResult's, asked for { exact: true }; rows: the queue with its rows):
// a new value, those given not changed (the Undo history holds them with the state before), by brush and then polygon
// (a Map of Maps: a Rebuild's faces are other objects; a brush the slip did not touch is shared, not copied). Each face
// slipped gets { left: the mapping it left (the preview's), exact: its exact one; the plain slip gives none: the exact
// one it started from moved by its one pan when it did not scale them (exactAgain), else that mapping; resets: resetsOf
// it in rows }; one whose exact pan is the pan it left (no part of a texel: the plain slip of faces that had none) gets
// none and loses the one it had, the next slip starting from its mapping, the same numbers; a face left out (no
// mapping) keeps what it had.
export function exactsKept(exacts, faces, preview, rows) {
  const out = new Map(exacts), copied = new Set(), index = indexRows(rows);
  faces.forEach((f, i) => {
    if (!f.mapping) return;
    const to = preview[i].mapping, exact = preview[i].exact || exactAgain(f.mapping, exactMapping(f), to) || to;
    const whole = sameList(exact.pan, to.pan);
    if (whole && !out.get(f.brush)?.has(f.poly)) return;
    if (!copied.has(f.brush)) { copied.add(f.brush); out.set(f.brush, new Map(exacts?.get(f.brush))); }
    if (whole) out.get(f.brush).delete(f.poly);
    else out.get(f.brush).set(f.poly, { left: to, exact, resets: resetsOf(f, index) });
  });
  return out;
}
// Whether vectors a and b point the same way: the cosine between them within a millionth of 1 (0.08 degrees: an axis a
// move left as it was, read back to the dump's digits, is well within it), signed, so a turn of 180 degrees is not the
// same way
const sameWay = (a, b) => dot(a, b) >= (1 - 1e-6) * Math.hypot(...a) * Math.hypot(...b);
// A face's mappings before the first slip kept on it and as built then, { before, built } (startSlip's), from the slips
// kept (kept: keptSlip's, none; face: { brush, poly, mapping: its mapping now }; built: its mapping as the last Rebuild
// built it): those of the first of the map's state now, whatever was queued or rebuilt since. A structure moved and
// rebuilt since moved the face's texture with it (the host keeps the mapping in the brush: UCEngineBridge.cpp
// surfaceWorld moves its base with the brush; a slip, a Pan or a Scale never moves a base, an alignment or One Tile
// may), so by the face's mapping now: its base where before's is, its entry, whatever its U and V did (a Rotate or a
// flip queued on it,
// a structure turned or resized that left the base where it was); its base moved and its U and V the same way as
// before's (sameWay), before with the face's base now, the rest of it and built as kept (after a resize too: U and V as
// long as before's, the guide's known limit); its base moved and its U or V turned (a structure turned about another
// point), as one no slip kept on, its mapping now. With no mapping now (or one with no base: a refusal, which startSlip
// refuses) or no before, its entry; with none kept on it, its mapping now and as built
export function keptBefore(kept, face, built) {
  const known = kept?.known.get(face.brush)?.get(face.poly), now = face.mapping;
  if (!known) return { before: face.mapping, built };
  const { before } = known;
  if (!Array.isArray(now?.base) || !before || sameList(now.base, before.base)) return known;
  if (!sameWay(now.u, before.u) || !sameWay(now.v, before.v)) return { before: now, built };
  return { before: { ...before, base: now.base }, built: known.built };
}
// What the slips kept in a map's state know of its faces, with one more kept (kept: what they knew, keptSlip's, none
// before the first; faces: the slip's, startSlip's): a new value, kept not changed. { known: each face's { before,
// built } (keptBefore), by its brush and then its polygon (a Map of Maps: a Rebuild's faces are other objects) }. A
// face left out (no mapping) is not in it, and a face it knew keeps its entry (the slip's before and built came from
// it): a brush with no new face is shared, not copied, and a slip of faces all known gives kept back. The page's Undo
// history holds it with the state's exact mappings (texture-slip-ui.js held): an Undo takes back what the slips it
// undoes knew, so a page that undid slips is a page that never made them.
export function keptSlip(kept, faces) {
  const fresh = faces.filter((f) => f.mapping && !kept?.known.get(f.brush)?.has(f.poly));
  if (kept && !fresh.length) return kept;
  const known = new Map(kept?.known), copied = new Set();
  fresh.forEach((f) => {
    if (!copied.has(f.brush)) { copied.add(f.brush); known.set(f.brush, new Map(known.get(f.brush))); }
    known.get(f.brush).set(f.poly, { before: f.before, built: f.built });
  });
  return { known };
}

const signed = (x) => (x > 0 ? '+' + x : String(x));
const factor = (k) => `x${Number(k.toPrecision(3))}`;
// The line the view shows while slipping: "U +12 · V -4 · x1.25", with the snap or the fine mode held, the plain slip,
// the faces slipped, those left out (only a Rebuild shows them), the error, or the map's room after it when little is
// left (roomNote). result: slipResult's for this session, when the page has it (it is not worked out again); room: the
// rows the map could take before it (as slipResult's), none to leave the room unsaid.
export function slipHud(s, result, room) {
  if (failed(s)) return s.error;
  const r = result || slipResult(s);
  const parts = [`U ${signed(r.moved[0])}`, `V ${signed(r.moved[1])}`, factor(r.scale)];
  if (s.snap) parts.push('snap');
  else if (s.fine) parts.push('fine');
  if (r.plain) parts.push('one pan');
  if (r.targets.length > 1) parts.push(`${r.targets.length} faces`);
  if (r.left.length) parts.push(`${r.left.length} left out: Rebuild first`);
  if (r.error) parts.push(r.error);
  else if (Number.isFinite(room) && roomNote(room - r.added)) parts.push(roomNote(room - r.added));
  return parts.join(' · ');
}
// What the log says of a slip queued (slipResult's result): "Texture slip: x1.19, pan U +12 V -4 on 3 faces, one pan,
// 1 left out (only a Rebuild shows it). Rebuild to apply and recalculate lighting."
export function slipSummary(r) {
  const n = r.targets.length, out = r.left.length;
  return `Texture slip: ${factor(r.scale)}, pan U ${signed(r.pan[0])} V ${signed(r.pan[1])} on ${n} face${n === 1 ? '' : 's'}`
    + `${r.plain ? ', one pan' : ''}${out ? `, ${out} left out (only a Rebuild shows ${out === 1 ? 'it' : 'them'})` : ''}`
    + '. Rebuild to apply and recalculate lighting.';
}

// ---------------------------------------------------------------- the map's room

export const ROOM_WARN = 2 * SLIP_ROWS;    // with fewer rows left than this, the HUD and the status say how many
// what the HUD and the status say of the map's room (rows: those it can still take): '' while there is plenty
export function roomNote(rows) {
  const left = Math.max(0, Math.min(ROW_LIMIT, Math.floor(rows)));
  return left < ROOM_WARN ? `room for ${left} more queued surface change${left === 1 ? '' : 's'} (of ${ROW_LIMIT})` : '';
}
// a row the fold takes: a pan or a scale aimed at faces by their number (a row aimed at a whole brush, '*', edits faces
// no row names)
const foldable = (row) => (row?.op === 'pan' || row?.op === 'scale') && Array.isArray(row.args) && Array.isArray(row.targets)
  && row.targets.every((t) => t && typeof t === 'object' && t.poly !== '*');
// The queue (edits.surfaces) with rows added, folded where that takes fewer rows: the pan and scale rows at its end and
// the rows added are put together face by face, each face's scale factors multiplied and its pans added (they commute:
// a scale leaves the pan, a pan the texture's axes; a face a row names twice is edited twice), then written as a scale
// row per factor and a pan row per pan, as slipResult writes a slip. Every face is left as the rows unfolded leave it
// (mappingAfter: the same pan, the same axes to the last digits of a division) and ends on the same pan, so none is
// refused that was not (a pan past the 16 bits half way, which the rows unfolded would fail the Rebuild on, is the one
// difference). Folded only when that takes fewer rows and each stays one surfaces.py takes (a factor within 0.001 to
// 1000, a pan within the 16 bits); otherwise the rows are added as they are. The rows before the last one that is not
// a pan or a scale, or that names a whole brush, are kept as they are. A new list: the queue is not changed.
export function foldRows(queue = [], rows = []) {
  let start = queue.length;
  while (start > 0 && foldable(queue[start - 1])) start--;
  const tail = [...queue.slice(start), ...rows];
  if (!rows.length || !tail.every(foldable)) return [...queue, ...rows];
  // each face (by its brush and polygon) with the rows that name it, in their order: its factors and its pan
  const named = tail.flatMap((row) => row.targets.map((t) => ({ row, t })));
  const faces = groupBy(named, ({ t }) => [t.brush, t.poly]).map(({ key, items }) => {
    const f = { target: { brush: key[0], poly: key[1] }, k: [1, 1], pan: [0, 0] };
    for (const { row } of items) {
      if (row.op === 'scale') f.k = [f.k[0] * row.args[0], f.k[1] * row.args[1]];
      else f.pan = [f.pan[0] + row.args[0] || 0, f.pan[1] + row.args[1] || 0];
    }
    return f;
  });
  const folded = [...rowsOf('scale', groupBy(faces, (f) => (f.k[0] === 1 && f.k[1] === 1 ? null : f.k)), (f) => f.target),
    ...rowsOf('pan', groupBy(faces, (f) => (f.pan[0] || f.pan[1] ? f.pan : null)), (f) => f.target)];
  if (folded.length >= tail.length || folded.some((row) => argsProblem(row))) return [...queue, ...rows];
  return [...queue.slice(0, start), ...folded];
}

// ---------------------------------------------------------------- the pointer and the keys

const ARROWS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
// An arrow key as the nudge that moves the picture on the screen its way, as Premiere's: [du, dv], one texel along the
// texture's axis (U or V of the face under the pointer, as it lies on the face's plane) nearest the screen's right
// (Left, Right) or up (Up, Down), signed so the picture goes that way (a pan of +1 shows at each point the texel one on
// along the axis: the picture goes toward -U). right, up: the view's, in the map's frame. null for another key, or no
// axis along the screen.
export function arrowNudge(s, key, right, up) {
  if (failed(s) || !ARROWS[key] || !isPoint(right) || !isPoint(up)) return null;
  const [x, y] = ARROWS[key], way = add(times(right, x), times(up, y)), n = s.plane.normal, m = reference(s);
  const along = (axis) => dot(safeNormal(sub(axis, times(n, dot(axis, n)))), way);
  const u = along(m.u), v = along(m.v);
  if (Math.max(Math.abs(u), Math.abs(v)) < GRAZING) return null;
  return Math.abs(u) >= Math.abs(v) ? [u > 0 ? -1 : 1, 0] : [0, v > 0 ? -1 : 1];
}
// a wheel event's step (Shift turns the wheel sideways in some browsers)
const wheelStep = ({ deltaY = 0, deltaX = 0, shiftKey = false } = {}) => deltaY || (shiftKey ? deltaX : 0);
// The size of a wheel's notch in pixels, learnt from its events (the page keeps it while it is open): the smallest pixel
// step of WHEEL_TURN or more seen, one notch (a larger one is several, merged while the page was busy), and only from a
// step after WHEEL_PAUSE with no wheel event, which no trackpad's swipe or pinch gives in its middle (their steps come
// close together, some of 50 pixels or more; a pinch comes as Ctrl+wheel, as a mouse's notch with Ctrl held does). A
// swipe or a pinch whose very first step after a pause is that large still teaches it. notch: the size learnt so far,
// none before the first; quiet: the milliseconds since the wheel event before this one (Infinity for the first; none:
// no pause known, nothing learnt).
export function learnNotch(notch, e = {}, quiet = 0) {
  const d = Math.abs(wheelStep(e));
  if ((e.deltaMode || 0) >= 1 || !(quiet >= WHEEL_PAUSE) || !Number.isFinite(d) || d < WHEEL_TURN) return notch;
  return notch > 0 ? Math.min(notch, d) : d;
}
// A wheel event's notches for slipScale (positive: larger, the wheel turned up, as the view comes nearer): a mouse
// wheel's whole notches (lines, or a step of the notch's size in pixels or more: several when the browser merged them),
// a trackpad's small steps parts of one. notch: the notch's size learnt (learnNotch), WHEEL_PIXELS until one is.
export function wheelNotches(e = {}, notch = null) {
  const d = wheelStep(e);
  if (!d || !Number.isFinite(d)) return 0;
  if ((e.deltaMode || 0) >= 1) return -Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / WHEEL_LINES));
  const size = notch > 0 ? notch : WHEEL_PIXELS;
  return Math.abs(d) >= size ? -Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / size)) : -d / size;
}

// ---------------------------------------------------------------- the view's faces

// A face's BSP pieces and corners from the triangles the view has of it in one mesh (data.py's fans: a polygon's corners
// 0 1 2, then 0 2 3...): pos, the mesh's corners in the map's frame as the last Rebuild built them (geometry.json's pos,
// 9 numbers a triangle); piece, the BSP polygon of each triangle (geometry.json's piece; none in an older geometry: put
// together again from the fans, face-grow.js piecesFromFans); triangles: the face's, in their order. Never the
// triangles themselves as pieces: rounded to 2 decimals, slivers face anyhow (38,732 faces of the cached maps came out
// unknown). { pieces: [[corner...]...], points: every piece's corners }
export function piecesOf(pos, piece, triangles) {
  const corner = (t, j) => [pos[t * 9 + j * 3], pos[t * 9 + j * 3 + 1], pos[t * 9 + j * 3 + 2]];
  const corners = (t) => [corner(t, 0), corner(t, 1), corner(t, 2)];
  // by the pieces' numbers: a triangle of the polygon the one before it is of goes on it
  const numbered = () => {
    const out = [];
    triangles.forEach((t, i) => {
      if (i && piece[t] === piece[triangles[i - 1]]) out[out.length - 1].push(corner(t, 2));
      else out.push(corners(t));
    });
    return out;
  };
  const pieces = piece ? numbered() : piecesFromFans(triangles.map(corners));
  return { pieces, points: pieces.flat() };
}
// the operations whose result needs the face's shape (mappingAfter): its plane and corners, or a texture's tile
const SHAPED = new Set(['floor', 'wall', 'tile', 'tile-u', 'tile-v', 'cylinder', 'texture']);
// The mappings the view shows now, for each face a row not built yet edits (faces: [{ brush, poly, mapping: as the last
// Rebuild built it (mappingOf), null for none }]): built, the rows the view was built with; { maybe: rows } when that is
// not known but for those rows (the map's when it opened, an older build: in it or not), the faces they name are null
// and the rows queued since show; null when nothing is known (then every face a row of current names is null: only a
// Rebuild shows it). current, edits.surfaces now. The rows are indexed once (a face's found without going through them
// all). shapeOf(i, rows): face i's shape (see mappingAfter), asked only when its rows need one, null when it cannot be
// known (Floor and Wall on a structure moved since the Rebuild). Map: face index -> mappingAfter's (a mapping, null, or
// a refusal); faces with no rows are not in it.
export function pendingMappings(faces, built, current = [], shapeOf = () => ({})) {
  const base = Array.isArray(built?.maybe) ? built.maybe : built, unsure = base === built ? null : indexRows(base);
  const out = new Map(), pending = base ? pendingRows(base, current) : current;
  if (!pending.length && !unsure?.rows.length) return out;
  const index = indexRows(pending);
  faces.forEach((face, i) => {
    if (unsure && rowsFor(face, unsure).length) { out.set(i, null); return; }
    const rows = rowsFor(face, index);
    if (!rows.length) return;
    if (!base || !face.mapping) { out.set(i, null); return; }
    const shape = rows.some((row) => SHAPED.has(row.op)) ? shapeOf(i, rows) : {};
    out.set(i, shape ? mappingAfter(face.mapping, rows, shape) : null);
  });
  return out;
}
