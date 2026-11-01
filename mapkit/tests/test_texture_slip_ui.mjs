// The Texture Slip in the 3D view (static/texture-slip-ui.js), with the page's parts stood in for: Y over a selected face
// starts it (or it waits for the pointer over one), the pointer rolls the texture, the wheel sizes it (Ctrl adds up a
// trackpad's parts, the notch learnt after a pause), the arrows nudge it the way they point on the screen, P gives
// every face one pan when each its own would not fit, a click, the release after a drag or Enter queue it as one undo
// step; Esc, the right button, Alt, Ctrl+Z, a click elsewhere, leaving the page or cancel() end it with nothing queued
// and the preview drawn again. It refuses what it cannot do (locked, resized, another frame, a refused row, not now),
// works where a moved structure was built, keeps a texture together round a corner and folds into the queue before it,
// gives each face's texture to the slip, and starts each slip kept after another from what the slips before left each
// face, by its brush and polygon: the exact mapping of the map's state now, which the page's Undo history holds with
// each step's edits and gives back with them (an Undo, a Redo, a History panel jump, a click that moved nothing taken
// back: a page that undid steps is a page that never made them; a Pan of any of the faces moves it as much, a Rebuild
// keeps it; a ring closing at the scale it had; hold ends a slip going on), its mapping as built and before the first
// slip kept, which the history holds too (a side's drift judged at that scale, a ring parting where it parted while its
// texture still steps there, a corner lined up since staying closed, however the queue changed or the map was rebuilt,
// its structure moved too), until another map opens (forget).
import test, { THREE } from './three.mjs';
import assert from 'node:assert/strict';
import { createTextureSlip, sameFrame } from '../editor/static/texture-slip-ui.js';
import { mappingOf, mappingAfter, mappingNow, rowsFor, texelOf, foldRows, numsOf, pendingRows, sourceNormal, ROW_LIMIT } from '../editor/static/texture-slip.js';
import { createHistory, clearHistory, recordStep, dropStep, travelStep, stepsTo } from '../editor/static/history-names.js';

const T = (a) => new THREE.Vector3(a[0], a[2], a[1]);                 // Unreal -> three, as app.js
// the Feature Lab's added wall (Brush212 face 1, facing +x at x 64) and its floor (Brush2 face 4), as built; a wall
// meeting the first at its end (y 528, facing -y), its texture running on round the corner
const FACES = [
  { brush: 'Brush212', poly: 1, map: [64, 400, 0, -0, -1, -0, -0, -0, -1, 0, 0, 128, 128], points: [[64, 528, 0], [64, 528, 96], [64, 272, 96], [64, 272, 0]] },
  { brush: 'Brush2', poly: 4, map: [0, 0, 0, 1, -0, -0, -0, 1, -0, 0, 0, 128, 128], points: [[0, 0, 0], [256, 0, 0], [256, 256, 0], [0, 256, 0]] },
  { brush: 'Brush3', poly: 0, map: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 128, 128], points: [[0, 0, 0], [0, 64, 0], [64, 0, 0]] },
  { brush: 'Brush212', poly: 2, map: [64, 528, 0, -1, 0, 0, 0, 0, -1, -128, 0, 128, 128], points: [[64, 528, 0], [320, 528, 0], [320, 528, 96], [64, 528, 96]] },
];
const WALL = { brush: 'Brush212', poly: 1 }, FLOOR = { brush: 'Brush2', poly: 4 };

// faces: the map's (FACES; tex: a face's texture now; pieces: its BSP pieces, else its points one); queue: the rows queued
// (edits.surfaces), which the slips' rows fold into as the Surface tools queue them (queueRows: one step of the page's
// Undo history first), and each face's mapping now as they leave it, the rows the last Rebuild built taken off
// (pendingRows). The history as app.js keeps it (pushUndo, travel: history-names.js, each step holding what the slips
// know of its edits, held: their exact mappings and each face's mapping before the first of them, and giving it back,
// hold)
function page({ faces = FACES, selected = [0, 1], frames = {}, room = ROW_LIMIT, queue = [], can = '', canEdit = () => true, current = null,
  offset = [0, 0, 0] } = {}) {
  const listeners = [], meshes = faces.map((_, i) => ({ name: 'mesh' + i })), said = [], queued = [], slips = [], h = createHistory();
  let refreshed = 0, rows = queue, built = [];
  // app.js's pushUndo and travel, the edits being the rows
  const pushUndo = (label) => recordStep(h, JSON.stringify(rows), label, undefined, slip.held);
  const travel = (way) => {
    const step = travelStep(h, way, JSON.stringify(rows), slip.held);
    if (step) { rows = JSON.parse(step.state); slip.hold?.(step.page); }
    return step;
  };
  // a face's mapping now: as the last Rebuild built it (its map), after the rows that Rebuild did not build (its shape
  // for the panel's alignments: the normal of its pieces, its corners)
  const now = (f) => mappingNow({ ...f, mapping: mappingOf(f.map) }, pendingRows(built, rows),
    { normal: sourceNormal(f.pieces || [f.points]), points: (f.pieces || [f.points]).flat() });
  const win = {
    addEventListener: (type, fn, options) => listeners.push({ type, fn, capture: typeof options === 'object' ? !!options.capture : !!options }),
    removeEventListener: (type, fn, capture) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === !!capture);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  const canvas = { tagName: 'CANVAS' }, label = { style: {}, textContent: '' };
  // the camera in front of the wall (offset: the structure moved since the Rebuild, the view and the camera with it)
  const moved = (a) => a.map((x, k) => x + offset[k]);
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(T(moved([400, 400, 50])));
  camera.lookAt(T(moved([64, 400, 50])));
  camera.updateMatrixWorld();
  const toBuilt = new THREE.Matrix4().makeTranslation(...T(offset).negate().toArray());
  const slip = createTextureSlip({ THREE, win, canvas, camera, label, frame: (fn) => fn(),
    ray: (e) => new THREE.Ray(camera.position.clone(), T(moved(e.at)).sub(camera.position).normalize()),
    pointed: (e) => (e.face === undefined ? { why: 'No built face under the pointer.' }
      : { id: e.face, mesh: meshes[e.face], point: T(moved(e.at)), normal: new THREE.Vector3(1, 0, 0) }),
    frameOf: (mesh) => ({ toBuilt, moved: !!offset.some((x) => x), resized: false, ...frames[mesh.name] }),
    faces: { selected: () => selected.map((id) => ({ id, face: faces[id], tex: faces[id].tex })), canEdit },
    preview: { current: current || ((id) => now(faces[id])), asBuilt: (id) => mappingOf(faces[id].map),
      shapeOf: (id) => ({ pieces: faces[id].pieces || [faces[id].points] }), trianglesOf: (id) => [{ mesh: meshes[id], triangle: 0 }], slip: (map) => slips.push(map) },
    refresh: () => refreshed++,
    queue: (added, label, line) => { queued.push({ rows: added, label, line }); pushUndo(label); rows = foldRows(rows, added); return { left: room - added.length }; },
    room: () => room, queued: () => rows, can: () => can, status: (text, kind) => said.push([text, kind]), wake() {} });
  // an event: of the pointer at a point of the map (Unreal, where it was built), over a face, or a key
  const event = (props) => ({ target: canvas, clientX: 300, clientY: 200, button: 0, buttons: 0, shiftKey: false, ctrlKey: false, altKey: false,
    metaKey: false, stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; },
    ...props });
  const send = (type, props) => {
    const e = event(props);
    for (const l of listeners.filter((x) => x.type === type)) { l.fn(e); if (e.stopped) break; }
    return e;
  };
  const key = (k, props = {}) => send('keydown', { key: k, code: /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : k, ...props });
  return { slip, win, canvas, label, listeners, said, queued, slips, refreshed: () => refreshed, send, key,
    at: (face, point, props = {}) => event({ face, at: point, ...props }),
    rows: () => rows,                                                       // the queue now
    select: (list) => { selected = list; },                                 // the faces selected from now (their indexes)
    // the page's Undo history: Ctrl+Z, Ctrl+Y, a History panel row (at: the steps from now), a change of the Surface
    // panel (one step, then fn changes the rows), a click that moved nothing (its step taken back)
    history: h, undo: () => travel('undo'), redo: () => travel('redo'),
    jump: (at) => { const { way, count } = stepsTo(at); let n = 0; while (n < count && travel(way)) n++; return n; },
    change: (label, fn) => { pushUndo(label); rows = fn(rows); }, drop: () => { pushUndo('Move Light4'); dropStep(h); },
    // each face's mapping now; a Rebuild: each face built as the queue leaves it (other objects, their numbers to the
    // dump's 6 digits), the queue kept (the build has it, nothing pending), the history gone (the map opened again); t:
    // the structure moved that far since, each face's corners and its texture's base with it (the host keeps a face's
    // mapping in its brush: UCEngineBridge.cpp surfaceWorld moves the base with the brush)
    mappings: () => faces.map(now),
    rebuild: (t = [0, 0, 0]) => {
      const by = (c) => c.map((x, k) => x + t[k]);
      faces = faces.map((f) => { const m = now(f); return { ...f, map: numsOf({ ...m, base: by(m.base) }).map((x) => Number(x.toPrecision(6))),
        points: f.points.map(by), pieces: f.pieces && f.pieces.map((p) => p.map(by)) }; });
      built = JSON.parse(JSON.stringify(rows));
      clearHistory(h);
    } };
}
const HERE = [64, 400, 50];
// The room's four walls (Brush2, 384 high, each one piece: north, east, south, west), one texture 32 tiles round; east:
// the east wall's texture; along: its base moved that far along it (0.6: its corners 0.3 texel off as built, as on
// original maps)
function ringRoom(east = 'Pkg.Wall', along = 0) {
  const wall = (poly, map, points, tex = 'Pkg.Wall') => ({ brush: 'Brush2', poly, map, points, tex });
  return [wall(3, [0, 1024, 0, -0.5, 0, 0, 0, 0, -0.5, 0, 0, 128, 128], [[1024, 1024, 0], [-1024, 1024, 0], [-1024, 1024, 384], [1024, 1024, 384]]),
    wall(1, [1024, along, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 128, 128], [[1024, -1024, 0], [1024, 1024, 0], [1024, 1024, 384], [1024, -1024, 384]], east),
    wall(2, [0, -1024, 0, 0.5, 0, 0, 0, 0, -0.5, 0, 0, 128, 128], [[-1024, -1024, 0], [1024, -1024, 0], [1024, -1024, 384], [-1024, -1024, 384]]),
    wall(0, [-1024, 0, 0, 0, -0.5, 0, 0, 0, -0.5, 0, 0, 128, 128], [[-1024, 1024, 0], [-1024, -1024, 0], [-1024, -1024, 384], [-1024, 1024, 384]])];
}
// its corners: [name, the walls either side, where (x, y)]
const RING_CORNERS = [['north-east', 0, 1, [1024, 1024]], ['east-south', 1, 2, [1024, -1024]], ['south-west', 2, 3, [-1024, -1024]],
  ['west-north', 3, 0, [-1024, 1024]]];
