// Small billboard symbols for actors without a visible game model. Textures are
// shared by glyph; changing a light's colour only updates its SpriteMaterial.
import * as THREE from 'three';
import { classKind } from './scene-kinds.js';

const PATHS = Object.freeze({
  light: 'M46 79C46 68 30 64 30 43A34 34 0 0 1 98 43C98 64 82 68 82 79M46 82H82M48 93H80M55 104H73M57 79V59L48 49M71 79V59L80 49',
  camera: 'M22 41H79V94H22ZM79 57L109 42V94L79 78M33 27A12 12 0 1 0 57 27A12 12 0 1 0 33 27M58 27A12 12 0 1 0 82 27A12 12 0 1 0 58 27',
  walk: 'M61 20A9 9 0 1 0 79 20A9 9 0 1 0 61 20M65 39L54 66L76 79L87 109M55 66L42 109M64 42L80 61L99 65M61 44L42 49L30 69',
  sound: 'M23 49H43L68 29V99L43 79H23ZM83 46Q104 64 83 82M95 31Q128 64 95 97',
  trigger: 'M24 48V24H48M80 24H104V48M104 80V104H80M48 104H24V80M73 38L49 67H65L55 91L81 58H65Z',
  // a zone: the plan of a closed area (its rooms); a collision box: a box in wireframe
  zone: 'M16 24H70V52H112V104H16ZM16 66H46M70 52V76M84 78H98',
  water: 'M64 18C57 37 34 58 34 78A30 30 0 0 0 94 78C94 58 71 37 64 18ZM48 79Q48 94 63 96',
  weather: 'M34 77A22 22 0 0 1 31 33A28 28 0 0 1 85 38A20 20 0 1 1 96 77ZM38 91L30 108M65 91L57 108M92 91L84 108',
  exit: 'M56 22H27V106H56M76 43L99 64L76 85M47 64H99',
  flag: 'M34 108V23M34 27C57 10 72 47 98 27V69C72 89 57 50 34 69',
  logic: 'M45 26H83V53H45ZM19 84H47V108H19ZM81 84H109V108H81ZM64 53V70M33 84V70H95V84',
  timer: 'M22 70A42 42 0 1 0 106 70A42 42 0 1 0 22 70M64 44V70L82 82M52 16H76M64 16V28',
  effect: 'M64 17L75 49L107 60L75 71L64 103L53 71L21 60L53 49ZM100 19V37M91 28H109M25 89V109M15 99H35',
  box: 'M18 46H82V110H18ZM46 18H110V82H82M18 46L46 18M82 46L110 18M82 110L110 82',
  // within a kind, a picture of what the thing does (iconGlyph): a spotlight's beam, a sound effect's trigger, the
  // sound of a place JC walks into, rain, snow, the sky, the AI's points, where a teleporter arrives
  spotlight: 'M16 46H44V82H16ZM44 52L104 30M44 76L104 98M104 30Q116 64 104 98',
  soundfx: 'M16 49H34L56 31V97L34 79H16ZM98 22L76 62H98L82 106',
  soundzone: 'M12 36V12H36M92 12H116V36M116 92V116H92M36 116H12V92M36 54H50L68 40V88L50 74H36ZM80 50Q94 64 80 78',
  rain: 'M34 77A22 22 0 0 1 31 33A28 28 0 0 1 85 38A20 20 0 1 1 96 77ZM38 91L30 108M65 91L57 108M92 91L84 108',
  snow: 'M34 68A22 22 0 0 1 31 24A28 28 0 0 1 85 29A20 20 0 1 1 96 68ZM31 92H45M34 86L42 98M42 86L34 98M57 104H71M60 98L68 110M68 98L60 110M83 92H97M86 86L94 98M94 86L86 98',
  sky: 'M10 92H118M34 92A30 30 0 0 1 94 92M64 22V44M24 50L38 62M104 50L90 62M40 108H88',
  path: 'M16 96A10 10 0 1 0 36 96A10 10 0 1 0 16 96M54 34A10 10 0 1 0 74 34A10 10 0 1 0 54 34M92 90A10 10 0 1 0 112 90A10 10 0 1 0 92 90M32 88L58 43M71 42L97 81M36 95L92 91',
  patrol: 'M28 64A36 36 0 0 1 94 44M94 44L96 24M94 44L74 44M100 64A36 36 0 0 1 34 84M34 84L32 104M34 84L54 84',
  wander: 'M10 64Q64 12 118 64Q64 116 10 64ZM50 64A14 14 0 1 0 78 64A14 14 0 1 0 50 64',
  hide: 'M64 14L104 28V60C104 88 86 104 64 114C42 104 24 88 24 60V28ZM46 62Q64 76 82 62',
  arrive: 'M22 96A42 14 0 1 0 106 96A42 14 0 1 0 22 96M64 16V82M44 62L64 82L84 62',
  // particles (Objects > Effects): rising smoke, drifting mist or steam, a burst of sparks
  smoke: 'M40 110C22 90 58 78 40 58C26 42 46 32 40 18M74 110C56 90 92 78 74 58C60 42 80 32 74 18M104 104C94 92 110 84 102 72',
  mist: 'M14 44Q34 30 54 44T94 44T114 44M14 68Q34 54 54 68T94 68T114 68M14 92Q34 78 54 92T94 92T114 92',
  sparks: 'M64 64L64 18M64 64L102 30M64 64L112 70M64 64L92 106M64 64L36 106M64 64L16 70M64 64L26 30',
});
const textures = new Map();
let iconSize = 32;          // units across: the 3D view's Show menu sets it (scene-kinds.js ICON_SIZE)
// what a class makes, by a word of its name, as a picture: water, weather, else a zone (null: none of these)
const MAKES = Object.freeze([['water', /water|lava|slime/], ['weather', /snow|precipitation|rain|skyzone/], ['zone', /zone/]]);
const makes = (name) => MAKES.find(([, word]) => word.test(name))?.[0] || null;
const nameOf = (cls) => String(cls || '').split('.').pop().toLowerCase();       // without its package, in lower case

