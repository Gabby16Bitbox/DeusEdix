// First-person animations made in Blender (Tools > First-person moments: Export the model, Import an animation): the
// weapon's first-person model (arms and gun: one model of points moved frame by frame, no skeleton) goes out as a .glb
// at its resting frame; animated in Blender (an armature, shape keys, anything) and exported again as .glb, each of its
// frames comes back as the model's own points: every point of the model is the point of the import nearest to it at
// rest, wherever that point goes in each frame. The frames are saved as a new animation of a copy of the model
// (DeusEdixAnims, as the Animation Studio's: /api/studio_bake, /api/studio_pack), which the moment wears in the game.

import { encodeRawVertices } from './studio-vertex-format.js';

// the model's resting frame: its Still, else its first
export function restFrame(model) {
  const still = model.seqs.find((s) => /^still$/i.test(s.name));
  return still ? still.start : 0;
}
const framePos = (m, f) => m.pos.subarray(f * m.FV * 3, (f + 1) * m.FV * 3);
// the points the model's faces use (the others: special points, kept as they are)
export function usedPoints(model) {
  return [...new Set(Array.from(model.wedges))].sort((a, b) => a - b);
}

// For each point of `wanted` ([x, y, z] by index), the nearest of `pool` ([x, y, z] list): {map: pool index by point,
// worst, median: their distances}. A grid of cells keeps it quick for thousands of points.
export function matchPoints(wanted, pool, cell = 4) {
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map();
  pool.forEach((p, i) => { const k = key(...p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const map = new Map(), dists = [];
  for (const [index, p] of wanted) {
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 64 && best < 0; r *= 2) {          // wider cells until something is found
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        for (const i of grid.get(`${x},${y},${z}`) || []) {
          const q = pool[i], d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    map.set(index, best);
    dists.push(bd);
  }
  dists.sort((a, b) => a - b);
  return { map, worst: dists.at(-1) ?? 0, median: dists[Math.floor(dists.length / 2)] ?? 0 };
}

// three.js positions -> the model's raw units (int16), as the Studio's bake (studio.js toRaw)
export function toRaw(info, P, out, at) {
  return encodeRawVertices(info, P, out, at);
}
export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// The model at rest as a .glb (ArrayBuffer): a mesh of its faces, a point for each corner (its picture's place), its
// pictures' slots as materials
export async function exportModel(THREE, model, name = 'FirstPerson') {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const R = framePos(model, restFrame(model)), nf = model.faces.length / 4;
  const pos = new Float32Array(nf * 9), uv = new Float32Array(nf * 6);
  const g = new THREE.BufferGeometry(), slots = [];
  let o = 0, u = 0, groupStart = 0, lastSlot = null;
  const order = Array.from({ length: nf }, (_, f) => f).sort((a, b) => model.faces[a * 4 + 3] - model.faces[b * 4 + 3]);
  order.forEach((f, n) => {
    const slot = model.faces[f * 4 + 3];
    if (slot !== lastSlot) { if (lastSlot !== null) g.addGroup(groupStart, n * 3 - groupStart, slots.length - 1); slots.push(slot); groupStart = n * 3; lastSlot = slot; }
    for (let j = 0; j < 3; j++) {
      const w = model.faces[f * 4 + j], i = model.wedges[w] * 3;
      pos[o++] = R[i]; pos[o++] = R[i + 1]; pos[o++] = R[i + 2];
      uv[u++] = model.uvs[2 * w]; uv[u++] = model.uvs[2 * w + 1];
    }
  });
  if (lastSlot !== null) g.addGroup(groupStart, nf * 3 - groupStart, slots.length - 1);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const mats = slots.map((s) => new THREE.MeshStandardMaterial({ name: `slot${s}`, color: 0xb0b0b0 }));
  const mesh = new THREE.Mesh(g, mats);
  mesh.name = name;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return new Promise((done, fail) => new GLTFExporter().parse(scene, done, fail, { binary: true }));
}

// The frames of a .glb's first animation as the model's own (Int16Array, frames x FV x 3), at `rate` frames a second.
// Throws when it has no animation, or when its points at rest are not the model's (moved in edit mode: they must keep
// their places; only the animation moves them).
export async function framesFromGlb(THREE, buf, model, rate = 30) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new Promise((done, fail) => new GLTFLoader().parse(buf, '', done, fail));
  const clip = gltf.animations[0];
  if (!clip) throw new Error('The file has no animation: animate the model in Blender, then export it with its animation.');
  const scene = gltf.scene, meshes = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if (o.isMesh && o.geometry?.attributes.position) meshes.push(o); });
  if (!meshes.length) throw new Error('The file has no model.');
  const v = new THREE.Vector3();
  const sample = () => {
    const out = [];
    scene.updateMatrixWorld(true);
    for (const mesh of meshes) {
      const n = mesh.geometry.attributes.position.count;
      for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); out.push([v.x, v.y, v.z]); }
    }
    return out;
  };
  // its points at rest (before the animation moves them), matched to the model's
  const rest = sample(), R = framePos(model, restFrame(model)), used = usedPoints(model);
  const { map, worst, median } = matchPoints(used.map((i) => [i, [R[3 * i], R[3 * i + 1], R[3 * i + 2]]]), rest);
  if (median > 0.5 || worst > 8) {
    throw new Error(`The model's points are not where they were (${median.toFixed(2)} units off): animate the exported model without moving its points in edit mode.`);
  }
  const mixer = new THREE.AnimationMixer(scene), action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);                       // its last frame is its end, not its start again
  action.clampWhenFinished = true;
  action.play();
  const frames = Math.max(1, Math.round(clip.duration * rate) + 1), FV = model.FV;
  const data = new Int16Array(frames * FV * 3), P = new Float32Array(FV * 3);
  for (let f = 0; f < frames; f++) {
    action.time = Math.min(clip.duration, f / rate);
    mixer.update(0);
    const now = sample();
    P.set(R);                                              // the points no face uses stay where they are
    for (const i of used) { const q = now[map.get(i)]; P[3 * i] = q[0]; P[3 * i + 1] = q[1]; P[3 * i + 2] = q[2]; }
    toRaw(model.info, P, data, f * FV * 3);
  }
  return { frames, rate, data, median, worst, name: clip.name };
}
