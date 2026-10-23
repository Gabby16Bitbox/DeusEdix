// Piece library: ready-made pieces of the original maps (tools/mapkit/library.py), shown in 3D so
// they can be chosen by eye; "Copy" puts one in the editor's clipboard (Ctrl+V in any map).
import * as THREE from 'three';
import { projectStorageKey } from './projects.js';

const $ = (s) => document.querySelector(s);
const PF = { masked: 2, translucent: 4, modulated: 64, fake: 128, unlit: 4194304 };
const W = 440, H = 300;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
const loader = new THREE.TextureLoader();
const geoCache = {}, texCache = {};

const texReady = {};
function material(png, flags, base) {
  let map = null;
  if (png) {
    const url = base + png;
    if (!texCache[url]) texReady[url] = new Promise((res) => { texCache[url] = loader.load(url, res, undefined, res); });
    map = texCache[url];
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    if (flags & PF.masked) { map.generateMipmaps = false; map.minFilter = THREE.LinearFilter; }
  }
  const o = { map, side: THREE.DoubleSide, color: map ? 0xffffff : 0x777777 };
  if (flags & PF.masked) o.alphaTest = 0.5;
  if (flags & PF.translucent) Object.assign(o, { transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  return new THREE.MeshBasicMaterial(o);      // flat: the texture as it is, easy to judge
}

async function geometryOf(key) {
  return geoCache[key] || (geoCache[key] = fetch(`/cache/${key}/geometry.json`).then((r) => r.json()));
}

async function render(item, canvas) {
  const key = 'ref_' + item.map, g = await geometryOf(key);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(0.5, 1, 0.3);
  scene.add(sun);
  const group = new THREE.Group();
  for (const grp of g.groups) {
    if (grp.structure !== item.name || grp.flags & PF.fake) continue;
    const pos = new Float32Array(grp.pos.length);
    for (let i = 0; i < grp.pos.length; i += 3) { pos[i] = grp.pos[i]; pos[i + 1] = grp.pos[i + 2]; pos[i + 2] = grp.pos[i + 1]; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(grp.uv), 2));
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, material((g.textures[grp.tex] || {}).png, grp.flags, `/cache/${key}/`)));
  }
  scene.add(group);
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z, 32);
  const cam = new THREE.PerspectiveCamera(40, W / H, 1, 50000);
  cam.position.copy(c).add(new THREE.Vector3(r * 1.1, r * 0.8, r * 1.3));
  cam.lookAt(c);
  // wait for this piece's textures (no timers: a hidden page throttles them), then draw once
  const urls = [];
  group.traverse((o) => { if (o.material && o.material.map && o.material.map.userData) urls.push(o.material.map); });
  await Promise.all(Object.values(texReady));
  renderer.render(scene, cam);
  canvas.getContext('2d').drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
}

async function search() {
  const q = $('#q').value.trim(), maps = $('#maps').value.trim();
  $('#status').textContent = 'searching...';
  const r = await fetch(`/api/library?q=${encodeURIComponent(q)}&maps=${encodeURIComponent(maps)}`).then((x) => x.json());
  $('#grid').innerHTML = '';
  $('#status').textContent = `${r.length} pieces`;
  for (const item of r) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<canvas width="${W}" height="${H}"></canvas><div>${item.label}<br><span class="id">${item.map} ${item.name} · ${item.size.join('x')}</span><br><span class="id">${item.objects.slice(0, 4).join(', ')}</span></div><button>Copy</button>`;
    $('#grid').appendChild(card);
    card.querySelector('button').onclick = async () => {
      const clip = await fetch(`/api/copy_ref?map=${encodeURIComponent(item.map)}&structure=${encodeURIComponent(item.name)}`, { method: 'POST' }).then((x) => x.json());
      localStorage.setItem(projectStorageKey('clipboard'), JSON.stringify(clip));
      $('#status').textContent = `Copied ${item.map} ${item.name}: Ctrl+V in the editor`;
    };
    await render(item, card.querySelector('canvas'));
  }
  $('#status').textContent = `${r.length} pieces`;
  if (new URLSearchParams(location.search).get('sheet')) await sheet(r);
}

// a contact sheet of the results, saved by the server (editor/cache/_sheets): to look at many pieces at once
async function sheet(items) {
  const cols = 5, tw = 320, th = 250, lh = 46;
  const rows = Math.ceil(items.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * tw; c.height = rows * (th + lh);
  const g = c.getContext('2d');
  g.fillStyle = '#14161b'; g.fillRect(0, 0, c.width, c.height);
  const canv = [...document.querySelectorAll('.card canvas')];
  items.forEach((it, i) => {
    const x = (i % cols) * tw, y = Math.floor(i / cols) * (th + lh);
    g.drawImage(canv[i], x + 4, y + 4, tw - 8, th - 8);
    g.fillStyle = '#d9dde5'; g.font = '15px Segoe UI';
    g.fillText(`${i + 1}. ${it.map.replace('06_HongKong_', 'HK ')} ${it.name}`, x + 6, y + th + 16);
    g.fillStyle = '#8b93a3'; g.font = '13px Segoe UI';
    g.fillText(`${it.size.join('x')} ${it.label}`.slice(0, 46), x + 6, y + th + 36);
  });
  const name = new URLSearchParams(location.search).get('sheet');
  await fetch('/api/sheet?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ png: c.toDataURL('image/png') }) });
  $('#status').textContent = `contact sheet saved: ${name}`;
}
$('#go').onclick = search;
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
const p = new URLSearchParams(location.search);
if (p.get('q')) { $('#q').value = p.get('q'); $('#maps').value = p.get('maps') || ''; search(); }