export function viewportIconKind(actor) {
  const cls = nameOf(actor.cls);
  if (actor.kind === 'light' || /^(light|spotlight|triggerlight)$/.test(cls)) return 'light';
  // a sound, a camera or a zone as the Show menu has them (scene-kinds.js), so that its row hides these icons and no
  // others; a zone of water or of weather has a picture of its own
  const own = classKind(cls, actor.kind);
  if (own === 'zone') return makes(cls);
  if (own) return own;
  if (/effectpoint|particle/.test(cls)) return 'effect';
  if (/triggerbox/.test(cls)) return 'box';
  if (actor.kind === 'path' || /^(pathnode|patrolpoint|wanderpoint|hidepoint|liftcenter|liftexit|jumpdest)$/.test(cls)) return 'walk';
  if (/teleport|mapexit|levelchange/.test(cls)) return 'exit';
  if (/playerstart|flag|objective/.test(cls)) return 'flag';
  if (/trigger|collision/.test(cls)) return 'trigger';
  if (/timer/.test(cls)) return 'timer';
  return 'logic';
}

// The Browser uses the same symbols as the viewport for invisible actors. A real
// model thumbnail still replaces this fallback whenever the game supplies one. A class with no symbol of its own
// shows what it makes (a SnowPrecipitator the weather, WaterDrips water, a RevLightningZoneCreator a zone): in the 3D
// view it keeps the icon of its row of the Show menu, which is not Zones (the icon and the row agree there).
// preset: the properties it is placed with (the Browser's two sound effects, the map exit and the arrival point)
export function objectPreviewIcon(cls, preset = null) {
  let kind = viewportIconKind({ cls });
  if (kind === 'logic') kind = makes(nameOf(cls)) || (/script|dispatcher|counter|event|logic/i.test(cls) ? 'logic' : 'box');
  const glyph = iconGlyph(cls, kind, (name) => preset?.[name]);
  return `<svg class="object-preview-icon" data-icon="${glyph}" viewBox="0 0 128 128" width="48" height="48" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${PATHS[glyph]}"/></svg>`;
}