// how far each corner has gone apart (mappings: the walls' now) against the walls as built (faces: ringRoom's), whole
// tiles off, the most of the floor, half way up and the top, in RING_CORNERS' order; at: how far the room was moved
// along x and y since (playRing's 'M'), each corner measured where it is now
function cornerShifts(faces, mappings, [dx, dy] = [0, 0]) {
  const built = faces.map((f) => mappingOf(f.map)), apart = (x) => Math.abs(x / 128 - Math.round(x / 128)) * 128;
  const shows = (m, a, b, p, k) => texelOf(m[a], p)[k] - texelOf(m[b], p)[k];
  return RING_CORNERS.map(([, a, b, [x, y]]) => Math.max(...[0, 192, 384].flatMap((z) => [0, 1].map((k) =>
    apart(shows(mappings, a, b, [x + dx, y + dy, z], k) - shows(built, a, b, [x, y, z], k))))));
}
// the corners more than a texel apart (cornerShifts)
function openCorners(faces, mappings, at) {
  const shifts = cornerShifts(faces, mappings, at);
  return RING_CORNERS.filter((corner, i) => shifts[i] > 1).map(([name]) => name);
}
// each wall by its initial: [its index in ringRoom, the pointer's point on it, the way along it a roll goes]
const RING_AT = { N: [0, [-500, 1024, 200], [-1, 0, 0]], E: [1, [1024, -500, 200], [0, 1, 0]], S: [2, [500, -1024, 200], [1, 0, 0]],
  W: [3, [-1024, 500, 200], [0, -1, 0]] };
// Steps on a page of the ring room (p; faces: its walls as built, the four selected), as the reviews and the oracle
// searches wrote them, a wall by its initial: 'N+5' Y on the north wall, 5 notches up, Enter; 'Er1' Y on the east wall,
// the pointer 1 unit along it, Enter ('Er1,0.5': and half a unit up); '@Wr-0.12' the same with the west wall alone
// selected (part of the selection; the four again after it), '@NW-3' with the north and west walls selected (the
// pointer on the first); 'NW^Nr-2.3,1' the north and west walls selected, the pointer on the north one; 'U' Undo, 'R'
// Redo, 'J-2' the History panel's row two steps back, 'D' a click that moved nothing; 'P3,-4' the Surface panel's Pan
// of the four walls ('P3,-4@NE': of the north and east ones), 'x2@NE' its Scale, 'A@NE' its Wall; 'B' a Rebuild; 'M16'
// the room moved 16 units along x and rebuilt (page's rebuild: its texture with it), the pointer on the walls where they
// are then. The corners open after each slip of the four (openCorners, where they are)
function playRing(p, faces, steps) {
  const open = [], all = faces.map((_, i) => i), walls = (names) => [...names].map((w) => RING_AT[w][0]);
  let moved = [0, 0, 0];
  const onWalls = (list) => list.map((i) => ({ brush: faces[i].brush, poly: faces[i].poly }));
  for (const step of steps.split(' ')) {
    if (step === 'U') { p.undo(); continue; }
    if (step === 'R') { p.redo(); continue; }
    if (step === 'D') { p.drop(); continue; }
    if (step === 'B') { p.rebuild(); continue; }
    const move = /^M(-?\d+)$/.exec(step);
    if (move) { moved = [moved[0] + Number(move[1]), moved[1], moved[2]]; p.rebuild([Number(move[1]), 0, 0]); continue; }
    const jump = /^J(-?\d+)$/.exec(step);
    if (jump) { p.jump(Number(jump[1])); continue; }
    const wall = /^A@([NESW]+)$/.exec(step);
    if (wall) { p.change('Align the texture: wall', (rows) => [...rows, { op: 'wall', args: [], targets: onWalls(walls(wall[1])) }]); continue; }
    const panel = /^(P|x)(-?[\d.]+)(?:,(-?\d+))?(?:@([NESW]+))?$/.exec(step);
    if (panel) {
      const on = onWalls(panel[4] ? walls(panel[4]) : all), [op, args] = panel[1] === 'P' ? ['pan', [Number(panel[2]), Number(panel[3])]]
        : ['scale', [Number(panel[2]), Number(panel[2])]];
      p.change(op === 'pan' ? 'Pan the texture' : 'Scale the texture', (rows) => [...rows, { op, args, targets: on }]);
      continue;
    }
    const [, alone, set, named, roll, n, up] = /^(@?)(?:([NESW]+)\^)?([NESW]+)(r?)([+-]?[\d.]+)(?:,(-?[\d.]+))?$/.exec(step);
    const [face, from, along] = RING_AT[named[0]], at = from.map((x, k) => x + moved[k]), chosen = alone ? walls(named) : set ? walls(set) : all;
    p.select(chosen);
    p.slip.start(p.at(face, at));
    if (roll) p.send('pointermove', { face, at: at.map((x, k) => x + along[k] * Number(n) + (k === 2 ? Number(up || 0) : 0)) });
    else p.send('wheel', { deltaY: -100 * Number(n) });
    p.key('Enter');
    p.select(all);
    if (chosen.length === all.length) open.push(openCorners(faces, p.mappings(), moved));
  }
  return open;
}
// the room's north and east walls (Brush2), the east wall's V drifting 0.3 texel along their corner
const DRIFTING = [
  { brush: 'Brush2', poly: 3, map: [0, 1024, 0, -0.5, 0, 0, 0, 0, -0.5, 0, 0, 128, 128], points: [[-1024, 1024, 0], [1024, 1024, 0], [1024, 1024, 384], [-1024, 1024, 384]] },
  { brush: 'Brush2', poly: 1, map: [1024, 0, 0, 0, 0.5, 0, 0, 0, -0.5 - 0.3 / 384, 0, 0, 128, 128], points: [[1024, -1024, 384], [1024, 1024, 384], [1024, 1024, 0], [1024, -1024, 0]] }];

test('Y over a selected face: the pointer rolls the texture, a click queues it as one undo step', () => {
  const p = page();
  assert.equal(p.slip.start(p.at(0, HERE)), true);
  assert.equal(p.slip.active, true);
  assert.equal(p.listeners.length, 8);
  assert.match(p.said.at(-1)[0], /^Texture Slip: move to roll it/);
  // 12 units along +y, 4 down: Pan U +12, V -4 on the wall (its U along -y, its V down), as the panel's fields
  const moved = p.send('pointermove', { face: 0, at: [64, 412, 46] });
  assert.equal(moved.stopped, false);                           // the view's hover goes on
  assert.equal(p.label.textContent, 'U +12 · V -4 · x1 · 2 faces');
  assert.equal(p.label.style.display, 'block');
  const shown = p.slips.at(-1);
  assert.deepEqual(shown.get(0).pan, [12, -4]);
  assert.deepEqual(shown.get(1).pan, [12, -4]);
  const down = p.send('pointerdown', { face: 0, at: [64, 412, 46] }), up = p.send('pointerup', { face: 0, at: [64, 412, 46] });
  assert.ok(down.stopped && up.stopped, 'the click is the slip\'s: nothing is picked');
  assert.deepEqual(p.queued, [{ rows: [{ op: 'pan', args: [12, -4], targets: [WALL, FLOOR] }], label: 'Slip the texture',
    line: 'Texture slip: x1, pan U +12 V -4 on 2 faces. Rebuild to apply and recalculate lighting.' }]);
  assert.deepEqual(p.said.at(-1), ['Texture slipped on 2 faces: Rebuild to see it in the game.', 'ok']);
  assert.equal(p.slip.active, false);
  assert.equal(p.listeners.length, 0);
  assert.equal(p.label.style.display, 'none');
  // a drag: let go where it ends; away from the page (no button any more), at the next move
  const q = page({ selected: [0] });
  q.slip.start(q.at(0, HERE));
  q.send('pointerdown', { face: 0, at: HERE, buttons: 1 });
  q.send('pointermove', { face: 0, at: [64, 380, 50], buttons: 1 });
  q.send('pointermove', { face: 0, at: [64, 370, 50], buttons: 0 });
  assert.deepEqual(q.queued[0].rows, [{ op: 'pan', args: [-20, 0], targets: [WALL] }]);
  // nothing moved: nothing queued
  const r = page();
  r.slip.start(r.at(0, HERE));
  r.key('Enter');
  assert.deepEqual([r.queued, r.said.at(-1)[0], r.slip.active], [[], 'Nothing slipped: the texture is where it was.', false]);
});

test('the wheel sizes it round the point under the pointer; Ctrl adds up a trackpad\'s parts; Shift sideways is finer', () => {
  const p = page({ selected: [0] });
  p.slip.start(p.at(0, HERE));
  const up = p.send('wheel', { deltaY: -100 });
  assert.ok(up.stopped && up.prevented, 'no camera move, no page zoom');
  assert.equal(p.label.textContent, 'U 0 · V 0 · x1.19');
  const scale = () => p.label.textContent.split(' · ').slice(2).join(' · ');   // the factor and the mode held
  for (let i = 0; i < 3; i++) p.send('wheel', { deltaY: -30, ctrlKey: true });
  assert.equal(scale(), 'x1.19 · snap');                                 // 0.9 of a notch: not yet
  p.send('wheel', { deltaY: -30, ctrlKey: true });
  assert.equal(scale(), 'x2 · snap');                                    // 1.2: a notch, to the next power of two
  p.send('wheel', { deltaX: 100, shiftKey: true });
  assert.equal(scale(), 'x1.92 · fine');                                 // a sixteenth of a doubling less
  assert.equal(p.send('wheel', { deltaY: -100, target: { tagName: 'DIV' } }).stopped, false);   // over a panel: its own
  p.key('Enter');
  assert.deepEqual(p.queued[0].rows[0], { op: 'scale', args: [1.91521, 1.91521], targets: [WALL] });
});

