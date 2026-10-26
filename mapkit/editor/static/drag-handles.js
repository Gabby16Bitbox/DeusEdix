// Drag handles in the 3D view and the orthographic views, as Unity's handles of lights, audio sources and colliders:
// dots on what the selected object shows (range-handles.js: a light's reach, a spotlight's cone, how far a sound is
// heard, a trigger's cylinder, a collision box's sides; with Scale (R) a block's sides, block-handles.js). They are
// drawn over everything and picked through walls; the dot under the pointer lights up, the sides of a box facing away
// are dimmer. Each view (the 3D one; Top, Front, Side) leaves out the dots whose line runs toward it, which could not
// be dragged there, and keeps the others (range-handles.js seenFrom). Dragging one shows its value at the bottom of
// the view and changes the object as it goes; let go, it is written, one Ctrl+Z; Esc puts it back. Alt and Shift: a
// box's sides (block-handles.js). A spotlight's cone is drawn here too (its lines), whether or not it can be changed.
// app.js says what the selection shows and writes it.
import * as THREE from 'three';
import { rangeHandles, rangeDrag, coneRim, seenFrom } from './range-handles.js';
import { lineParam } from './block-handles.js';

const PICK_PX = 9;               // how near the pointer a dot is picked, in pixels (as Edit vertices' corners)
const MOVE_PX = 3;               // how far a press goes before it drags
const MAX_DOTS = 32;
const RIM_SIDES = 48;
const HOT = new THREE.Color(0xffa040);
const G = (v) => [v.x, v.z, v.y];                        // three -> the game's axes (x, y, z up), not rounded
const T = (a) => new THREE.Vector3(a[0], a[2], a[1]);    // the game's axes -> three
const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