// The picture of a thing within its kind (the kind stays what the Show menu goes by): what it does, by its class and,
// for one class placed two ways, a property (prop(name): its value as the map has it, undefined: the class's default).
// Before, a light and a spotlight, the three ways of placing a sound, rain, snow and the sky, the four kinds of AI
// points had one picture each (Gabby, 2 Nov 2026).
const isTrue = (v) => /^true$/i.test(String(v ?? '').replace(/"/g, '').trim());
const isFalse = (v) => /^false$/i.test(String(v ?? '').replace(/"/g, '').trim());
const AI_POINTS = Object.freeze({ pathnode: 'path', patrolpoint: 'patrol', wanderpoint: 'wander', hidepoint: 'hide' });
export function iconGlyph(cls, kind, prop = () => undefined) {
  const n = nameOf(cls);
  if (kind === 'light') return /spotlight/.test(n) ? 'spotlight' : 'light';
  if (kind === 'sound') return /soundfx/.test(n) ? (isTrue(prop('bOnTouch')) ? 'soundzone' : 'soundfx') : 'sound';
  if (kind === 'weather') return /snow/.test(n) ? 'snow' : /skyzone/.test(n) ? 'sky' : 'rain';
  if (kind === 'walk') return AI_POINTS[n] || 'walk';
  if (kind === 'effect' && /particle/.test(n)) {          // particles: by their texture and the way they go
    if (/spark|fire|flare/i.test(String(prop('particleTexture') ?? ''))) return 'sparks';
    return Number(String(prop('riseRate') ?? '1').replace(/"/g, '')) < 0 ? 'mist' : 'smoke';
  }
  if (kind === 'exit' && /teleport/.test(n) && isFalse(prop('bEnabled'))) return 'arrive';     // where one arrives
  return PATHS[kind] ? kind : 'logic';
}

export function viewportIconSpec(actor, color, prop) {
  const kind = viewportIconKind(actor);
  return { kind, glyph: iconGlyph(actor.cls, kind, prop), color: Number.isFinite(color) ? Math.max(0, Math.min(0xffffff, color)) : 0xc58cff, size: iconSize };
}

// The icons' size (the Show menu's slider): the icons made from now on, and these at once (a proxy's body each:
// only the icons among them change)
export function setViewportIconSize(size, bodies = []) {
  iconSize = size;
  for (const b of bodies) if (b?.userData?.viewportIcon) b.scale.set(size, size, 1);
}

function iconTexture(kind) {
  if (textures.has(kind)) return textures.get(kind);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const path = new Path2D(PATHS[kind]);
  ctx.lineJoin = ctx.lineCap = 'round';
  // A dark border remains visible against bright walls without hiding the room.
  ctx.strokeStyle = '#101217'; ctx.lineWidth = 15; ctx.stroke(path);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7; ctx.stroke(path);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textures.set(kind, texture);
  return texture;
}

export function createViewportIcon(actor, color, prop) {
  const spec = viewportIconSpec(actor, color, prop);
  const material = new THREE.SpriteMaterial({ map: iconTexture(spec.glyph), color: spec.color,
    transparent: true, alphaTest: 0.08, depthTest: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(spec.size, spec.size, 1);
  sprite.userData.viewportIcon = spec.kind;
  return sprite;
}

export function disposeViewportIcons(root) {
  root.traverse((object) => {
    if (object.userData.viewportIcon) object.material.dispose();
  });
  // Shared glyph textures live for the page lifetime. Sprite geometry
  // is shared by Three.js too: neither should be disposed with an individual actor.
}
