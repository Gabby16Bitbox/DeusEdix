// The logic's wires in the 3D view (5 Nov 2026, Gabby: "una cosa tipo quake"). As TrenchBroom draws a Quake map's
// target / targetname links, four modes: Off, the selected object's own rules (Selected), every rule reachable from
// it either way (Chain), every rule of the map (All). Better than a straight line: each wire is an arc from what sets
// a rule off to what it acts on, its dashes flowing that way with an arrowhead near its end; the part behind a wall
// is drawn faint; two rules between the same objects get arcs of their own (lanes); a rule that sets a state another
// rule reads is a dotted amber wire between their objects; each wire has a label at its top ("uses → Open · 2 s")
// that opens the rule in the Logic window. The colours are this file's own table (DESIGN.md: 3D overlays keep their
// colours in one table each): green as the editor's arrows always were.
//
// logic-wires-model.js says which wires (pure, tested); createLogicWires draws what it returns.
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

import { WIRE_COLORS, arcOf, labelsOf, roomFor } from './logic-wires-model.js';
export { WIRE_MODES, WIRE_COLORS, wiresOf } from './logic-wires-model.js';

// ---------------------------------------------------------------- drawing
// positionOf(name): a THREE.Vector3 (the object's place) or null; onOpen(rule id): the rule opened in the Logic window
export function createLogicWires({ THREE, scene, camera, canvas, positionOf, onOpen = () => {} }) {
  const group = new THREE.Group();
  group.name = 'logic-wires';
  scene.add(group);
  const box = document.createElement('div');
  box.className = 'lw3-labels';
  document.body.appendChild(box);
  const css = document.createElement('style');
  // under the workspace's panels (z-index 4): a label shows only where the 3D view does
  css.textContent = `.lw3-labels { position:fixed; left:0; top:0; width:0; height:0; z-index:3; pointer-events:none; }
    .lw3-label { position:fixed; transform:translate(-50%, -100%); padding:0 6px; height:18px; line-height:18px; font-size:11px;
      white-space:nowrap; color:var(--text); background:color-mix(in srgb, var(--panel) 88%, transparent); border:1px solid var(--line);
      border-radius:var(--radius-control); pointer-events:auto; cursor:pointer; }
    .lw3-label.hot { border-color:var(--accent-border); color:var(--heading); }
    .lw3-label.state { color:var(--warn); }
    .lw3-label:hover { background:var(--hover); }`;
  document.head.appendChild(css);
  let items = [], last = [], checked = 0;
  const up = new THREE.Vector3(0, 16, 0);
  function clear() {
    for (const it of items) {
      for (const o of it.objects) { group.remove(o); o.geometry?.dispose(); o.material?.dispose(); }
      it.label?.remove();
    }
    items = [];
  }
  function set(wires) {
    clear();
    last = wires;
    const many = labelsOf(wires);                    // which say what they do, and for how many objects
    // the selected object's wires first: their labels win a place on the screen
    wires = [...wires].sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0));
    for (const w of wires) {
      const a = positionOf(w.from), b = positionOf(w.to);
      if (!a || !b) continue;
      const [p0, c, p1] = arcOf(a.clone().add(up), b.clone().add(up), w.lane);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(p0.x, p0.y, p0.z), new THREE.Vector3(c.x, c.y, c.z),
        new THREE.Vector3(p1.x, p1.y, p1.z));
      const pts = curve.getPoints(40), flat = pts.flatMap((p) => [p.x, p.y, p.z]);
      const state = w.kind === 'state';
      const color = state ? (w.hot ? WIRE_COLORS.state : WIRE_COLORS.stateDim) : (w.hot ? WIRE_COLORS.act : WIRE_COLORS.actDim);
      const objects = [];
      // a dark edge under it (it shows on a bright floor too), the wire in front of the walls, behind them faint
      const width = w.hot ? 3.5 : 2.5;
      for (const pass of ['edge', 'front', 'behind']) {
        const behind = pass === 'behind', edge = pass === 'edge';
        const geometry = new LineGeometry();
        geometry.setPositions(flat);
        const material = new LineMaterial({ color: edge ? 0x000000 : color, linewidth: behind ? 1.5 : edge ? width + 3 : width,
          dashed: !edge, transparent: true, opacity: behind ? 0.25 : edge ? 0.45 : 1, depthTest: !behind, depthWrite: false,
          dashSize: state ? 8 : 24, gapSize: state ? 8 : (behind ? 24 : 8) });
        material.resolution.set(canvas.clientWidth || 1, canvas.clientHeight || 1);
        const line = new Line2(geometry, material);
        if (!edge) line.computeLineDistances();
        line.renderOrder = behind ? 9 : edge ? 9.5 : 10;
        group.add(line);
        objects.push(line);
      }
      if (!state) {                                    // the arrowhead, near the end it goes to
        const at = curve.getPoint(0.88), dir = curve.getTangent(0.88);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(w.hot ? 7 : 5, w.hot ? 18 : 14, 12), new THREE.MeshBasicMaterial({ color, transparent: true,
          opacity: 0.95, depthTest: false }));
        cone.position.copy(at);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        cone.renderOrder = 11;
        group.add(cone);
        objects.push(cone);
      }
      let label = null;
      if (many.has(w) && w.label) {
        label = document.createElement('div');
        label.className = 'lw3-label' + (w.hot ? ' hot' : '') + (state ? ' state' : '');
        const n = many.get(w) || 1;
        label.textContent = (state ? 'sets ' : '') + w.label + (n > 1 && !state ? ` ×${n}` : '')
          + (w.delay > 0 && !state ? ` · ${w.delay} s` : '');
        label.title = 'Open this rule in the Logic window';
        label.onclick = () => onOpen(w.rule);
        box.appendChild(label);
      }
      items.push({ wire: w, objects, label, top: curve.getPoint(0.5), a: a.clone(), b: b.clone() });
    }
    frame(clock, true);
  }
  // each frame: the dashes flow towards the target, the labels follow their arcs; a label over another moves up a
  // line or two, else waits until there is room (the selected object's go first: their wires come first)
  // t: seconds of the wires' own clock (the view's: it stands still while the view is idle)
  let clock = 0;
  function frame(t, now = false) {
    clock = t;
    if (!items.length) return;
    // an object moved (the gizmo, Undo, a drop): its wires follow, looked at every 0.15 s
    const real = performance.now() / 1000;          // (real time: the view still draws 4 times a second when idle)
    if (!now && real - checked > 0.15) {
      checked = real;
      const moved = items.some((it) => { const a = positionOf(it.wire.from), b = positionOf(it.wire.to);
        return !a || !b || a.distanceToSquared(it.a) > 1 || b.distanceToSquared(it.b) > 1; });
      if (moved) { set(last); return; }
    }
    const r = canvas.getBoundingClientRect(), fw = new THREE.Vector3(), placed = [];
    camera.getWorldDirection(fw);
    for (const it of items) {
      for (const o of it.objects) {
        if (o.material && o.material.isLineMaterial) {
          o.material.dashOffset = -t * (it.wire.kind === 'state' ? 12 : 40);
          o.material.resolution.set(r.width || 1, r.height || 1);
        }
      }
      if (!it.label) continue;
      const v = it.top.clone().project(camera), ahead = it.top.clone().sub(camera.position).dot(fw) > 0;
      const x = r.left + (v.x + 1) / 2 * r.width;
      let y = ahead && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 ? r.top + (1 - v.y) / 2 * r.height : null;
      if (y !== null) y = roomFor(placed, x, y, (it.width ||= it.label.offsetWidth || it.label.textContent.length * 6.5 + 14) + 6);
      it.label.style.display = y !== null ? 'block' : 'none';
      if (y !== null) Object.assign(it.label.style, { left: `${x}px`, top: `${y}px` });
    }
  }
  return { set, frame, clear, get count() { return items.length; } };
}