test('Esc, the right button, Alt, Ctrl+Z, a click elsewhere, leaving the page, cancel(): nothing queued, the view back', () => {
  const ways = {
    Esc: (p) => assert.ok(p.key('Escape').stopped),
    'the right button': (p) => assert.ok(p.send('pointerdown', { button: 2 }).stopped),
    Alt: (p) => p.key('Alt', { altKey: true }),
    'Ctrl+Z': (p) => assert.ok(p.key('z', { ctrlKey: true }).stopped, 'no Undo of the step before'),
    'a click on a panel': (p) => assert.equal(p.send('pointerdown', { target: { tagName: 'BUTTON' } }).stopped, false),
    'leaving the page': (p) => p.send('blur', { target: p.win }),
    'typing': (p) => assert.equal(p.key('a', { target: { tagName: 'INPUT' } }).stopped, false),
    'cancel()': (p) => assert.equal(p.slip.cancel(), true),
  };
  for (const [way, act] of Object.entries(ways)) {
    const p = page();
    p.slip.start(p.at(0, HERE));
    p.send('pointermove', { face: 0, at: [64, 412, 46] });
    act(p);
    assert.deepEqual([p.queued, p.slip.active, p.listeners.length, p.label.style.display], [[], false, 0, 'none'], way);
    assert.equal(p.refreshed(), 1, `${way}: the preview drawn again from the queue`);
    assert.equal(p.said.at(-1)[0], 'Texture slip cancelled: nothing changed.', way);
    assert.equal(p.slip.cancel(), false, `${way}: nothing left to cancel`);
  }
  // a blur inside the page (a field losing the focus) is not leaving it
  const p = page();
  p.slip.start(p.at(0, HERE));
  p.send('blur', { target: { tagName: 'INPUT' } });
  assert.equal(p.slip.active, true);
  // Shift and Ctrl go on to the page (the shortcut helper) and change the mode; any other key is the slip's
  assert.equal(p.key('Shift', { shiftKey: true }).stopped, false);
  assert.match(p.label.textContent, / · fine · 2 faces$/);
  p.send('keyup', { key: 'Shift' });
  assert.equal(p.label.textContent, 'U 0 · V 0 · x1 · 2 faces');
  const w = p.key('w');
  assert.ok(w.stopped && w.prevented);
  assert.equal(p.slip.active, true);
});

test('Y away from the selected faces: it waits for the pointer over one; what it cannot do it refuses', () => {
  const p = page();
  assert.equal(p.slip.start(null), true);
  assert.equal(p.said.at(-1)[0], 'Texture Slip: point at one of the selected faces (Esc cancels).');
  p.send('pointermove', { face: 2, at: [10, 10, 0] });                 // a face not selected
  assert.match(p.said.at(-1)[0], /^Point at one of the selected faces/);
  p.send('pointermove', { at: [10, 10, 0] });                           // a block not built, nothing
  assert.match(p.said.at(-1)[0], /^No built face under the pointer\. The slip starts over one/);
  assert.equal(p.label.style.display, undefined);
  p.send('pointermove', { face: 0, at: HERE, target: { tagName: 'DIV' } });   // over a panel: still waiting
  assert.equal(p.label.style.display, undefined);
  p.send('pointermove', { face: 0, at: HERE });
  assert.equal(p.label.textContent, 'U 0 · V 0 · x1 · 2 faces');
  // a click while waiting starts it there, and queues nothing
  const q = page();
  q.slip.start(null);
  q.send('pointerdown', { face: 1, at: [100, 100, 0] });
  assert.ok(q.send('pointerup', { face: 1, at: [100, 100, 0] }).stopped);
  assert.deepEqual([q.slip.active, q.queued], [true, []]);
  // not now (a Rebuild runs), no face selected, a locked face, a structure resized or moved otherwise since the
  // Rebuild, a face whose queued row the Rebuild refuses
  const refused = (options, at, why) => {
    const r = page(options);
    assert.equal(r.slip.start(at), false, why);
    assert.deepEqual([r.slip.active, r.listeners.length], [false, 0], why);
    assert.match(r.said.at(-1)[0], why);
  };
  refused({ can: 'Rebuilding 01_Feature_Lab: the slip waits.' }, null, /^Rebuilding/);
  // no face selected: the page says it (can(): in Face selection, a click selects one); the slip names no key of its own
  refused({ selected: [], can: 'Select faces first: click one (Shift+click adds).' }, null, /^Select faces first: click one \(Shift\+click adds\)\.$/);
  const none = page({ selected: [] });
  none.slip.start(null);
  assert.deepEqual(none.said.filter(([text]) => /\bQ\b/.test(text)), []);
  none.slip.cancel();
  refused({ canEdit: (f) => f.brush !== 'Brush2' }, p.at(0, HERE), /^Unlock the target structure/);
  refused({ frames: { mesh1: { resized: true } } }, p.at(0, HERE), /^1 of the selected faces is on a structure resized since the Rebuild/);
  refused({ frames: { mesh1: { toBuilt: new THREE.Matrix4().makeTranslation(0, 0, 64) } } }, p.at(0, HERE),
    /^1 of the selected faces is on a structure moved or turned since the Rebuild, otherwise than the face under the pointer/);
  // the face under the pointer the one moved: the others are those not moved with it
  refused({ frames: { mesh0: { toBuilt: new THREE.Matrix4().makeTranslation(0, 0, 64), moved: true } } }, p.at(0, HERE),
    /^The face under the pointer is on a structure moved or turned since the Rebuild and 1 of the selected faces is not moved with it: Rebuild first, or slip them apart\.$/);
  const failing = mappingAfter({ ...mappingOf(FACES[1].map), pan: [32760, 0] }, [{ op: 'pan', args: [10, 0] }]);
  refused({ current: (id) => (id === 1 ? failing : mappingOf(FACES[id].map)) }, p.at(0, HERE), /^The Rebuild would fail on a selected face/);
});

test('the arrows nudge it the way they point on the screen; Enter with too many rows says so, P gives one pan', () => {
  // seen from in front of the wall: Right takes the picture right, a texel (its U runs to the left)
  const p = page({ selected: [0] });
  p.slip.start(p.at(0, HERE));
  p.key('ArrowRight');
  p.key('ArrowUp');
  assert.equal(p.label.textContent, 'U -1 · V +1 · x1');
  p.key('ArrowLeft', { ctrlKey: true });                              // Ctrl: a snap step (16 texels of 128)
  p.send('keyup', { key: 'Control' });                                // (held, the pan would snap)
  p.key('Enter');
  assert.deepEqual(p.queued[0].rows, [{ op: 'pan', args: [15, 1], targets: [WALL] }]);
  // room for 2 rows: each face its own pan after the wheel takes 3 (a scale, two pans): P offered, then one pan
  const q = page({ room: 2 });
  q.slip.start(q.at(0, [64, 450, 80]));
  q.send('wheel', { deltaY: -100 });
  assert.match(q.label.textContent, / · P: one pan for all$/);
  q.key('Enter');
  assert.match(q.said.at(-1)[0], /^This slip needs 3 queued surface changes and the map has room for 2 more/);
  assert.deepEqual([q.queued, q.slip.active], [[], true]);
  q.key('p');
  assert.match(q.label.textContent, / · one pan · 2 faces · room for 0 more queued surface changes \(of 4096\) · P: each face its own pan$/);
  q.key('Enter');
  assert.deepEqual(q.queued[0].rows.map((row) => row.op), ['scale', 'pan']);
  assert.match(q.queued[0].line, /on 2 faces, one pan\./);
  assert.deepEqual(q.said.at(-1), ['Texture slipped on 2 faces: Rebuild to see it in the game · room for 0 more queued surface changes (of 4096).', 'warn']);
  // P when each face's own pan fits: said, nothing changes
  const r = page();
  r.slip.start(r.at(0, HERE));
  r.key('p');
  assert.match(r.said.at(-1)[0], /^One pan for all is offered when/);
  assert.doesNotMatch(r.label.textContent, /one pan/);
});

test('a structure moved since the Rebuild: the slip where it was built, the same rows', () => {
  const rowsOf = (offset) => {
    const p = page({ offset });
    p.slip.start(p.at(0, HERE));
    p.send('pointermove', { face: 0, at: [64, 431, 21] });
    p.send('wheel', { deltaY: 100 });
    p.key('Enter');
    return p.queued[0].rows;
  };
  const still = rowsOf([0, 0, 0]);
  assert.equal(still.length, 3);
  assert.deepEqual(rowsOf([512, -256, 128]), still);
  assert.ok(sameFrame(new THREE.Matrix4().elements, new THREE.Matrix4().makeTranslation(0.0004, 0, 0).elements));
  assert.ok(!sameFrame(new THREE.Matrix4().elements, new THREE.Matrix4().makeTranslation(0, 0.01, 0).elements));
  assert.ok(!sameFrame(new THREE.Matrix4().elements, new THREE.Matrix4().makeRotationY(1e-4).elements));
});

test('at a corner the wheel keeps the walls\' texture together: each face\'s pieces go to the slip', () => {
  const p = page({ selected: [0, 3] });
  p.slip.start(p.at(0, HERE));
  p.send('wheel', { deltaY: -100 });
  p.key('Enter');
  const [wall, side] = [0, 3].map((id) => mappingAfter(mappingOf(FACES[id].map), rowsFor(FACES[id], p.queued[0].rows)));
  // at the corner (x 64, y 528) whole tiles apart as before, give or take half a texel (one notch on its own axes parted
  // them by 20)
  for (const z of [0, 50, 96]) {
    const [a, b] = [texelOf(wall, [64, 528, z]), texelOf(side, [64, 528, z])];
    for (const k of [0, 1]) {
      const tiles = (a[k] - b[k]) / 128;
      assert.ok(Math.abs(tiles - Math.round(tiles)) * 128 <= 0.5 + 1e-9, `axis ${k} at z ${z}: ${a[k]} and ${b[k]}`);
    }
  }
});

