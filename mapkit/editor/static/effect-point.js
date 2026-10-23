// The Effect point of the 3D view (Objects > Triggers > Effect point; in the game UCEffectPoint): where an
// effect of an interaction goes, and the way it goes. Its gizmo has one BIG orange arrow, the direction of
// the effect (the point's yaw and pitch), and two small thin arrows for its other axes; while the point is
// selected (or always, when its Inspector says so) a few soft puffs flow along the big arrow: a preview of
// the kind chosen in the Inspector (editor-only, edits.fxpreview: the game does not read it).
// Pure helpers (kinds, the kind an interaction gives) are tested in tests/test_effect_point.mjs.
import * as THREE from 'three';

export const FX_POINT_CLASS = 'UCEffectPoint';
export const isEffectPoint = (a) => !!a && String(a.cls || '').split('.').pop() === FX_POINT_CLASS;
// the kinds of the preview: 'auto' = the effect its interactions put on it
export const FX_PREVIEW_KINDS = [['auto', 'As its interactions (auto)'], ['mist', 'Mist'], ['smoke', 'Smoke'],
  ['sparks', 'Sparks'], ['fire', 'Fire'], ['light', 'A light'], ['none', 'No preview']];

// the preview settings of a point (edits.fxpreview[name]), with their defaults
export function fxPreviewOf(edits, name) {
  const p = ((edits && edits.fxpreview) || {})[name] || {};
  return { kind: FX_PREVIEW_KINDS.some(([k]) => k === p.kind) ? p.kind : 'auto', always: !!p.always };
}
// the effects the interactions put on this point: [{kind, colour}] in the order of the rules
export function fxEffectsOn(links, name) {
  const out = [];
  for (const l of links || []) for (const x of l.do || [])
    if (x.verb === 'effect' && x.target === name && x.a && x.a !== 'off') out.push({ kind: x.a, colour: String(x.c || '').split(/\s+/)[0] || 'red' });
  return out;
}
// the kind the preview shows: chosen, or the first effect of its interactions (mist when it has none)
export function fxPreviewKind(edits, name) {
  const k = fxPreviewOf(edits, name).kind;
  if (k !== 'auto') return k;
  const e = fxEffectsOn(edits && edits.links, name)[0];
  if (!e) return 'mist';
  return e.kind === 'blinklight' || e.kind === 'pulse' ? 'light' : e.kind;
}

// ---------------------------------------------------------------- the gizmo
const BIG = 0xff7a1a, SIDE = 0x6fd36f, UP = 0x5aa2ff;
function arrow(len, radius, head, color, opacity, xray) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: !xray, depthWrite: false });
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 10), mat);
  shaft.rotation.z = -Math.PI / 2; shaft.position.x = len / 2;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(head * 0.42, head, 14), mat);
  cone.rotation.z = -Math.PI / 2; cone.position.x = len + head / 2;
  g.add(shaft, cone);
  if (xray) g.renderOrder = 5;
  return g;
}
// local +X = the effect's direction (the group's parent turns it by the yaw, this group by the pitch)
export function createEffectPointGizmo() {
  const g = new THREE.Group();
  g.add(arrow(56, 2.6, 20, BIG, 1, false));                         // the effect's way: big, orange
  g.add(arrow(56, 2.6, 20, BIG, 0.22, true));                       // (faint through walls)
  const side = arrow(16, 0.8, 6, SIDE, 0.85, false); side.rotation.y = -Math.PI / 2; g.add(side);   // Unreal +Y
  const up = arrow(16, 0.8, 6, UP, 0.85, false); up.rotation.z = Math.PI / 2; g.add(up);            // Unreal +Z
  g.add(new THREE.Mesh(new THREE.SphereGeometry(5, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffe2c4, transparent: true, opacity: 0.9, depthWrite: false })));
  g.userData.fxGizmo = true;
  return g;
}

