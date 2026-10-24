// The orthographic views (View > Top view / Front view / Side view), as UnrealEd's: off by default, each one a
// pane in a column at the right of the 3D view. They are drawn by the 3D view's own renderer (one WebGL context:
// the map's textures are not uploaded twice) into a corner of its canvas and copied into the pane, before the 3D
// view itself is drawn over it. In a pane: the wheel zooms where the mouse is; the right or middle button, or the
// left one away from the selection, moves the view; a click picks as in the 3D view; dragging the selection moves
// it on the pane's plane, on the grid when Grid snap is on (through the gizmo's own events: undo, structures,
// several objects, the Inspector, as when the gizmo moves it). "Cut" shows a section: what is above the 3D
// camera (Top) or between the pane and the 3D camera (Front, Side) is left out, so rooms show from inside.
import * as THREE from 'three';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./ortho-views.css', import.meta.url).href;
document.head.appendChild(css);

// three's axes: y up; Unreal's X is x, Y is z, Z is y. look: where the pane looks, up: the pane's up. Top as in
// UnrealEd: X to the right, Y down the screen; Front: X to the right, Z up; Side: Y to the right, Z up.
const KINDS = {
  top: { label: 'Top', look: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, -1) },
  front: { label: 'Front', look: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  side: { label: 'Side', look: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
};
const ORDER = ['top', 'front', 'side'];
const STORE = 'ucmap.ortho';
const FAR = 60000;

export function createOrthoViews(api) {
  const { renderer, scene, canvas, tc } = api;
  const panes = new Map();                 // kind -> pane
  let clip = null;                         // Clip armed: {done(normal, point), pts: [world points on a pane]}
  const col = document.createElement('div');
  col.id = 'ortho';
  col.innerHTML = '<div class="or-grip" title="Drag to make the views wider or narrower"></div>';
  document.body.appendChild(col);
  let width = 0;
  try { width = +localStorage.getItem(STORE + '.w') || 0; } catch (e) { /* no storage */ }

  function layout() {
    const on = panes.size > 0, root = getComputedStyle(document.documentElement);
    const room = Math.max(0, window.innerWidth - (parseFloat(root.getPropertyValue('--lw')) || 0) - (parseFloat(root.getPropertyValue('--rw')) || 0));
    // the 3D view keeps half the room at least; the views get 160 pixels at least
    const w = on ? Math.round(Math.max(Math.min(160, room / 2), Math.min(room / 2, width || room * 0.36))) : 0;
    col.style.display = on ? 'flex' : 'none';
    ORDER.filter((k) => panes.has(k)).forEach((k) => col.appendChild(panes.get(k).el));    // always Top, Front, Side
    if (root.getPropertyValue('--ow').trim() !== w + 'px') {
      document.documentElement.style.setProperty('--ow', w + 'px');
      window.dispatchEvent(new Event('resize'));        // the 3D view takes the room that is left
    }
    api.wake();
  }
  // again when the window or the side panels change size (workspace.js sets --lw / --rw), after their own handlers
  let pending = 0;
  function later() { if (!pending) pending = requestAnimationFrame(() => { pending = 0; layout(); }); }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify([...panes.keys()])); } catch (e) { /* no storage */ }
  }

  function open(kind, quiet = false) {
    if (!KINDS[kind] || panes.has(kind)) return;
    const K = KINDS[kind];
    const el = document.createElement('div');
    el.className = 'or-pane';
    el.innerHTML = `<div class="or-head"><b>${K.label}</b><span class="or-scale"></span><span class="or-sp"></span>
      <button type="button" class="or-cut on" title="Section: leave out what is ${kind === 'top' ? 'above the 3D camera' : 'between this view and the 3D camera'}">Cut</button>
      <button type="button" class="or-center" title="Center on the selection (or on the 3D camera)">Center</button>
      <button type="button" class="or-close" title="Close this view" aria-label="Close">×</button></div>
      <canvas class="or-view"></canvas>`;
    const pane = { kind, K, el, canvas: el.querySelector('canvas'), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 1, FAR * 2),
      center: new THREE.Vector3(), scale: 2, cut: true, right: new THREE.Vector3().crossVectors(K.look, K.up) };
    pane.ctx = pane.canvas.getContext('2d');
    pane.cam.up.copy(K.up);
    centerOn(pane);
    el.querySelector('.or-close').onclick = () => close(kind);
    el.querySelector('.or-center').onclick = () => { centerOn(pane); api.wake(); };
    el.querySelector('.or-cut').onclick = (e) => { pane.cut = !pane.cut; e.currentTarget.classList.toggle('on', pane.cut); api.wake(); };
    wire(pane);
    panes.set(kind, pane);
    layout();
    if (!quiet) save();
  }
  function close(kind) {
    const p = panes.get(kind);
    if (!p) return;
    p.el.remove();
    panes.delete(kind);
    layout();
    save();
  }
  function toggle(kind) { if (panes.has(kind)) close(kind); else open(kind); }

  // the selection's middle, else what the 3D camera looks at
  function centerOn(pane) {
    const s = api.selected;
    if (s) {
      const box = new THREE.Box3().setFromObject(s);
      if (!box.isEmpty()) { box.getCenter(pane.center); return; }
      s.getWorldPosition(pane.center);
      return;
    }
    pane.center.copy(api.camera.position).addScaledVector(api.forward(), 256);
  }

  // ---------------------------------------------------------------- drawing
  const plane = new THREE.Plane();
  function render() {
    if (!panes.size) return;
    const pr = renderer.getPixelRatio(), vw = canvas.width / pr, vh = canvas.height / pr;
    if (!vw || !vh) return;
    const gizmo = tc.visible;
    tc.visible = false;                    // the gizmo is the 3D view's; here the selection is dragged itself
    renderer.setScissorTest(true);
    for (const p of panes.values()) {
      const w = p.canvas.clientWidth, h = p.canvas.clientHeight;
      if (!w || !h) continue;
      const bw = Math.round(w * pr), bh = Math.round(h * pr);
      if (p.canvas.width !== bw || p.canvas.height !== bh) { p.canvas.width = bw; p.canvas.height = bh; }
      // drawn at the pane's size when the 3D view's canvas is that big, else smaller and stretched
      const k = Math.min(1, vw / w, vh / h), rw = Math.max(1, Math.floor(w * k)), rh = Math.max(1, Math.floor(h * k));
      const c = p.cam;
      c.left = -w / 2 * p.scale; c.right = w / 2 * p.scale; c.top = h / 2 * p.scale; c.bottom = -h / 2 * p.scale;
      c.position.copy(p.center).addScaledVector(p.K.look, -FAR);
      c.lookAt(p.center);
      c.updateProjectionMatrix();
      c.updateMatrixWorld();
      renderer.clippingPlanes = p.cut ? [sectionOf(p, plane)] : [];
      renderer.setViewport(0, 0, rw, rh);
      renderer.setScissor(0, 0, rw, rh);
      renderer.render(scene, c);
      p.ctx.setTransform(1, 0, 0, 1, 0, 0);
      p.ctx.drawImage(canvas, 0, canvas.height - rh * pr, rw * pr, rh * pr, 0, 0, bw, bh);
      grid(p, w, h, pr);
    }
    renderer.clippingPlanes = [];
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, vw, vh);
    tc.visible = gizmo;
  }
  // the grid: the snap's step when it is 8 pixels or more apart (else doubled until it is), 1024 units brighter,
  // the axes through the origin brightest; a small cross where the 3D camera is
  function grid(p, w, h, pr) {
    const g = p.ctx, s = p.scale;
    g.setTransform(pr, 0, 0, pr, 0, 0);
    let step = Math.max(1, api.SNAP.move || 16);
    while (step / s < 8) step *= 2;
    const ax = p.right, ay = p.K.up;
    const cx = p.center.dot(ax), cy = p.center.dot(ay);
    const x0 = cx - w / 2 * s, x1 = cx + w / 2 * s, y0 = cy - h / 2 * s, y1 = cy + h / 2 * s;
    const sx = (v) => (v - cx) / s + w / 2, sy = (v) => h / 2 - (v - cy) / s;
    const line = (alpha, list, vertical) => {
      g.strokeStyle = `rgba(160,190,230,${alpha})`;
      g.beginPath();
      for (const v of list) {
        const q = Math.round(vertical ? sx(v) : sy(v)) + 0.5;
        if (vertical) { g.moveTo(q, 0); g.lineTo(q, h); } else { g.moveTo(0, q); g.lineTo(w, q); }
      }
      g.stroke();
    };
    const steps = (a, b, d) => { const out = []; for (let v = Math.ceil(a / d) * d; v <= b; v += d) out.push(v); return out; };
    g.lineWidth = 1;
    line(0.07, steps(x0, x1, step), true);
    line(0.07, steps(y0, y1, step), false);
    if (1024 / s >= 24) { line(0.16, steps(x0, x1, 1024), true); line(0.16, steps(y0, y1, 1024), false); }
    line(0.35, [0].filter((v) => v >= x0 && v <= x1), true);
    line(0.35, [0].filter((v) => v >= y0 && v <= y1), false);
    const camX = sx(api.camera.position.dot(ax)), camY = sy(api.camera.position.dot(ay));
    g.strokeStyle = '#4c9eff';
    g.beginPath(); g.moveTo(camX - 6, camY); g.lineTo(camX + 6, camY); g.moveTo(camX, camY - 6); g.lineTo(camX, camY + 6); g.stroke();
    p.el.querySelector('.or-scale').textContent = `grid ${step} u`;
    if (clip && clip.pane === p && clip.pts.length) {       // the first point of a Clip
      const q = clip.pts[0], x = sx(q.dot(ax)), y = sy(q.dot(ay));
      g.fillStyle = '#ffa040';
      g.fillRect(x - 4, y - 4, 8, 8);
    }
  }

  // ---------------------------------------------------------------- the mouse
  // with Cut on, what the section leaves out is not picked either (the ceiling over a room would be)
  function rayAt(p, e) {
    const r = p.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), p.cam);
    ray.unitsPerPixel = p.scale;           // how near a corner is picked (vertex-edit.js)
    if (p.cut) {
      const cut = sectionOf(p, new THREE.Plane());
      ray.intersectObjects = (objects, recursive = true, out = []) =>
        THREE.Raycaster.prototype.intersectObjects.call(ray, objects, recursive, out).filter((h) => cut.distanceToPoint(h.point) >= -0.5);
    }
    return ray;
  }
  function sectionOf(p, into) {
    into.normal.copy(p.K.look);
    into.constant = -p.K.look.dot(api.camera.position);
    return into;
  }
  function pseudo(e, ray, extra = {}) {
    return Object.assign({ clientX: e.clientX, clientY: e.clientY, button: e.button, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
      altKey: e.altKey, metaKey: e.metaKey, ray }, extra);
  }
  function wire(p) {
    const cv = p.canvas;
    let drag = null;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      if (drag) return;
      cv.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, center: p.center.clone() };
      const V = api.vertexEdit();
      if (clip && e.button === 0) {          // Clip: two points; the line between them, through the view's depth, cuts
        const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
        let a = p.center.dot(p.right) + mx * p.scale, b = p.center.dot(p.K.up) - my * p.scale;
        if (api.snapOn()) { const st = api.SNAP.move || 16; a = Math.round(a / st) * st; b = Math.round(b / st) * st; }
        const at = p.right.clone().multiplyScalar(a).addScaledVector(p.K.up, b).addScaledVector(p.K.look, p.center.dot(p.K.look));
        if (clip.pane && clip.pane !== p) clip.pts = [];
        clip.pane = p;
        clip.pts.push(at);
        if (clip.pts.length === 2) {
          const [A, B] = clip.pts, d = B.clone().sub(A), n = d.clone().cross(p.K.look).normalize(), done = clip.done;
          clip = null;
          if (d.lengthSq() > 1e-6) done(n, A);
        }
        api.wake();
        return;
      }
      if (V?.active) {                     // Edit vertices: a picked corner is dragged, anything else picks or pans
        drag = Object.assign(start, { kind: e.button === 0 && V.hitsChosen(rayAt(p, e), p.scale) ? 'verts' : e.button === 0 ? 'click' : 'pan', moved: false });
      } else if (e.button === 0 && !e.ctrlKey && !e.shiftKey && !e.altKey && !api.busy() && api.selected && api.hitsSelection(rayAt(p, e))) {
        drag = Object.assign(start, { kind: 'grab', moved: false, at: api.selected.position.clone() });
      } else drag = Object.assign(start, { kind: e.button === 0 ? 'click' : 'pan', moved: false });
      e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!drag.moved && drag.kind === 'verts' && !api.vertexEdit().moveStart()) drag.kind = 'pan';
      if (!drag.moved && drag.kind === 'grab') {
        if (!api.requireUnlocked(api.selected) || api.selected.userData.folded) { drag.kind = 'pan'; }
        else tc.dispatchEvent({ type: 'dragging-changed', value: true });       // as the gizmo starting a drag
      }
      drag.moved = true;
      if (drag.kind === 'click') drag.kind = 'pan';
      if (drag.kind === 'pan') {
        p.center.copy(drag.center).addScaledVector(p.right, -dx * p.scale).addScaledVector(p.K.up, dy * p.scale);
      } else if (drag.kind === 'verts') {
        let a = dx * p.scale, b = -dy * p.scale;
        if (api.snapOn()) { const st = api.SNAP.move || 16; a = Math.round(a / st) * st; b = Math.round(b / st) * st; }
        api.vertexEdit().moveBy(p.right.clone().multiplyScalar(a).addScaledVector(p.K.up, b));
      } else {
        const to = drag.at.clone().addScaledVector(p.right, dx * p.scale).addScaledVector(p.K.up, -dy * p.scale);
        if (api.snapOn()) {                // on the grid along the pane's two axes; the depth stays
          const st = api.SNAP.move || 16;
          for (const axis of [p.right, p.K.up]) {
            const v = to.dot(axis);
            to.addScaledVector(axis, Math.round(v / st) * st - v);
          }
        }
        api.selected.position.copy(to);
        api.selected.updateMatrixWorld(true);
        tc.dispatchEvent({ type: 'objectChange' });
      }
      api.wake();
    });
    const up = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === 'grab' && d.moved) tc.dispatchEvent({ type: 'dragging-changed', value: false });
      else if (d.kind === 'verts' && d.moved) api.vertexEdit().moveEnd();
      else if (!d.moved && e.button === 0 && !api.placing() && !api.busy()) api.pick(pseudo(e, rayAt(p, e)));
      api.wake();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', (e) => {
      if (e.button !== 0 || api.placing() || api.busy() || e.ctrlKey || e.shiftKey || e.altKey) return;
      api.pick(pseudo(e, rayAt(p, e), { inside: true }));
    });
    cv.addEventListener('wheel', (e) => {          // zoom where the mouse is
      e.preventDefault();
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      const at = p.center.clone().addScaledVector(p.right, mx * p.scale).addScaledVector(p.K.up, -my * p.scale);
      p.scale = Math.max(0.05, Math.min(200, p.scale * Math.pow(1.0015, e.deltaY)));
      p.center.copy(at).addScaledVector(p.right, -mx * p.scale).addScaledVector(p.K.up, my * p.scale);
      api.wake();
    }, { passive: false });
  }

  // the column's width: its left edge dragged (remembered in this browser)
  const grip = col.querySelector('.or-grip');
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = col.getBoundingClientRect().width;
    const move = (ev) => { width = w0 + (x0 - ev.clientX); layout(); };
    const stop = () => {
      grip.removeEventListener('pointermove', move);
      try { localStorage.setItem(STORE + '.w', String(Math.round(col.getBoundingClientRect().width))); } catch (err) { /* no storage */ }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', stop, { once: true });
  });
  window.addEventListener('resize', (e) => { if (e.isTrusted) later(); });
  new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

  // the views open at the last session's start (none the first time)
  try { for (const k of JSON.parse(localStorage.getItem(STORE) || '[]')) open(k, true); } catch (e) { /* no storage */ }
  // Clip (app.js): the next two clicks in a view; Esc gives up
  function armClip(done) {
    clip = { done, pts: [], pane: null };
    if (!panes.size) open('top');
  }
  window.addEventListener('keydown', (e) => { if (clip && e.key === 'Escape') { clip = null; api.wake(); e.stopPropagation(); } }, true);
  return { render, toggle, open, close, armClip, has: (k) => panes.has(k), get active() { return panes.size > 0; }, get clipping() { return !!clip; } };
}
