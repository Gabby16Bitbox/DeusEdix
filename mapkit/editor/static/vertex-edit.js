// Edit vertices (V, Edit menu, or the Inspector's "Edit vertices" on a block): UnrealEd's vertex editing of a brush.
// The block's corners show as handles; a click picks one (Shift or Ctrl: one more), the arrows move them (on the grid
// when Grid snap is on), Delete takes them away, V or Esc ends. When a move ends, the block keeps the corners as
// shares of its new box (b.verts, block-shapes.js / blocks.py verts_of): the box is fitted round them and the block
// stays where it was, even turned. The brush is the corners' convex hull, as a brush should be for the game's CSG:
// a corner pushed inside the others is no corner any more and goes. In the orthographic views a click picks a
// corner and dragging a picked one moves it on that view's plane (ortho-views.js).
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { blockPoints, hullCorners } from './block-shapes.js';

const PICK_PX = 9;            // how near the mouse a corner is picked, in pixels

export function createVertexEditor(api) {
  const { scene, camera, canvas, mainTc } = api;
  const dots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 9, sizeAttenuation: false,
    vertexColors: true, depthTest: false, transparent: true }));
  dots.renderOrder = 999;
  dots.visible = false;
  scene.add(dots);
  const pivot = new THREE.Object3D();
  scene.add(pivot);
  const vtc = new TransformControls(camera, canvas);
  vtc.setMode('translate');
  vtc.setSize(0.7);
  scene.add(vtc);
  let on = null;                // { p: the block's proxy, b, world: [Vector3], chosen: Set, start }

  // the corners in the world: the block's own space (game axes from its middle) through the proxy (a unit block
  // scaled by the size: three's y is the game's Z)
  function worldOf(p, pts) {
    const b = p.userData.box, size = [0, 1, 2].map((k) => Math.max(1, b.hi[k] - b.lo[k]));
    p.updateMatrixWorld(true);
    return pts.map((q) => p.localToWorld(new THREE.Vector3(q[0] / size[0], q[2] / size[2], q[1] / size[1])));
  }
  // and back: each corner as a share of the block's box (0..1 per game axis; outside when it left the box)
  function sharesOf(p, world) {
    p.updateMatrixWorld(true);
    return world.map((w) => { const u = p.worldToLocal(w.clone()); return [u.x + 0.5, u.z + 0.5, u.y + 0.5]; });
  }
  function draw() {
    if (!on) { dots.visible = false; return; }
    const pos = [], col = [];
    on.world.forEach((w, i) => { pos.push(w.x, w.y, w.z); col.push(...(on.chosen.has(i) ? [1, 0.55, 0.15] : [0.92, 0.95, 1])); });
    dots.geometry.dispose();
    dots.geometry = new THREE.BufferGeometry();
    dots.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dots.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    dots.visible = true;
    if (on.chosen.size && !on.start) {
      pivot.position.set(0, 0, 0);
      for (const i of on.chosen) pivot.position.add(on.world[i]);
      pivot.position.divideScalar(on.chosen.size);
      vtc.attach(pivot);
    } else if (!on.chosen.size) vtc.detach();
    api.wake();
  }

  function enter(p) {
    if (on) exit(false);
    if (!p || p.userData.kind !== 'box') { api.status('Edit vertices: select a block first (a cube, a wedge, a cylinder...).', 'warn'); return false; }
    const pts = blockPoints(p.userData.box);
    if (!pts) { api.status('This block cannot have its corners moved: water, portals, moving blocks, signs and hollow shapes keep their shape.', 'warn'); return false; }
    if (!api.requireUnlocked(p)) return false;
    on = { p, b: p.userData.box, world: worldOf(p, pts), chosen: new Set(), start: null };
    mainTc.enabled = false;
    mainTc.visible = false;
    vtc.camera = camera;
    draw();
    api.status('Edit vertices: click a corner (Shift: one more), move it with the arrows; Delete takes it away; V or Esc ends.', 'ok');
    return true;
  }
  function exit(reselect = true) {
    if (!on) return;
    const p = on.p;
    on = null;
    vtc.detach();
    dots.visible = false;
    mainTc.enabled = true;
    mainTc.visible = true;
    if (reselect && p.parent) api.select(p);
    api.status('Edit vertices ended.');
    api.wake();
  }

  // a click in the 3D view (or an orthographic view: its ray and its units per pixel come with it)
  function click(e) {
    if (!on) return false;
    let best = -1, bestD = Infinity;
    if (e.ray) {
      const tol = (e.unitsPerPixel || e.ray.unitsPerPixel || 2) * PICK_PX;
      on.world.forEach((w, i) => { const d = e.ray.ray.distanceToPoint(w); if (d < tol && d < bestD) { bestD = d; best = i; } });
    } else {
      const r = canvas.getBoundingClientRect();
      on.world.forEach((w, i) => {
        const s = w.clone().project(camera);
        if (s.z > 1) return;
        const d = Math.hypot((s.x + 1) / 2 * r.width + r.left - e.clientX, (1 - s.y) / 2 * r.height + r.top - e.clientY);
        if (d < PICK_PX && d < bestD) { bestD = d; best = i; }
      });
    }
    if (best >= 0) {
      if (e.shiftKey || e.ctrlKey) { if (on.chosen.has(best)) on.chosen.delete(best); else on.chosen.add(best); }
      else if (!on.chosen.has(best) || on.chosen.size > 1) on.chosen = new Set([best]);
    } else if (!e.shiftKey && !e.ctrlKey) on.chosen.clear();
    draw();
    return true;
  }
  // is there a picked corner under this ray (an orthographic view's drag)?
  function hitsChosen(ray, unitsPerPixel) {
    if (!on || !on.chosen.size) return false;
    const tol = (unitsPerPixel || 2) * PICK_PX;
    return [...on.chosen].some((i) => ray.ray.distanceToPoint(on.world[i]) < tol);
  }

  // a move of the picked corners: begun, by a world offset, ended (the arrows and the orthographic views both)
  function moveStart() {
    if (!on || !on.chosen.size || on.start) return false;
    api.pushUndo();
    on.start = on.world.map((w) => w.clone());
    return true;
  }
  function moveBy(delta) {
    if (!on || !on.start) return;
    for (const i of on.chosen) on.world[i].copy(on.start[i]).add(delta);
    api.preview(on.p, sharesOf(on.p, on.world));
    draw();
  }
  function moveEnd() {
    if (!on || !on.start) return;
    const moved = on.world.some((w, i) => w.distanceToSquared(on.start[i]) > 1e-6);
    on.start = null;
    if (!moved) { draw(); return; }
    commit(on.world);
  }
  vtc.addEventListener('dragging-changed', (e) => {
    if (e.value) { vtc.setTranslationSnap(api.snapOn() ? (api.SNAP.move || 16) : null); on && moveStart() && (on.pivot0 = pivot.position.clone()); }
    else moveEnd();
  });
  vtc.addEventListener('objectChange', () => { if (on?.start && on.pivot0) moveBy(pivot.position.clone().sub(on.pivot0)); });

  // the new corners into the block: its box fitted round them, the block where it was in the world
  function commit(world) {
    const p = on.p, b = on.b, chosenAt = [...on.chosen].map((i) => world[i].clone());
    let shares = sharesOf(p, world);
    const size = [0, 1, 2].map((k) => Math.max(1, b.hi[k] - b.lo[k]));
    // the hull's corners only (in the block's own space, to find them), as shares again
    const local = shares.map((f) => f.map((x, k) => (x - 0.5) * size[k]));
    const corners = hullCorners(local);
    if (corners.length < 4) { api.status('Those corners make a flat shape: the block was left as it was.', 'warn'); api.dropUndo(); return refresh(p); }
    shares = corners.map((q) => q.map((x, k) => x / size[k] + 0.5));
    const lo = [0, 1, 2].map((k) => Math.min(...shares.map((f) => f[k]))), hi = [0, 1, 2].map((k) => Math.max(...shares.map((f) => f[k])));
    if ([0, 1, 2].some((k) => (hi[k] - lo[k]) * size[k] < 1)) { api.status('Those corners make a flat shape: the block was left as it was.', 'warn'); api.dropUndo(); return refresh(p); }
    const mid = [0, 1, 2].map((k) => ((lo[k] + hi[k]) / 2 - 0.5) * size[k]);       // the new middle, block space
    const centre = p.position.clone().add(new THREE.Vector3(mid[0], mid[2], mid[1]).applyQuaternion(p.quaternion));
    const c = api.UE(centre), nsize = [0, 1, 2].map((k) => (hi[k] - lo[k]) * size[k]);
    const r2 = (x) => Math.round(x * 100) / 100;
    b.lo = c.map((x, k) => r2(x - nsize[k] / 2));
    b.hi = c.map((x, k) => r2(x + nsize[k] / 2));
    b.verts = shares.map((f) => f.map((x, k) => Math.round(((x - lo[k]) / (hi[k] - lo[k])) * 10000) / 10000));
    api.setDirty();
    on = null;                       // before the new proxy is selected (a selection ends this mode)
    enter(api.refreshBlock(b));
    // the corners just moved stay picked
    for (const w of chosenAt) {
      let best = -1, d = 0.5;
      on?.world.forEach((v, i) => { const e = v.distanceTo(w); if (e < d) { d = e; best = i; } });
      if (best >= 0) on.chosen.add(best);
    }
    draw();
  }
  function refresh(p) {
    on = null;
    enter(api.refreshBlock(p.userData.box));
  }
  // Delete: the picked corners go (four at least must stay, not all on one plane)
  function deleteChosen() {
    if (!on || !on.chosen.size) return false;
    const keep = on.world.filter((_, i) => !on.chosen.has(i));
    if (keep.length < 4) { api.status('A block keeps four corners at least.', 'warn'); return true; }
    api.pushUndo();
    on.chosen.clear();
    commit(keep);
    return true;
  }
  // the block's own shape again (its box, its shape's corners)
  function reset(p) {
    const b = p?.userData.box;
    if (!b || !b.verts) return;
    if (!api.requireUnlocked(p)) return;
    const was = !!on;
    api.pushUndo();
    delete b.verts;
    api.setDirty();
    on = null;
    const np = api.refreshBlock(b);
    if (was) enter(np);
  }

  return {
    enter, exit, click, hitsChosen, moveStart, moveBy, moveEnd, deleteChosen, reset,
    toggle(p) { if (on) exit(); else enter(p); },
    get active() { return !!on; },
    get block() { return on?.p || null; },
    get dragging() { return !!vtc.dragging; },
  };
}
