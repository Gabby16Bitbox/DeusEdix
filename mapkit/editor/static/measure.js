// View > Measure (M): a ruler, as in UnrealEd's later editors. Two clicks on the map (the 3D view or an orthographic
// one) give the distance between the points, and how far apart they are along X, Y and Z, in the game's units (on
// the grid when Grid snap is on); a third click starts a new measure; M or Esc ends. JC is 88 units tall, a door 128.
import * as THREE from 'three';

export function createMeasure(api) {
  const { scene, camera, canvas } = api;
  const mat = new THREE.LineBasicMaterial({ color: 0xffd25a, depthTest: false, transparent: true });
  const line = new THREE.Line(new THREE.BufferGeometry(), mat);
  line.renderOrder = 998;
  line.visible = false;
  const dots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffd25a, size: 8, sizeAttenuation: false, depthTest: false, transparent: true }));
  dots.renderOrder = 998;
  dots.visible = false;
  scene.add(line, dots);
  const label = document.createElement('div');
  label.className = 'measure-label';
  label.style.cssText = 'position:fixed;z-index:6;pointer-events:none;display:none;padding:2px 6px;border-radius:3px;'
    + 'background:#0b1625e6;border:1px solid #ffd25a;color:#ffe6a0;font:12px/1.4 "Segoe UI",sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap';
  document.body.appendChild(label);
  let on = false, pts = [];

  function draw() {
    const p3 = pts.map((p) => p.clone());
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(p3);
    dots.geometry.dispose();
    dots.geometry = new THREE.BufferGeometry().setFromPoints(p3);
    line.visible = pts.length === 2;
    dots.visible = pts.length > 0;
    if (pts.length === 2) {
      const a = api.UE(pts[0]), b = api.UE(pts[1]), d = b.map((v, k) => v - a[k]);
      const r = (v) => Math.round(v * 10) / 10;
      label.textContent = `${r(Math.hypot(...d))} u   X ${r(d[0])}  Y ${r(d[1])}  Z ${r(d[2])}`;
    }
    update();
    api.wake();
  }
  // the label at the middle of the line, on the 3D view (each frame: the camera moves)
  function update() {
    if (!on || pts.length < 2) { label.style.display = 'none'; return; }
    const mid = pts[0].clone().add(pts[1]).multiplyScalar(0.5).project(camera), r = canvas.getBoundingClientRect();
    if (mid.z > 1 || Math.abs(mid.x) > 1.05 || Math.abs(mid.y) > 1.05) { label.style.display = 'none'; return; }
    label.style.display = 'block';
    label.style.left = (r.left + (mid.x + 1) / 2 * r.width + 8) + 'px';
    label.style.top = (r.top + (1 - mid.y) / 2 * r.height - 10) + 'px';
  }
  // a click: the first thing the ray meets (the floor, a wall, an object), on the grid with Grid snap
  function click(e) {
    const hit = api.firstHit(e);
    if (!hit) { api.status('Measure: click on the map (a floor, a wall, an object).', 'warn'); return; }
    const p = hit.clone();
    if (api.snapOn()) { const st = api.SNAP.move || 16; p.set(Math.round(p.x / st) * st, Math.round(p.y / st) * st, Math.round(p.z / st) * st); }
    if (pts.length === 2) pts = [];
    pts.push(p);
    draw();
    api.status(pts.length === 1 ? 'Measure: now the second point.' : 'Measure: ' + label.textContent + ' (a click: a new measure).', pts.length === 1 ? '' : 'ok');
  }
  function toggle() {
    on = !on;
    pts = [];
    draw();
    api.status(on ? 'Measure: click two points on the map (M or Esc ends).' : 'Measure ended.', on ? 'ok' : '');
  }
  return { click, toggle, update, get active() { return on; }, exit() { if (on) toggle(); } };
}
