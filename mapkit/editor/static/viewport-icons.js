// Small billboard symbols for actors without a visible game model. Textures are
// shared by glyph; changing a light's colour only updates its SpriteMaterial.
import * as THREE from 'three';

const PATHS = Object.freeze({
  light: 'M46 79C46 68 30 64 30 43A34 34 0 0 1 98 43C98 64 82 68 82 79M46 82H82M48 93H80M55 104H73M57 79V59L48 49M71 79V59L80 49',
  camera: 'M22 41H79V94H22ZM79 57L109 42V94L79 78M33 27A12 12 0 1 0 57 27A12 12 0 1 0 33 27M58 27A12 12 0 1 0 82 27A12 12 0 1 0 58 27',
  walk: 'M61 20A9 9 0 1 0 79 20A9 9 0 1 0 61 20M65 39L54 66L76 79L87 109M55 66L42 109M64 42L80 61L99 65M61 44L42 49L30 69',
  sound: 'M23 49H43L68 29V99L43 79H23ZM83 46Q104 64 83 82M95 31Q128 64 95 97',
  trigger: 'M24 48V24H48M80 24H104V48M104 80V104H80M48 104H24V80M73 38L49 67H65L55 91L81 58H65Z',
  zone: 'M25 44L64 22L103 44V87L64 109L25 87ZM25 44L64 66L103 44M64 66V109M43 55V34M84 55V34',
  water: 'M64 18C57 37 34 58 34 78A30 30 0 0 0 94 78C94 58 71 37 64 18ZM48 79Q48 94 63 96',
  weather: 'M34 77A22 22 0 0 1 31 33A28 28 0 0 1 85 38A20 20 0 1 1 96 77ZM38 91L30 108M65 91L57 108M92 91L84 108',
  exit: 'M56 22H27V106H56M76 43L99 64L76 85M47 64H99',
  flag: 'M34 108V23M34 27C57 10 72 47 98 27V69C72 89 57 50 34 69',
  logic: 'M45 26H83V53H45ZM19 84H47V108H19ZM81 84H109V108H81ZM64 53V70M33 84V70H95V84',
  timer: 'M22 70A42 42 0 1 0 106 70A42 42 0 1 0 22 70M64 44V70L82 82M52 16H76M64 16V28',
  effect: 'M64 17L75 49L107 60L75 71L64 103L53 71L21 60L53 49ZM100 19V37M91 28H109M25 89V109M15 99H35',
  box: 'M24 43L64 21L104 43V87L64 109L24 87ZM24 43L64 65L104 43M64 65V109',
});
const textures = new Map();

export function viewportIconKind(actor) {
  const cls = String(actor.cls || '').split('.').pop().toLowerCase();
  if (actor.kind === 'light' || /^(light|spotlight|triggerlight)$/.test(cls)) return 'light';
  if (/camera|cutscene|interpolationpoint/.test(cls)) return 'camera';
  if (/effectpoint/.test(cls)) return 'effect';
  if (/triggerbox/.test(cls)) return 'box';
  if (actor.kind === 'path' || /^(pathnode|patrolpoint|wanderpoint|hidepoint|liftcenter|liftexit|jumpdest)$/.test(cls)) return 'walk';
  if (/sound|music/.test(cls)) return 'sound';
  if (/water|lava|slime/.test(cls)) return 'water';
  if (/snow|precipitation|rain|skyzone/.test(cls)) return 'weather';
  if (/zone/.test(cls)) return 'zone';
  if (/teleport|mapexit|levelchange/.test(cls)) return 'exit';
  if (/playerstart|flag|objective/.test(cls)) return 'flag';
  if (/trigger|collision/.test(cls)) return 'trigger';
  if (/timer/.test(cls)) return 'timer';
  return 'logic';
}

// The Browser uses the same symbols as the viewport for invisible actors. A real
// model thumbnail still replaces this fallback whenever the game supplies one.
export function objectPreviewIcon(cls) {
  let kind = viewportIconKind({ cls });
  if (kind === 'logic' && !/script|dispatcher|counter|event|logic/i.test(cls)) kind = 'box';
  return `<svg class="object-preview-icon" data-icon="${kind}" viewBox="0 0 128 128" width="48" height="48" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${PATHS[kind]}"/></svg>`;
}

export function viewportIconSpec(actor, color) {
  return { kind: viewportIconKind(actor), color: Number.isFinite(color) ? Math.max(0, Math.min(0xffffff, color)) : 0xc58cff, size: 32 };
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

export function createViewportIcon(actor, color) {
  const spec = viewportIconSpec(actor, color);
  const material = new THREE.SpriteMaterial({ map: iconTexture(spec.kind), color: spec.color,
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