// ---------------------------------------------------------------- the preview
let puffTexture = null;
function puff() {
  if (puffTexture) return puffTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  puffTexture = new THREE.CanvasTexture(c);
  puffTexture.colorSpace = THREE.SRGBColorSpace;
  return puffTexture;
}
// speed and rise in units per second, life in seconds, size in units, the colour and how bright
const KIND = {
  mist: { n: 16, speed: 90, rise: -4, life: 2.6, size: [12, 50], color: 0xffffff, peak: 0.75, spread: 0.14 },
  smoke: { n: 12, speed: 70, rise: 45, life: 3.0, size: [16, 66], color: 0xc4c4c4, peak: 0.7, spread: 0.16 },
  sparks: { n: 16, speed: 200, rise: 0, gravity: 420, life: 0.9, size: [4, 2], color: 0xffd27a, peak: 1, spread: 0.25, add: true },
  fire: { n: 14, speed: 150, rise: 40, life: 0.8, size: [12, 26], color: 0xff8a2a, peak: 0.85, spread: 0.18, add: true },
  light: { n: 1, speed: 0, rise: 0, life: 1, size: [34, 34], color: 0xff3a2a, peak: 0.9, spread: 0, add: true, pulse: true },
};
const LIGHT_COLOURS = { red: 0xff3a2a, green: 0x3aff6a, blue: 0x4a7aff, yellow: 0xffe23a, orange: 0xff9a2a, white: 0xffffff };

function rnd(seed) { const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function buildPreview(kind, colour) {
  const k = KIND[kind];
  const g = new THREE.Group();
  g.userData.fxPreview = kind;
  for (let i = 0; i < k.n; i++) {
    const m = new THREE.SpriteMaterial({ map: puff(), color: kind === 'light' ? (LIGHT_COLOURS[colour] || k.color) : k.color, transparent: true,
      opacity: 0, depthWrite: false, blending: k.add ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = new THREE.Sprite(m);
    const a = rnd(i + 1) * Math.PI * 2, r = Math.sqrt(rnd(i + 7));
    s.userData.fx = { phase: i / k.n, dy: Math.cos(a) * r * k.spread, dz: Math.sin(a) * r * k.spread };
    s.raycast = () => {};                     // never picked: clicking goes to the point
    g.add(s);
  }
  return g;
}
function disposePreview(g) {
  for (const s of g.children) s.material.dispose();
}
const up = new THREE.Vector3(), q = new THREE.Quaternion();
function stepPreview(g, t) {
  const kind = g.userData.fxPreview, k = KIND[kind];
  g.updateWorldMatrix(true, false);
  q.setFromRotationMatrix(g.matrixWorld).invert();
  up.set(0, 1, 0).applyQuaternion(q);             // the world's up in the point's own frame
  for (const s of g.children) {
    const f = s.userData.fx;
    if (k.pulse) {
      const v = 0.55 + 0.45 * Math.sin(t * 5);
      s.material.opacity = k.peak * v;
      s.scale.setScalar(k.size[0] * (0.8 + 0.3 * v));
      s.position.set(0, 0, 0);
      continue;
    }
    const u = ((t / k.life) + f.phase) % 1, secs = u * k.life;
    const along = k.speed * secs;
    s.position.set(along, along * f.dy, along * f.dz);
    s.position.addScaledVector(up, k.rise * secs - 0.5 * (k.gravity || 0) * secs * secs);
    s.scale.setScalar(k.size[0] + (k.size[1] - k.size[0]) * u);
    s.material.opacity = k.peak * Math.min(1, u * 6) * (1 - u);
  }
}

// The proxy of a point: its gizmo turned by its pitch (tiltRad), the preview inside the gizmo.
export function setEffectPointTilt(gizmo, tiltRad) { if (gizmo) gizmo.rotation.z = tiltRad; }

let active = false, clockT = 0;
export function effectPreviewsActive() { return active; }
// every frame: show, hide and move the previews (want(proxy) -> null or {kind, colour})
export function stepEffectPreviews(proxies, dt, want) {
  clockT += dt;
  active = false;
  for (const p of proxies.children) {
    const gz = p.userData && p.userData.fxGizmo;
    if (!gz) continue;
    const w = p.visible ? want(p) : null;
    let pv = gz.children.find((c) => c.userData.fxPreview);
    if (pv && (!w || pv.userData.fxPreview !== w.kind || pv.userData.colour !== w.colour)) { gz.remove(pv); disposePreview(pv); pv = null; }
    if (!w || !KIND[w.kind]) continue;
    if (!pv) { pv = buildPreview(w.kind, w.colour); pv.userData.colour = w.colour; gz.add(pv); }
    stepPreview(pv, clockT);
    active = true;
  }
}
export function disposeEffectPoint(p) {
  const gz = p && p.userData && p.userData.fxGizmo;
  if (!gz) return;
  gz.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } else if (o.isSprite) o.material.dispose(); });
}
