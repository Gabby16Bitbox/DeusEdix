// The Sky dialog and the 3D view share the same images, UV mapping and cloud layer.
// A sky is a direction, not a box in the map: walking the camera never brings its walls closer.
import { skyProjection } from './sky-background.js';

const fragmentShader = `
uniform sampler2D skyWalls, skyTop, skyBottom, cloudMap;
uniform vec4 skyU[6], skyV[6];
uniform vec4 cloudLayer;
uniform vec2 cloudDirection;
uniform float cloudTime;
uniform bool hasClouds, perspective;
varying vec3 skyDirection;
void main() {
  if (!perspective) discard;
  vec3 d = normalize(skyDirection.xzy); // editor Y up -> Unreal Z up
  vec3 a = abs(d);
  int face;
  if (a.z >= max(a.x, a.y)) face = d.z < 0.0 ? 4 : 5;
  else if (a.x > a.y) face = d.x < 0.0 ? 0 : 1;
  else face = d.y < 0.0 ? 2 : 3;
  vec3 p = d * (1024.0 / max(max(a.x, a.y), a.z));
  vec2 uv = vec2(dot(skyU[face], vec4(1.0, p)), dot(skyV[face], vec4(1.0, p)));
  vec3 rgb;
  if (face < 4) rgb = texture2D(skyWalls, uv).rgb;
  else if (face == 4) rgb = texture2D(skyBottom, uv).rgb;
  else rgb = texture2D(skyTop, uv).rgb;
  if (hasClouds && d.z > 0.0) {
    vec2 hit = d.xy * (cloudLayer.x / d.z);
    if (max(abs(hit.x), abs(hit.y)) < 1024.0) {
      vec2 q = vec2(dot(hit, cloudDirection), dot(hit, vec2(-cloudDirection.y, cloudDirection.x)));
      q.x -= mod(cloudTime * cloudLayer.z, cloudLayer.y);
      vec3 cloud = texture2D(cloudMap, q / cloudLayer.y + vec2(0.5 / 128.0)).rgb;
      rgb += cloud * (1.0 - rgb);
    }
  }
  gl_FragColor = vec4(rgb, 1.0);
}`;

export function createSkyPreview({ THREE, scene, wake = () => {}, storage = globalThis.localStorage }) {
  let enabled = true, source = null, suspended = false, cloudField = null, disposed = false;
  try { enabled = storage?.getItem('deusedix.skyPreview') !== 'off'; } catch { /* optional preference */ }
  const uniforms = {
    skyWalls: { value: null }, skyTop: { value: null }, skyBottom: { value: null }, cloudMap: { value: null },
    skyU: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
    skyV: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
    cloudLayer: { value: new THREE.Vector4() }, cloudDirection: { value: new THREE.Vector2(1, 0) },
    cloudTime: { value: 0 }, hasClouds: { value: false }, perspective: { value: true },
  };
  const makeMaterial = (background) => new THREE.ShaderMaterial({ uniforms, fragmentShader, toneMapped: false,
    side: background ? THREE.BackSide : THREE.DoubleSide, depthWrite: !background,
    vertexShader: background ? `varying vec3 skyDirection;
      void main() { skyDirection = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`
      : `varying vec3 skyDirection;
      void main() { vec4 p = modelMatrix * vec4(position, 1.0); skyDirection = p.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * p; }`,
  });
  const backdropMaterial = makeMaterial(true), surfaceMaterial = makeMaterial(false);
  const backdrop = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), backdropMaterial);
  backdrop.name = 'Sky preview'; backdrop.userData.skyPreview = true;
  backdrop.frustumCulled = false; backdrop.renderOrder = -1000; backdrop.visible = false; backdrop.raycast = () => {};
  const beforeRender = (_renderer, _scene, camera, _geometry, material) => {
    uniforms.perspective.value = !!camera.isPerspectiveCamera;
    uniforms.cloudTime.value = performance.now() / 1000;
    material.uniformsNeedUpdate = true; // the ortho panes and main view share this material
  };
  backdrop.onBeforeRender = beforeRender;
  scene.add(backdrop);
  const surfaces = new Map(), images = new Map();
  function visibility() {
    const shown = enabled && !!source?.look && !suspended;
    backdrop.visible = shown;
    for (const [mesh, fallback] of surfaces) {
      mesh.material = shown ? surfaceMaterial : fallback.material;
      mesh.visible = suspended ? false : shown || fallback.visible;
    }
  }
  function texture(image) {
    if (images.has(image)) return images.get(image);
    const t = new THREE.DataTexture(new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength), image.width, image.height);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false; t.needsUpdate = true;
    images.set(image, t); return t;
  }
  function setSource(next) {
    if (disposed) return;
    source = next?.look ? next : null;
    const keep = new Set(source?.look.map(slot => slot.image) || []);
    for (const [image, tex] of images) if (!keep.has(image)) { tex.dispose(); images.delete(image); }
    for (const [i, key] of ['skyWalls', 'skyTop', 'skyBottom'].entries()) uniforms[key].value = source ? texture(source.look[i].image) : null;
    if (source) for (let f = 0; f < 6; f++) {
      const p = skyProjection(f, source.look[f < 4 ? 0 : f === 4 ? 2 : 1], source.background);
      uniforms.skyU.value[f].fromArray(p); uniforms.skyV.value[f].fromArray(p, 4);
    }
    if (cloudField !== source?.field) {
      uniforms.cloudMap.value?.dispose(); uniforms.cloudMap.value = null; cloudField = source?.field;
      if (cloudField) {
        const bytes = new Uint8Array(128 * 128 * 4);
        for (let i = 0; i < 128 * 128; i++) {
          for (let c = 0; c < 3; c++) bytes[i*4+c] = Math.max(0, Math.min(255, Math.round(cloudField[i*3+c])));
          bytes[i*4+3] = 255;
        }
        uniforms.cloudMap.value = texture({ data: bytes, width: 128, height: 128 });
        // clouds have their own lifetime, not the three sky images
        for (const [key, value] of images) if (value === uniforms.cloudMap.value) images.delete(key);
      }
    }
    const layer = source?.layer;
    uniforms.hasClouds.value = !!cloudField;
    if (layer) { uniforms.cloudLayer.value.set(layer.high, layer.tile, layer.speed, 0); uniforms.cloudDirection.value.fromArray(layer.dir); }
    visibility(); wake();
  }
  function bindSurface(mesh, fallbackVisible = mesh.visible) {
    if (surfaces.has(mesh)) return;
    surfaces.set(mesh, { material: mesh.material, visible: fallbackVisible, before: mesh.onBeforeRender });
    mesh.onBeforeRender = beforeRender;
    visibility();
  }
  function clearSurfaces() {
    for (const [mesh, fallback] of surfaces) { mesh.material = fallback.material; mesh.visible = fallback.visible; mesh.onBeforeRender = fallback.before; }
    surfaces.clear();
  }
  return {
    setSource, bindSurface, clearSurfaces,
    get enabled() { return enabled; }, get ready() { return !!source; },
    get animating() { return backdrop.visible && !!cloudField && (source?.layer?.speed || 0) > 0; },
    setEnabled(on) {
      enabled = !!on; try { storage?.setItem('deusedix.skyPreview', enabled ? 'on' : 'off'); } catch { /* optional preference */ }
      visibility(); wake();
    },
    suspend(on) { if (suspended !== !!on) { suspended = !!on; visibility(); } },
    dispose() { clearSurfaces(); setSource(null); disposed = true; backdrop.removeFromParent(); backdrop.geometry.dispose(); backdropMaterial.dispose(); surfaceMaterial.dispose(); },
  };
}