test('each face\'s texture goes to the slip: walls of one texture over a floor of another keep their corners', () => {
  // the room's floor, its texture running on into the north and south walls along their bases (the south one's U
  // mirrored), and three walls of another texture, the pointer on the floor: the walls' sides crossed first, the ring
  // they make through the floor (8 tiles round) closes at its edge. Given no texture (as the page gave none), it closed
  // at the east-south corner: 35 texels apart after a notch. The floor not panned: it steps at none of the ring's sides
  const room = (floorTex, wallTex) => [
    { brush: 'Brush2', poly: 4, tex: floorTex, map: [0, 0, 0, -0.5, 0, 0, 0, 0.5, 0, 0, 0, 128, 128], points: [[-1024, -1024, 0], [1024, -1024, 0], [1024, 1024, 0], [-1024, 1024, 0]] },
    { brush: 'Brush2', poly: 3, tex: wallTex, map: [0, 1024, 0, -0.5, 0, 0, 0, 0, -0.5, 0, 0, 128, 128], points: [[-1024, 1024, 0], [1024, 1024, 0], [1024, 1024, 384], [-1024, 1024, 384]] },
    { brush: 'Brush2', poly: 1, tex: wallTex, map: [1024, 0, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 128, 128], points: [[1024, -1024, 0], [1024, -1024, 384], [1024, 1024, 384], [1024, 1024, 0]] },
    { brush: 'Brush2', poly: 2, tex: wallTex, map: [0, -1024, 0, -0.5, 0, 0, 0, 0, -0.5, 0, 0, 128, 128], points: [[1024, -1024, 0], [-1024, -1024, 0], [-1024, -1024, 384], [1024, -1024, 384]] }];
  // how far the wall corners part (north-east, east-south) after a notch, whole tiles taken off
  const corners = (faces) => {
    const p = page({ faces, selected: [0, 1, 2, 3] });
    p.slip.start(p.at(0, [300, 200, 0]));
    p.send('wheel', { deltaY: -100 });
    p.key('Enter');
    const [north, east, south] = faces.slice(1).map((f) => mappingNow({ ...f, mapping: mappingOf(f.map) }, p.queued[0].rows));
    return [[north, east, 1024], [east, south, -1024]].map(([a, b, y]) => Math.max(...[10, 300].flatMap((z) => [0, 1].map((k) => {
      const tiles = (texelOf(a, [1024, y, z])[k] - texelOf(b, [1024, y, z])[k]) / 128;
      return Math.abs(tiles - Math.round(tiles)) * 128;
    }))));
  };
  const [northEast, eastSouth] = corners(room('Pkg.Floor', 'Pkg.Wall'));
  assert.ok(northEast <= 0.5 + 1e-9 && eastSouth <= 0.5 + 1e-9, `the corners ${northEast} and ${eastSouth} texels apart`);
  assert.ok(corners(room())[1] > 1);
});

test('slips kept one after the other start from the exact mappings the one before left, while each face\'s mapping is still the one it left (an Undo, an Undo and Redo, a Pan, a Rebuild between)', () => {
  // two walls at a corner (Brush9, 0.6 texel a unit along them, 0.45 down), slipped twelve times and kept, the pointer on
  // either in turn: the corner within a texel after each (from the queued mappings alone, 1.38 texels after the twelfth)
  const faces = [
    { brush: 'Brush9', poly: 0, map: [0, 256, 0, 0.6, 0, 0, 0, 0, -0.45, 0, 0, 128, 128], points: [[0, 256, 0], [256, 256, 0], [256, 256, 256], [0, 256, 256]] },
    { brush: 'Brush9', poly: 1, map: [256, 256, 0, 0, -0.6, 0, 0, 0, -0.45, 0, 0, 128, 128], points: [[256, 256, 0], [256, 0, 0], [256, 0, 256], [256, 256, 256]] }];
  const built = faces.map((f) => ({ ...f, mapping: mappingOf(f.map) })), points = [[40, 256, 200], [256, 30, 60]];
  const seam = (rows, z) => { const [a, b] = built.map((f) => mappingNow(f, rows)); return [0, 1].map((k) => texelOf(a, [256, 256, z])[k] - texelOf(b, [256, 256, z])[k]); };
  const moved = (rows) => Math.max(...[0, 128, 256].flatMap((z) => seam(rows, z).map((x, k) => {
    const tiles = (x - seam([], z)[k]) / 128;
    return Math.abs(tiles - Math.round(tiles)) * 128;
  })));
  // a slip kept, the pointer on face i % 2, the wheel turned: what the HUD said before it was kept
  const slipAt = (p, i, notches) => {
    p.slip.start(p.at(i % 2, points[i % 2]));
    p.send('wheel', { deltaY: -100 * notches });
    const said = p.label.textContent;
    p.key('Enter');
    return said;
  };
  const p = page({ faces }), twin = page({ faces });
  [1, -3, 2, -1, 3, -2, 1, 1, -3, 2, -2, -1].forEach((notches, i) => {
    const [said] = [p, twin].map((q) => slipAt(q, i, notches));
    assert.ok(moved(p.rows()) <= 1 + 1e-9, `slip ${i + 1}: ${moved(p.rows())} texels`);
    assert.match(said, /^U 0 · V 0 · /, `slip ${i + 1}: no pan from the pointer`);   // (the exact pans' offsets said U +1 or V -1)
  });
  // the queue made again since (Undo, Redo), the Surface panel's Pan pushed onto it (each face's exact pan moved as much),
  // the map rebuilt (the faces other objects, their numbers to the dump's 6 digits, nothing queued): each face's mapping
  // is still the one the slip left, by value (its pan whole texels off), so the next slip starts from the exact mappings
  // as the page that did none of them, the same rows; not from the queued mappings, as a fresh page with those rows
  // (the exact mappings dropped with the queue's list, after the Undo the rows were those of the fresh page)
  twin.undo(); twin.redo();
  const fresh = page({ faces, queue: twin.rows() });
  for (const q of [p, twin, fresh]) slipAt(q, 0, 1);
  assert.notDeepEqual(p.queued.at(-1).rows, fresh.queued.at(-1).rows);
  assert.deepEqual(twin.queued.at(-1).rows, p.queued.at(-1).rows, 'an Undo and Redo between');
  twin.change('Pan the texture', (rows) => [...rows, { op: 'pan', args: [5, 0], targets: faces.map(({ brush, poly }) => ({ brush, poly })) }]);
  for (const q of [p, twin]) slipAt(q, 1, 1);
  assert.deepEqual(twin.queued.at(-1).rows, p.queued.at(-1).rows, 'a Pan between');
  twin.rebuild();
  for (const q of [p, twin]) slipAt(q, 0, -2);
  assert.deepEqual(twin.queued.at(-1).rows, p.queued.at(-1).rows, 'a Rebuild between');
  // a slip kept on the twin alone, then undone (the queue as before it): the next slip starts from the exact mappings
  // the slip before it left, the same rows as the page that never made it (each face's mapping then the one the undone
  // slip started from, of another scale: it started from the queued mappings)
  slipAt(twin, 1, 3);
  twin.undo();
  for (const q of [p, twin]) slipAt(q, 1, -1);
  assert.deepEqual(twin.queued.at(-1).rows, p.queued.at(-1).rows, 'an Undo between');
  assert.ok(moved(p.rows()) <= 1 + 1e-9, `${moved(p.rows())} texels`);
});

test('slips kept with the queue made again, panned or rebuilt between them, or the panel\'s Scale first: the drift judged at the scale the faces were built at', () => {
  // the room's north and east walls (Brush2), the east wall's V drifting 0.3 texel along their corner: -3 notches on the
  // north wall kept; the queue made again (Undo, Redo), the Surface panel's Pan pushed onto it, or the map rebuilt; -2 on
  // the east wall kept: the corner within a texel and its drift's share. Without the faces' mappings as built, the drift
  // was judged at the scale now (0.5 texel): each wall scaled round its own point, 53.5 texels apart; with those the last
  // Rebuild built, the same after a Rebuild between
  const faces = DRIFTING, built = faces.map((f) => mappingOf(f.map));
  const seam = (mappings, z) => [0, 1].map((k) => texelOf(mappings[0], [1024, 1024, z])[k] - texelOf(mappings[1], [1024, 1024, z])[k]);
  const moved = (mappings) => Math.max(...[0, 192, 384].flatMap((z) => seam(mappings, z).map((x, k) => {
    const tiles = (x - seam(built, z)[k]) / 128;
    return Math.abs(tiles - Math.round(tiles)) * 128;
  })));
  const slipAt = (p, face, point, deltaY) => { p.slip.start(p.at(face, point)); p.send('wheel', { deltaY }); p.key('Enter'); };
  for (const between of ['an Undo and Redo', 'a Pan', 'a Rebuild']) {
    const p = page({ faces });
    slipAt(p, 0, [584, 1024, 200], 300);
    if (between === 'an Undo and Redo') { p.undo(); p.redo(); }
    else if (between === 'a Pan') p.change('Pan the texture', (rows) => [...rows, { op: 'pan', args: [5, 0], targets: faces.map(({ brush, poly }) => ({ brush, poly })) }]);
    else p.rebuild();
    slipAt(p, 1, [1024, -600, 300], 200);
    assert.ok(moved(p.mappings()) <= 1 + 0.15 * Math.abs(1 - 2 ** 1.25) + 1e-6, `${between} between: ${moved(p.mappings())} texels`);
  }
  // the Surface panel's Scale (2, 0.5) queued on both walls before the first slip (their V 0.6 texel apart along the
  // corner now, 0.3 as built), -3 notches on the north wall: the corner within a texel and its drift's share, against the
  // walls as the Scale left them. (Given the mapping now as built, the drift was judged at 0.6: 52.9 texels apart)
  const scaled = [{ op: 'scale', args: [2, 0.5], targets: faces.map(({ brush, poly }) => ({ brush, poly })) }];
  const p = page({ faces, queue: scaled }), from = p.mappings();
  slipAt(p, 0, [584, 1024, 200], 300);
  const after = p.mappings(), at = (mappings, z) => [0, 1].map((k) => texelOf(mappings[0], [1024, 1024, z])[k] - texelOf(mappings[1], [1024, 1024, z])[k]);
  const shift = Math.max(...[0, 192, 384].flatMap((z) => at(after, z).map((x, k) => Math.abs((x - at(from, z)[k]) / 128 - Math.round((x - at(from, z)[k]) / 128)) * 128)));
  assert.ok(shift <= 1 + 0.3 / 0.5 / 2 * Math.abs(1 - 2 ** 0.75) + 1e-6, `the panel's Scale first: ${shift} texels`);
});

