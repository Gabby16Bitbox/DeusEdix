// The grid of the 3D view, as Unity's scene grid with "Show closest grid to handle": lines on a level plane that fade
// out round the camera, a cell for each grid step (the toolbar's, Grid snap's) and a brighter line every GRID_MAJOR
// cells, at the height of the bottom of what is selected (on the grid), else of the floor under the camera; on or off
// from the 3D view's toolbar. The lines are drawn by the plane's shader, sharp at any distance; cells too small to
// read fade away. It is on a layer of its own that only the 3D view's camera sees: the orthographic views draw a
// grid of their own (ortho-views.js), and the editor's rays never meet it. Where it lies and how fine: grid-snap.js.
import * as THREE from 'three';
import { gridView } from './grid-snap.js';

export const GRID_LAYER = 1;

const VERTEX = `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
// lines `s` apart both ways: how much of a line this pixel is, each way fading out where its lines come closer than a
// few pixels (looking along a floor, the lines across the view go first)
const FRAGMENT = `
uniform float uCell, uMajor, uRadius;
uniform vec2 uCentre;
uniform vec3 uColor;
varying vec3 vWorld;
float lines(vec2 p, float s) {
  vec2 c = p / s, w = max(fwidth(c), vec2(1e-5));
  vec2 g = (1.0 - min(abs(fract(c - 0.5) - 0.5) / w, 1.0)) * (1.0 - smoothstep(0.2, 0.5, w));
  return max(g.x, g.y);
}
void main() {
  vec2 p = vWorld.xz;
  float a = max(lines(p, uCell) * 0.45, lines(p, uMajor) * 0.85);
  a *= 1.0 - smoothstep(uRadius * 0.45, uRadius, distance(p, uCentre));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

// api: scene, camera, step() (the grid step), floor() (the height of the bottom of the selection, else of the floor
// under the camera, three's y; null: none known), color (the lines', a THREE.Color)
export function createViewGrid(api) {
  const uniforms = { uCell: { value: 16 }, uMajor: { value: 128 }, uRadius: { value: 1024 }, uCentre: { value: new THREE.Vector2() },
    uColor: { value: api.color || new THREE.Color(0x4c9eff) } };
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));     // over a floor at the same height
  plane.layers.set(GRID_LAYER);
  plane.renderOrder = -1;                  // before the other see-through things (the selection's outline, the icons)
  plane.frustumCulled = false;
  plane.visible = false;
  api.scene.add(plane);
  api.camera.layers.enable(GRID_LAYER);
  let level = 0;

  // each frame it is shown: at the floor's height, round the camera, as fine as the grid step
  function update() {
    if (!plane.visible) return;
    const eye = api.camera.position, floor = api.floor();
    if (floor !== null && floor !== undefined) level = floor;
    const v = gridView(api.step(), level, eye.y);
    plane.position.set(eye.x, v.level, eye.z);
    plane.scale.setScalar(v.radius);
    uniforms.uCell.value = v.cell;
    uniforms.uMajor.value = v.major;
    uniforms.uRadius.value = v.radius;
    uniforms.uCentre.value.set(eye.x, eye.z);
  }
  return {
    update,
    get on() { return plane.visible; },
    set on(v) { plane.visible = !!v; update(); },
    get level() { return plane.visible ? plane.position.y : null; },
  };
}