export function createDragHandles(api) {
  const { scene, camera, canvas } = api;
  const position = new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3), colour = new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3);
  const dots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 10, sizeAttenuation: false,
    vertexColors: true, depthTest: false, transparent: true }));
  dots.geometry.setAttribute('position', position);
  dots.geometry.setAttribute('color', colour);
  const cone = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6, depthTest: false }));
  dots.renderOrder = 999; cone.renderOrder = 998;
  dots.frustumCulled = cone.frustumCulled = false;
  dots.visible = cone.visible = false;
  scene.add(dots, cone);
  const caster = new THREE.Raycaster(), colourOf = new THREE.Color();
  let shown = [];                // the selection's dots now: { ri (its range), hi (its handle there), h, at (three), colour }
  let hot = -1;                  // the one under the pointer in the 3D view (lit up)
  let pointer = null;            // where the pointer is over the 3D view, still (the dot under it lights up)
  let drag = null;               // { p, ri, hi, h, range (as it began), offset, started, saved, live, res, stop }
  let coneKey = '', cursorSet = '';     // the pointer's look this set (another tool's own is left alone)
  const same = (a, b) => a && b && a.ri === b.ri && a.hi === b.hi;

  // each frame: the dots of the selection as it is now (a range being dragged: as the drag has it), every one of them;
  // drawn as the 3D view sees them (an orthographic view draws them as it sees them: drawFor)
  function update() {
    const p = api.target(), ranges = p ? api.ranges(p) : [];
    if (drag?.started && drag.p === p) ranges[drag.ri] = drag.live;
    shown = [];
    if (p && api.editable(p)) ranges.forEach((range, ri) => rangeHandles(range).forEach((h, hi) => {
      if (shown.length < MAX_DOTS) shown.push({ ri, hi, h, at: T(h.at), colour: range.color ?? 0xe8edf5 });
    }));
    // the dot under the pointer, found again each frame: the dots move with the camera and the selection
    hot = pointer && !drag ? nearestOnScreen(pointer) : -1;
    if (!drag) setCursor(hot >= 0);
    fill(fromEye());
    drawCone(ranges.find((r) => r.shape === 'cone'));
  }
  // the 3D view's look at each dot: from its camera
  function fromEye() {
    const eye = G(camera.position);
    return (s) => unit(s.h.at.map((v, k) => v - eye[k]));
  }
  // how a view (look: a dot -> the unit direction from the view's eye to it) sees a dot, or null: left out there; the
  // one being dragged stays wherever its line turns
  const seen = (s, look) => seenFrom(s.h, look(s)) || (same(drag, s) ? { dim: false } : null);
  // the buffer as one view sees the dots: the ones it leaves out are not drawn
  function fill(look) {
    let n = 0;
    shown.forEach((s, i) => {
      const view = seen(s, look);
      if (!view) return;
      position.setXYZ(n, s.at.x, s.at.y, s.at.z);
      colourOf.setHex(s.colour);
      if (same(drag, s) || i === hot) colourOf.copy(HOT);
      else if (view.dim) colourOf.multiplyScalar(0.45);
      colour.setXYZ(n++, colourOf.r, colourOf.g, colourOf.b);
    });
    position.needsUpdate = colour.needsUpdate = true;
    dots.geometry.setDrawRange(0, n);
    dots.visible = n > 0;
  }
  // a spotlight's cone: lines from its tip to the rim where it meets its reach, and the rim
  function drawCone(range) {
    cone.visible = !!range;
    if (!range) return;
    const key = JSON.stringify([range.centre, range.dir, range.size, range.angle]);
    cone.material.color.setHex(range.color ?? 0xffd25a);
    if (key === coneKey) return;
    coneKey = key;
    const rim = coneRim(range), at = (t) => rim.centre.map((c, k) => c + (rim.u[k] * Math.cos(t) + rim.v[k] * Math.sin(t)) * rim.radius);
    const pts = [];
    for (let i = 0; i < 4; i++) pts.push(T(range.centre), T(at(i * Math.PI / 2)));
    for (let i = 0; i < RIM_SIDES; i++) pts.push(T(at(i / RIM_SIDES * 2 * Math.PI)), T(at((i + 1) / RIM_SIDES * 2 * Math.PI)));
    cone.geometry.dispose();
    cone.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  // the dot nearest the pointer in the 3D view, within PICK_PX (-1: none)
  function nearestOnScreen(e) {
    const r = canvas.getBoundingClientRect(), look = fromEye();
    let best = -1, bestD = PICK_PX;
    shown.forEach((s, i) => {
      if (!seen(s, look)) return;
      const q = s.at.clone().project(camera);
      if (q.z > 1) return;
      const d = Math.hypot((q.x + 1) / 2 * r.width + r.left - e.clientX, (1 - q.y) / 2 * r.height + r.top - e.clientY);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  // the 3D view's ray through the pointer, in the game's axes
  function rayOf(e) {
    const r = canvas.getBoundingClientRect();
    caster.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    return [G(caster.ray.origin), G(caster.ray.direction)];
  }

  // a dot taken: where on its line the pointer is, so that the dot keeps its place under it
  function grab(s, [origin, dir]) {
    const at = lineParam(s.h.origin, s.h.dir, origin, dir), p = api.target();
    if (at === null || !p) return false;
    drag = { p, ri: s.ri, hi: s.hi, h: s.h, range: api.ranges(p)[s.ri], offset: s.h.t - at, started: false, saved: null, live: null, res: null, stop: null };
    return true;
  }
  // the pointer moved with a dot: the first move begins the change (one undo step), each one shows it
  function follow([origin, dir], mods) {
    if (!drag) return;
    if (!drag.started) {
      drag.saved = api.begin(drag.p);
      if (!drag.saved) { finish(true); return; }                   // locked: nothing changes
      drag.started = true;
      drag.live = drag.range;
    }
    const at = lineParam(drag.h.origin, drag.h.dir, origin, dir);
    if (at === null) return;
    const on = api.snapOn();
    drag.res = rangeDrag(drag.range, drag.h, at + drag.offset, { step: on ? api.SNAP.move : 0, angleStep: on ? api.SNAP.rotate : 0,
      alt: !!mods.altKey, shift: !!mods.shiftKey });
    drag.live = drag.res.range;
    api.preview(drag.p, drag.res, drag.saved);
    api.note(drag.res.note);
    api.wake();
  }
  // let go (written) or Esc (put back)
  function finish(cancel) {
    const d = drag;
    if (!d) return;
    drag = null;
    d.stop?.();
    if (d.started && (cancel || !d.res)) { api.cancel(d.p, d.saved); api.note('Cancelled.'); }
    else if (d.started) api.end(d.p, d.res, d.saved);
    setCursor(false);
    api.wake();
  }
  function setCursor(on, kind = 'grab') {
    if (on) canvas.style.cursor = cursorSet = kind;
    else if (cursorSet) { if (canvas.style.cursor === cursorSet) canvas.style.cursor = ''; cursorSet = ''; }
  }

  // a press in the 3D view (app.js asks first, before the gizmo and the picks): true when it took a dot
  function press(e) {
    if (e.button !== 0 || drag) return false;
    const i = nearestOnScreen(e);
    if (i < 0 || !grab(shown[i], rayOf(e))) return false;
    const from = { x: e.clientX, y: e.clientY };
    const move = (ev) => {
      if (!drag || (!drag.started && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < MOVE_PX)) return;
      follow(rayOf(ev), ev);
    };
    const up = () => finish(false), lost = () => finish(true);
    canvas.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', lost, true);
    window.addEventListener('blur', lost);
    drag.stop = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', lost, true);
      window.removeEventListener('blur', lost);
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    setCursor(true, 'grabbing');
    return true;
  }
  // the dot under the pointer lights up (and the pointer says it can be dragged): update() finds it
  canvas.addEventListener('pointermove', (e) => { pointer = e.buttons ? null : { clientX: e.clientX, clientY: e.clientY }; });
  canvas.addEventListener('pointerleave', () => { pointer = null; if (!drag) setCursor(false); });
  window.addEventListener('keydown', (e) => {
    if (!drag || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finish(true);
  }, true);

  return {
    update, press,
    // the orthographic views (ortho-views.js): a press with that view's ray (a dot within PICK_PX of its pixels),
    // its moves once it drags, and its end
    pressRay(ray, unitsPerPixel) {
      if (drag) return false;
      const look = G(ray.ray.direction), along = () => look, tol = (unitsPerPixel || 2) * PICK_PX;
      let best = -1, bestD = tol;
      shown.forEach((s, i) => {
        if (!seen(s, along)) return;                                   // its line runs into the view: nothing to drag there
        const d = ray.ray.distanceToPoint(s.at);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best >= 0 && grab(shown[best], [G(ray.ray.origin), look]);
    },
    moveRay(ray, mods) { follow([G(ray.ray.origin), G(ray.ray.direction)], mods); },
    release(cancel = false) { finish(cancel); },
    // an orthographic view about to be drawn: the dots as it sees them (look: the way it looks, three's axes); with no
    // look, the 3D view's again
    drawFor(look) { const toward = look && G(look); fill(toward ? () => toward : fromEye()); },
    get dragging() { return !!drag?.started; },
    // for tests: what the 3D view draws
    get dots() { const look = fromEye(); return shown.filter((s) => seen(s, look)).map((s) => ({ part: s.h.part, at: s.h.at.slice() })); },
  };
}