test('a sign of another texture set in a wall slipped again, a drag between, kept or rebuilt: parted where the first parted', () => {
  // a sign (Brush679, U 2 texels a unit) in a concrete wall cut round it (Brush243, U 1): the texture runs on over the
  // sign's left and right sides. -3 notches by its left side (the right one parts), a drag by its right side, +3 by its
  // right side (the scale back to 1), kept, and rebuilt after each: the left side within a texel throughout, both back
  // within a texel at the end. (Each face's mapping before the slip given as the last Rebuild built it, or as the slip
  // before started from: the right side counted as parted no more, the last slip kept it, the nearer, and parted the
  // left: 32 texels off at the end)
  const faces = [{ brush: 'Brush679', poly: 2, tex: 'Pkg.Sign', map: [128, 0, 16, 2, 0, 0, 0, 0, -1, 0, 0, 128, 128],
    points: [[128, 0, 16], [192, 0, 16], [192, 0, 144], [128, 0, 144]] },
  { brush: 'Brush243', poly: 3, tex: 'Pkg.Concrete', map: [240, 0, 0, 1, 0, 0, 0, 0, -1, 48, 44, 128, 128], points: [[0, 0, 0], [256, 0, 0], [256, 0, 256], [0, 0, 256]],
    pieces: [[[0, 0, 0], [256, 0, 0], [256, 0, 16], [0, 0, 16]], [[0, 0, 144], [256, 0, 144], [256, 0, 256], [0, 0, 256]],
      [[0, 0, 16], [128, 0, 16], [128, 0, 144], [0, 0, 144]], [[192, 0, 16], [256, 0, 16], [256, 0, 144], [192, 0, 144]]] }];
  const shows = (mappings, x, z) => [0, 1].map((k) => texelOf(mappings[0], [x, 0, z])[k] - texelOf(mappings[1], [x, 0, z])[k]);
  for (const [what, between] of [['kept', () => {}], ['rebuilt after each', (p) => p.rebuild()]]) {
    const p = page({ faces, selected: [0, 1] }), first = p.mappings();
    // how far the left and right sides moved since the start, whole tiles off
    const moved = () => [128, 192].map((x) => Math.max(...[16, 80, 144].flatMap((z) => shows(p.mappings(), x, z).map((d, k) => {
      const tiles = (d - shows(first, x, z)[k]) / 128;
      return Math.abs(tiles - Math.round(tiles)) * 128;
    }))));
    p.slip.start(p.at(0, [135, 0, 80]));
    p.send('wheel', { deltaY: 300 });
    p.key('Enter');
    const [left1, right1] = moved();
    assert.ok(left1 <= 1 + 1e-9 && right1 > 1, `${what}, slip 1: ${left1} and ${right1} texels`);
    between(p);
    p.slip.start(p.at(0, [185, 0, 80]));
    p.send('pointermove', { face: 0, at: [189, 0, 83] });
    p.key('Enter');
    between(p);
    p.slip.start(p.at(0, [185, 0, 80]));
    p.send('wheel', { deltaY: -300 });
    p.key('Enter');
    assert.equal(p.queued.length, 3, what);
    const [left3, right3] = moved();
    assert.ok(left3 <= 1 + 1e-9 && right3 <= 1 + 1e-9, `${what}, slip 3: ${left3} and ${right3} texels`);
  }
});

test('a ring slipped again with the queue made again or the map rebuilt between: it parts at one corner, the one it parted', () => {
  // the room's four walls (Brush2, 384 high), one texture 32 tiles round: -1 notch on the north wall, -2 on the south
  // one, -3 on the west one, kept, the queue made again (Undo, Redo) after each, or the map rebuilt; then the same with
  // the east wall of another texture, rebuilt after each. One corner parts, the same after each slip. (The exact
  // mappings dropped with the queue's list, the rounding left a seamless corner 1.16 texels off, and the ring parted
  // there too: 38.69 and 23.69 texels; the retextured room rebuilt, against its mappings as rebuilt, parted at both its
  // sides between the textures)
  for (const [what, east, between] of [['an Undo and Redo after each', 'Pkg.Wall', (p) => { p.undo(); p.redo(); }],
    ['rebuilt after each', 'Pkg.Wall', (p) => p.rebuild()], ['retextured, rebuilt after each', 'Pkg.Panel', (p) => p.rebuild()]]) {
    const faces = ringRoom(east), p = page({ faces, selected: [0, 1, 2, 3] }), open = [];
    for (const [face, point, notches] of [[0, [-500, 1024, 200], -1], [2, [500, -1024, 200], -2], [3, [-1024, 500, 200], -3]]) {
      p.slip.start(p.at(face, point));
      p.send('wheel', { deltaY: -100 * notches });
      p.key('Enter');
      open.push(openCorners(faces, p.mappings()));
      between(p);
    }
    assert.ok(open[0].length === 1, `${what}: ${JSON.stringify(open)}`);
    assert.deepEqual(open, [open[0], open[0], open[0]], what);
  }
});

test('a ring whose texture steps at two corners as built, slipped again: it parts again at the corner the slip before parted, one after each slip, none at the scale it had', () => {
  // the ring room, the east wall's base 2.4 units along it: its two corners step 1.2 texels as built. -3 notches on the
  // north wall kept (the ring parts at one of those, east-south), then +3 or -5 on the south wall (back to the scale it
  // had, or to a quarter: the ring 128 tiles round), or -2 with a Rebuild between: east-south alone open after each
  // slip, none at the end of the first two. (The corner the first slip parted ranked with north-east, which steps as
  // built, and where the walk started decided: the second slip parted north-east too, 23 texels open at the end; round
  // 13's review, #0)
  for (const [steps, last] of [['N-3 S+3', []], ['N-3 S-5', []], ['N-3 B S-2', ['east-south']]]) {
    const faces = ringRoom('Pkg.Wall', 2.4), open = playRing(page({ faces, selected: [0, 1, 2, 3] }), faces, steps);
    assert.deepEqual(open, [['east-south'], last], steps);
  }
  // the west wall's base 2.4 up instead: its V steps 1.2 texels along its corners (a step along a side parts before one
  // across it): the same at south-west. (Ranked between a step along and one across, the corner the first slip parted
  // was crossed and west-north parted too)
  const raised = ringRoom().map((f, i) => (i === 3 ? { ...f, map: [-1024, 0, 2.4, ...f.map.slice(3)] } : f));
  for (const steps of ['N-3 S+3', 'N-3 S-5']) {
    assert.deepEqual(playRing(page({ faces: raised, selected: [0, 1, 2, 3] }), raised, steps), [['south-west'], []], `the west wall raised: ${steps}`);
  }
});

test('a corner lined up by a roll of one wall alone, then the four slipped: it stays lined up, within a texel', () => {
  // the ring room, the east wall's base 4 units along it: its two corners step 2 texels as built. The north wall alone
  // rolled 4 units lines up north-east (and opens west-north by 2 texels), kept; then -3 notches on the north wall, +3 on
  // the south wall or +2 on the west wall, the four selected: north-east still within a texel (which corner parts
  // instead is not asserted). (Ranked as a side a slip parted since the first slip kept on its faces, the corner the
  // roll lined up parted again: 23, 3.7 and 47 texels open)
  const at = (m, a, b, [x, y], z, k) => texelOf(m[a], [x, y, z])[k] - texelOf(m[b], [x, y, z])[k];
  const steps = (m, [, a, b, xy]) => Math.max(...[0, 192, 384].flatMap((z) => [0, 1].map((k) => Math.abs(at(m, a, b, xy, z, k) / 128
    - Math.round(at(m, a, b, xy, z, k) / 128)) * 128)));
  for (const last of ['N-3', 'S+3', 'W+2']) {
    const faces = ringRoom('Pkg.Wall', 4), p = page({ faces, selected: [0, 1, 2, 3] });
    playRing(p, faces, '@Nr4');
    assert.deepEqual(RING_CORNERS.map((c) => Math.round(steps(p.mappings(), c))), [0, 2, 0, 2], 'the roll');
    playRing(p, faces, last);
    assert.ok(steps(p.mappings(), RING_CORNERS[0]) <= 1, `${last}: north-east ${steps(p.mappings(), RING_CORNERS[0]).toFixed(2)}`);
  }
});

test('a ring slipped again after its structure was moved and rebuilt: it parts again at the corner the slip before parted, its texture having moved with the walls', () => {
  // the ring room, the east wall's base 2.4 units along it (its two corners step 1.2 texels as built): -1 notch on the
  // north wall kept (the ring parts at east-south), the room moved 16 units along x and rebuilt (the host moves each
  // wall's texture base with it), then -2 on the east wall: east-south alone open after each slip, as with a Rebuild
  // that moved nothing. (Each wall's mapping before the first slip read where it was before the move: every corner
  // whose walls' U or V differ along the move seemed parted since, and the ring parted at north-east too, 31.86 texels;
  // round 14's review, #0)
  for (const steps of ['N-1 M16 E-2', 'N-1 B E-2', 'N-1 M-16 E-2']) {
    const faces = ringRoom('Pkg.Wall', 2.4);
    assert.deepEqual(playRing(page({ faces, selected: [0, 1, 2, 3] }), faces, steps), [['east-south'], ['east-south']], steps);
  }
});

test('a ring of two textures whose one-texture corners a roll of one wall alone stepped: it parts between the two textures, the roll\'s steps kept', () => {
  // the ring room, its west wall of another texture (south-west and west-north between two textures). The east wall
  // alone rolled 5 units (its corners with the north and south walls 2.5 texels apart, kept), then -3 notches on the
  // north wall or +2 on the west one, the four: the one corner moved more than 4 texels against the walls as built is
  // west-north, between the two textures (of those two, the one whose walls come later by brush and polygon); the
  // roll's corners keep their steps, scaled. (A side of one texture a slip parted since, ranked with the sides between
  // two textures or below them, was crossed after one of them: the ring parted at north-east, 25.85 and 49.92 texels;
  // round 14's review, #3)
  const faces = ringRoom().map((f, i) => (i === 3 ? { ...f, tex: 'Pkg.Panel' } : f));
  for (const last of ['N-3', 'W+2']) {
    const p = page({ faces, selected: [0, 1, 2, 3] });
    playRing(p, faces, `@Er5 ${last}`);
    const shifts = cornerShifts(faces, p.mappings());
    assert.deepEqual(RING_CORNERS.filter((corner, i) => shifts[i] > 4).map(([name]) => name), ['west-north'],
      `@Er5 ${last}: ${shifts.map((x) => x.toFixed(2)).join(', ')}`);
  }
});

