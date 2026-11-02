// Particles in the 3D view, the three.js part (the rules: particles.js). A generator's proxy has this gizmo for a body:
// a cyan arrow, the way its particles are thrown (local +X, as the Effect point's), and a small emitter ball. Its
// preview is a pool of sprites inside the gizmo that follow the simulation each frame, while want(proxy) gives the
// settings (selected, or always) and the texture to draw them with.
import * as THREE from 'three';
import { createSimulation, stepSimulation, particleLook, MAX_PARTICLES } from './particles.js';

const ARROW = 0x38d6e8;
function arrow(len, radius, head, opacity, xray) {
  const mat = new THREE.MeshBasicMaterial({ color: ARROW, transparent: true, opacity, depthTest: !xray, depthWrite: false });
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 10), mat);
  shaft.rotation.z = -Math.PI / 2; shaft.position.x = len / 2;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(head * 0.42, head, 14), mat);
  cone.rotation.z = -Math.PI / 2; cone.position.x = len + head / 2;
  g.add(shaft, cone);
  if (xray) g.renderOrder = 5;
  return g;
}
export function createParticleGizmo() {
  const g = new THREE.Group();
  g.add(arrow(40, 2, 14, 1, false), arrow(40, 2, 14, 0.22, true));
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(6, 1), new THREE.MeshBasicMaterial({ color: ARROW, wireframe: true, transparent: true, opacity: 0.9 }));
  g.add(ball);
  g.userData.particleGizmo = true;
  return g;
}

// a soft round puff: the particles' picture until their texture is there (or when it cannot be read)
let puffTexture = null;
function puff() {
  if (puffTexture) return puffTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  // grey, as the game's smoke puffs: added on one another they grow brighter without turning into a white blot
  gr.addColorStop(0, 'rgba(150,150,150,0.55)'); gr.addColorStop(0.45, 'rgba(120,120,120,0.25)'); gr.addColorStop(1, 'rgba(120,120,120,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  puffTexture = new THREE.CanvasTexture(c);
  puffTexture.colorSpace = THREE.SRGBColorSpace;
  return puffTexture;
}
// a bright spark: the picture of the glowing ones (unlit) until theirs is there
let glowTexture = null;
function glow() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.3, 'rgba(255,200,120,0.8)'); gr.addColorStop(1, 'rgba(255,160,60,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}
const loaded = new Map();               // picture url -> THREE.Texture
const loader = new THREE.TextureLoader();
function textureOf(url, unlit) {
  if (!url) return unlit ? glow() : puff();
  if (!loaded.has(url)) {
    const t = loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    loaded.set(url, t);
  }
  return loaded.get(url);
}

// the preview of one gizmo: its pool of sprites (a material each: each fades on its own), its simulation
function previewOf(gz) {
  let pv = gz.userData.particlePreview;
  if (pv) return pv;
  const group = new THREE.Group();
  gz.add(group);
  pv = gz.userData.particlePreview = { group, sprites: [], sim: createSimulation(), look: '', map: puff(), modulated: false };
  return pv;
}
function dress(material, pv) {
  material.map = pv.map;
  material.blending = pv.modulated ? THREE.MultiplyBlending : THREE.AdditiveBlending;
  material.premultipliedAlpha = pv.modulated;
  material.needsUpdate = true;
}
function dropPreview(gz) {
  const pv = gz.userData.particlePreview;
  if (!pv) return;
  gz.remove(pv.group);
  for (const sp of pv.sprites) sp.material.dispose();
  delete gz.userData.particlePreview;
}
const q = new THREE.Quaternion(), upV = new THREE.Vector3();

// where it hurts (particles.js hurtZone): a red see-through stream round the arrow, a ball when it has no reach
function showHurt(gz, hurt) {
  let mesh = gz.userData.hurtMesh;
  const key = hurt ? `${hurt.radius}|${hurt.reach}` : '';
  if (mesh && mesh.userData.key === key) return;
  if (mesh) { gz.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); delete gz.userData.hurtMesh; }
  if (!hurt) return;
  const geo = hurt.reach > 0 ? new THREE.CapsuleGeometry(hurt.radius, hurt.reach, 6, 16) : new THREE.SphereGeometry(hurt.radius, 20, 12);
  if (hurt.reach > 0) { geo.rotateZ(-Math.PI / 2); geo.translate(hurt.reach / 2, 0, 0); }     // along +X, from the generator
  mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff3030, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }));
  mesh.raycast = () => {};
  mesh.userData.key = key;
  gz.add(mesh);
  gz.userData.hurtMesh = mesh;
}

let active = false;
export function particlePreviewsActive() { return active; }
// every frame: want(proxy) -> null (no preview) or {settings (particles.js particleSettings), url (the texture's
// picture, '' while unknown), size (the texture's width in units), hurt (particles.js hurtZone: null, none)}
export function stepParticlePreviews(proxies, dt, want) {
  active = false;
  for (const p of proxies.children) {
    const gz = p.userData && p.userData.particleGizmo;
    if (!gz) continue;
    const w = p.visible ? want(p) : null;
    showHurt(gz, w && w.hurt);
    if (!w) { dropPreview(gz); continue; }
    const pv = previewOf(gz), s = w.settings;
    // how they are drawn: their texture, added light (the game's translucent particles), or darkening (modulated)
    const look = `${w.url}|${s.bModulated}|${s.bParticlesUnlit}`;
    if (pv.look !== look) {
      pv.look = look; pv.map = textureOf(w.url, s.bParticlesUnlit); pv.modulated = !!s.bModulated;
      for (const sp of pv.sprites) dress(sp.material, pv);
    }
    // the world's up in the gizmo's own frame (+X its arrow)
    gz.updateWorldMatrix(true, false);
    q.setFromRotationMatrix(gz.matrixWorld).invert();
    upV.set(0, 1, 0).applyQuaternion(q);
    const list = stepSimulation(pv.sim, s, dt, [upV.x, upV.y, upV.z]);
    while (pv.sprites.length < Math.min(list.length, MAX_PARTICLES)) {
      const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
      dress(material, pv);
      const sp = new THREE.Sprite(material);
      sp.raycast = () => {};                // never picked: a click goes to the generator
      pv.group.add(sp); pv.sprites.push(sp);
    }
    const base = Math.max(1, (w.size || 64) * s.particleDrawScale);
    pv.sprites.forEach((sp, i) => {
      const it = list[i];
      sp.visible = !!it;
      if (!it) return;
      const l = particleLook(s, it);
      sp.position.set(it.p[0], it.p[1], it.p[2]);
      sp.scale.setScalar(base * l.scale);
      sp.material.opacity = l.alpha * (s.bParticlesUnlit || s.bModulated ? 1 : 0.6);     // lit ones: as dimmed by the room's light
    });
    active = true;
  }
}
export function disposeParticleGizmo(p) {
  const gz = p && p.userData && p.userData.particleGizmo;
  if (!gz) return;
  dropPreview(gz);
  showHurt(gz, null);
  gz.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
}
