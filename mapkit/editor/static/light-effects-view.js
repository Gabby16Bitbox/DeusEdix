// View > Effects (the 3D view's toolbar, the View menu), as Unity's Scene view Effects: while it is on, the Lit view
// moves as the game does (light-effects.js has the timing maths, app.js says what is in the map). What is drawn here:
// - the lamps that pulse, blink, flicker or strobe, on the map's walls, floors and ceilings: their lightmaps hold the
//   sum of every lamp, not each one's share, so a lamp's share is taken as its light at that point without shadows
//   (light-reach.js's falloff, angle and cone, here in the shader), never more than the lightmap holds there, and goes
//   up and down with the lamp. Behind a wall within its reach the lightmap dims a little too. The FX_MAX lamps nearest
//   the camera move, the others stay steady. (The objects' own light is app.js's: there each lamp's share is exact.)
// - Auto U / V Pan: each corner of the surfaces takes its pan speed (the geometry's fxPan, in textures a second);
// - coronas: a glow of the lamp's colour where a lamp with bCorona and a Skin is, in the game's square on the screen
//   (light-effects.js coronaScale) and as big inside it (coronaGlow) as Revision's Effects.Corona.Corona_G (measured;
//   the original game's corona textures were not), not dimmed with its lamp, shown while no wall of the map is between
//   the camera and the lamp and fading in and out as the game's do (the game draws the Skin texture itself; here a glow);
// - the zone the camera is in: its ViewFlash and ViewFog over the whole view as JC sees them, its FogColor out to
//   FogDistance as a haze (light-effects.js zoneView).
// Nothing of this runs while Effects is off: the surfaces keep their own materials and no frame is drawn for it.
import { coneAngle } from './range-handles.js';
import { SPOT_LIGHTS, NON_INCIDENCE } from './light-reach.js';
import { coronaScale, coronaFade, coronaTurn, coronaGlow, CORONA_MAX } from './light-effects.js';
import { radialTexture } from './search-view.js';

export const FX_MAX = 16;

// a corona's picture, as wide as its square (128 x 128): its glow (coronaGlow) the alpha; filtered smoothly (a
// DataTexture is nearest by default, which shows steps on a big corona)
const coronaTexture = (THREE) => radialTexture(THREE, 128, coronaGlow, THREE.LinearFilter);

// what goes into the shaders of the surfaces' materials (app.js effectMaterial): a corner's pan, the lamps' light
const VERTEX_HEAD = `
attribute vec2 fxPan;
uniform float uFxTime;
varying vec3 vFxP;`;
const FRAGMENT_HEAD = `
#define FX_MAX ${FX_MAX}
uniform int uFxN;
uniform vec4 uFxPos[FX_MAX];
uniform vec4 uFxCol[FX_MAX];
uniform vec4 uFxDir[FX_MAX];
uniform float uFxFlat[FX_MAX];
varying vec3 vFxP;`;
// uFxPos: where the lamp is (three's axes) and its reach; uFxCol: its light on a surface (doubled, with the view's
// brightness) and its level now - 1; uFxDir: the way a spotlight faces and the cosine of its cone (2: no cone);
// uFxFlat: 1 for LE_NonIncidence. The lightmap's light, back in the game's units (0 to 2: the Lit view's gain to the
// 1 / 2.2), takes each lamp's change, then goes back as it came.
const FRAGMENT_LIGHT = `
#ifdef USE_LIGHTMAP
	if ( uFxN > 0 ) {
		vec3 fxLight = pow( max( reflectedLight.indirectDiffuse, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) ), fxAdd = vec3( 0.0 );
		vec3 fxNormal = normalize( cross( dFdx( vFxP ), dFdy( vFxP ) ) );
		for ( int i = 0; i < FX_MAX; i ++ ) {
			if ( i >= uFxN ) break;
			vec3 d = uFxPos[ i ].xyz - vFxP;
			float dist = length( d );
			if ( dist >= uFxPos[ i ].w ) continue;
			float f = 1.0 - dist / uFxPos[ i ].w;
			if ( uFxFlat[ i ] < 0.5 && dist > 0.01 ) f *= abs( dot( fxNormal, d ) ) / dist;
			if ( uFxDir[ i ].w <= 1.0 && dist > 0.01 ) {
				float cs = - dot( d, uFxDir[ i ].xyz ) / dist;
				f *= cs <= uFxDir[ i ].w ? 0.0 : min( 1.0, ( cs - uFxDir[ i ].w ) / max( 0.05, 1.0 - uFxDir[ i ].w ) * 2.0 );
			}
			fxAdd += uFxCol[ i ].w * min( uFxCol[ i ].rgb * f, fxLight );
		}
		reflectedLight.indirectDiffuse = pow( max( fxLight + fxAdd, vec3( 0.0 ) ), vec3( 2.2 ) );
	}
#endif`;