test('a ring slipped again with an Undo between (of a roll, of one wall\'s roll then a Pan of the four, to the same scale, to another) or a Pan of the four after a roll: one corner after each slip, none at the scale it had; undone back to as built or to a slip of two walls, a slip that moves nothing queues nothing', () => {
  // the room's four walls, slips kept and undone in turn (the review's flows, playRing's steps): one corner parts after
  // each slip, and none at the end, back at the scale the walls had, with a Pan of the four after an Undo too, and
  // after a roll of the west wall alone (part of the selection) undone. (Each wall given the exact mapping the last slip
  // kept on it left, while its pan was whole texels off that: an Undo of a roll, or back to the same scale, gave each
  // the fraction of another state, and the ring stood open at two corners, 57 to 63 texels; an Undo to another scale
  // dropped them, and the next slip parted a second corner, 1 to 9 texels. The west wall's roll undone, then a Pan of
  // the four: the west wall took the roll's fraction, the others the slip's before it, and a second corner parted)
  for (const steps of ['N+5 Er1 U W-5', 'S-3 U S-5 N-3 E+3 U U E-1 W+6', 'W-5 W-4 U W+4 N-1 U S+1', 'E+5 E+4 U S-2 W+2 U W-3',
    'N+5 Er1 U P3,-4 W-5', 'S+5 N+1 S-3 N-2 @Wr-0.12 U P3,-2 N-2 S+1', 'N-3 @Wr-1.4 U P3,-2 S+3', 'N+2 E-1 @Wr1.7 U P3,-2 S-1']) {
    const faces = ringRoom(), open = playRing(page({ faces, selected: [0, 1, 2, 3] }), faces, steps);
    assert.ok(open.every((names) => names.length <= 1) && !open.at(-1).length, `${steps}: ${JSON.stringify(open)}`);
  }
  // -3 notches on the north wall, a roll of the west wall alone, then one of the four, a Pan of the four and a slip: one
  // corner at most after each slip of the four. (The west wall, back at its own roll's end by value, took it and lost
  // the four's roll's fraction: the last slip parted the west-north corner too, 1.66 texels)
  const rolled = ringRoom(), afterPan = playRing(page({ faces: rolled, selected: [0, 1, 2, 3] }), rolled, 'N-3 @Wr0.3 Nr2.2 P1,0 E-2');
  assert.ok(afterPan.every((names) => names.length <= 1), `N-3 @Wr0.3 Nr2.2 P1,0 E-2: ${JSON.stringify(afterPan)}`);
  // two slips that bring the walls back to the scale they had, both undone (the walls as built), then Y and Enter on the
  // north wall alone, nothing moved: nothing queued, and the status says so. (The walls as built are at the newer slip's
  // end too by value, whole texels off: that end gave the north wall its fraction, and the slip queued a pan of a texel)
  const faces = ringRoom(), p = page({ faces, selected: [0, 1, 2, 3] });
  playRing(p, faces, 'N-1 S+1 U U');
  p.select([0]);
  p.slip.start(p.at(0, RING_AT.N[1]));
  p.key('Enter');
  assert.deepEqual([p.queued.length, p.rows()], [2, []]);
  assert.match(p.said.at(-1)[0], /^Nothing slipped/);
  // the north and west walls alone slipped, the west wall alone rolled, then the four rolled, the two rolls undone (the
  // east and south walls as built), then Y and Enter on the four, nothing moved: nothing queued. (The four's roll, asked
  // again of the east and south walls alone once older slips had given the others theirs, gave them its end, and the
  // slip queued a pan of a texel on them)
  const q = page({ faces, selected: [0, 1, 2, 3] });
  playRing(q, faces, '@NW-3 @Wr1.5 Nr-0.5 U U');
  assert.deepEqual(q.rows().filter(({ op }) => op === 'scale').map(({ targets }) => targets), [[faces[0], faces[3]].map(({ brush, poly }) => ({ brush, poly }))],
    'the first slip scaled the north and west walls');
  assert.deepEqual(q.mappings().slice(1, 3), faces.slice(1, 3).map((f) => mappingOf(f.map)), 'the east and south walls as built');
  const left = [q.queued.length, q.rows()];
  q.slip.start(q.at(0, RING_AT.N[1]));
  q.key('Enter');
  assert.deepEqual([q.queued.length, q.rows()], left);
  assert.match(q.said.at(-1)[0], /^Nothing slipped/);
});

test('a slip undone between two kept: the next one queues what it would have queued had the undone one never been made, no corner open', () => {
  // the room's four walls, the east one's base 0.6 along it (its corners 0.3 texel off as built): -1 notch on the north
  // wall kept, a drag on the south wall kept, then an Undo (the queue the first left); +1 on the north wall kept, the
  // scale back to 1: the same rows as a page that never made the drag, every corner as built. (The drag's exact
  // mappings, its pans whole texels off, gave each wall its fraction: the east-south and south-west corners 6 and 7
  // texels open)
  const faces = ringRoom('Pkg.Wall', 0.6), [p, twin] = [0, 1].map(() => page({ faces, selected: [0, 1, 2, 3] }));
  const scaleAt = (q, face, at, notches) => { q.slip.start(q.at(face, at)); q.send('wheel', { deltaY: -100 * notches }); q.key('Enter'); };
  for (const q of [p, twin]) scaleAt(q, 0, [500, 1024, 300], -1);
  p.slip.start(p.at(2, [-800, -1024, 300]));
  p.send('pointermove', { face: 2, at: [-798.8, -1024, 300.8] });
  p.key('Enter');
  assert.equal(p.queued.length, 2, 'the drag kept');
  p.undo();
  for (const q of [p, twin]) scaleAt(q, 0, [-800, 1024, 100], 1);
  assert.deepEqual(p.queued.at(-1).rows, twin.queued.at(-1).rows);
  assert.deepEqual(openCorners(faces, p.mappings()), []);
});

test('the page\'s Undo history holds what the slips kept know (their exact mappings among it) with each step\'s edits: an Undo, a Redo, a History panel jump or a click that moved nothing gives back those of the edits it puts in place', () => {
  // the ring room's four walls: -3 notches on the north wall kept, a Pan of the north and east walls, +2 on the south
  // wall kept. The slip's step holds the exact mappings of the edits before it (none before the first); a Pan's the
  // same ones as the state after it (they move with it); each Undo, Redo, jump of the History panel gives back those of
  // the step it takes, a click that moved nothing keeps them (and Redo its step); a Rebuild keeps those of the map now
  // (the history goes), another map forgets them
  const faces = ringRoom(), p = page({ faces, selected: [0, 1, 2, 3] });
  assert.equal(p.slip.held, null);
  playRing(p, faces, 'N-3');
  const one = p.slip.held;
  assert.ok(one.exacts instanceof Map && one.kept.known instanceof Map);
  assert.equal(p.history.undo[0].page, null, 'the first slip\'s step: no exact mapping before it');
  playRing(p, faces, 'P3,-2@NE');
  assert.deepEqual([p.slip.held, p.history.undo[1].page], [one, one], 'a Pan');
  playRing(p, faces, 'S+2');
  const two = p.slip.held;
  assert.ok(two.exacts instanceof Map && two !== one);
  assert.equal(p.history.undo[2].page, one);
  const held = [];
  for (const step of [() => p.undo(), () => p.undo(), () => p.undo(), () => p.jump(3), () => p.jump(-2), () => p.redo(), () => p.drop(), () => p.redo()]) {
    step();
    held.push(p.slip.held === null ? 'none' : p.slip.held === one ? 'one' : p.slip.held === two ? 'two' : '?');
  }
  assert.deepEqual(held, ['one', 'one', 'none', 'two', 'one', 'one', 'one', 'two']);
  p.rebuild();
  assert.deepEqual([p.slip.held, p.history.undo.length], [two, 0], 'a Rebuild');
  p.slip.forget();
  assert.equal(p.slip.held, null, 'another map');
});

test('an Undo, a Redo, a History panel jump or a click that moved nothing between slips: the next slip queues what it would have queued had the steps undone never been made', () => {
  // the ring room's four walls, flows where the records of the slips kept went wrong (undo_design_pagesearch.mjs, and
  // the flows of round 12's review, fix12_result.json #0, #7 to #13, written as playRing's steps): each page against a
  // twin that only made the steps left, then the same slip on both (a slip that moves nothing, in most of the review's):
  // the same queue, the same rows. (By value from the records, a slip of part of the walls undone, or rolls undone back
  // to as built, fit an older or a newer record's state, whole texels off: walls off the twin's exact mappings by
  // different amounts, up to 1.16 texels, and a slip that moved nothing queued a pan of a texel)
  for (const [steps, left, then] of [['D NSW^W-3 NES^Er0.64,0.69 U NE^N1 D U', 'NSW^W-3', 'NESW^N-2'],
    ['NES^N1 NW^Wr-2.93,0.64 N^N-1 J-1 NESW^Sr0.46,-0.58 U U U', '', 'NESW^Wr-0.65,1.47'],
    ['ES^S3 NE^Nr1.35,1.85 NE^Nr2.28,1.65 D NESW^Er2.44,0.11 D J-3', '', 'NESW^Wr-0.48,-0.34'],
    ['D D NSW^W-1 NE^Er2.32,0.60 U D ESW^E-2 W^W-2', 'NSW^W-1 ESW^E-2 W^W-2', 'NESW^Wr-1.54,1.00'],
    ['D D E^E-1 NW^Wr2.45,0.97 ESW^Wr1.31,1.82 J-1 E^Er2.62,-0.88 J-2', 'E^E-1', 'NESW^Nr-1.87,-0.80'],
    ['N^N3 W^Wr-1.10,0.36 ES^E-2 NSW^Nr0.19,-0.93 J-4 W^Wr-3.00,2.00 U R', 'W^Wr-3.00,2.00', 'NESW^W1'],
    ['N-3 Er1.3,0.4 S+1 J-2 J1', 'N-3 Er1.3,0.4', 'W+2'], ['NESW^N-3 B NE^Er1.2,0.4 U', 'NESW^N-3 B', 'NESW^Sr0.6,-0.3'],
    ['@WEr-1.96 @SEr-2.91 @Nr-1.29 U P0,-2 S-2 U U', '@WEr-1.96 @SEr-2.91', 'Nr0'],
    ['@Wr1.03 U Wr0.98 @NEr-1.81 U P1,2 W-3 U U', 'Wr0.98', 'Nr0'],
    ['@SEr2.8 @NWr1.17 U @Wr0.88 U U P-3,1 N+3 U U', '', 'Nr0'],
    ['@EWNr-1.51 @SEr1.34 U P-3,1 N+2 U U', '@EWNr-1.51', 'Nr0'],
    ['ES^Er2.08,-1.43 N^Nr1.49,0.72 NE^Nr-1.57,0.94 U U U', '', 'NES^Sr0'],
    ['ES^S2 NESW^S1 E^E-3 ES^Sr2.32,-1.78 NESW^S-3 U U U', 'ES^S2 NESW^S1', 'ES^Er0'],
    ['N^Nr1.23,-0.52 ESW^Wr1.03,-0.47 NW^W-3 U U U', '', 'NSW^Sr0'],
    ['NE^Nr1.98,-0.48 U P0,1 ES^E-2 U', 'P0,1', 'NSW^Nr0'],
    ['NW^W-1 NE^Nr-1.57,-0.84 U NSW^Sr-0.17,-1.94 P-2,0@ES', 'NW^W-1 NSW^Sr-0.17,-1.94 P-2,0@ES', 'ES^Er0'],
    ['ESW^W-2 ES^Sr-2.23,1.67 ESW^Er0.47,0.99 U W^Wr0.27,-1.55 U', 'ESW^W-2 ES^Sr-2.23,1.67', 'NESW^Er0'],
    ['NESW^W3 NW^Nr1.65,-0.73 NES^Er-2.74,-0.98 U U', 'NESW^W3', 'NW^Wr0'],
    ['P-2,1 N^Nr-0.83,1.93 U ESW^Wr-2.33,1.65 NW^Nr-2.48,-0.74 P-1,1', 'P-2,1 ESW^Wr-2.33,1.65 NW^Nr-2.48,-0.74 P-1,1', 'NES^Nr0']]) {
    const faces = ringRoom(), [p, twin] = [0, 1].map(() => page({ faces, selected: [0, 1, 2, 3] }));
    playRing(p, faces, steps);
    if (left) playRing(twin, faces, left);
    assert.deepEqual(p.rows(), twin.rows(), `${steps}: the queue`);
    // the rows the last slip queued (none: nothing slipped)
    const [n, m] = [p.queued.length, twin.queued.length];
    for (const q of [p, twin]) playRing(q, faces, then);
    assert.deepEqual(p.queued.slice(n).map((x) => x.rows), twin.queued.slice(m).map((x) => x.rows), `${steps}, then ${then}`);
  }
});

test('what the slips kept know of the faces goes with the Undo history too: undone, the next slip parts the ring where a page that never made them parts it', () => {
  // the ring room's four walls: the Surface panel's Pan of one wall, a slip of the four kept, both undone, then a slip
  // of the four: the rows of a page that made neither; so for the critic's flow (round 13's review searches), and with
  // the east wall of another texture. (What the slips knew of each wall's mapping before the first of them stayed
  // whatever was undone: the panned wall's, 2 texels off, counted its corners parted since, and the ring parted at one
  // of them, not where the page that never made them parts it; with two textures, round 13 too)
  for (const [east, steps, then] of [['Pkg.Wall', 'P2,0@N NESW^S-2 U U', 'NESW^W2'], ['Pkg.Wall', 'D E^E2 U R P2,0@NES NE^E2 J-2 U', 'NESW^N2'],
    ['Pkg.Panel', 'P2,0@S NESW^N-2 U U', 'NESW^W2']]) {
    const faces = ringRoom(east), [p, twin] = [0, 1].map(() => page({ faces, selected: [0, 1, 2, 3] }));
    playRing(p, faces, steps);
    assert.deepEqual(p.rows(), twin.rows(), `${steps}: nothing left`);
    const n = p.queued.length, open = [p, twin].map((q) => playRing(q, faces, then));
    assert.deepEqual(p.queued.slice(n).map((x) => x.rows), twin.queued.map((x) => x.rows), `${steps}, then ${then}`);
    assert.deepEqual(open[0], open[1], `${steps}, then ${then}: the corner open`);
  }
});

test('a Pan of some of the walls, or of all, between slips: each keeps its exact mapping, moved as much (a slip queues the rows it queues with no Pan)', () => {
  // the ring room's four walls: slips kept, then the Surface panel's Pan of some of them (or all four), then another
  // slip: the same rows as a twin that made no Pan (a roll's rows are each face's exact pan less its queued one, the drag
  // added: a Pan moves both; a slip that moves nothing queues none on either). (By value from the records, a Pan of
  // only some of a slip's faces fit none of its states, and each wall started from its rounded pan; after a roll a Pan
  // of all four fit its start by different whole texels: other rows; round 12's review #2 and #14)
  for (const [first, pan, then] of [['NES^Er-1.3,0.4', 'P1,-1@NE', 'ESW^Er0.7,0.2'], ['NESW^Nr2.31,0.48', 'P1,0', 'NSW^Wr1.1,0.3'],
    ['NESW^S-2 NESW^Wr0.45,-1.2', 'P0,1@NE', 'ESW^Sr-0.8,0.5'], ['NE^Er-2,1.3', 'P-3,-1@E', 'NES^Er0.9,0.25'],
    ['W^Wr-2.59,-1.9 NESW^Sr2.05,1.21 NESW^Sr2.7,0.02 NES^Nr1.71,0.2', 'P2,-1', 'NSW^Nr0'],
    ['P-1,-1@NSW ES^S-1', 'P-2,0@E', 'NES^Er0']]) {
    const faces = ringRoom(), [p, twin] = [0, 1].map(() => page({ faces, selected: [0, 1, 2, 3] }));
    playRing(p, faces, `${first} ${pan}`);
    playRing(twin, faces, first);
    const [n, m] = [p.queued.length, twin.queued.length];
    for (const q of [p, twin]) playRing(q, faces, then);
    assert.deepEqual(p.queued.slice(n).map((x) => x.rows), twin.queued.slice(m).map((x) => x.rows), `${first} ${pan} | ${then}`);
  }
});

test('Wall again on a wall after a slip: its own exact mapping goes, though by value it is a Pan of what the slip left; the other walls keep theirs', () => {
  // the ring room's four walls aligned with the Surface panel's Wall, the north and east walls rolled (kept), then Wall
  // on the north wall again: its pan back to 0, base, U and V as they were. A roll of the north wall alone then starts
  // from its queued pan, as a page given that queue with no slip kept; a roll of the east wall alone from the roll's
  // exact mapping, as a page whose walls were built aligned so (no alignment in its queue) after the same roll. Rolled
  // again, the north wall starts from the exact mapping its roll left, with the two alignments then queued on it
  // counted, as a page whose walls were built as the queue left them (none queued) after the same rolls. (By value the
  // north wall kept the roll's fraction, and its roll landed a texel away from where the pointer put it:
  // undo_design_result.json, the correctness critique; given the queue's alignments counted from none, every wall lost
  // its own; given the count its entry had before, one, the second roll started from the queued pan: round 13's
  // review, #4)
  const faces = ringRoom(), p = page({ faces, selected: [0, 1, 2, 3] });
  playRing(p, faces, 'A@NESW NE^Er2.8,-1.23 A@N');
  const fresh = page({ faces, selected: [0, 1, 2, 3], queue: p.rows() });
  const built = page({ faces: faces.map((f, i) => ({ ...f, map: numsOf(p.mappings()[i]) })), selected: [0, 1, 2, 3] });
  const [n, m] = [p.queued.length, fresh.queued.length];
  for (const q of [p, fresh, built]) playRing(q, faces, 'N^Nr-2,0.7');
  assert.deepEqual(p.queued.slice(n).map((x) => x.rows), fresh.queued.slice(m).map((x) => x.rows), 'the north wall alone');
  assert.equal(p.queued.length, n + 1, 'the north wall rolled');
  const o = built.queued.length;
  for (const q of [p, built]) playRing(q, faces, 'N^Nr0.45,-0.45');
  assert.deepEqual(p.queued.slice(n + 1).map((x) => x.rows), built.queued.slice(o).map((x) => x.rows), 'the north wall rolled again');
  const e = p.queued.length;
  const walled = page({ faces, selected: [0, 1, 2, 3] });
  playRing(walled, faces, 'A@NESW');
  const aligned = page({ faces: faces.map((f, i) => ({ ...f, map: numsOf(walled.mappings()[i]) })), selected: [0, 1, 2, 3] });
  playRing(aligned, faces, 'NE^Er2.8,-1.23');
  const k = aligned.queued.length;
  for (const q of [p, aligned]) playRing(q, faces, 'E^Er0.6,0.6');
  assert.deepEqual(p.queued.slice(e).map((x) => x.rows), aligned.queued.slice(k).map((x) => x.rows), 'the east wall alone');
  // (from its exact mapping, 2.8 and -1.23 texels, the roll lands on 3.4 and -0.63: the pans queued, nothing to queue;
  // from its queued pan it would queue a texel each way)
  assert.equal(aligned.queued.length, k, 'the east wall\'s roll queues nothing');
});