// renderer, scene, camera: the 3D view's; blocked(from, to): is a wall of the map between two points (three's)
export function createLightEffects(THREE, { renderer, scene, camera, blocked = () => false }) {
  const lamps = () => Array.from({ length: FX_MAX }, () => new THREE.Vector4());
  const uniforms = { uFxN: { value: 0 }, uFxPos: { value: lamps() }, uFxCol: { value: lamps() }, uFxDir: { value: lamps() },
    uFxFlat: { value: new Float32Array(FX_MAX) }, uFxTime: { value: 0 } };
  const coronas = new THREE.Group(), glow = coronaTexture(THREE);
  coronas.name = 'Effects: coronas';
  // the zone's view: the picture times its scale plus its fog (src x 1 + dst x src alpha), as the game's flash
  const hazeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2), hazeScene = new THREE.Scene();
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false,
    depthWrite: false, toneMapped: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor }));
  haze.position.z = -1;
  haze.frustumCulled = false;
  hazeScene.add(haze);
  let running = false, view = null, fog = null;
  let sight = new Map(), lastT = 0;            // each corona's line of sight ({ clear, shown }, by its lamp), the last frame's t

  // a surface material's shader (onBeforeCompile): its corners pan, its lightmap takes the lamps' changes
  function patch(shader) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>' + VERTEX_HEAD)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv += fract( fxPan * uFxTime );\n#endif')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvFxP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>' + FRAGMENT_HEAD)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>' + FRAGMENT_LIGHT);
  }
  // the lamps' light on the surfaces now: lights [{ L (light-reach.js's 12 numbers), level }], the first FX_MAX
  function setLamps(lights, gain) {
    const n = Math.min(FX_MAX, lights.length);
    uniforms.uFxN.value = n;
    for (let i = 0; i < n; i++) {
      const { L, level } = lights[i], spot = SPOT_LIGHTS.includes(L[7]);
      uniforms.uFxPos.value[i].set(L[0], L[2], L[1], L[6]);
      uniforms.uFxCol.value[i].set(2 * L[3] * gain, 2 * L[4] * gain, 2 * L[5] * gain, level - 1);
      uniforms.uFxDir.value[i].set(L[8], L[10], L[9], spot ? Math.cos(coneAngle(L[11])) : 2);
      uniforms.uFxFlat.value[i] = L[7] === NON_INCIDENCE ? 1 : 0;
    }
  }
  // list: [{ name (its lamp's), at (three's Vector3), colour (0xrrggbb), size (DrawScale) }], the CORONA_MAX nearest
  // the camera drawn: a sprite each, kept from frame to frame, over the walls (its line of sight says whether it shows);
  // dt: seconds since the last frame, frame: the drawn frame (whose lines of sight are looked along: coronaTurn)
  function setCoronas(list, dt, frame) {
    if (!coronas.parent) scene.add(coronas);
    const near = list.map((c) => [c.at.distanceToSquared(camera.position), c]).sort((a, b) => a[0] - b[0]).slice(0, CORONA_MAX).map(([, c]) => c);
    while (coronas.children.length < near.length) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, depthTest: false,
        sizeAttenuation: false, blending: THREE.AdditiveBlending }));
      s.raycast = () => {};
      coronas.add(s);
    }
    const look = new Set(coronaTurn(near.length, frame)), seen = new Map(), p00 = camera.projectionMatrix.elements[0];
    coronas.children.forEach((s, i) => {
      const c = near[i];
      s.visible = !!c;
      if (!c) return;
      const was = sight.get(c.name) || { clear: false, shown: 0 }, clear = look.has(i) ? !blocked(camera.position, c.at) : was.clear;
      const state = { clear, shown: coronaFade(was.shown, clear, dt) };
      seen.set(c.name, state);
      s.position.copy(c.at);
      s.scale.setScalar(coronaScale(c.size, p00));
      s.material.color.setHex(c.colour);
      s.material.opacity = state.shown;
    });
    sight = seen;
  }
  // zone: light-effects.js zoneView of the zone the camera is in (null: none)
  function setZone(next) {
    view = next;
    const want = next?.haze ? `${next.haze.colour}|${next.haze.distance}` : null;
    if (want === fog) return;
    fog = want;
    scene.fog = next?.haze ? new THREE.Fog(new THREE.Color().setRGB(...next.haze.colour, THREE.SRGBColorSpace), 0, next.haze.distance) : null;
  }
  // a frame of Effects: t (seconds since it started), lights, coronas, zone (as above), gain (the Lit view's brightness),
  // frame (the drawn frame since it started, from 1)
  function step(t, { lights, coronas: glows, zone, gain, frame = 0 }) {
    running = true;
    uniforms.uFxTime.value = t;
    setLamps(lights, gain);
    setCoronas(glows, Math.max(0, t - lastT), frame);
    lastT = t;
    setZone(zone);
  }
  // after the picture: the zone's view over it
  function drawHaze() {
    if (!running || !view || (view.scale === 1 && !view.fog.some((v) => v > 0))) return;
    haze.material.color.setRGB(...view.fog, THREE.SRGBColorSpace);
    haze.material.opacity = view.scale;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    try { renderer.render(hazeScene, hazeCamera); } finally { renderer.autoClear = auto; }
  }
  // Effects off (or not shown): nothing of it stays in the view
  function stop() {
    if (!running) return;
    running = false;
    uniforms.uFxN.value = 0;
    coronas.parent?.remove(coronas);
    sight = new Map();                         // the next start's coronas come in from nothing
    lastT = 0;
    setZone(null);
  }
  return { patch, step, drawHaze, stop, cacheKey: 'lightfx' + FX_MAX, get running() { return running; } };
}