test('Around a cylinder queued on a brush after a slip of its cap, or before it: the cap keeps the exact mapping the slip left, the next slip starts from it', () => {
  // the ring room with its ceiling (Brush2 face 5, a cap of the brush: Around a cylinder wraps its sides and leaves it
  // as it is), the ceiling rolled 3.3 units along x and 1.7 along y (kept: its exact pan a part of a texel off its
  // queued one), then Around a cylinder on the brush, then the ceiling rolled half a unit back along x: the rows of a
  // page that queued no cylinder. (Counted on the cap too, the cylinder dropped its exact mapping, and the roll started
  // from its queued pan: it queued nothing where the twin queued a texel; round 13's review, #3)
  const ceiling = { brush: 'Brush2', poly: 5, tex: 'Pkg.Ceiling', map: [0, 0, 384, 0.5, 0, 0, 0, -0.5, 0, 0, 0, 128, 128],
    points: [[-1024, -1024, 384], [1024, -1024, 384], [1024, 1024, 384], [-1024, 1024, 384]] };
  const faces = [...ringRoom(), ceiling], from = [100, 200, 384], [p, twin] = [0, 1].map(() => page({ faces, selected: [4] }));
  const roll = (q, by) => { q.slip.start(q.at(4, from)); q.send('pointermove', { face: 4, at: from.map((x, k) => x + by[k]) }); q.key('Enter'); };
  for (const q of [p, twin]) roll(q, [3.3, 1.7, 0]);
  p.change('Align the texture: cylinder', (rows) => [...rows, { op: 'cylinder', args: [], targets: [{ brush: 'Brush2', poly: '*' }] }]);
  assert.deepEqual(p.mappings()[4], twin.mappings()[4], 'the ceiling as it was');
  const [n, m] = [p.queued.length, twin.queued.length];
  for (const q of [p, twin]) roll(q, [-0.5, 0, 0]);
  assert.deepEqual(p.queued.slice(n).map((x) => x.rows), twin.queued.slice(m).map((x) => x.rows));
  assert.equal(p.queued.length, n + 1, 'the roll queued');
  // the same with Around a cylinder queued on the brush before the first roll: the count of such rows the roll's exact
  // mapping is kept with (exactsKept, from the slip's faces with their pieces: a cap, none) is the one the next roll
  // finds (exactsNow). (Counted from a face given without its pieces when kept, its plane not known, the cylinder's row
  // counted: the next roll started from the queued pan and queued nothing; round 14's review, #5)
  const [first, alone] = [0, 1].map(() => page({ faces, selected: [4] }));
  first.change('Align the texture: cylinder', (rows) => [...rows, { op: 'cylinder', args: [], targets: [{ brush: 'Brush2', poly: '*' }] }]);
  for (const q of [first, alone]) { roll(q, [3.3, 1.7, 0]); roll(q, [-0.5, 0, 0]); }
  assert.deepEqual(first.queued.map((x) => x.rows), alone.queued.map((x) => x.rows), 'Around a cylinder first');
  assert.equal(first.queued.length, 2, 'Around a cylinder first: both rolls queued');
});

test('hold: a slip going on, or waiting for the pointer, ends first with nothing queued; only what this page\'s slips made is taken', () => {
  // the page calls hold when it puts other edits in place wholesale (an Undo, a Redo, a jump; Revert all changes): a
  // slip that goes on there would keep what it started from, another state's. Anything this page did not make (held)
  // is none: a history is never saved, and one read back from JSON, or a part of what it held, would make the next slip
  // throw or start from another state
  const faces = ringRoom(), p = page({ faces, selected: [0, 1, 2, 3] });
  playRing(p, faces, 'N-3');
  const table = p.slip.held, n = p.queued.length;
  p.slip.start(p.at(0, RING_AT.N[1]));
  p.send('wheel', { deltaY: -200 });
  const drawn = p.refreshed();
  p.slip.hold(null);
  assert.deepEqual([p.slip.active, p.queued.length, p.slip.held, p.listeners.length], [false, n, null, 0]);
  assert.ok(p.refreshed() > drawn, 'the view drawn again from the queue');
  assert.match(p.said.at(-1)[0], /^Texture slip cancelled/);
  p.slip.start();                                                      // waiting for the pointer over a face
  assert.equal(p.slip.active, true);
  p.slip.hold(table);
  assert.deepEqual([p.slip.active, p.slip.held], [false, table]);
  for (const other of [{}, [], 'table', undefined, table.exacts, { ...table }, JSON.parse(JSON.stringify(table))]) {
    p.slip.hold(other);
    assert.equal(p.slip.held, null, JSON.stringify(other));
  }
});

test('another map opened: forget() drops what the slips kept knew of the faces', () => {
  // test 9's walls at a corner slipped twice and kept, then forget() (the page calls it when another map opens:
  // the same brushes and polygons there are other faces): the next slip starts from the queued mappings, as a fresh
  // page with that queue; the page that did not forget starts from the exact mappings, other rows
  const faces = [
    { brush: 'Brush9', poly: 0, map: [0, 256, 0, 0.6, 0, 0, 0, 0, -0.45, 0, 0, 128, 128], points: [[0, 256, 0], [256, 256, 0], [256, 256, 256], [0, 256, 256]] },
    { brush: 'Brush9', poly: 1, map: [256, 256, 0, 0, -0.6, 0, 0, 0, -0.45, 0, 0, 128, 128], points: [[256, 256, 0], [256, 0, 0], [256, 0, 256], [256, 256, 256]] }];
  const points = [[40, 256, 200], [256, 30, 60]];
  const slipAt = (p, i, notches) => { p.slip.start(p.at(i, points[i])); p.send('wheel', { deltaY: -100 * notches }); p.key('Enter'); };
  const p = page({ faces }), kept = page({ faces });
  [1, -3].forEach((notches, i) => { for (const q of [p, kept]) slipAt(q, i % 2, notches); });
  p.slip.forget();
  const fresh = page({ faces, queue: [...p.rows()] });
  for (const q of [p, kept, fresh]) slipAt(q, 1, -1);
  assert.deepEqual(p.queued.at(-1).rows, fresh.queued.at(-1).rows);
  assert.notDeepEqual(kept.queued.at(-1).rows, fresh.queued.at(-1).rows);
  // test 10's walls (the east one's V drifting 0.3 texel along their corner), -3 notches kept, the map rebuilt, then
  // forget(): the walls' mappings as built before that slip go too, so the next slip (-2 on the east wall) judges the
  // drift at the scale they are built at now, as a fresh page of the walls rebuilt; the page that did not forget judges
  // it at the scale before the slip, other rows
  const scaleAt = (q, face, at, deltaY) => { q.slip.start(q.at(face, at)); q.send('wheel', { deltaY }); q.key('Enter'); };
  const [gone, still] = [page({ faces: DRIFTING }), page({ faces: DRIFTING })];
  for (const q of [gone, still]) scaleAt(q, 0, [584, 1024, 200], 300);
  const rebuilt = DRIFTING.map((f, i) => ({ ...f, map: numsOf(gone.mappings()[i]).map((x) => Number(x.toPrecision(6))) }));
  for (const q of [gone, still]) q.rebuild();
  gone.slip.forget();
  const anew = page({ faces: rebuilt });
  for (const q of [gone, still, anew]) scaleAt(q, 1, [1024, -600, 300], 200);
  assert.deepEqual(gone.queued.at(-1).rows, anew.queued.at(-1).rows, 'rebuilt, then forget()');
  assert.notDeepEqual(still.queued.at(-1).rows, anew.queued.at(-1).rows, 'rebuilt, not forgotten');
});

test('a slip of the same face again on a full queue: it folds into the rows before it, so it fits', () => {
  // the wall slipped and made larger, then the queue filled to 4096; slipped back a notch from where that one ended
  const first = page({ selected: [0] });
  first.slip.start(first.at(0, HERE));
  first.send('pointermove', { face: 0, at: [64, 431, 21] });
  first.send('wheel', { deltaY: -100 });
  first.key('Enter');
  const done = first.queued[0].rows, filler = { op: 'shadows', args: ['low'], targets: [FLOOR] };
  const queue = [...Array.from({ length: ROW_LIMIT - done.length }, () => filler), ...done];
  const p = page({ selected: [0], room: 0, queue, current: (id) => mappingNow({ ...FACES[id], mapping: mappingOf(FACES[id].map) }, queue) });
  p.slip.start(p.at(0, [64, 431, 21]));
  p.send('wheel', { deltaY: 100 });
  assert.match(p.label.textContent, /^U 0 · V 0 · x0\.841 · room for \d+ more queued surface changes? \(of 4096\)$/);
  p.key('Enter');
  assert.deepEqual([p.queued.length, p.queued[0].rows.map((row) => row.op)], [1, ['scale', 'pan']]);
  assert.match(p.said.at(-1)[0], /^Texture slipped on 1 face/);
});

test('the wheel\'s notch learnt while the page is open, after a pause: several merged count as several, a swipe or a pinch teaches none, Ctrl with a mouse does', () => {
  // the scale the HUD shows after each wheel event of a page: [deltaY, timeStamp (ms), Ctrl]; a mouse's notches a
  // second apart, a trackpad's swipe a frame apart
  const sizes = (p, steps) => steps.map(([deltaY, timeStamp, ctrlKey = false]) => {
    p.send('wheel', { deltaY, timeStamp, ctrlKey });
    return p.label.textContent.split(' · ')[2];
  });
  const p = page({ selected: [0] });
  p.slip.start(p.at(0, HERE));
  assert.deepEqual(sizes(p, [[-53, 1000], [-106, 2000]]), ['x1.19', 'x1.68']);            // Linux: 53 a notch, then two merged
  p.key('Escape');
  p.slip.start(p.at(0, HERE));
  assert.deepEqual(sizes(p, [[-106, 3000]]), ['x1.41']);                                  // the next slip knows it
  const q = page({ selected: [0] });
  q.slip.start(q.at(0, HERE));
  assert.deepEqual(sizes(q, [[-100, 1000], [-300, 2000], [-30, 3000]]), ['x1.19', 'x2', 'x2.11']);  // Windows: 100, three merged; a trackpad's part
  // a swipe up to 57 pixels a step, then a mouse's notch: one notch (learnt from the swipe, it counted two from then on)
  const r = page({ selected: [0] });
  r.slip.start(r.at(0, HERE));
  assert.deepEqual(sizes(r, [[-12, 1000], [-31, 1016], [-57, 1032], [-100, 2000], [-100, 3000]]), ['x1.02', 'x1.08', 'x1.19', 'x1.41', 'x1.68']);
  // a pinch (Ctrl+wheel) of 64 pixels a frame after a step before it, then a mouse's notch: one notch (it is a part)
  const t = page({ selected: [0] });
  t.slip.start(t.at(0, HERE));
  assert.deepEqual(sizes(t, [[-12, 984], [-64, 1000, true], [-100, 2000]]), ['x1.02', 'x1.02', 'x1.21']);
  // Ctrl with a mouse of 53 pixels a notch on a fresh page, a second apart: a power of two each (as a part of a notch,
  // the first did nothing and the second x2)
  const c = page({ selected: [0] });
  c.slip.start(c.at(0, HERE));
  assert.deepEqual(sizes(c, [[-53, 1000, true], [-53, 2000, true]]), ['x2', 'x4']);
  // the pause counts every wheel event the page hears, over a panel too: a swipe's first steps there, its next on the
  // view, then a mouse's notch (counted from the view's step alone, the 57 taught the notch: x1.19, then x1.68)
  const u = page({ selected: [0] });
  u.slip.start(u.at(0, HERE));
  for (const [deltaY, timeStamp] of [[-12, 1000], [-31, 1016]]) u.send('wheel', { deltaY, timeStamp, target: { tagName: 'DIV' } });
  assert.deepEqual(sizes(u, [[-57, 1032], [-100, 2000]]), ['x1.1', 'x1.31']);
});
