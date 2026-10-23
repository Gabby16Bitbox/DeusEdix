// DeusEdix map editor: 3D view of the last build, objects and structures moved like in UE5.
// Unreal coordinates (X, Y, Z up, left-handed) <-> three.js (Y up): (x, y, z) -> (x, z, y).
import { AREA_VERBS, areaMembers, areaRecipients } from './connect-area.js';
import { BLOCK_WHEN, BLOCK_VERBS, TIMER_VERBS, EFFECT_ON, blockDefaults, blockWhenText, blockActText, blockRowsHtml,
  effectOptions, effectOptionText, withExact, usableDefault, usableHtml, usableChange, usableSummary } from './interaction-blocks.js';
import { createEffectPointGizmo, setEffectPointTilt, stepEffectPreviews, effectPreviewsActive, disposeEffectPoint, isEffectPoint,
  fxPreviewOf, fxPreviewKind, fxEffectsOn, FX_PREVIEW_KINDS } from './effect-point.js';
import { PLACE_MODES, loadPlaceMode, savePlaceMode, placeModeLabel, normalToRotation, rotationToVector, stickPoint, isFloor, signedRot } from './surface-stick.js';
import { createRotations } from './rotation.js';
import { createSurfacePlacement } from './surface-placement.js';
import { createSelectionOutline } from './selection-outline.js';
import { createTextureScale, stretchOnResize } from './texture-scale.js';
import * as THREE from 'three';
import { PATH_KINDS, floorField, buildPathView, buildRouteView, stepPathView, findRoute, nearestPoint, loosePoints, pathStrips } from './ai-paths.js';
import { createNavmeshView, bakePolys } from './navmesh.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createSurfaceTools } from './surface-ui.js';
import { createStartScreen } from './start-screen.js';
import { createSoundBrowser } from './sound-browser.js';
import { createViewportIcon, disposeViewportIcons, objectPreviewIcon } from './viewport-icons.js';
import { createActorOverlayTracker } from './actor-overlays.js';
import { isCylinder, updateCollisionVolume } from './collision-volume.js';
import { createProjectHub, projectStorageKey, readProjectMapPrefs, unsavedProjectTools, isCustomProject, isTrainingProject } from './projects.js';
import { mountStateField, parseFate, stateLabel } from './state-editor.js';
import { characterSections, playerSection } from './behaviours.js';
import { mountPlayStates } from './play-state.js';
import { editorIcon } from './editor-icons.js';
import { drawText, fontFamilies, fontOptions, importFont } from './text-style.js';
import { TUTORIAL_SCRIPT, tutorialSession, installTutorialSession, isTemporaryTutorial, clearTutorialViewPreferences } from './tutorial-session.js';
import { createAutosave, normalizeAutosaveSettings } from './autosave.js';
import { createSaveQueue } from './save-state.js';
import { createGameView } from './game-view.js';
import { usablePlayerStarts, PLAYER_START_REQUIRED } from './player-start.js';
import {mapPlayerFields, wireProjectPlayer, applyMapPlayer} from './player-profiles.js';
import { createPrefabBrowser } from './prefab-browser.js';
import { moverFields, moverPanel, wireMoverPanel } from './mover-piece.js';
import { createPiecesBrowser } from './pieces-browser.js';
import { collectPrefabSelection } from './prefab-selection.js';
import { createTextureTransfer } from './texture-transfer.js';
import { createSurfaceTexturePreview } from './surface-texture-preview.js';
import { createDrawTools, DRAW_LABELS } from './draw-tools.js';
import { createSkyTool } from './sky-tool.js';
import { createMapPose } from './map-pose.js';
import { createViewportToolbar } from './viewport-toolbar.js';
import { createTexturePicker } from './texture-picker.js';
import { BLOCK_SHAPES, ROUND_SHAPES, blockShape, blockLabel, blockGeometry, blockOptions } from './block-shapes.js';
import { createSceneTextures } from './scene-textures.js';

import { withPublishedLayout, exerciseOnly } from './published-layout.js';

import { scriptTag, originalTag, validScriptTag, tagMatches, TAG_VERBS } from './object-tags.js';

installTutorialSession(window);

const $ = (s) => document.querySelector(s);
const T = (a) => new THREE.Vector3(a[0], a[2], a[1]);          // Unreal -> three
const UE = (v) => [r1(v.x), r1(v.z), r1(v.y)];                  // three -> Unreal
const r1 = (x) => Math.round(x * 10) / 10;
const YAW = 65536;
const yawToRad = (y) => -y * 2 * Math.PI / YAW;                 // UE yaw -> three rotation.y
const radToYaw = (r) => (Math.round(-r * YAW / (2 * Math.PI)) % YAW + YAW) % YAW;
const PF = { masked: 2, translucent: 4, modulated: 64, fake: 128, unlit: 4194304 };
const EMPTY = () => ({ moved: {}, deleted: {}, added: [], boxes: [], groups: {}, copies: [], prefabs: [], nests: [], unnest: [] });

let script = null, mapName = null, mapKind = 'script', baseActors = [], palette = [], texList = [], texFull = {};
let startScreen = null, mapList = [], mapLoading = false;
let hierFolderOn = null, hierRenaming = null;   // the Hierarchy: an empty folder chosen; the folder being named
let projectHub = null, projectContext = window.__projectContext?.id ? window.__projectContext : null;
let edits = EMPTY();
let publishedLayout = null;
let bakedObjectTags = {};
let editRevision = 0;
let mapGeneration = 0, lastEditingInput = 0;
const mapSaveQueue = createSaveQueue();
let autosave = null;
let gameView = null;
let undo = [], dirty = false, selected = null, placing = null, snap = true;
let vpBar = null;                  // the 3D view's toolbar (viewport-toolbar.js)
let showIcons = true;              // the icons of lights, AI paths and logic points (its last button)
try { showIcons = localStorage.getItem('deusedix.viewIcons') !== '0'; } catch { /* no storage */ }
let soundBrowser = null, soundCat = null;
let inspectorPin = null, inspectorPinBar = null;
let textureTransfer = null, surfaceTexturePreview = null;
const texturePreviewInfo = new Map(), texturePreviewPending = new Map();
let structures = {};          // name -> {label, category, pivot, placement, actors, copy_of, obj, ...}
let actorStruct = {};         // actor name -> structure name
let meshLib = {}, mapTex = {}, paletteLib = {}, paletteTex = {}, paletteHas = new Set(), paletteLoading = {};
let moveStart = null;         // structure being moved: its pose and its members at the start
let inspectorDrag = null;     // a coordinate label held in the Inspector (one undo per gesture)
let propertySlider = null;    // temporary property preview; committed once when the slider is released
const worldMeshes = [];
const collisionVolumes = new Set();

// ---------------------------------------------------------------- three.js scene
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
const actorOverlays = createActorOverlayTracker(scene);
scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--viewport').trim() || '#0a0d16');
const camera = new THREE.PerspectiveCamera(75, 1, 2, 120000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 0.55);
sun.position.set(0.4, 1, 0.25);
scene.add(sun);
const world = new THREE.Group(), proxies = new THREE.Group();
scene.add(world, proxies);
const tc = new TransformControls(camera, canvas);
tc.setSize(0.9);
scene.add(tc);
const ghost = new THREE.Group();
const ghostBody = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16),
  new THREE.MeshBasicMaterial({ color: 0x5aa2ff, transparent: true, opacity: 0.35, depthTest: false }));
ghost.add(ghostBody);
ghost.visible = false;
scene.add(ghost);
const outline = createSelectionOutline(THREE);
outline.visible = false;
scene.add(outline);

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // the game's field of view is horizontal (86 degrees in Gabby's settings); three.js wants the vertical one
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(86) / 2) / camera.aspect));
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
// the side panels get wider or narrower by dragging their inner edge, the browser at the bottom
// taller or lower by dragging its top edge (remembered in this browser)
for (const [id, side, min, max] of [['lgrip', 'lw', 200, 520], ['rgrip', 'rw', 240, 600], ['bgrip', 'bh', 90, 760]]) {
  try { const v = localStorage.getItem('ucmap.' + side); if (v) document.documentElement.style.setProperty('--' + side, v); } catch (e) { /* no storage */ }
  const grip = document.getElementById(id);
  if (!grip) continue;
  grip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    grip.classList.add('on');
    const move = (ev) => {
      const w = Math.max(min, Math.min(max, side === 'lw' ? ev.clientX : side === 'rw' ? window.innerWidth - ev.clientX
        : window.innerHeight - ev.clientY));
      document.documentElement.style.setProperty('--' + side, w + 'px');
      resize();
      observeThumbs();
    };
    const up = () => {
      grip.classList.remove('on');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      try { localStorage.setItem('ucmap.' + side, getComputedStyle(document.documentElement).getPropertyValue('--' + side).trim()); } catch (e) { /* no storage */ }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

// ---------------------------------------------------------------- camera (UE5 style)
const cam = { yaw: Math.PI / 2, pitch: 0, look: false, keys: {}, speed: 600, sens: 0.0035, invertY: false };   // Settings (menubar.js)
function forward() {
  return new THREE.Vector3(Math.cos(cam.pitch) * Math.cos(cam.yaw), Math.sin(cam.pitch), Math.cos(cam.pitch) * Math.sin(cam.yaw));
}
function placeCamera(posUE, yawUE, pitch = -0.15) {
  camera.position.copy(T(posUE));
  cam.yaw = yawUE * 2 * Math.PI / YAW;
  cam.pitch = pitch;
}
let drag = null, transformGesture = false;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// keys and buttons released while the page had no focus (Alt+Tab, leaving the editor) never send
// their "up": forget them, or the camera keeps flying on its own the next time
function resetInput() {
  cam.look = false;
  for (const k of Object.keys(cam.keys)) cam.keys[k] = false;
  drag = null;
}
window.addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
canvas.addEventListener('lostpointercapture', () => { if (cam.look) resetInput(); });
canvas.addEventListener('pointerdown', (e) => {
  // a click in the 3D view takes the keys back from the text fields (search, coordinates)
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  if (e.button === 2) { cam.look = true; canvas.setPointerCapture(e.pointerId); }
  if (e.button === 1) { drag = { x: e.clientX, y: e.clientY }; e.preventDefault(); }
  if (e.button === 0) drag = { x: e.clientX, y: e.clientY, click: true, marquee: (e.ctrlKey || e.shiftKey) && !placing };
});
canvas.addEventListener('pointermove', (e) => {
  if (cam.look) {
    cam.yaw += e.movementX * cam.sens;
    cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - e.movementY * cam.sens * (cam.invertY ? -1 : 1)));
  } else if (drag && !drag.click && e.buttons & 4) {
    const f = forward(), right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    camera.position.addScaledVector(right, -(e.clientX - drag.x) * 2).addScaledVector(up, (e.clientY - drag.y) * 2);
    drag.x = e.clientX; drag.y = e.clientY;
  }
  if (placing) { lastPlacingMove = e; movePlacing(e); }
  if (drag && drag.marquee && !tc.dragging && e.buttons & 1 && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) {
    if (!marquee) { marquee = document.createElement('div'); marquee.style.cssText = 'position:fixed;border:1px dashed #ffd25a;background:#ffd25a18;pointer-events:none;z-index:6'; document.body.appendChild(marquee); }
    Object.assign(marquee.style, { left: Math.min(drag.x, e.clientX) + 'px', top: Math.min(drag.y, e.clientY) + 'px', width: Math.abs(e.clientX - drag.x) + 'px', height: Math.abs(e.clientY - drag.y) + 'px' });
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button === 2) {
    cam.look = false;
    for (const k of Object.keys(cam.keys)) cam.keys[k] = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }
  if (marquee) { marquee.remove(); marquee = null; if (drag) marqueeSelect(drag.x, drag.y, e.clientX, e.clientY); drag = null; return; }
  if (e.button === 0 && !transformGesture && drag && drag.click && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5 && !tc.dragging) {
    if (placing) finishPlacing(e); else pick(e);
  }
  drag = null; transformGesture = false;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.position.addScaledVector(forward(), -Math.sign(e.deltaY) * (e.shiftKey ? 320 : 96));
}, { passive: false });

const clock = new THREE.Clock();
let PACKAGE = 'UnatcoContinues';        // the editor's own package (the server says which: settings.py)
let MODELS_PKG = 'UCModels';            // the imported models' package (settings.py)
// what the player reads for it: a project's package has a made-up name (DXP_<id>Models), so say "your models"
const modelsWhere = () => (/^DXP_/i.test(MODELS_PKG) ? "this project's own models" : `the package ${MODELS_PKG}`);
let STANDALONE = false;                 // DeusEdix installed: no UNATCO route, no mission states of the mod
// The view is drawn every frame only while something moves: the mouse or a key (and 1.5 s after),
// the camera flying, a gizmo drag, an animation or a cutscene playing (cutscene.js calls wake()).
// Left alone it is drawn 4 times a second, enough for what changes by itself (textures arriving, a
// build): idle, the editor no longer redraws the same picture 60-144 times a second.
let awakeUntil = 0, lastDraw = 0;
function wake(ms = 1500) { awakeUntil = Math.max(awakeUntil, performance.now() + ms); }
for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'resize'])
  window.addEventListener(ev, () => wake(), { capture: true, passive: true });
function animate(now) {
  requestAnimationFrame(animate);
  if (!(now < awakeUntil || cam.look || previewing || tc.dragging || (anim && anim.playing) || effectPreviewsActive() || showPaths) && now - lastDraw < 250) return;
  lastDraw = now;
  const dt = Math.min(clock.getDelta(), 0.1);
  if (cam.look) {
    const k = cam.keys, sp = cam.speed * (k.shift ? 3 : 1) * dt;
    const f = forward(), right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    if (k.w) camera.position.addScaledVector(f, sp);
    if (k.s) camera.position.addScaledVector(f, -sp);
    if (k.d) camera.position.addScaledVector(right, sp);
    if (k.a) camera.position.addScaledVector(right, -sp);
    if (k.e) camera.position.y += sp;
    if (k.q) camera.position.y -= sp;
  }
  camera.lookAt(camera.position.clone().add(forward()));
  if (cam.roll) camera.rotateZ(-cam.roll);          // looking through a cutscene camera with a roll (cutscene.js)
  stepPreview(dt);
  stepEffectPreviews(proxies, dt, fxWant);
  if (showPaths) stepPathView(dt);
  if (outline.visible && selected) outline.setFromObject(selected);
  drawMultiBoxes();
  updateHoleCut();
  actorOverlays.sync();
  for (const p of collisionVolumes) {
    if (!p.parent) collisionVolumes.delete(p);
    else updateCollisionVolume(p, actorProp);
  }
  renderer.render(scene, camera);
  updateLinkEdges();
}

// ---------------------------------------------------------------- loading
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function busy(text) {
  $('#busy').style.display = text ? 'flex' : 'none';
  $('#busytext').textContent = text || '';
}
function status(t, cls = '') { $('#status').textContent = t; $('#status').className = cls; }
function log(lines, cls = '') {
  const el = $('#log');
  el.innerHTML = (Array.isArray(lines) ? lines : [lines]).map((l) => `<div class="${cls}">${escapeHtml(l)}</div>`).join('') + el.innerHTML;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function loadMaps(want) {
  const info = await api('/api/map_browser');
  if (info.project) {
    projectContext = { ...projectContext, ...info.project };
    startScreen?.setProject(projectContext);
  }
  const maps = mapList = info.maps;
  STANDALONE = !!info.standalone;
  // the project's own packages known before a map is open (My models and Import listed none: Crypt Test, 20 Oct 2026)
  const pkgBefore = MODELS_PKG;
  PACKAGE = info.package || PACKAGE; MODELS_PKG = info.models_package || MODELS_PKG;
  if (MODELS_PKG !== pkgBefore && (bottomTab === 'models' || bottomTab === 'mymodels')) buildModels();
  startScreen?.setMaps(info);
  const groups = [['script', 'Script-built maps'], ['mod', 'Mod maps (maps\\)'], ['game', 'Original maps (you edit a copy)']];
  $('#map').innerHTML = '<option value="">Open a map...</option>' + groups.map(([k, label]) => {
    const items = maps.filter((m) => (m.kind || 'script') === k);
    if (!items.length) return '';
    return `<optgroup label="${label}">` + items.map((m) => `<option value="${m.script}">${m.map}${k === 'script' && !m.built ? ' (not built yet)' : ''}</option>`).join('') + '</optgroup>';
  }).join('');
  $('#map').value = script || '';
  if (want && maps.some(m => m.script === want)) return loadScene(want, true);
  if (!script && !gameView?.active) status(projectContext ? 'Choose a map to begin.' : 'Choose a project to begin.');
  return maps;
}

async function saveWorkspace({ automatic = false, key = autosaveKey() } = {}) {
  if (key !== autosaveKey() || (automatic && temporaryTutorial())) return false;
  if (dirty && await save({ automatic }) === false) return false;
  if (key !== autosaveKey() || (automatic && (mapLoading || temporaryTutorial()))) return false;
  if (window.__story?.dirty && await window.__story.save({ automatic }) === false) return false;
  if (!automatic && key === autosaveKey() && !dirty && !window.__story?.dirty) autosave?.saved(key);
  return key === autosaveKey();
}

async function confirmProjectLeave() {
  if (mapLoading || $('#busy')?.style.display === 'flex') return false;
  if (gameView?.active && !(await gameView.stop())) return false;
  if (temporaryTutorial()) return true;
  const tools = unsavedProjectTools();
  if (tools.length && !confirm(`Unsaved changes in ${tools.join(', ')} will be discarded when you switch projects. Continue?`)) return false;
  return startScreen.confirmLeave();
}

async function openMap(s) {
  if (!s) { startScreen.openPicker(); return false; }
  if (mapLoading || !mapList.some(m => m.script === s)) return false;
  if (s === script) return true;
  if (gameView?.active && !(await gameView.stop())) return false;
  if (!(await startScreen.confirmLeave())) { $('#map').value = script || ''; return false; }
  const item = mapList.find(m => m.script === s);
  if (item.kind === 'script' && !item.built && !isTemporaryTutorial(projectContext, s)) {
    mapLoading = true; busy('Building this map for the first time...');
    try {
      const r = await api('/api/build?script=' + encodeURIComponent(s), {});
      log(r.lines, r.ok ? '' : 'bad');
      if (!r.ok) throw new Error('The map could not be built. See Messages.');
      item.built = true;
    } finally { mapLoading = false; busy(''); }
  }
  return loadScene(s, true);
}

function temporaryTutorial() { return isTemporaryTutorial(projectContext, script); }
function resetTutorialView() {
  clearTutorialViewPreferences(localStorage, projectContext?.id);
  viewStateMap = null; objectViewState = { hidden: new Set(), locked: new Set() };
}
async function endTutorialSession() {
  if (!temporaryTutorial() && !tutorialSession.token && !tutorialSession.preparing) return;
  // Keep the map and guide untouched if the server cannot close it yet (for
  // example while the game still uses this session's temporary packages).
  try { await tutorialSession.end(); }
  catch (e) { status(e.message, 'warn'); log(e.message, 'warn'); throw e; }
  if (window.__texedit?.state?.open) window.__texedit.close(true);
  if (window.__studio?.state?.open) window.__studio.close(true);
  window.__characters?.close(true);
  window.__tutorial?.forget();
  resetTutorialView();
}
async function clearMap() {
  if (mapLoading) return false;
  if (gameView?.active && !(await gameView.stop())) return false;
  mapLoading = true;
  try {
  textureTransfer?.cancel(); surfaceTexturePreview?.restore(); texturePreviewInfo.clear(); texturePreviewPending.clear();
  if (temporaryTutorial() || tutorialSession.token || tutorialSession.preparing) await endTutorialSession();
  window.__tutorial?.stop(); window.__cutscene?.close(); window.__story?.reset();
  closeAnim(); stopPreview(); resetInput(); cancelPlacing(); select(null); clearLinks();
  disposeGroup(pathLines); disposeGroup(routeLines); disposeGroup(multiBoxes);
  world.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  world.clear(); for (const q of proxies.children) disposeEffectPoint(q); disposeViewportIcons(proxies); proxies.clear(); worldMeshes.length = 0; clearMaterials();
  script = null; mapName = null; baseActors = []; structures = {}; actorStruct = {}; edits = EMPTY(); undo = []; dirty = false;
  mapGeneration++;
  publishedLayout = null;
  bakedObjectTags = {};
  inspectorPin = null;
  pathData = null; geoFaces = []; groupPivot.userData.members = []; groupPivot.userData.keys = null;
  for (const id of ['hier','structs','details','changes']) { const el = document.getElementById(id); if (el) el.innerHTML = ''; }
  for (const id of ['playbox','newbox','linkbox','mapbox','soundbox','checkbox','logicbox','pkgbox','mimportbox','shot']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  $('#map').value = ''; status('Choose a map to begin.'); wake();
  refreshInspectorPin();
  return true;
  } finally { mapLoading = false; }
}

async function loadScene(s, resetCamera) {
  if (mapLoading) return false;
  const previousTutorial = temporaryTutorial(), sessionRevision = tutorialSession.revision;
  mapLoading = true;
  busy('Loading map...');
  try {
    const j = await api('/api/scene?script=' + encodeURIComponent(s));
    if (s === TUTORIAL_SCRIPT && isTrainingProject(projectContext)) {
      if (sessionRevision !== tutorialSession.revision && tutorialSession.token !== j.tutorialSession) {
        if (j.tutorialSession) await tutorialSession.end({ session: j.tutorialSession }).catch(() => {});
        return false;
      }
      if (!j.tutorialSession) throw new Error('Training did not return a temporary session.');
      const fresh = j.tutorialSession !== tutorialSession.token;
      tutorialSession.adopt(j.tutorialSession);
      if (fresh) {
        resetTutorialView();
        window.__tutorial?.forget();
      }
    }
    if (previousTutorial && s !== TUTORIAL_SCRIPT) await endTutorialSession();
    textureTransfer?.cancel(); surfaceTexturePreview?.restore(); texturePreviewInfo.clear(); texturePreviewPending.clear();
    window.__story?.reset(); window.__cutscene?.close(); closeAnim(); stopPreview(); resetInput(); cancelPlacing(); soundBrowser?.clearSelection(false);
    if (script !== s) window.__tutorial?.stop();
    script = j.script; mapName = j.map; baseActors = j.actors; palette = j.palette; mapKind = j.kind || 'script';
    mapGeneration++;
    inspectorPin = null;
    PACKAGE = j.package || PACKAGE; MODELS_PKG = j.models_package || MODELS_PKG; STANDALONE = !!j.standalone;
    publishedLayout = j.publishedLayout || null;
    bakedObjectTags = j.bakedObjectTags || {};
    edits = Object.assign(EMPTY(), withPublishedLayout(j.edits, publishedLayout));
    builtScale = {};                       // objects scaled by edits that are already in the map shown
    if (j.kind === 'script' || !j.kind || j.built)
      for (const [n, m] of Object.entries(edits.moved || {})) if (m && m.scale) builtScale[n] = m.scale;
    builtBoxes = new Map((j.kind === 'script' || !j.kind || j.built ? edits.boxes || [] : []).map((b) => [b.name, boxSig(b)]));
    if (Array.isArray(edits.deleted)) edits.deleted = Object.fromEntries(edits.deleted.map((n) => [n, {}]));
    undo = []; dirty = false; selected = null;
    clearMaterials();
    // the sky colour Sky & time of day gave the background belongs to the map it was made on
    scene.background.set(getComputedStyle(document.documentElement).getPropertyValue('--viewport').trim() || '#0a0d16');
    const [lib, plib] = await Promise.all([fetch(j.meshes).then((r) => r.ok ? r.json() : {}), fetch(j.palette_meshes).then((r) => r.ok ? r.json() : {}), loadFactions()]);
    meshLib = lib || {};
    paletteTex = (plib && plib._textures) || {};
    paletteHas = new Set((plib && plib.classes) || []);
    paletteLib = {}; paletteLoading = {};
    await loadGeometry(j.geometry, j.structures || {});
    pathData = j.paths ? await fetch(j.paths).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
    drawPaths();
    buildPalette();
    buildStructList();
    rebuildProxies();
    if (resetCamera) {
      const start = baseActors.find((a) => a.cls === 'PlayerStart');
      if (start) {                      // behind JC's start, looking the way he looks
        const yr = (start.rot[1] || 0) * 2 * Math.PI / YAW;
        // never through a wall: a start near one (a new map's room, 256 from its wall) put the camera behind it
        const eye = T([start.loc[0], start.loc[1], start.loc[2] + 160]), back = T([-Math.cos(yr), -Math.sin(yr), 0]).normalize();
        const hit = new THREE.Raycaster(eye, back, 0, 260).intersectObjects(world.children, true)[0];
        const dist = hit ? Math.max(0, hit.distance - 24) : 260;
        placeCamera([start.loc[0] - dist * Math.cos(yr), start.loc[1] - dist * Math.sin(yr), start.loc[2] + 160], start.rot[1], -0.3);
      }
    }
    showDetails();
    status(`${mapName}: ${baseActors.length} objects, ${Object.keys(structures).length} structures` +
      (mapKind !== 'script' ? (j.built ? ' · with your changes (not installed yet)' : ' · as it is now') : ''));
    $('#map').value = script;
    startScreen?.opened(script);
    if (temporaryTutorial()) status(`${mapName}: temporary training. Rebuild and Play work normally; Close map discards this session.`);
    return true;
  } catch (e) {
    log('Error: ' + e.message, 'bad');
    status('loading failed', 'bad');
    startScreen?.error(e);
    return false;
  } finally { mapLoading = false; busy(''); }
}

// materials shared by the world, the structures and the objects (one per texture and style)
const loader = new THREE.TextureLoader();
let texCache = {}, matCache = {};
function clearMaterials() {
  sceneTextures.clear();
  for (const m of Object.values(matCache)) m.dispose();
  for (const t of Object.values(texCache)) t.dispose();
  texCache = {}; matCache = {};
  for (const k of Object.keys(modelCache)) delete modelCache[k];
}
// the flags a texture has by itself (masked fences and grates, translucent glass, unlit screens): the
// engine adds them to the surface's, and so does the editor (data.texture_flags, /api/texflags)
let texFlags = {};
// Texture flags travel with the scene; no eager whole-game scan or runtime compile on startup.
const TEX_FLAG_BITS = PF.masked | PF.translucent | PF.modulated | PF.unlit;
function tf(tex, flags) { return (flags || 0) | ((texFlags[tex] || 0) & TEX_FLAG_BITS); }
const PENDING_PIXEL = (() => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.fillStyle = '#8a8f99'; g.fillRect(0, 0, 1, 1); return c; })();
const imageLoader = new THREE.ImageLoader();
const sceneTextures = createSceneTextures({ createTexture: () => new THREE.Texture(), placeholder: PENDING_PIXEL,
  loadImage: (url, ready, failed) => imageLoader.load(url, ready, undefined, failed), wake,
  failed: (url, scope) => { if (scope === 'scene') log(`Could not load scene texture after 3 attempts: ${url}`, 'warn'); } });
function makeMaterial(png, flags, base, scope = 'scene') {
  const key = scope + ':' + base + (png || '-') + '|' + (flags & (PF.masked | PF.translucent | PF.modulated | PF.unlit));
  if (matCache[key]) return matCache[key];
  let map = null;
  if (png) {
    const url = base + png, masked = !!(flags & PF.masked);
    const textureKey = scope + ':' + url + (masked ? '|m' : '');
    map = texCache[textureKey];
    if (!map) {
      map = texCache[textureKey] = sceneTextures.load(url, scope);
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.flipY = false;
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (masked) {
        // chain-link fences, grates, foliage: with mipmaps their thin parts fade under the alpha test and
        // the whole fence disappears from a distance; the game draws them without
        map.generateMipmaps = false;
        map.minFilter = THREE.LinearFilter;
        // the see-through texels keep the key colour of the palette (often purple): filtered into the edges of
        // the wires it made a purple fringe; premultiplied, they are black, like the game's outlines
        map.premultiplyAlpha = true;
      }
    }
  }
  const opts = { map, side: THREE.DoubleSide, color: map ? 0xffffff : 0x777777 };
  if (flags & PF.masked) opts.alphaTest = 0.5;
  if (flags & PF.translucent) Object.assign(opts, { transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  else if (flags & PF.modulated) Object.assign(opts, { transparent: true, opacity: 0.5, depthWrite: false });
  return matCache[key] = (flags & PF.unlit) ? new THREE.MeshBasicMaterial(opts) : new THREE.MeshLambertMaterial(opts);
}
function geometryUE(posUE, uv, shift, uv2) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(posUE.length);
  const [sx, sy, sz] = shift || [0, 0, 0];
  for (let i = 0; i < posUE.length; i += 3) { pos[i] = posUE[i] - sx; pos[i + 1] = posUE[i + 2] - sz; pos[i + 2] = posUE[i + 1] - sy; }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  if (uv2 && uv2.length === uv.length) geo.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(uv2), 2));
  geo.computeVertexNormals();
  return geo;
}
const rotations = createRotations(THREE);
const placementGeometry = createSurfacePlacement(THREE);
const textureScale = createTextureScale(THREE);

let geoRev = 0;                       // the map's geometry loaded so far (the walkable area is made again after a rebuild)
async function loadGeometry(url, structs) {
  surfaceTexturePreview?.restore();
  geoRev++;
  world.clear();
  worldMeshes.length = 0;
  structures = {};
  actorStruct = {};
  const g = await (await fetch(url)).json();
  texFlags = g.texflags || {};
  const faceMeshes = [];
  geoFaces = g.faces || [];
  mapTex = g.textures;
  const base = `/cache/${mapName}/`;
  loadLightmap(g.lightmap ? base + g.lightmap : null, g.actorlight || {}, g.lights || [], g.objectlight || {});
  texList = Object.keys(g.textures).filter((t) => t !== 'none' && g.textures[t].w > 0).map((t) => t.split('.').pop()).sort();
  texFull = Object.fromEntries(Object.keys(g.textures).map((t) => [t.split('.').pop(), t]));     // short name -> Package.Name
  for (const [name, info] of Object.entries(structs)) {
    const obj = new THREE.Group();
    const cb = add3(info.pivot, info.placement.offset);           // pivot where the last build put it
    obj.position.copy(T(cb));
    obj.quaternion.copy(rotations.pose(info.placement));
    obj.userData = { kind: 'structure', name };
    world.add(obj);
    structures[name] = Object.assign({}, info, { name, obj, built: true, center: cb, paste: name.startsWith('paste~'), rotatable: true, scalable: info.scalable ?? info.rotatable });
    if (structures[name].paste || (mapKind === 'script' && info.piece_of && !(info.actors || []).length)) structures[name].copyable = true;
    for (const a of info.actors) actorStruct[a] = name;
  }
  // the faces that show the sky (a hole open to the sky): the colour of the map's sky (Map > Sky & time of day),
  // else the background; never picked (the surfaces behind them are)
  const skyColour = skyTool.backdrop(edits.level || {});
  for (const grp of g.groups) {
    const st = grp.structure && structures[grp.structure];
    const flags = tf(grp.tex, grp.flags);
    if ((grp.flags | flags) & PF.fake) {
      if (skyColour == null || st) continue;
      const sky = new THREE.Mesh(geometryUE(grp.pos, grp.uv), new THREE.MeshBasicMaterial({ color: skyColour, side: THREE.DoubleSide }));
      sky.userData.flags = PF.unlit; sky.userData.sky = true;
      sky.raycast = () => {};
      world.add(sky);
      continue;
    }
    const mesh = new THREE.Mesh(geometryUE(grp.pos, grp.uv, st ? st.center : null, grp.uv2), makeMaterial((g.textures[grp.tex] || {}).png, flags, base));
    // Geometry is exported in its built world pose; keep its local axes canonical.
    if (st) mesh.geometry.applyQuaternion(rotations.pose(st.placement).invert());
    if (st) textureScale.capture(mesh.geometry, grp, rotations.pose(st.placement).invert());
    mesh.userData.tex = grp.tex;
    mesh.userData.flags = flags;
    mesh.userData.world = true;
    mesh.userData.faces = grp.faces || [];
    faceMeshes.push(mesh);
    (st ? st.obj : world).add(mesh);
    if (!(grp.flags & (PF.translucent | PF.modulated))) worldMeshes.push(mesh);
  }
  surfaceTools.load(g.faces || [], faceMeshes);
}

// ---------------------------------------------------------------- lighting of the view: Unlit / Shaded / Lit
// Shaded: the editor's own soft light (good to work). Unlit: textures only. Lit: the game's lighting from
// the last rebuild: the lightmaps of the surfaces (UC_LIGHTDUMP: the real shadows of every light, its
// colour, radius and angle, the zones' ambient) and, on the objects, the lights that see them, vertex by
// vertex like the engine does (each light all or nothing for an object, from its centre).
// The game multiplies texture and light in gamma space: lightmap bytes are light/2, read as sRGB and
// multiplied back by 2^2.2 (and by PI: three's MeshBasicMaterial divides the lightmap by PI).
let lightMode = 'shaded', lightAtlas = null, actorLight = {}, mapLights = [], objectLight = {};
const litGeos = new Map();            // per object part: its geometry with the light in the vertex colours
let lightGain = 1;                  // exposure of the Lit view (1 = as calibrated against the game's pictures)
try { lightGain = +localStorage.getItem('ucmap.lightgain') || 1; } catch (e) { /* no storage */ }
let derivedMats = new WeakMap();
const derivedSet = new WeakSet();
try { lightMode = localStorage.getItem('ucmap.light') || 'shaded'; } catch (e) { /* no storage */ }
let lightmapRevision = 0;
function loadLightmap(url, actors, lights, objects) {
  const revision = ++lightmapRevision;
  if (lightAtlas) lightAtlas.dispose();
  lightAtlas = null;
  actorLight = actors || {};
  mapLights = lights || [];
  objectLight = objects || {};
  for (const c of litGeos.values()) c.geo.dispose();
  litGeos.clear();
  if (!url) return;
  // Chromium can reuse a decoded Image in this document even with no-cache/ETag.
  // The atlas is regenerated at the same path: give each scene load a new identity.
  const freshUrl = url + (url.includes('?') ? '&' : '?') + 'lightBuild=' + Date.now() + '-' + revision;
  lightAtlas = loader.load(freshUrl, () => {
    if (revision !== lightmapRevision) return;
    applyLighting(); wake();
  }, undefined, () => {
    if (revision !== lightmapRevision) return;
    log('Could not load rebuilt lighting. Reopen the map to retry.', 'warn');
    wake();
  });
  lightAtlas.flipY = false;
  lightAtlas.colorSpace = THREE.SRGBColorSpace;
  lightAtlas.channel = 1;                    // the 'uv1' attribute
  lightAtlas.generateMipmaps = false;
  lightAtlas.minFilter = THREE.LinearFilter;
}
function variant(base, mode, tint) {
  let d = derivedMats.get(base);
  if (!d) derivedMats.set(base, d = {});
  const key = mode + (tint ? tint.map((v) => v.toFixed(2)).join(',') : '');
  if (d[key]) { updateVariantGain(d[key], base, mode, tint); return d[key]; }
  const m = new THREE.MeshBasicMaterial({ map: base.map, side: base.side, alphaTest: base.alphaTest, transparent: base.transparent,
    opacity: base.opacity, depthWrite: base.depthWrite, blending: base.blending, color: base.color.clone() });
  if (mode === 'vertex') m.vertexColors = true;
  else if (mode === 'lit' && !tint && lightAtlas) m.lightMap = lightAtlas;
  updateVariantGain(m, base, mode, tint);
  derivedSet.add(m);
  return d[key] = m;
}
function updateVariantGain(m, base, mode, tint) {
  if (m.userData.editorGain === lightGain) return;
  m.userData.editorGain = lightGain;
  m.color.copy(base.color);
  if (mode === 'vertex') m.color.multiplyScalar(Math.pow(lightGain, 2.2));
  else if (mode === 'lit' && tint) m.color.multiply(new THREE.Color(...tint.map((v) => Math.pow(Math.min(v * lightGain, 2), 2.2))));
  else if (mode === 'lit' && m.lightMap) m.lightMapIntensity = Math.pow(2 * lightGain, 2.2) * Math.PI;
}
function setMeshLight(mesh, tint) {
  if (!mesh.isMesh || !mesh.material || Array.isArray(mesh.material)) return;
  if (!derivedSet.has(mesh.material)) mesh.userData.matBase = mesh.material;    // the material it really has
  const base = mesh.userData.matBase;
  if (!base) return;
  if (lightMode === 'shaded') mesh.material = base;
  else if (lightMode === 'unlit') mesh.material = variant(base, 'unlit');
  else if (mesh.userData.world)        // unlit surfaces (neon signs, screens) are always full bright in the game
    mesh.material = mesh.geometry.getAttribute('uv1') && lightAtlas && !(mesh.userData.flags & PF.unlit) ? variant(base, 'lit') : variant(base, 'unlit');
  else if (mesh.userData.flags & PF.unlit) mesh.material = variant(base, 'unlit');       // flames, screens
  else mesh.material = variant(base, 'lit', tint || [1, 1, 1]);
  if (mesh.userData.world) mesh.material = holeCutMaterial(mesh.material);
}
// Holes are cut by the engine at Rebuild (a subtract brush). Until then the 3D view hides the walls, floors and
// ceilings inside every hole block, live while it is moved or resized (Gabby, 17 Oct 2026: "how can I see the
// hole?"). Only the map's surfaces (not the objects): a copy of their material that drops the pixels inside the
// holes' boxes. The faces of the hole's sides come with the rebuild; they lie on the box, which is not cut.
const HOLE_MAX = 16;
const HOLE = { n: { value: 0 }, min: { value: Array.from({ length: HOLE_MAX }, () => new THREE.Vector3()) },
  max: { value: Array.from({ length: HOLE_MAX }, () => new THREE.Vector3()) } };
const holeMats = new WeakMap();
function holeCutMaterial(m) {
  if (!HOLE.n.value || !m || m.isShaderMaterial) return m;
  let c = holeMats.get(m);
  if (!c) {
    c = m.clone();
    c.onBeforeCompile = (shader) => {
      shader.uniforms.uHoleN = HOLE.n; shader.uniforms.uHoleMin = HOLE.min; shader.uniforms.uHoleMax = HOLE.max;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHoleP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvHoleP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        '#include <common>\nvarying vec3 vHoleP;\nuniform int uHoleN;\nuniform vec3 uHoleMin[' + HOLE_MAX + '];\nuniform vec3 uHoleMax[' + HOLE_MAX + '];')
        .replace('void main() {', 'void main() {\n  for (int i = 0; i < ' + HOLE_MAX + '; i++) { if (i >= uHoleN) break;\n'
          + '    if (all(greaterThan(vHoleP, uHoleMin[i])) && all(lessThan(vHoleP, uHoleMax[i]))) discard; }');
    };
    c.customProgramCacheKey = () => 'holecut' + HOLE_MAX;
    derivedSet.add(c);
    holeMats.set(m, c);
  }
  // what the lighting changes on its material (the brightness slider), kept the same on the copy
  c.color.copy(m.color);
  if ('lightMapIntensity' in m) c.lightMapIntensity = m.lightMapIntensity;
  c.opacity = m.opacity;
  return c;
}
// each drawn frame: the boxes of the hole blocks (as they are now, also while dragged), a little inside them
function updateHoleCut() {
  let n = 0;
  for (const p of proxies.children) {
    const b = p.userData.box;
    if (!b || !b.hole || !p.visible || n >= HOLE_MAX) continue;
    const hx = Math.abs(p.scale.x) / 2 - 0.5, hy = Math.abs(p.scale.y) / 2 - 0.5, hz = Math.abs(p.scale.z) / 2 - 0.5;
    if (hx <= 0 || hy <= 0 || hz <= 0) continue;
    HOLE.min.value[n].set(p.position.x - hx, p.position.y - hy, p.position.z - hz);
    HOLE.max.value[n].set(p.position.x + hx, p.position.y + hy, p.position.z + hz);
    n++;
  }
  const changed = (n > 0) !== (HOLE.n.value > 0);
  HOLE.n.value = n;
  if (changed) applyLighting();                     // the map's surfaces take (or leave) their cutting copies
}
// the light on every vertex of an object part, as the engine does it: the ambient of the object, plus
// each light that sees the object's centre, with its falloff, its angle on the vertex's normal (smooth
// normals) and its spotlight cone, doubled like on the surfaces. Returned as linear vertex colours.
function vertexColours(geo, mw, info) {
  const P = geo.getAttribute('position'), n = P.count;
  const out = new Float32Array(n * 3);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), acc = new Map(), keys = new Array(n);
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), centre = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i); centre.add(v); }
  centre.divideScalar(Math.max(1, n));
  // face normals (area weighted) summed on each shared position: smooth normals, turned outwards
  let out_ = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
    const f = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    out_ += f.dot(new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3).sub(centre));
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(P, i + k);
      const key = keys[i + k] = `${Math.round(v.x * 10)},${Math.round(v.y * 10)},${Math.round(v.z * 10)}`;
      const s = acc.get(key);
      if (s) s.add(f); else acc.set(key, f.clone());
    }
  }
  const sign = out_ < 0 ? -1 : 1;
  const nm = new THREE.Matrix3().getNormalMatrix(mw);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(mw);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.z; pos[i * 3 + 2] = v.y;            // back to the game's axes
    a.copy(acc.get(keys[i]) || v.set(0, 1, 0)).multiplyScalar(sign).applyMatrix3(nm).normalize();
    nrm[i * 3] = a.x; nrm[i * 3 + 1] = a.z; nrm[i * 3 + 2] = a.y;
  }
  const amb = info.slice(0, 3), ids = info[3] || [];
  for (let i = 0; i < n; i++) {
    let r = amb[0], gg = amb[1], bb = amb[2];
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    for (const id of ids) {
      const L = mapLights[id];
      if (!L) continue;
      const dx = L[0] - px, dy = L[1] - py, dz = L[2] - pz, dist = Math.hypot(dx, dy, dz);
      if (dist >= L[6]) continue;
      let f = 1 - dist / L[6];
      if (L[7] !== 13 && dist > 0.01) {                                   // LE_NonIncidence: no angle
        const inc = (dx * nx + dy * ny + dz * nz) / dist;
        if (inc <= 0) continue;
        f *= inc;
      }
      if ((L[7] === 12 || L[7] === 8) && dist > 0.01) {                    // spotlights: the cone
        const cs = -(dx * L[8] + dy * L[9] + dz * L[10]) / dist, edge = Math.cos(L[11] * Math.PI / 512);
        if (cs <= edge) continue;
        f *= Math.min(1, (cs - edge) / Math.max(0.05, 1 - edge) * 2);
      }
      r += 2 * L[3] * f; gg += 2 * L[4] * f; bb += 2 * L[5] * f;
    }
    out[i * 3] = Math.pow(Math.min(r, 2), 2.2); out[i * 3 + 1] = Math.pow(Math.min(gg, 2), 2.2); out[i * 3 + 2] = Math.pow(Math.min(bb, 2), 2.2);
  }
  return out;
}
function setVertexLight(mesh, key, info) {
  if (!mesh.isMesh || !mesh.material || Array.isArray(mesh.material)) return;
  if (!derivedSet.has(mesh.material)) mesh.userData.matBase = mesh.material;
  const base = mesh.userData.matBase, geo0 = mesh.userData.geoBase || mesh.geometry;
  mesh.userData.geoBase = geo0;
  mesh.updateWorldMatrix(true, false);
  const pose = mesh.matrixWorld.elements.map((e) => e.toFixed(2)).join(',');
  let c = litGeos.get(key);
  if (!c || c.pose !== pose || c.src !== geo0) {
    if (c) c.geo.dispose();
    c = { pose, src: geo0, geo: geo0.clone() };
    c.geo.setAttribute('color', new THREE.BufferAttribute(vertexColours(geo0, mesh.matrixWorld, info), 3));
    litGeos.set(key, c);
  }
  mesh.geometry = c.geo;
  mesh.material = variant(base, 'vertex');
}
// what lights an object: as found by the last rebuild; an object added or moved since then takes the
// lights in range of where it is now (without the shadow test, which needs a rebuild)
function objectLightOf(g) {
  const a = g.userData.actor, built = objectLight[a.name];
  if (built && g.userData.source === 'map' && !edits.moved[a.name]) return built;
  const ids = [];
  mapLights.forEach((L, i) => { if (Math.hypot(L[0] - a.loc[0], L[1] - a.loc[1], L[2] - a.loc[2]) < L[6]) ids.push(i); });
  return (built ? built.slice(0, 3) : [0, 0, 0]).concat([ids]);
}
function lightObject(g) {
  const a = g.userData && g.userData.actor;
  if (!a || !g.userData.model) return;
  const t = actorLight[a.name], info = lightMode === 'lit' && mapLights.length && objectLightOf(g);
  let part = 0;
  g.userData.model.traverse((o) => {
    if (!o.userData || o.userData.tex === undefined) return;
    if (info && o.isMesh && !(o.userData.flags & PF.unlit)) return setVertexLight(o, `${a.name}|${part++}`, info);
    if (o.userData.geoBase) o.geometry = o.userData.geoBase;              // back to the plain model
    setMeshLight(o, t ? t.map((v) => Math.max(0.08, v)) : null);
  });
}
function applyLighting() {
  surfaceTexturePreview?.restore();
  world.traverse((o) => { if (o.userData && o.userData.world) setMeshLight(o); });
  for (const g of proxies.children) lightObject(g);
  refreshSurfaceTexturePreview();
  const sel = $('#lightmode');
  if (sel) sel.value = lightMode;
  vpBar?.refresh();
  const gain = $('#lightgain');
  if (gain) { gain.style.display = lightMode === 'lit' ? '' : 'none'; gain.value = lightGain; }
}
function setLightMode(mode) {
  lightMode = mode;
  try { localStorage.setItem('ucmap.light', mode); } catch (e) { /* no storage */ }
  applyLighting();
  status(mode === 'lit' ? `${mapName}: game lighting of the last rebuild (move or change lights, then Rebuild to see them)` : `${mapName}: ${mode}`, 'ok');
}

// a real 3D object (mesh or door) from the library, coordinates relative to the actor
const modelCache = {};
function modelFor(a, source, preview = false) {
  let m = null, tex = mapTex, base = `/cache/${mapName}/`, key;
  const mp = previewMesh(a, source), pose = mp ? replacementPose(a, source) : null;
  if (mp && !meshModels[mp]) return null; // Never flash the previous model while its replacement loads.
  if (mp) {
    const pkg = mp.split('.')[0];
    m = meshModels[mp]; tex = meshTex[pkg] || {}; base = `/cache/_models/${pkg}/`; key = `mesh:${mp}|${JSON.stringify(pose)}`;
  } else if (source === 'map' && meshLib[a.name]) { m = meshLib[a.name]; key = 'map:' + a.name; }
  // a custom character before its class's own model (UCCustomCivilian... alone is a bare grey mannequin)
  else if (window.__characters && window.__characters.isCustom(a.cls) && window.__characters.parts(a)) {
    const c = window.__characters.parts(a);         // body + skins of its properties (characters.js)
    m = c; tex = c.textures; base = ''; key = 'char:' + c.key;
  }
  else if (paletteLib[a.cls]) { m = paletteLib[a.cls]; tex = paletteTex; base = '/cache/_palette/'; key = 'pal:' + a.cls; }
  if (!m || !m.parts || !m.parts.length) return null;
  if (preview) key = 'preview:' + key;
  if (!modelCache[key] || modelCache[key].map !== mapName) {
    const g = new THREE.Group();
    for (const part of m.parts) {
      const flags = tf(part.tex, part.flags);
      const mesh = new THREE.Mesh(geometryUE(part.pos, part.uv), makeMaterial((tex[part.tex] || {}).png, flags, base, preview ? 'preview' : 'scene'));
      mesh.userData = { tex: part.tex, slot: part.slot ?? -1, flags };
      g.add(mesh);
    }
    if (pose) {
      // Native exports already contain DrawScale/PrePivot; raw browser meshes do not.
      // Scale only the visual children: the actor and its collision stay untouched.
      for (const child of g.children) child.scale.setScalar(pose.scale);
      g.position.copy(T(pose.pivot));
    }
    modelCache[key] = { map: mapName, obj: g };
  }
  return modelCache[key].obj.clone();
}
// models of the whole game: one small file per class, fetched the first time it is shown
function loadPaletteModel(cls) {
  if (paletteLib[cls] || !paletteHas.has(cls)) return Promise.resolve(paletteLib[cls] || null);
  const lib = paletteLib, loading = paletteLoading;
  return paletteLoading[cls] || (paletteLoading[cls] = fetch(`/cache/_palette/models/${encodeURIComponent(cls)}.json`)
    .then((r) => (r.ok ? r.json() : null)).then((m) => { if (m) lib[cls] = m; return m; }).catch(() => null)
    .finally(() => { delete loading[cls]; }));
}
// The models of the map's objects load 6 at a time, the nearest to the camera first (what you look at shows
// first); until then an object is its outline, and it can be placed, moved and edited all the same.
const modelQueue = [];
let modelActive = 0;
function attachModelLater(g, a, source) {
  modelQueue.push({ g, a, source });
  pumpModels();
}
function pumpModels() {
  while (modelActive < 6 && modelQueue.length) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < modelQueue.length; i++) {
      const d = modelQueue[i].g.parent ? modelQueue[i].g.position.distanceToSquared(camera.position) : -1;   // gone: dropped at once
      if (d < bestD) { bestD = d; best = i; }
    }
    const job = modelQueue.splice(best, 1)[0];
    if (!job.g.parent) continue;
    modelActive++;
    Promise.resolve(loadModelNow(job.g, job.a, job.source)).catch(() => {}).finally(() => { modelActive--; pumpModels(); });
  }
}
function loadModelNow(g, a, source) {
  const generation = mapGeneration;
  const custom = window.__characters && window.__characters.isCustom(a.cls), mp = previewMesh(a, source);
  return (mp ? meshInfo(mp).catch(() => null) : custom ? window.__characters.ready().catch(() => null)
    : loadPaletteModel(a.cls)).then(() => {
    if (generation !== mapGeneration || !g.parent || g.userData.model) return;
    const model = modelFor(a, source);
    if (!model) return;
    g.add(model);
    g.userData.model = model;
    g.userData.body.visible = selected === g;
    applyTilt(g);
    lightObject(g);
    wake();
    if (g === inspectedObject()) showDetails();
  });
}

// ---------------------------------------------------------------- structures (pad, headhouse, towers...)
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const ONE = [1, 1, 1];
const scaleOf = (pose) => (pose && pose.scale) || ONE;
const oddQuarter = (yaw) => Math.abs(Math.round((yaw || 0) / 16384)) % 2 === 1;
// a structure's stretch since the last build, along the axes of its geometry as built (UE order)
function relScale(st, pose) {
  const s = scaleOf(pose), s0 = scaleOf(st.placement);
  const k = [s[0] / s0[0], s[1] / s0[1], s[2] / s0[2]];
  return k;
}
function setPose(entry, pose) {          // offset, turn and stretch of a structure into its edit
  entry.offset = pose.offset; entry.yaw = pose.yaw;
  for (const key of ['pitch', 'roll']) { if (pose[key]) entry[key] = pose[key]; else delete entry[key]; }
  if (pose.scale && pose.scale.some((v) => v !== 1)) entry.scale = pose.scale; else delete entry.scale;
  if (typeof pose.stretch === 'boolean') entry.stretch = pose.stretch; else delete entry.stretch;
  return entry;
}
// objects that can be made bigger or smaller (R): blocks, structures without doors, objects with a model
function canScale(p) {
  if (!p) return false;
  if (p === groupPivot) return members().length > 0 && members().every(canScale);
  const d = p.userData;
  if (d.kind === 'box') return true;
  if (d.kind === 'structure') { const st = structures[d.name]; return !!st && st.scalable !== false; }
  return (d.kind === 'prop' || d.kind === 'pawn') && !!d.actor;
}
// ---------------------------------------------------------------- textures (export / import)
const shortTex = (n) => String(n || '').split('.').pop();
function texRows(p) {                    // [{tex, slot, png, w, h, kind}] of the selected object or structure
  const d = p.userData, rows = [], seen = new Set();
  if (d.kind === 'structure') {
    for (const m of d.name && structures[d.name] ? structures[d.name].obj.children : []) {
      const tx = m.userData && m.userData.tex;
      if (!tx || seen.has(tx) || !mapTex[tx]) continue;
      seen.add(tx);
      rows.push({ tex: tx, png: mapTex[tx].png ? `/cache/${mapName}/${mapTex[tx].png}` : '', w: mapTex[tx].w, h: mapTex[tx].h, kind: 'structure' });
    }
    return rows;
  }
  if (!d.actor) return rows;
  const mp = previewMesh(d.actor, d.source);
  let m = null, tex = mapTex, base = `/cache/${mapName}/`;
  if (mp && !meshModels[mp]) return rows;
  if (mp) {
    m = meshModels[mp]; tex = meshTex[mp.split('.')[0]] || {}; base = `/cache/_models/${mp.split('.')[0]}/`;
  } else if (d.source === 'map' && meshLib[d.actor.name]) m = meshLib[d.actor.name];
  else if (paletteLib[d.actor.cls]) { m = paletteLib[d.actor.cls]; tex = paletteTex; base = '/cache/_palette/'; }
  else if (window.__characters?.isCustom(d.actor.cls)) { m = window.__characters.parts(d.actor); tex = m?.textures || {}; base = ''; }
  for (const part of (m && m.parts) || []) {
    const key = part.slot ?? -1;
    if (key < 0 || seen.has(key)) continue;
    seen.add(key);
    const info = tex[part.tex] || {};
    rows.push({ tex: part.tex, slot: key, png: info.png ? base + info.png : '',
                w: info.w, h: info.h, kind: 'actor' });
  }
  return rows.sort((a, b) => a.slot - b.slot);
}
function texOverride(p, row) {           // the imported texture now on this slot / these faces
  const d = p.userData;
  const same = (a, b) => String(a || '').split('.').pop().toLowerCase() === String(b || '').split('.').pop().toLowerCase();
  return (edits.retexture || []).find((r) => row.kind === 'actor'
    ? r.kind === 'actor' && r.name === d.actor.name && r.slot === row.slot
    : (r.kind === 'structure' && r.name === d.name && r.old === row.tex) || (r.kind === 'map' && r.old === row.tex))
    || (row.kind === 'actor' && (edits.retexture || []).find((r) => r.kind === 'actors' && same(r.old, row.tex)));
}
const texUrl = (name) => edits.textures && edits.textures[name] ? '/textures/' + edits.textures[name].png : '';
function applyTextureOverrides() {      // what the imports will look like, before the rebuild
  // first every face back to its own texture (Ctrl+Z may have taken an override away), then the overrides
  const resetIn = (o) => { for (const m of (o ? o.children : [])) if (m.isMesh && m.userData.texOrig) { m.material = m.userData.texOrig; m.userData.matBase = m.userData.texOrig; delete m.userData.texOrig; } };
  resetIn(world);
  for (const s of Object.values(structures)) resetIn(s.obj);
  const override = (m, mat) => { if (!m.userData.texOrig) m.userData.texOrig = m.userData.matBase || m.material; m.material = mat; };
  const cache = {};
  const matFor = (name, flags) => cache[name + '|' + flags] || (cache[name + '|' + flags] = makeMaterial(texUrl(name), flags, ''));
  for (const r of edits.retexture || []) {
    if (!texUrl(r.tex)) continue;
    if (r.kind === 'actor') {
      const pr = proxies.children.find((c) => c.userData.actor && c.userData.actor.name === r.name);
      pr && pr.userData.model && pr.userData.model.traverse((m) => { if (m.isMesh && m.userData.slot === r.slot) m.material = matFor(r.tex, m.userData.flags || 0); });
    } else if (r.kind === 'actors') {          // every object wearing the old texture
      const old = String(r.old).split('.').pop().toLowerCase();
      for (const pr of proxies.children) {
        if (pr.userData.model) pr.userData.model.traverse((m) => { if (m.isMesh && String(m.userData.tex || '').split('.').pop().toLowerCase() === old) m.material = matFor(r.tex, m.userData.flags || 0); });
      }
    } else {
      const objs = r.kind === 'map' ? Object.values(structures).map((s) => s.obj).concat([world]) : [structures[r.name]?.obj];
      for (const o of objs) for (const m of (o ? o.children : [])) if (m.isMesh && m.userData.tex === r.old) override(m, matFor(r.tex, m.userData.flags || 0));
    }
  }
}
function texSection(p) {
  const rows = texRows(p);
  if (!rows.length) return '';
  let html = '<p class="hint">Drag a thumbnail onto a built wall, floor or ceiling. Or click it, then click a face. Esc cancels; Ctrl+Z undoes. Lock the Inspector to keep these textures visible. Rebuild applies edits in game.</p>';
  rows.forEach((r, i) => {
    const ov = texOverride(p, r);
    const src = ov ? texUrl(ov.tex) : r.png;
    html += `<div class="row texrow"><button type="button" class="texture-source" data-texdrag="${i}" title="Drag this texture onto a built face, or click then choose a face" aria-label="Use texture ${escapeHtml(ov ? ov.tex : r.tex)} on a surface"><img src="${escapeHtml(src)}" alt="" draggable="false"></button>
      <span title="${escapeHtml(r.tex)}" style="flex:1 1 90px;min-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${escapeHtml(ov ? ov.tex : shortTex(r.tex))}${r.kind === 'actor' ? ' · slot ' + r.slot : ''}</span>
      <button class="ib" data-texedit="${i}" title="Paint and adjust this texture" aria-label="Edit texture">${editorIcon('textureEdit', 16)}<span>Edit texture</span></button>
      ${src ? `<a class="ib" href="${src}" title="Export: download the PNG" download="${escapeHtml(ov ? ov.tex : shortTex(r.tex))}.png">${ICON.exp}<span>Export</span></a>` : ''}
      <button class="ib" data-teximp="${i}" title="Import a picture of yours (it opens in the Texture Editor)">${ICON.imp}<span>Import</span></button>${ov ? `<button class="ib" data-texorig="${i}" title="Back to the original texture">${ICON.reset}<span>Original</span></button>` : ''}</div>`;
  });
  html += '<input type="file" id="texfile" accept="image/png,image/jpeg,image/bmp,image/gif" style="display:none">';
  return inspectorSection('textures', 'Textures', html, false);
}
function wireTexSection(p) {
  const rows = texRows(p);
  const file = $('#texfile');
  if (!file) return;
  let pending = null;
  for (const button of document.querySelectorAll('[data-texdrag]')) textureTransfer?.bind(button, () => {
    const row = rows[+button.dataset.texdrag], override = texOverride(p, row);
    const ref = override?.tex || row.tex, ownName = edits.textures?.[ref] ? ref : shortTex(ref), own = edits.textures?.[ownName];
    return { ref, url: override ? texUrl(ref) : row.png, w: own?.w || row.w, h: own?.h || row.h, requiredLocal: own ? ownName : null };
  });
  for (const b of document.querySelectorAll('[data-teximp]')) b.onclick = () => { pending = rows[+b.dataset.teximp]; file.value = ''; file.click(); };
  for (const b of document.querySelectorAll('[data-texedit]')) b.onclick = () => {
    const row = rows[+b.dataset.texedit], ov = texOverride(p, row);
    window.__texedit && window.__texedit.open(texContext(p, row, ov ? ov.tex : null));
  };
  for (const b of document.querySelectorAll('[data-texorig]')) b.onclick = () => {
    const ov = texOverride(p, rows[+b.dataset.texorig]);
    pushUndo();
    edits.retexture = (edits.retexture || []).filter((r) => r !== ov);
    setDirty(); rebuildProxies();
  };
  file.onchange = () => {                  // a picture of yours: in the Texture Editor, to adjust and place it
    const f = file.files && file.files[0];
    if (!f || !pending) return;
    window.__texedit && window.__texedit.open(texContext(p, pending, null), f);
  };
}
// what the Texture Editor needs about a texture of the selection: name, kind, slot, world size, a 3D preview
function texContext(p, row, current) {
  const d = p.userData, rows = texRows(p), contextScript = script, contextRevision = tutorialSession.revision;
  const label = row.kind === 'actor' ? `${hierLabel(d.actor)} · ${shortTex(row.tex)} (slot ${row.slot})` : `${structures[d.name]?.label || d.name} · ${shortTex(row.tex)}`;
  return {
    tex: current || row.tex, orig: row.tex, kind: row.kind, slot: row.slot, size: row.kind === 'structure' ? [row.w, row.h] : null,
    label, script, target: row.kind === 'actor' ? d.actor.name : d.name,
    materials: rows.map(r => ({ tex: r.tex, slot: r.slot,
      label: `${shortTex(texOverride(p, r)?.tex || r.tex)}${r.kind === 'actor' ? ' · slot ' + r.slot : ''}` })),
    materialIndex: rows.findIndex(r => r.tex === row.tex && r.slot === row.slot),
    selectMaterial(index) {
      if (script !== contextScript || tutorialSession.revision !== contextRevision)
        throw new Error('The map has changed. Reopen the texture from the current map.');
      const choice = rows[index];
      const next = choice && texRows(p).find(r => r.tex === choice.tex && r.slot === choice.slot);
      if (!next) throw new Error('This texture is no longer on the object. Reopen its Texture Editor.');
      return texContext(p, next, texOverride(p, next)?.tex);
    },
    preview3d: (row.kind === 'actor' ? d.model : structures[d.name]?.obj) ? (tex) => {
      const m = (row.kind === 'actor' ? d.model : structures[d.name].obj).clone(true);
      // The painting viewport owns its clones. Keep the map's geometry and
      // cached materials alive when closing it, and preserve the actual UVs.
      m.userData.texturePaintOwned = true;
      m.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry = o.geometry.clone();
        const paintable = row.kind === 'actor' ? o.userData.slot === row.slot : o.userData.tex === row.tex;
        const source = o.material;
        o.material = Array.isArray(source) ? source.map(mat => mat.clone()) : source.clone();
        o.userData.texturePaint = paintable;
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
          if (paintable) {
            if (mat.map) {
              tex.flipY = mat.map.flipY; tex.wrapS = mat.map.wrapS; tex.wrapT = mat.map.wrapT;
              tex.offset.copy(mat.map.offset); tex.repeat.copy(mat.map.repeat);
              tex.center.copy(mat.map.center); tex.rotation = mat.map.rotation;
            }
            mat.map = tex; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide;
            // Texture painting uses neutral lighting, independent of map lighting.
            mat.color?.set(0xffffff); mat.vertexColors = false; mat.lightMap = null;
            mat.transparent = false; mat.opacity = 1; mat.needsUpdate = true;
          }
        }
      });
      return m;
    } : null,
  };
}
// the Texture Editor applies a picture: a texture of the map on this object / structure, or on all
async function applyTexture(ctx, png, to, document = null) {
  const textureScript = script, textureSessionRevision = tutorialSession.revision;
  if (!textureScript || (ctx.script && ctx.script !== textureScript)) throw new Error('The texture belongs to a map that is no longer open.');
  const target = ctx.kind === 'actor' ? proxyOf(ctx.target) : structures[ctx.target]?.obj;
  if (target && !requireUnlocked(target)) throw new Error('Unlock this object before changing its texture.');
  const info = await api('/api/texture_import?script=' + encodeURIComponent(script),
    { png, document, base: ctx.orig, world: ctx.kind === 'structure' ? ctx.size : null, existing: Object.keys(edits.textures || {}) });
  if (script !== textureScript || tutorialSession.revision !== textureSessionRevision) throw new Error('The map was closed before its texture could be applied.');
  pushUndo();
  edits.textures = edits.textures || {};
  edits.textures[info.name] = { pcx: info.pcx, png: info.png, w: info.w, h: info.h, masked: info.masked, scale: info.scale, from: ctx.orig };
  const all = to === 'all';
  const entry = ctx.kind === 'actor'
    ? (all ? { kind: 'actors', old: ctx.orig, tex: info.name } : { kind: 'actor', name: ctx.target, slot: ctx.slot, tex: info.name })
    : (all ? { kind: 'map', old: ctx.orig, tex: info.name } : { kind: 'structure', name: ctx.target, old: ctx.orig, tex: info.name });
  const same = (a, b) => String(a || '').split('.').pop().toLowerCase() === String(b || '').split('.').pop().toLowerCase();
  edits.retexture = (edits.retexture || []).filter((r) => !(r.kind === entry.kind && r.name === entry.name && r.slot === entry.slot && same(r.old, entry.old)));
  edits.retexture.push(entry);
  log(`Texture ${info.name} (${info.w}x${info.h}${info.masked ? ', see-through parts' : ''}) on ${all ? (ctx.kind === 'actor' ? 'every object wearing ' : 'every face with ') + shortTex(ctx.orig) : ctx.label}. Rebuild puts it in the game.`, 'ok');
  setDirty(); rebuildProxies();
  return info;
}

let builtScale = {};                     // scale of each object in the map as last built (the edits it had)
let builtBoxes = new Map();              // the blocks as the map shown was built: name -> their shape and place
const boxSig = (b) => JSON.stringify([b.lo, b.hi, b.rot || null, b.tex || '', blockShape(b), !!b.solid, !!b.hole]);
const blockLooks = new Map();            // a block's texture before a Rebuild: map|texture -> {map, tile, masked}
let lastPlacingMove = null;              // the pointer's last move while placing (R re-turns the ghost there)
let lastBlockTex = 'flatconcrete_a';    // the texture of the next block made with the Hierarchy's +
const visualScale = (d) => d.source === 'added' ? (d.actor.scale || 1)
  : ((edits.moved[d.actor.name]?.scale || 1) / (builtScale[d.actor.name] || 1));
function rotUE(v, yaw) {
  const a = yaw * 2 * Math.PI / YAW, c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}
function copyEntry(name) {
  const at = name.lastIndexOf('~'), g = name.slice(0, at), id = name.slice(at + 1);
  return edits.copies.find((c) => c.group === g && c.id === id);
}
// pose of a structure in the edits (relative to how the script makes it)
function pasteEntry(name) { return edits.prefabs.find((e) => 'paste~' + e.pid === name); }
function poseOf(st) {
  const pose = (e) => ({ offset: e.offset || [0, 0, 0], yaw: e.yaw || 0, pitch: e.pitch || 0, roll: e.roll || 0, scale: e.scale || ONE, stretch: e.stretch });
  if (st.paste) {
    const e = pasteEntry(st.name);
    return e ? pose(e) : { offset: [0, 0, 0], yaw: 0, scale: ONE, deleted: true };
  }
  if (st.copy_of) {
    const c = copyEntry(st.name);
    return c ? pose(c) : { offset: [0, 0, 0], yaw: 0, scale: ONE, deleted: true };
  }
  const e = edits.groups[st.name] || {};
  return Object.assign(pose(e), { deleted: !!e.deleted });
}
// moves a point of a structure from one pose to another
function poseToPose(st, from, to) {
  const c = add3(st.pivot, from.offset), sf = scaleOf(from), sto = scaleOf(to);
  return (q) => {
    let v = T([q[0] - c[0], q[1] - c[1], q[2] - c[2]]).applyQuaternion(rotations.pose(from).invert());
    v = [v.x, v.z, v.y];
    v = [v[0] / sf[0] * sto[0], v[1] / sf[1] * sto[1], v[2] / sf[2] * sto[2]];
    const turned = T(v).applyQuaternion(rotations.pose(to));
    return add3([turned.x, turned.z, turned.y], add3(st.pivot, to.offset));
  };
}
function showPose(st, pose) {
  st.obj.visible = !pose.deleted && !st.dissolved && !objectHidden(st.obj);
  st.obj.position.copy(T(add3(st.pivot, pose.offset)));
  st.obj.quaternion.copy(rotations.pose(pose));
  const k = relScale(st, pose);
  st.obj.scale.set(k[0], k[2], k[1]);
  textureScale.update(st.obj, st.placement, pose);
}
// the pose of a structure as it is now in the view (while dragging, or to save it)
function livePose(st) {
  const o = st.obj, c = UE(o.position), prev = poseOf(st);
  const pose = { offset: [r1(c[0] - st.pivot[0]), r1(c[1] - st.pivot[1]), r1(c[2] - st.pivot[2])],
                 ...rotations.fields(o.quaternion), stretch: prev.stretch };
  if (!st.rotatable) Object.assign(pose, { yaw: prev.yaw, pitch: prev.pitch, roll: prev.roll });
  let k = [Math.abs(o.scale.x), Math.abs(o.scale.z), Math.abs(o.scale.y)];
  const s0 = scaleOf(st.placement);
  pose.scale = st.scalable === false ? scaleOf(prev) : k.map((v, i) => Math.max(0.05, Math.round(v * s0[i] * 100) / 100));
  const piece = !!st.piece_of || (st.paste && /^obj_/.test(pasteEntry(st.name)?.prefab || ''));
  pose.stretch = stretchOnResize(piece, prev, pose.scale);
  return pose;
}
// structures in the view follow the edits (also copies not built yet: clones of the original)
function syncStructures() {
  syncPieces();                          // structures taken apart (Un-nest): their pieces on their own
  for (const [name, st] of Object.entries(structures)) {
    if (st.pendingCopy || (st.pendingPaste && !pasteEntry(name))) { world.remove(st.obj); delete structures[name]; }
  }
  // pieces pasted from other maps, not built yet: their preview
  for (const e of edits.prefabs) {
    const name = 'paste~' + e.pid;
    if (structures[name]) continue;
    const obj = new THREE.Group();
    obj.userData = { kind: 'structure', name };
    world.add(obj);
    structures[name] = { name, obj, label: `${e.label} (from ${e.source})`, category: e.mover ? 'Movers' : 'Pasted', pivot: e.pivot,
      placement: { offset: [0, 0, 0], yaw: 0 }, actors: [], rotatable: e.rotatable !== false, copyable: true,
      gameplay: false, paste: true, pendingPaste: true, built: false };
    loadPrefabDisplay(e.prefab).then((d) => {
      if (!d || !obj.parent) return;
      const base = `/prefabs/${e.prefab}/`;
      for (const g of d.groups) {
        const mesh = new THREE.Mesh(geometryUE(g.pos, g.uv, e.pivot), makeMaterial((d.textures[g.tex] || {}).png, tf(g.tex, g.flags), base));
        textureScale.capture(mesh.geometry, g);
        mesh.userData.tex = g.tex; mesh.userData.flags = g.flags;
        obj.add(mesh);
      }
      const st = structures[name];
      if (st?.obj === obj) textureScale.update(obj, st.placement, livePose(st));
      if (selected === obj) outline.setFromObject(obj);
    });
  }
  for (const st of Object.values(structures)) showPose(st, poseOf(st));
  for (const c of edits.copies) {
    const name = `${c.group}~${c.id}`, orig = structures[c.group];
    if (structures[name] || !orig) continue;
    const obj = orig.obj.clone();
    obj.userData = { kind: 'structure', name };
    world.add(obj);
    structures[name] = Object.assign({}, orig, { name, obj, copy_of: c.group, pendingCopy: true, pendingPiece: false, actors: [], built: false,
      label: `${orig.label} (copy ${c.id})`, gameplay: false });
    showPose(structures[name], poseOf(structures[name]));
  }
}
function structureOf(o) {
  while (o && o !== world && o !== scene) { if (o.userData && o.userData.kind === 'structure') return o; o = o.parent; }
  return null;
}
// a structure's move: the selected one (moveStart), or each structure of a group being moved (nests)
function beginStructMove(obj = selected) {
  const st = structures[obj.userData.name];
  const ms = { st, pose: poseOf(st), pos: st.obj.position.clone(), members: [] };
  for (const p of proxies.children) {
    const a = p.userData.actor;
    if (a && p.userData.source === 'map' && actorStruct[a.name] === st.name) ms.members.push({ p, pos: p.position.clone(), rot: objectRotation(p) });
  }
  if (obj === selected) moveStart = ms;
  return ms;
}
function followStructure(ms = moveStart) {   // objects of the structure move with it while dragging (turned, stretched)
  if (!ms) return;
  const st = ms.st, pose = livePose(st);
  textureScale.update(st.obj, st.placement, pose);
  const f = poseToPose(st, ms.pose, pose);
  for (const m of ms.members) {
    m.p.position.copy(T(f(UE(m.pos))));
    setObjectRotation(m.p, rotations.carry(m.rot, ms.pose, pose));
  }
}
function commitStructure(ms = moveStart, quiet = false, textureChoice) {
  if (!ms) return;
  const st = ms.st;
  const pose = livePose(st);
  if (typeof textureChoice === 'boolean') pose.stretch = textureChoice;
  if (!pose.stretch && textureScale.incomplete(st.obj) &&
      (typeof textureChoice === 'boolean' || pose.scale.some((s, i) => s !== scaleOf(ms.pose)[i]))) {
    log('Texture tiling preview is unavailable for this older prefab. Rebuild to refresh its preview.', 'warn');
  }
  // objects of the structure moved or deleted one by one keep their place on it
  const f = poseToPose(st, ms.pose, pose), dy = pose.yaw - ms.pose.yaw;
  for (const n of st.actors || []) {
    const mv = edits.moved[n];
    if (mv) { mv.loc = f(mv.loc).map(r1); if (mv.orig) mv.orig = f(mv.orig).map(r1); mv.rot = rotations.carry(mv.rot || [0, 0, 0], ms.pose, pose); }
    const dl = edits.deleted[n];
    if (dl && dl.orig) dl.orig = f(dl.orig).map(r1);
  }
  if (st.paste) setPose(pasteEntry(st.name), pose);
  else if (st.copy_of) setPose(copyEntry(st.name), pose);
  else if (!movedPose(pose) && pose.stretch === undefined)
    delete edits.groups[st.name];
  else edits.groups[st.name] = setPose({}, pose);
  textureScale.update(st.obj, st.placement, pose);
  if (ms === moveStart) moveStart = null;
  if (quiet) return;
  setDirty();
  showDetails();
}

const CATS = ['Pasted', 'Roof', 'Building', 'Exit (street)', 'Warehouse (street)', 'City', 'City (Wan Chai Street)', 'Distant city',
  'UnrealEd groups', 'Map pieces'];
function buildStructList() {
  if (!$('#structs')) return;          // the structures of the map are in the Hierarchy
  const q = $('#ssearch').value.trim().toLowerCase();
  const byCat = {};
  for (const st of Object.values(structures)) {
    if (q && !st.label.toLowerCase().includes(q)) continue;
    (byCat[st.category || 'Other'] = byCat[st.category || 'Other'] || []).push(st);
  }
  const cats = Object.keys(byCat).sort((a, b) => (CATS.indexOf(a) + 1 || 99) - (CATS.indexOf(b) + 1 || 99));
  let html = '';
  for (const c of cats) {
    const items = byCat[c].sort((a, b) => a.label.localeCompare(b.label));
    html += `<details ${c === 'Roof' || q ? 'open' : ''}><summary>${escapeHtml(c)} <small>${items.length}</small></summary>`;
    for (const st of items) {
      const pose = poseOf(st), mark = pose.deleted ? ' ✕' : (st.pendingCopy || pose.offset.some((v) => v) || pose.yaw ? ' •' : '');
      html += `<button class="item" data-st="${escapeHtml(st.name)}" title="${escapeHtml(st.label)}${pose.deleted ? ' (deleted)' : ''}"><span class="th" data-th="st:${escapeHtml(st.name)}"></span><span class="tl">${escapeHtml(st.label)}${mark}</span></button>`;
    }
    html += '</details>';
  }
  $('#structs').innerHTML = html || '<div class="hint">No structures in this map.</div>';
  for (const b of document.querySelectorAll('#structs .item')) b.onclick = () => { const st = structures[b.dataset.st]; if (st) { select(st.obj); focusSelected(); } };
  for (const d of document.querySelectorAll('#structs details')) d.addEventListener('toggle', observeThumbs);
  observeThumbs();
}
if ($('#ssearch')) $('#ssearch').addEventListener('input', buildStructList);

// ---------------------------------------------------------------- nests and un-nesting (like Premiere)
// Nest (Ctrl+G, Edit > Nest, right click) puts the selection in a nest: one row in the Hierarchy, picked and
// moved as one thing in the 3D view (a double click there picks one thing inside). Un-nest (Ctrl+Shift+G)
// takes it all out again; one thing at a time: drag it out of the nest in the Hierarchy, or into another.
// A nest is the editor's own (edits.nests): the map does not change.
// A structure of the map (a section of the map script, the touching brushes of an original map) is a nest
// too: Un-nest takes it apart (edits.unnest): its pieces become structures of their own (in the view at
// once, in the map at the next Rebuild: scene.py _unnest, dxmaps.unnested) and its objects are free. One
// piece or one object can be dragged out of it in the Hierarchy. Where they are now is written in the
// edits first, so nothing jumps at the Rebuild.
const NO_POSE = { offset: [0, 0, 0], yaw: 0, scale: ONE };
let geoFaces = [];                     // the faces of the geometry: brush name and build order of each one
const nests = () => (edits.nests = edits.nests || []);
const unnests = () => (edits.unnest = edits.unnest || []);
function keyOf(o) {                    // how a nest names what it holds
  if (!o) return null;
  const d = o.userData;
  if (d.kind === 'structure') return 's:' + d.name;
  if (d.box) return 'b:' + d.box.name;
  if (d.drawn) return 'd:' + d.drawn.name;
  if (d.actor) return 'a:' + d.actor.name;
  return null;
}
function objOf(key) {
  const i = key.indexOf(':'), k = key.slice(0, i), name = key.slice(i + 1);
  if (k === 's') { const st = structures[name]; return st && !st.dissolved && !poseOf(st).deleted ? st.obj : null; }
  if (k === 'b') return proxies.children.find((p) => p.userData.box && p.userData.box.name === name) || null;
  if (k === 'a') return proxyOf(name) || null;
  if (k === 'd') return proxies.children.find((p) => p.userData.drawn && p.userData.drawn.name === name) || null;
  return null;
}
// View preferences never enter the map edits or the game build.
let viewStateMap = null, objectViewState = { hidden: new Set(), locked: new Set() };
function viewState() {
  if (viewStateMap !== script) {
    viewStateMap = script;
    let saved = {};
    try {
      const kept = localStorage.getItem(projectStorageKey('objects.' + script, projectContext));
      const old = kept == null && projectContext?.kind === 'legacy' ? localStorage.getItem('deusedix.objects.' + script) : null;
      saved = JSON.parse(kept || old || '{}') || {};
    } catch { /* optional preference */ }
    const keys = v => new Set(Array.isArray(v) ? v.filter(k => typeof k === 'string') : []);
    objectViewState = { hidden: keys(saved.hidden), locked: keys(saved.locked) };
  }
  return objectViewState;
}
function objectStateKeys(p) {
  const key = keyOf(p), keys = [key];
  if (!key) return [];
  const st = p.userData.source === 'map' && p.userData.actor && structures[actorStruct[p.userData.actor.name]];
  if (st && !st.dissolved) keys.push('s:' + st.name);
  for (const own of [...keys]) {
    const seen = new Set();
    for (let n = parentNest(own); n && !seen.has(n.id); n = parentNest('n:' + n.id)) { seen.add(n.id); keys.push('n:' + n.id); }
  }
  return keys;
}
function objectHidden(p) { return objectStateKeys(p).some(k => viewState().hidden.has(k)); }
function objectLocked(p) { return objectStateKeys(p).some(k => viewState().locked.has(k)); }
function selectionLocked(p = selected) {
  if (!p) return false;
  if (p === groupPivot) return members().some(m => selectionLocked(m));
  if (objectLocked(p)) return true;
  return isStruct(p) && proxies.children.some(m => m.userData.actor && actorStruct[m.userData.actor.name] === p.userData.name && objectLocked(m));
}
function requireUnlocked(p = selected) {
  if (!selectionLocked(p)) return true;
  status('This selection is locked. Unlock it in the Hierarchy to edit it.', 'warn');
  return false;
}
function stateTargets(specs) {
  const targets = specs.flatMap(k => k.startsWith('n:') ? nestLeaves(nestById(k.slice(2))) : [objOf(k)]).filter(Boolean);
  return [...new Set(targets)];
}
function stateKeys(specs) { return specs.flatMap(k => k.startsWith('p:') ? ['s:' + k.slice(2).split('|')[0]] : [k]); }
function saveViewState() {
  const state = viewState();
  if (temporaryTutorial()) return;
  try { localStorage.setItem(projectStorageKey('objects.' + script, projectContext), JSON.stringify({ hidden: [...state.hidden], locked: [...state.locked] })); } catch { /* optional preference */ }
}
const isIcon = (p) => ['light', 'path', 'logic'].includes(p.userData.kind) && !p.userData.model && !!p.userData.body;
function applyObjectVisibility() {
  for (const p of proxies.children) if (keyOf(p)) {
    p.visible = !objectHidden(p);
    if (isIcon(p)) p.userData.body.visible = showIcons;      // hidden icons cannot be clicked: pick them in the Hierarchy
  }
  for (const st of Object.values(structures)) st.obj.visible = !poseOf(st).deleted && !st.dissolved && !objectHidden(st.obj);
  if (selected && (selectionLocked() || objectHidden(selected))) tc.detach();
  if (selected && objectHidden(selected)) { outline.visible = false; lightRange.visible = false; soundRange.visible = false; triggerZone.visible = false; }
}
function setObjectView(specs, property, value) {
  const state = viewState()[property];
  if (!state) return;
  if (anim) closeAnim();
  const keys = stateKeys(specs);
  if (!value) for (const p of stateTargets(keys)) {
    keys.push(...objectStateKeys(p));
    if (property === 'locked' && isStruct(p)) for (const child of proxies.children)
      if (child.userData.actor && actorStruct[child.userData.actor.name] === p.userData.name) keys.push(...objectStateKeys(child));
  }
  for (const key of keys) { if (value) state.add(key); else state.delete(key); }
  saveViewState();
  applyObjectVisibility();
  if (selected) select(selected); else buildHierarchy();
}
function showAllObjects() { viewState().hidden.clear(); saveViewState(); applyObjectVisibility(); if (selected) select(selected); else buildHierarchy(); }
function unlockAllObjects() { viewState().locked.clear(); saveViewState(); if (selected) select(selected); else buildHierarchy(); }
function setGameEnabled(names, enabled) {
  const actors = [...new Set(names)].map(name => proxyOf(name)).filter(Boolean);
  if (!actors.length || actors.some(p => !requireUnlocked(p))) return;
  const changed = actors.filter(p => !!edits.disabled?.[p.userData.actor.name] === enabled);
  if (!changed.length) return;
  pushUndo();
  edits.disabled ||= {};
  for (const p of changed) { const name = p.userData.actor.name; if (enabled) delete edits.disabled[name]; else edits.disabled[name] = true; }
  if (!Object.keys(edits.disabled).length) delete edits.disabled;
  setDirty(); showDetails(); buildHierarchy();
  status(`${changed.length === 1 ? hierLabel(changed[0].userData.actor) : changed.length + ' objects'} ${enabled ? 'enabled' : 'disabled'} in game. Rebuild to apply.`, 'ok');
}
const nestById = (id) => nests().find((n) => n.id === id);
const parentNest = (key) => nests().find((n) => n.items.includes(key));
function outerNest(key) {              // the outermost nest around key
  let top = null;
  const seen = new Set();
  for (let n = parentNest(key); n && !seen.has(n.id); n = parentNest('n:' + n.id)) { seen.add(n.id); top = n; }
  return top;
}
function nestsWithin(id, seen = new Set()) {      // the nests inside a nest, at any depth
  const n = nestById(id);
  if (!n || seen.has(id)) return [];
  seen.add(id);
  const out = [];
  for (const k of n.items) if (k.startsWith('n:')) out.push(k.slice(2), ...nestsWithin(k.slice(2), seen));
  return out;
}
function nestLeaves(n, seen = new Set()) {         // what moves when the nest moves
  if (!n || seen.has(n.id)) return [];
  seen.add(n.id);
  const out = [];
  for (const k of n.items) {
    if (k.startsWith('n:')) out.push(...nestLeaves(nestById(k.slice(2)), seen));
    else { const o = objOf(k); if (o) out.push(o); }
  }
  return out;
}
function newNest(label, items) {
  const state = viewState();
  let i = 1;
  while (nestById('n' + i) || state.hidden.has('n:n' + i) || state.locked.has('n:n' + i)) i++;
  const n = { id: 'n' + i, label, items };
  nests().push(n);
  return n;
}
function nextNestLabel() {
  let i = 1;
  while (nests().some((n) => n.label === 'Folder ' + i)) i++;
  return 'Folder ' + i;
}
function dropEmptyNests() {
  for (;;) {
    const empty = new Set(nests().filter((n) => !n.items.length && !n.folder).map((n) => 'n:' + n.id));
    if (!empty.size) return;
    edits.nests = nests().filter((n) => !empty.has('n:' + n.id));
    for (const n of nests()) n.items = n.items.filter((k) => !empty.has(k));
  }
}
function forgetKeys(keys) {            // things deleted: out of their nests (empty nests go)
  const gone = new Set(keys.filter(Boolean));
  if (!gone.size || !nests().length) return;
  edits.nests = nests().filter((n) => !gone.has('n:' + n.id));
  for (const n of nests()) n.items = n.items.filter((k) => !gone.has(k));
  dropEmptyNests();
}
// the selection as nests know it: what was picked (a nest is one thing)
function selKeys() {
  if (selected === groupPivot) {
    if (groupPivot.userData.nest) return ['n:' + groupPivot.userData.nest];
    return (groupPivot.userData.keys || members().map(keyOf)).filter(Boolean);
  }
  const k = keyOf(selected);
  return k ? [k] : [];
}
function selectKeys(keys, nest = null) {
  const list = [];
  for (const k of keys) {
    if (k.startsWith('n:')) list.push(...nestLeaves(nestById(k.slice(2))));
    else { const o = objOf(k); if (o) list.push(o); }
  }
  setMulti(list, nest, keys);
}
function selectNest(id) { if (nestById(id)) selectKeys(['n:' + id], id); }
function groupTurns() {                // a group with a structure that has doors or a lift moves, but does not turn
  return !members().some((m) => isStruct(m) && structures[m.userData.name].rotatable === false);
}

// ------------------------------- a structure of the map taken apart
const takenOut = () => new Set(edits.unnest || []);
function piecesInside(st) {
  const out = takenOut();
  return out.has(st.name) ? [] : (st.pieces || []).filter((pc) => !out.has(pc.id));
}
let objectNames = { of: null, set: new Set() };    // the map's objects (a structure's list has its brushes too)
function isObjectName(a) {
  if (objectNames.of !== baseActors) objectNames = { of: baseActors, set: new Set(baseActors.map((x) => x.name)) };
  return objectNames.set.has(a);
}
const objectsInside = (st) => Object.keys(actorStruct).filter((a) => actorStruct[a] === st.name && isObjectName(a));
function canTakeApart(st) {            // a built structure with more than one thing inside
  if (!st || !st.built || st.paste || st.dissolved || !st.pieces) return false;
  const pcs = piecesInside(st), objs = objectsInside(st).filter((a) => !pcs.some((pc) => (pc.actors || []).includes(a)));
  return pcs.length + objs.length > 1;
}
const movedPose = (p) => (p.offset || [0, 0, 0]).some((v) => v) || !!(p.yaw || p.pitch || p.roll) || scaleOf(p).some((v) => v !== 1);
// pieces and objects leave st where they are now: their own pose, their own place in the edits
function bakeOut(st, pcs, objs) {
  const pose = poseOf(st);
  const now = poseToPose(st, NO_POSE, pose), toScript = poseToPose(st, pose, NO_POSE);
  const builtNow = poseToPose(st, st.placement, pose), builtScript = poseToPose(st, st.placement, NO_POSE);
  for (const pc of pcs) {
    if (!movedPose(pose)) { delete edits.groups[pc.id]; continue; }
    const c = now(pc.pivot);
    edits.groups[pc.id] = setPose({}, { ...pose, offset: [0, 1, 2].map((i) => r1(c[i] - pc.pivot[i])), scale: scaleOf(pose) });
  }
  for (const n of objs) {
    const mv = edits.moved[n], dl = edits.deleted[n], a = baseActors.find((x) => x.name === n);
    if (mv) { if (mv.orig) mv.orig = toScript(mv.orig).map(r1); }      // its place in the script: no structure moves it now
    else if (a && (movedPose(pose) || movedPose(st.placement))) {
      const dy = (pose.yaw || 0) - (st.placement.yaw || 0);
      edits.moved[n] = { cls: a.cls, loc: builtNow(a.loc).map(r1), rot: rotations.carry(a.rot, st.placement, pose),
                         orig: builtScript(a.loc).map(r1) };
      if (builtScale[n] && builtScale[n] !== 1) edits.moved[n].scale = builtScale[n];
    }
    if (dl && dl.orig) dl.orig = toScript(dl.orig).map(r1);
  }
}
function takeOutOf(st, pcs, objs) {    // (the undo is the caller's)
  bakeOut(st, pcs, objs);
  for (const id of [...pcs.map((pc) => pc.id), ...objs.map((n) => 'a:' + n)]) if (!unnests().includes(id)) unnests().push(id);
  if (st.built && (st.pieces || []).length && !piecesInside(st).length && objectsInside(st).every((a) => objs.includes(a)))
    delete edits.groups[st.name];                    // nothing left in it: the structure is gone
}
// Un-nest a whole structure: its pieces and its objects on their own, in its place (its nest, if it has one);
// the things the script describes under one comment stay together in a nest named after it
function takeApart(st) {
  if (!requireUnlocked(st.obj)) return;
  if (!canTakeApart(st)) return;
  pushUndo();
  const pcs = piecesInside(st), objs = objectsInside(st).filter((a) => !pcs.some((pc) => (pc.actors || []).includes(a)));
  takeOutOf(st, pcs, objs);
  const notes = new Map(), loose = [];
  const put = (note, key) => {
    if (!note) { loose.push(key); return; }
    if (!notes.has(note[0])) notes.set(note[0], { text: note[1], keys: [] });
    notes.get(note[0]).keys.push(key);
  };
  for (const pc of pcs) put(pc.note, 's:' + pc.id);
  for (const a of objs) put((st.notes || {})[a], 'a:' + a);
  const keys = [];
  for (const g of notes.values()) {
    if (notes.size > 1 && g.keys.length > 1) keys.push('n:' + newNest(g.text, g.keys).id);
    else keys.push(...g.keys);
  }
  keys.push(...loose);
  const up = parentNest('s:' + st.name);
  if (up) up.items.splice(up.items.indexOf('s:' + st.name), 1, ...keys);
  setDirty(); rebuildProxies();
  selectKeys(keys);
  log(`"${st.label}" un-nested: ${pcs.length} piece${pcs.length === 1 ? '' : 's'}${objs.length ? ` and ${objs.length} object${objs.length === 1 ? '' : 's'}` : ''} on their own. They move one by one now; Rebuild makes them structures of the map. Ctrl+Z puts them back.`, 'ok');
}

// what is out of its structure shows on its own at once: the structure's triangles split by brush
function syncPieces() {
  const out = takenOut();
  let changed = false;
  for (const st of Object.values(structures)) {
    if (!st.built || !(st.pieces || []).length) continue;
    const gone = st.pieces.filter((pc) => out.has(st.name) || out.has(pc.id));
    const key = gone.map((pc) => pc.id).join('|');
    if (key === (st.outKey || '')) continue;
    partition(st, gone);
    st.outKey = key;
    changed = true;
  }
  actorStruct = {};
  for (const st of Object.values(structures)) if (st.built) for (const a of st.actors || []) actorStruct[a] = st.name;
  for (const st of Object.values(structures)) if (st.pendingPiece) for (const a of st.actors || []) actorStruct[a] = st.name;
  for (const w of out) if (w.startsWith('a:')) delete actorStruct[w.slice(2)];
  for (const st of Object.values(structures)) if (st.built && out.has(st.name)) for (const a of st.actors || []) if (actorStruct[a] === st.name) delete actorStruct[a];
  const holds = new Set(Object.keys(actorStruct).filter(isObjectName).map((a) => actorStruct[a]));    // objects, not pasted brushes
  for (const st of Object.values(structures)) if (st.built) st.dissolved = !!(st.pieces && st.pieces.length) && !piecesInside(st).length && !holds.has(st.name);
  if (changed) refreshWorldMeshes();
}
function subMesh(m, tris, shift) {     // some triangles of a mesh, moved by shift (three's axes)
  const g0 = m.geometry, geo = new THREE.BufferGeometry();
  for (const name of ['position', 'uv', 'uv1', 'uvBase', 'uvAxisU', 'uvAxisV']) {
    const a = g0.getAttribute(name);
    if (!a) continue;
    const s = a.itemSize, arr = new Float32Array(tris.length * 3 * s);
    let j = 0;
    for (const t of tris) for (let i = t * 3 * s, e = i + 3 * s; i < e; i++) arr[j++] = a.array[i];
    if (name === 'position' && shift) for (let i = 0; i < arr.length; i += 3) { arr[i] += shift.x; arr[i + 1] += shift.y; arr[i + 2] += shift.z; }
    geo.setAttribute(name, new THREE.BufferAttribute(arr, s));
  }
  geo.computeVertexNormals();
  const sub = new THREE.Mesh(geo, m.material);
  const faces = m.userData.faces || [];
  sub.userData = Object.assign({}, m.userData, { faces: tris.map((t) => faces[t]), part: true });
  return sub;
}
function partition(st, gone) {
  if (!st.full) st.full = st.obj.children.filter((m) => m.isMesh);
  for (const m of st.obj.children.slice()) if (m.isMesh) { st.obj.remove(m); if (!st.full.includes(m)) m.geometry.dispose(); }
  for (const id of st.pendingPieces || []) {
    const s = structures[id];
    if (!s) continue;
    world.remove(s.obj);
    s.obj.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    delete structures[id];
  }
  st.pendingPieces = [];
  if (!gone.length) { for (const m of st.full) st.obj.add(m); return; }
  const owner = new Map();
  gone.forEach((pc, k) => { for (const o of pc.brushes || []) owner.set('o' + o, k); for (const n of pc.brush_names || []) owner.set('n' + n, k); });
  const pieceOf = (fid) => { const f = geoFaces[fid]; if (!f) return -1; const k = owner.get('o' + f.ord) ?? owner.get('n' + f.brush); return k === undefined ? -1 : k; };
  const toBuilt = poseToPose(st, NO_POSE, st.placement), cb = T(st.center);
  const made = gone.map((pc) => {
    const c = toBuilt(pc.pivot), obj = new THREE.Group();
    obj.userData = { kind: 'structure', name: pc.id };
    world.add(obj);
    const placement = { ...st.placement, offset: [0, 1, 2].map((i) => r1(c[i] - pc.pivot[i])), scale: scaleOf(st.placement) };
    obj.position.copy(T(c));
    obj.quaternion.copy(rotations.pose(placement));
    st.pendingPieces.push(pc.id);
    return structures[pc.id] = { name: pc.id, obj, label: pc.label, category: st.category, pivot: pc.pivot, placement, center: c,
      actors: (pc.actors || []).slice(), rotatable: true, scalable: pc.rotatable ?? (!(pc.actors || []).length || st.scalable), copyable: pc.copyable ?? (!(pc.actors || []).length && mapKind === 'script'), gameplay: false, built: false,
      pendingPiece: true, piece_of: st.name, shift: cb.clone().sub(T(c)).applyQuaternion(rotations.pose(placement).invert()) };
  });
  for (const m of st.full) {
    const faces = m.userData.faces || [], buckets = new Map();
    for (let t = 0; t < faces.length; t++) { const k = pieceOf(faces[t]); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(t); }
    if (!buckets.size || (buckets.size === 1 && buckets.has(-1))) { st.obj.add(m); continue; }
    for (const [k, tris] of buckets) {
      if (k < 0) st.obj.add(subMesh(m, tris, null));
      else made[k].obj.add(subMesh(m, tris, made[k].shift));
    }
  }
}
function refreshWorldMeshes() {        // what drops and rays hit, what face selection sees
  worldMeshes.length = 0;
  const faced = [];
  for (const c of world.children) {
    const st = c.userData && c.userData.kind === 'structure' ? structures[c.userData.name] : null;
    if (st && (st.pendingCopy || st.pendingPaste)) continue;
    c.traverse((o) => {
      if (!o.isMesh || !o.userData.world) return;
      faced.push(o);
      if (!(o.userData.flags & (PF.translucent | PF.modulated))) worldMeshes.push(o);
    });
  }
  surfaceTools.load(geoFaces, faced);
}
// where a piece still inside its structure is (picked in the Hierarchy)
const pieceBox = new THREE.Box3Helper(new THREE.Box3(), 0x6bd6ff);
pieceBox.visible = false;
scene.add(pieceBox);
function showPieceBox(st, pc) {
  pieceBox.visible = false;
  if (!st || !pc) return;
  const own = new Set([...(pc.brushes || []).map((o) => 'o' + o), ...(pc.brush_names || []).map((n) => 'n' + n)]);
  const box = pieceBox.box.makeEmpty(), v = new THREE.Vector3();
  st.obj.updateMatrixWorld(true);
  for (const m of st.obj.children) {
    if (!m.isMesh) continue;
    const P = m.geometry.getAttribute('position');
    (m.userData.faces || []).forEach((fid, t) => {
      const f = geoFaces[fid];
      if (!f || !(own.has('o' + f.ord) || own.has('n' + f.brush))) return;
      for (let j = 0; j < 3; j++) box.expandByPoint(v.fromBufferAttribute(P, t * 3 + j).applyMatrix4(m.matrixWorld));
    });
  }
  pieceBox.visible = !box.isEmpty();
}
function focusPieceBox() {
  if (!pieceBox.visible) return;
  const c = pieceBox.box.getCenter(new THREE.Vector3()), r = Math.max(120, pieceBox.box.getSize(new THREE.Vector3()).length() * 0.6);
  camera.position.copy(c.clone().addScaledVector(forward(), -r * 1.4));
}

// ------------------------------- the actions
function hierarchyRoots(keys) {
  const chosen = new Set(keys.filter(Boolean));
  return [...chosen].filter(key => {
    const roots = [key];
    const holder = key.startsWith('a:') ? actorStruct[key.slice(2)] : key.startsWith('p:') ? key.slice(2).split('|')[0] : null;
    if (holder) { if (chosen.has('s:' + holder)) return false; roots.push('s:' + holder); }
    for (const own of roots) {
      const seen = new Set();
      for (let n = parentNest(own); n && !seen.has(n.id); n = parentNest('n:' + n.id)) {
        seen.add(n.id);
        if (chosen.has('n:' + n.id)) return false;
      }
    }
    return true;
  });
}
function nestKeys(keys) {
  keys = hierarchyRoots(keys);
  if (stateTargets(keys).some(p => !requireUnlocked(p))) return;
  if (!keys.length) { status('Select what to nest first: Ctrl+click several things (here or in the Hierarchy), or Ctrl+drag a rectangle.', 'warn'); return; }
  const poses = captureHierarchyActors(keys);
  pushUndo();
  // one parent each: what was inside a structure of the map comes out of it first
  for (const k of keys) {
    const st = k.startsWith('a:') && structures[actorStruct[k.slice(2)]];
    if (st) takeOutOf(st, [], [k.slice(2)]);
  }
  const up = parentNest(keys[0]);
  for (const k of keys) { const p = parentNest(k); if (p) p.items = p.items.filter((x) => x !== k); }
  const n = newNest(nextNestLabel(), keys);
  if (up) up.items.push('n:' + n.id);
  dropEmptyNests();
  retainHierarchyActors(poses);
  setDirty(); rebuildProxies();
  selectNest(n.id);
  log(`"${n.label}": ${keys.length} thing${keys.length === 1 ? '' : 's'} in a folder, moved as one. Type its name (F2 renames it later); Ctrl+Shift+G (Un-nest) takes them out again.`, 'ok');
}
function unnestNest(id) {
  const n = nestById(id);
  if (!n) return;
  if (nestLeaves(n).some(p => !requireUnlocked(p))) return;
  const poses = captureHierarchyActors(['n:' + id]);
  pushUndo();
  const up = parentNest('n:' + id);
  if (up) up.items.splice(up.items.indexOf('n:' + id), 1, ...n.items);
  edits.nests = nests().filter((x) => x !== n);
  retainHierarchyActors(poses);
  setDirty(); rebuildProxies();
  selectKeys(n.items);
  log(`"${n.label}" un-nested: ${n.items.length} thing${n.items.length === 1 ? '' : 's'} on their own again.`, 'ok');
}
function nestSelection() { nestKeys(selKeys()); }
function unnestSelection() {
  if (selected === groupPivot && groupPivot.userData.nest) return unnestNest(groupPivot.userData.nest);
  if (isStruct(selected) && canTakeApart(structures[selected.userData.name])) return takeApart(structures[selected.userData.name]);
  if (isStruct(selected) && structures[selected.userData.name].built && !structures[selected.userData.name].pieces) {
    status('Rebuild the map once: then its structures can be taken apart (this build is older than Un-nest).', 'warn');
    return;
  }
  // several things picked one by one: each comes out of its nest (or structure) one level, the rest stays nested
  if (selected === groupPivot) {
    const up = new Map();
    for (const key of selKeys()) {
      const st = key.startsWith('a:') && structures[actorStruct[key.slice(2)]], n = !st && parentNest(key);
      if (!st && !n) continue;
      const dest = st ? parentNest('s:' + st.name)?.id || null : parentNest('n:' + n.id)?.id || null;
      up.set(dest, (up.get(dest) || []).concat([key]));
    }
    if (up.size) { for (const [dest, keys] of up) moveManyTo(keys, dest); return; }
  }
  const k = keyOf(selected);
  if (k && (parentNest(k) || (k.startsWith('a:') && actorStruct[k.slice(2)]))) return takeOut(k);
  status('Select a nest, or a structure with several things inside, to un-nest it. One thing comes out of it by dragging it in the Hierarchy.', 'warn');
}
function takeOut(k) {                  // one level up: out of its structure, or out of its nest
  const st = k.startsWith('a:') && structures[actorStruct[k.slice(2)]];
  if (st) return moveTo(k, parentNest('s:' + st.name)?.id || null);
  const n = parentNest(k);
  if (n) moveTo(k, parentNest('n:' + n.id)?.id || null);
}
// Nest membership is editor metadata, not a Three.js transform parent. Keep the displayed world
// transform when that metadata changes, including an actor taken out of a moved/scaled structure.
function captureHierarchyActors(keys) {
  return stateTargets(keys).filter(p => p.userData.actor).map(p => {
    p.updateWorldMatrix(true, false);
    return { actor: p.userData.actor, source: p.userData.source, structure: structures[actorStruct[p.userData.actor.name]],
      position: p.getWorldPosition(new THREE.Vector3()), quaternion: p.getWorldQuaternion(new THREE.Quaternion()),
      scale: p.getWorldScale(new THREE.Vector3()) };
  });
}
function retainHierarchyActors(poses) {
  for (const pose of poses) {
    const a = pose.actor, loc = UE(pose.position), yaw = radToYaw(new THREE.Euler().setFromQuaternion(pose.quaternion, 'YXZ').y);
    const rot = [a.rot?.[0] || 0, yaw, a.rot?.[2] || 0];
    if (pose.source === 'added') {
      const entry = edits.added.find(x => x.name === a.name);
      if (!entry) continue;
      entry.loc = loc; entry.rot = rot;
      if (canScale({ userData: { kind: a.kind || addedKind(a.cls), actor: a } })) entry.scale = r1(pose.scale.x * 100) / 100;
      continue;
    }
    const previous = edits.moved[a.name], original = baseActors.find(x => x.name === a.name);
    if (!original) continue;
    let orig = previous?.orig || original.loc;
    // bakeOut normally supplies orig. If neither structure pose changed, its built position is
    // already the script position; an explicitly detached actor must not inherit its old parent.
    if (!previous?.orig && pose.structure && takenOut().has('a:' + a.name))
      orig = poseToPose(pose.structure, pose.structure.placement, NO_POSE)(original.loc).map(r1);
    edits.moved[a.name] = Object.assign({}, previous, { cls: a.cls, loc, rot, orig: [...orig] });
    const scale = Math.round(pose.scale.x * (builtScale[a.name] || 1) * 100) / 100;
    if (Math.abs(scale - 1) > 0.005) edits.moved[a.name].scale = scale;
    else delete edits.moved[a.name].scale;
  }
}
function reparentCheck(spec, target) {
  if (typeof spec !== 'string' || !spec) return { reason: 'Choose an object to move.' };
  if (target && !nestById(target)) return { reason: 'That Nest no longer exists.' };
  let key = spec, st = null, pc = null;
  if (spec.startsWith('p:')) {
    const [g, id] = spec.slice(2).split('|');
    st = structures[g]; pc = st && piecesInside(st).find(x => x.id === id);
    if (!pc) return { reason: 'That piece no longer exists.' };
    key = 's:' + id;
  } else if (spec.startsWith('n:')) {
    if (!nestById(spec.slice(2))) return { reason: 'That Nest no longer exists.' };
    if (target && (key === 'n:' + target || nestsWithin(spec.slice(2)).includes(target)))
      return { reason: 'A Nest cannot be placed inside itself or its children.' };
  } else {
    const object = objOf(spec);
    if (!object) return { reason: 'That object no longer exists.' };
    if (object.userData.kind === 'mover') return { reason: 'Move the door’s structure; the door stays attached to its geometry.' };
    if (spec.startsWith('a:')) st = structures[actorStruct[spec.slice(2)]];
  }
  if (stateTargets(stateKeys([spec, ...(target ? ['n:' + target] : [])])).some(p => selectionLocked(p)))
    return { reason: 'Unlock the object and destination Nest before moving it.' };
  const from = parentNest(key), to = target ? nestById(target) : null;
  return { key, st, pc, from, to, unchanged: !st && (from?.id || null) === (target || null) };
}
// one thing (or a piece of a structure: 'p:<structure>|<piece>') into a nest, or out to the top (target null)
function moveTo(spec, target) {
  const plan = reparentCheck(spec, target);
  if (plan.reason) { status(plan.reason, 'warn'); return; }
  if (plan.unchanged) return;
  const { key: k, st, pc, from, to } = plan, poses = captureHierarchyActors([spec]);
  pushUndo();
  if (st) takeOutOf(st, pc ? [pc] : [], pc ? [] : [spec.slice(2)]);
  if (from) from.items = from.items.filter((x) => x !== k);
  if (to && !to.items.includes(k)) to.items.push(k);
  dropEmptyNests();
  retainHierarchyActors(poses);
  setDirty(); rebuildProxies();
  if (k.startsWith('n:')) selectNest(k.slice(2));
  else { const o = objOf(k); if (o) select(o); }
  status(to ? `Moved into "${to.label}". Position unchanged.` : 'Moved to the top level. Position unchanged.', 'ok');
}
// several things at once (the Hierarchy's selection dragged together): one undo, the same checks as moveTo
function moveManyTo(keys, target) {
  if (keys.length === 1) return moveTo(keys[0], target);
  const plans = keys.map((k) => [k, reparentCheck(k, target)]);
  const bad = plans.find(([, p]) => p.reason);
  if (bad) { status(bad[1].reason, 'warn'); return; }
  const todo = plans.filter(([, p]) => !p.unchanged);
  if (!todo.length) return;
  const poses = captureHierarchyActors(todo.map(([k]) => k)), to = target ? nestById(target) : null, moved = [];
  pushUndo();
  for (const [spec, { key: k, st, pc }] of todo) {
    if (st) takeOutOf(st, pc ? [pc] : [], pc ? [] : [spec.slice(2)]);
    const from = parentNest(k);
    if (from) from.items = from.items.filter((x) => x !== k);
    if (to && !to.items.includes(k)) to.items.push(k);
    moved.push(k);
  }
  dropEmptyNests();
  retainHierarchyActors(poses);
  setDirty(); rebuildProxies();
  selectKeys(moved);
  status(`${moved.length} things moved ${to ? `into "${to.label}"` : 'to the top level'}. Positions unchanged.`, 'ok');
}

// ------------------------------- the menu of the right button (Hierarchy, 3D view)
const ctxMenu = document.createElement('div');
ctxMenu.id = 'ctxmenu';
document.body.appendChild(ctxMenu);
{
  const s = document.createElement('style');
  s.textContent = `#ctxmenu { position:fixed; z-index:90; display:none; min-width:220px; max-width:340px; padding:4px; background:var(--panel); color:var(--text);
    border:1px solid var(--line); border-radius:var(--radius-window, 6px); box-shadow:0 10px 30px rgba(0,0,0,.5); font-size:12px; }
  #ctxmenu.open { display:block; }
  #ctxmenu button { display:flex; width:100%; align-items:center; gap:12px; justify-content:space-between; padding:6px 10px; border:0; background:none;
    color:inherit; font:inherit; text-align:left; border-radius:var(--radius-row, 4px); cursor:pointer; }
  #ctxmenu button:hover:not(:disabled) { background:var(--field); color:var(--heading, inherit); }
  #ctxmenu button:disabled { opacity:.45; cursor:default; }
  #ctxmenu small { color:var(--dim); }
  #ctxmenu hr { border:0; border-top:1px solid var(--line); margin:4px 2px; }
  #details .inspector-object-heading { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
  #details .inspector-object-heading > b { flex:1; min-width:0; overflow-wrap:anywhere; }
  #details .inspector-primary-actions { display:flex; gap:5px; flex:none; }
  #details .inspector-primary { display:inline-flex; align-items:center; justify-content:center; width:30px; height:28px; min-width:30px; padding:0; border:1px solid currentColor; border-radius:var(--radius-button, 4px); }
  #details .inspector-primary svg { width:17px; height:17px; display:block; flex:none; }
  #details .inspector-primary.talk { color:#83cfff; background:#19394b; }
  #details .inspector-primary.connect { color:#ffd17b; background:#49371b; }
  #details .inspector-primary:hover:not(:disabled) { filter:brightness(1.2); }
  #details .inspector-primary:focus-visible { outline:2px solid var(--heading); outline-offset:2px; }
  #details .inspector-primary:disabled { opacity:.45; }
  #details .place-split { display:inline-flex; }
  #details .place-split > .ib:first-child { border-top-right-radius:0; border-bottom-right-radius:0; }
  #details .place-split > .place-mode { border-top-left-radius:0; border-bottom-left-radius:0; border-left:0; padding-left:3px; padding-right:3px; min-width:0; }
  #details .place-split > .place-mode svg { width:12px; height:12px; }
  #hier.drop-top { outline:1px dashed var(--acc); outline-offset:-2px; }
  #hier .drop-into { outline:1px dashed var(--acc); outline-offset:-1px; }
  #hier .hpiece .hl { opacity:.85; }`;
  document.head.appendChild(s);
}
let ctxItems = [], hierarchyDragging = false;
function openMenu(x, y, items) {
  ctxItems = items;
  ctxMenu.innerHTML = items.map((it, i) => it.sep ? '<hr>' : `<button data-ci="${i}" ${it.off ? 'disabled' : ''}><span>${escapeHtml(it.label)}</span>${it.key ? `<small>${escapeHtml(it.key)}</small>` : ''}</button>`).join('');
  ctxMenu.classList.add('open');
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  ctxMenu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
function closeMenu() { ctxMenu.classList.remove('open'); }
ctxMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ci]');
  if (!b) return;
  closeMenu();
  const it = ctxItems[+b.dataset.ci];
  if (it && it.run && !it.off) Promise.resolve().then(it.run).catch(err => log(err.message, 'bad'));
});
document.addEventListener('pointerdown', (e) => { if (!ctxMenu.contains(e.target)) closeMenu(); }, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, true);
window.addEventListener('blur', closeMenu);
const menuKey = (id) => (window.__menubar ? window.__menubar.keyOf(id) : { nest: 'Ctrl+G', unnest: 'Ctrl+Shift+G' }[id]);
function specSelect(spec) {            // the thing the menu is about becomes the selection
  if (spec.startsWith('p:')) { const [g] = spec.slice(2).split('|'); if (structures[g]) select(structures[g].obj); return; }
  if (spec.startsWith('n:')) { selectNest(spec.slice(2)); return; }
  const o = objOf(spec);
  if (o) select(o);
}
function texRowForHit(rows, hit) {
  const data = hit?.object?.userData;
  return data && rows.find(row => row.kind === 'actor' ? data.slot === row.slot : data.tex === row.tex);
}
function menuFor(spec, surface = null) {
  const items = [];
  if (spec.startsWith('p:')) {
    const [g, id] = spec.slice(2).split('|'), st = structures[g], pc = st && (st.pieces || []).find((x) => x.id === id);
    if (!pc) return [{ label: 'Nothing to do here', off: true }];
    items.push({ label: `Take out of "${st.label}"`, run: () => moveTo(spec, parentNest('s:' + st.name)?.id || null) });
    for (const n of nests()) items.push({ label: `Move into "${n.label}"`, run: () => moveTo(spec, n.id) });
    return items.slice(0, 12);
  }
  const sel = selKeys(), several = sel.length > 1 && sel.includes(spec);
  const keys = several ? sel : [spec];
  const targets = stateTargets(keys), locked = targets.some(p => selectionLocked(p));
  if (!several) {
    const o = objOf(spec), d = o?.userData, a = d?.actor;
    const use = fn => () => { specSelect(spec); return fn(); };
    const dialogue = a && a.talker !== false && (d.kind === 'pawn' || d.kind === 'prop')
      ? { label:'Dialogue…', off:locked, run:use(() => window.__story?.openFor(a.name)) } : null;
    if (dialogue && isCharacter(a)) items.push(dialogue);
    if (a) items.push({ label:'Connect…', off:locked, run:use(() => connectObject(o)) });
    if (a) items.push({ label:'Connect within radius…', off:locked, run:use(() => connectAreaObject(o)) });
    if (dialogue && !isCharacter(a)) items.push(dialogue);
    if (a) items.push({ sep:true });
  }
  const hidden = targets.length > 0 && targets.every(objectHidden);
  items.push({ label: hidden ? 'Show in Scene' : 'Hide in Scene', run: () => setObjectView(keys, 'hidden', !hidden) });
  items.push({ label: locked ? 'Unlock selection' : 'Lock selection', run: () => setObjectView(keys, 'locked', !locked) });
  const actors = targets.filter(p => p.userData.actor), enabled = actors.some(p => !edits.disabled?.[p.userData.actor.name]);
  if (actors.length) items.push({ label: enabled ? 'Disable in game' : 'Enable in game', off: locked, run: () => setGameEnabled(actors.map(p => p.userData.actor.name), !enabled) });
  items.push({ sep: true });
  if (!several) {
    const o = objOf(spec), d = o?.userData, a = d?.actor;
    const use = (fn) => () => { specSelect(spec); return fn(o); };
    if (a && isCharacter(a)) items.push({ label: 'Animation Studio…', off: locked, run: use(() => window.__studio?.open(a.cls)) });
    if (a && isCharacter(a)) items.push({ label: 'Pose here…', off: locked, run: use(() => mapPose.open(o)) });
    if (a?.cls === 'UCCutscene') items.push({ label: 'Edit cutscene…', off: locked, run: use(() => window.__cutscene?.open(a.name)) });
    else if (a || (d?.box && !d.box.hole && !d.box.water && !d.box.portal))
      items.push({ label: 'Animate movement…', off: locked, run: use(() => openAnim(o)) });
    if (d?.kind === 'light') items.push({ label: 'Light settings…', run: () => focusInspector(spec, '[data-inspector-section="Light"]') });
    if (a && (propSchema[a.cls] || []).some(f => f.kind === 'text'))
      items.push({ label: 'Edit text…', run: () => focusInspector(spec, '.game-document') });
    // the Texture Editor straight away (Gabby, 18 Oct 2026): one item per texture when they are few, else the
    // Inspector's list to choose from (a whole structure)
    const texList = o ? texRows(o) : [];
    const editTex = (row) => () => { specSelect(spec); const ov = texOverride(o, row); window.__texedit?.open(texContext(o, row, ov ? ov.tex : null)); };
    const clickedTexture = surface?.owner === o ? texRowForHit(texList, surface.hit) : null;
    if (clickedTexture) items.push({ label: `Edit texture ${shortTex(texOverride(o, clickedTexture)?.tex || clickedTexture.tex)}…`, off: locked, run: editTex(clickedTexture) });
    else if (texList.length === 1) items.push({ label: 'Edit texture…', off: locked, run: editTex(texList[0]) });
    else if (texList.length > 1 && texList.length <= 4)
      for (const row of texList) items.push({ label: `Edit texture ${shortTex(texOverride(o, row)?.tex || row.tex)}…`, off: locked, run: editTex(row) });
    else if (texList.length) items.push({ label: 'Edit textures…', run: () => focusInspector(spec, '[data-inspector-section="textures"]') });
    if (a) items.push({ label: 'Interactions…', run: () => focusInspector(spec, '#lkwhen, #lkconnect') });
    if (items.length) items.push({ sep: true });
  }
  const actOnSelection = (fn) => () => { if (!several) specSelect(spec); return fn(); };
  items.push({ label: 'Focus', key: 'F', run: () => { if (!several) specSelect(spec); focusSelected(); } });
  items.push({ label: 'Duplicate', key: 'Ctrl+D', off: locked, run: actOnSelection(duplicateSelected) });
  items.push({ label: 'Copy', key: 'Ctrl+C', run: actOnSelection(copySelected) });
  if (spec.startsWith('n:') || spec.startsWith('s:') || several)
    items.push({ label: 'Save as prefab…', off: !!gameView?.active, run: actOnSelection(() => prefabBrowser.save()) });
  for (const [m, label] of PLACE_MODES)        // Drop to floor / Stick to surface: the one chosen is End's
    items.push({ label, key: m === placeMode ? (menuKey('drop') || 'End') : '', off: locked, run: actOnSelection(() => placeSelected(m)) });
  items.push({ sep: true });
  items.push({ label: 'Create folder', key: menuKey('nest'), off: locked, run: () => { const before = nests().length; nestKeys(keys); if (nests().length > before && selected === groupPivot && groupPivot.userData.nest) renameFolder(groupPivot.userData.nest); } });
  if (spec.startsWith('n:')) {
    const id = spec.slice(2);
    items.push({ label: 'Un-nest', key: menuKey('unnest'), run: () => unnestNest(id) });
    items.push({ label: 'Rename', key: 'F2', run: () => { selectNest(id); if (!selected) hierFolderOn = id; renameFolder(id); } });
  }
  const st = spec.startsWith('s:') && structures[spec.slice(2)];
  if (st && canTakeApart(st)) items.push({ label: 'Un-nest: take it apart', key: menuKey('unnest'), run: () => takeApart(st) });
  const holder = spec.startsWith('a:') && structures[actorStruct[spec.slice(2)]];
  if (holder) items.push({ label: `Take out of "${holder.label}"`, run: () => takeOut(spec) });
  const n = parentNest(spec);
  if (n) items.push({ label: `Take out of "${n.label}"`, run: () => takeOut(spec) });
  const into = nests().filter((x) => x !== n && 'n:' + x.id !== spec && !(spec.startsWith('n:') && nestsWithin(spec.slice(2)).includes(x.id)));
  for (const x of into.slice(0, 8)) items.push({ label: `Move into "${x.label}"`, run: () => moveTo(spec, x.id) });
  items.push({ sep: true });
  items.push({ label: several ? `Delete these ${keys.length}` : 'Delete', key: 'Del', off: locked, run: () => { if (!several) specSelect(spec); if (!selected && spec.startsWith('n:') && deleteFolder(spec.slice(2))) return; deleteSelected(); } });
  return items;
}
// the Hierarchy: drag things into a nest or out of it, the right button for the menu
{
  const hier = $('#hier');
  let dragSpec = null;
  const specOf = (t) => { const r = t.closest('[data-piece],[data-key]'); return !r ? null : r.dataset.piece ? 'p:' + r.dataset.piece : r.dataset.key; };
  const dropHint = document.createElement('div');
  dropHint.className = 'hier-drop-hint';
  dropHint.setAttribute('role', 'status');
  dropHint.setAttribute('aria-live', 'polite');
  dropHint.hidden = true;
  hier.after(dropHint);
  // Like Unity: drag a row (or the whole selection, when the row is part of it) onto a nest to put it in,
  // or onto "take it out" at the top of the list (shown while dragging something nested) to take it out.
  let dragKeys = [];
  const outZone = document.createElement('div');
  outZone.className = 'hier-out-zone';
  outZone.hidden = true;
  hier.before(outZone);
  const nested = (k) => k.startsWith('p:') || !!parentNest(k) || (k.startsWith('a:') && !!actorStruct[k.slice(2)]);
  const clearMarks = () => { hier.classList.remove('drop-top', 'drop-invalid'); outZone.classList.remove('over'); for (const x of hier.querySelectorAll('.drop-into, .drop-invalid, .drop-before, .drop-after')) x.classList.remove('drop-into', 'drop-invalid', 'drop-before', 'drop-after'); dropHint.hidden = true; };
  const planFor = (targetId, row) => {
    const plans = dragKeys.map((k) => reparentCheck(k, targetId));
    const reason = plans.find((p) => p.reason)?.reason;
    let unchanged = plans.every((p) => p.unchanged);
    if (dragKeys.length === 1 && row) {          // a structure's own object dropped back on its structure
      const k = dragKeys[0], holder = k.startsWith('p:') ? k.slice(2).split('|')[0] : k.startsWith('a:') ? actorStruct[k.slice(2)] : null;
      if (holder && row.closest('details[data-hk^="s:"]')?.dataset.hk === 's:' + holder) return { unchanged: true, targetId, text: 'Already in this structure' };
    }
    const what = dragKeys.length > 1 ? `${dragKeys.length} things` : 'it';
    return { reason, unchanged, targetId, text: reason || (unchanged ? 'Already here' : targetId ? `Put ${what} into "${nestById(targetId).label}" · keep position` : `Take ${what} out to the top level · keep position`) };
  };
  const destination = (target) => {
    const row = target.closest('[data-piece], [data-key], summary');
    return planFor(row?.closest('[data-in]')?.dataset.in || null, row);
  };
  // the folder a key lives in when it is in no nest: 'c:<category>' for a structure, 'k:<kind>' for the rest
  const folderOf = (k) => {
    if (k.startsWith('n:')) return null;
    if (k.startsWith('s:')) return 'c:' + (structures[k.slice(2)]?.category || 'Other');
    const o = objOf(k);
    return o ? 'k:' + (o.userData.kind || 'prop') : undefined;
  };
  // Over a row: its upper half = before it, lower half = after it (a line), the middle of a nest = into it.
  // Before/after puts the rows in that place: in the nest that holds the row, or in its folder.
  const placement = (e) => {
    const row = e.target.closest('.hrow, summary');
    if (!row || !hier.contains(row) || row.dataset.piece || !row.dataset.key) return null;
    const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / Math.max(1, r.height);
    if (row.dataset.nest && y > 0.28 && y < 0.72) return null;                     // into the nest
    const item = row.tagName === 'SUMMARY' ? row.parentElement : row;
    const box = item.parentElement.closest('details');
    if (!box || box.dataset.hk?.startsWith('s:')) return null;                     // inside a structure: no order
    const nestId = box.querySelector(':scope > summary')?.dataset.nest || null;
    const siblings = [...box.children].map((c) => c.tagName === 'DETAILS' ? c.querySelector(':scope > summary')?.dataset.key : c.dataset?.key).filter(Boolean);
    const moved = dragKeys.map((k) => reparentCheck(k, nestId).key || k);
    if (!nestId && moved.some((k) => folderOf(k) !== box.dataset.hk)) return null;  // a light among the structures: its own folder
    if (moved.includes(row.dataset.key)) return null;
    const rest = siblings.filter((k) => !moved.includes(k));
    const at = rest.indexOf(row.dataset.key) + (y >= 0.5 ? 1 : 0);
    return { row, after: y >= 0.5, nestId, order: [...rest.slice(0, at), ...moved, ...rest.slice(at)], moved };
  };
  const planAt = (e) => {
    const p = placement(e);
    if (!p) return { ...destination(e.target), place: null };
    const plan = planFor(p.nestId, p.row);
    if (plan.reason) return { ...plan, place: null };
    const what = dragKeys.length > 1 ? `${dragKeys.length} things` : 'it';
    return { ...plan, unchanged: false, moveNeeded: !plan.unchanged, place: p,
      text: p.nestId ? `Put ${what} here in "${nestById(p.nestId).label}" · keep position` : `Move ${what} here · keep position` };
  };
  hier.addEventListener('dragstart', (e) => {
    dragSpec = specOf(e.target);
    if (!dragSpec) return;
    const sel = selKeys();
    dragKeys = sel.length > 1 && sel.includes(dragSpec) ? sel : [dragSpec];
    if (stateTargets(stateKeys(dragKeys)).some(p => selectionLocked(p))) { e.preventDefault(); dragSpec = null; dragKeys = []; return; }
    hierarchyDragging = true;
    closeMenu();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragKeys.join('\n'));
    if (dragKeys.length > 1) {                   // the pointer carries "3 things", not one row
      const ghost = document.createElement('div');
      ghost.className = 'hier-drag-ghost';
      ghost.textContent = `${dragKeys.length} things`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove());
    }
    const out = dragKeys.some(nested);
    outZone.textContent = `Drop here to take ${dragKeys.length > 1 ? 'them' : 'it'} out (top level)`;
    if (out) {                                   // laid over the top of the list (theme.css): the rows do not move
      const box = hier.parentElement;
      if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
      outZone.style.top = (hier.offsetTop + 4) + 'px';
    }
    outZone.hidden = !out;
  });
  hier.addEventListener('dragover', (e) => {
    if (!dragSpec) return;
    e.preventDefault();
    const plan = planAt(e);
    clearMarks();
    e.dataTransfer.dropEffect = plan.reason || plan.unchanged ? 'none' : 'move';
    if (plan.place) plan.place.row.classList.add(plan.place.after ? 'drop-after' : 'drop-before');
    else {
      const s = plan.targetId && [...hier.querySelectorAll('[data-nest]')].find(x => x.dataset.nest === plan.targetId);
      (s?.parentElement || hier).classList.add(plan.reason ? 'drop-invalid' : s ? 'drop-into' : 'drop-top');
    }
    dropHint.textContent = plan.text; dropHint.hidden = false;
  });
  hier.addEventListener('dragleave', (e) => { if (!hier.contains(e.relatedTarget)) clearMarks(); });
  const finish = (plan) => {
    const keys = dragKeys, moved = keys.map((k) => reparentCheck(k, plan.targetId ?? null).key || k);
    clearMarks();
    dragSpec = null; dragKeys = []; hierarchyDragging = false; outZone.hidden = true;
    if (plan.reason) { status(plan.reason, 'warn'); buildHierarchy(); return; }
    if (plan.unchanged && !plan.place) { buildHierarchy(); return; }
    if (plan.place && !plan.moveNeeded) pushUndo();          // only the order changes (a move pushes its own undo)
    if (!plan.place || plan.moveNeeded) moveManyTo(keys, plan.targetId);
    if (plan.place) {
      const { order, nestId } = plan.place;
      if (nestId) {
        const n = nestById(nestId);
        if (n) n.items = [...order.filter((k) => n.items.includes(k)), ...n.items.filter((k) => !order.includes(k))];
      } else {
        const set = new Set(order);
        edits.order = (edits.order || []).filter((k) => !set.has(k)).concat(order);
      }
      setDirty();
    }
    flashInHierarchy(plan.place ? plan.place.moved : moved);
  };
  hier.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragSpec) return;
    finish(planAt(e));
  });
  outZone.addEventListener('dragover', (e) => {
    if (!dragSpec) return;
    e.preventDefault();
    const plan = planFor(null, null);
    clearMarks();
    e.dataTransfer.dropEffect = plan.reason || plan.unchanged ? 'none' : 'move';
    outZone.classList.add('over');
    dropHint.textContent = plan.text; dropHint.hidden = false;
  });
  outZone.addEventListener('dragleave', () => outZone.classList.remove('over'));
  outZone.addEventListener('drop', (e) => { e.preventDefault(); if (dragSpec) finish(planFor(null, null)); });
  hier.addEventListener('dragend', () => { dragSpec = null; dragKeys = []; hierarchyDragging = false; outZone.hidden = true; clearMarks(); buildHierarchy(); });
  hier.addEventListener('contextmenu', (e) => {
    const spec = specOf(e.target);
    if (!spec) return;
    e.preventDefault();
    e.stopPropagation();
    resetInput();
    rightDown = null;
    if (!selKeys().includes(spec)) specSelect(spec);
    openMenu(e.clientX, e.clientY, menuFor(spec));
  });
}
// the 3D view: a right click (not a drag: that turns the camera) opens the menu of what is under the mouse
let rightDown = null;
canvas.addEventListener('pointerdown', (e) => { if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 2 || !rightDown) return;
  const quick = Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y) < 5 && performance.now() - rightDown.t < 500;
  rightDown = null;
  if (!quick || placing || lkPicking) return;
  const r = mouseRay(e);
  const hp = visibleHits(r.intersectObjects(proxies.children, true))[0], hw = visibleHits(r.intersectObjects(world.children, true))[0];
  let o = null, textureHit = null;
  if (hp && (!hw || hp.distance <= hw.distance + 4)) { textureHit = hp; o = hp.object; while (o.parent !== proxies) o = o.parent; }
  else if (hw) { textureHit = hw; o = structureOf(hw.object); }
  if (!o) return;
  const k = keyOf(o), n = outerNest(k), want = n ? 'n:' + n.id : k;
  if (!selKeys().includes(want) && !(selected === groupPivot && members().includes(o))) {
    if (objectLocked(o)) specSelect(want); else pickOne(o, e);
  }
  const sel = selKeys();
  openMenu(e.clientX, e.clientY, menuFor(sel.includes(want) ? want : sel[0] || want, { owner: o, hit: textureHit }));
});

// Prefabs are durable project assets, independent from their source level and clipboard.
const prefabBrowser = createPrefabBrowser({
  api, escapeHtml, status,
  canSave: () => !!script && !gameView?.active && (selected === groupPivot || isStruct(selected)),
  isTemporary: () => temporaryTutorial(),
  getDefaultName: () => selected === groupPivot
    ? (nestById(groupPivot.userData.nest)?.label || 'Selection')
    : (structures[selected?.userData.name]?.label || 'Prefab'),
  onPlace: clip => {
    if (!script || gameView?.active) { status('Open a map and stop Play before placing a prefab.', 'warn'); return; }
    startPlacing({ prefab: clip, radius: 4, height: 0 });
  },
  onSave: async label => {
    if (!script || gameView?.active) throw new Error('Open a map and stop Play before saving a prefab.');
    const selection = collectPrefabSelection(selected === groupPivot ? members() : [selected], structures);
    const savingScript = script, generation = mapGeneration;
    const snapshot = JSON.parse(JSON.stringify(edits));
    try {
      busy('Saving reusable prefab…');
      const clip = await api('/api/prefab_library?script=' + encodeURIComponent(savingScript), { label, selection, edits: snapshot });
      if (script !== savingScript || generation !== mapGeneration) prefabBrowser.invalidate();
      return clip;
    } finally { busy(''); }
  },
  onSaved: clip => { showTab('prefabs'); status(`Saved "${clip.label}" in Prefabs — reusable in every level of this project.`, 'ok'); },
});

// ---------------------------------------------------------------- proxies (the objects)
const KIND_COLOR = { prop: 0x5aa2ff, pawn: 0xff6b6b, light: 0xffd25a, path: 0x6bd68a, logic: 0xc58cff, mover: 0xff9a3c, box: 0xb9c2d0 };

function lightColor(l) {             // the colour the engine gives the light (hue, saturation)
  if (!l) return 0xffd25a;
  const [r, g, b] = ueLightRGB(l.hue ?? 0, l.sat ?? 255).map((v) => Math.round(v * 255));
  return (r << 16) | (g << 8) | b;
}

// a light as the Properties panel has it now (edited values first, then the map's, then the class's)
function liveLight(a) {
  const n = (k, def) => { const v = actorProp(a, k); return v === undefined || v === '' ? def : (parseInt(v, 10) || 0); };
  const l = a.light || {};
  return { hue: n('LightHue', l.hue ?? 0), sat: n('LightSaturation', l.sat ?? 255), b: n('LightBrightness', l.b ?? 64), radius: n('LightRadius', l.radius ?? 64) };
}
// its reach (25 x (radius + 1) units, as in the engine) while it is selected
const lightRange = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd25a, wireframe: true, transparent: true, opacity: 0.18, depthWrite: false }));
lightRange.visible = false;
scene.add(lightRange);
function showLightRange(p) {
  const a = p && p.userData.kind === 'light' && p.userData.actor;
  actorOverlays.bind(lightRange, p, !!a);
  if (!a) return;
  const l = liveLight(a);
  lightRange.scale.setScalar(25 * (l.radius + 1));
  lightRange.material.color.setHex(lightColor(l));
}
function refreshLight(p) {
  const a = p && p.userData.actor;
  if (!a || p.userData.kind !== 'light') return;
  if (p.userData.body && p.userData.body.material) p.userData.body.material.color.setHex(lightColor(liveLight(a)));
  showLightRange(p);
}

function makeProxy(a, source) {
  const g = new THREE.Group();
  const kind = a.kind || 'prop';
  const color = kind === 'light' ? lightColor(liveLight(a)) : KIND_COLOR[kind];
  const model = (kind === 'light' || kind === 'path' || kind === 'logic') ? null : modelFor(a, source);
  let body;
  if (kind === 'light' || kind === 'path' || kind === 'logic') body = isEffectPoint(a) ? createEffectPointGizmo() : createViewportIcon(a, color);
  else {
    const r = Math.max(4, a.radius || 16), h = Math.max(4, a.height || 16);
    const geo = new THREE.CylinderGeometry(r, r, 2 * h, 18);
    body = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
    body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color })));
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(Math.min(8, r * 0.4), Math.min(18, r), 8), new THREE.MeshBasicMaterial({ color }));
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(r + 6, 0, 0);
    body.add(arrow);
  }
  if (model) { g.add(model); body.visible = false; }      // the real object; its outline only when selected
  g.add(body);
  g.position.copy(T(a.loc));
  g.rotation.y = yawToRad((a.rot || [0, 0, 0])[1]);
  g.userData = { actor: a, source, kind, body, model };
  if (isEffectPoint(a)) g.userData.fxGizmo = body;
  g.userData.tilt = signedRot((a.rot || [0])[0] || 0);        // its pitch (Stick to surface, Pitch in the Inspector)
  g.userData.roll = signedRot((a.rot || [0, 0, 0])[2] || 0);  // and its roll (E, Roll in the Inspector)
  applyTilt(g);
  if (kind === 'prop' || kind === 'pawn') g.scale.setScalar(visualScale(g.userData));
  proxies.add(g);
  if (a.cls === 'UCTriggerBox') refreshTriggerBox(g);
  // the map's player character (Map settings, Player Start > Change…) stands on the start, as the game will show it
  if (a.cls === 'PlayerStart') {
    const id = edits.level?.player, ch = window.__characters;
    const props = id && id !== 'jc' && ch?.propsOf ? ch.propsOf(id) : null;
    if (props && props.Mesh) {
      // its body now, or when the characters' models are read (the first map opened: not yet)
      const who = { cls: 'UCCustomCivilian', custom: id, props }, mp = previewMesh(who, 'added');   // with its skins
      const put = () => {
        if (!g.parent || g.children.some((c) => c.userData.playerLook)) return true;
        const look = modelFor(who, 'added');
        if (!look) return false;
        look.userData.playerLook = true; g.add(look); lightObject(g); wake();
        return true;
      };
      const generation = mapGeneration;
      if (!put()) (mp ? meshInfo(mp) : ch.ready()).catch(() => null).then(() => { if (generation === mapGeneration) put(); });
    }
  }
  if (!model && kind !== 'light' && kind !== 'path' && kind !== 'logic' && (previewMesh(a, source) || paletteHas.has(a.cls) || a.cls === 'UCMeshDeco' || (window.__characters && window.__characters.isCustom(a.cls)))) attachModelLater(g, a, source);
  return g;
}

function makeBoxProxy(b) {
  const size = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
  const geo = blockGeometry(THREE, b);     // a cube, a wedge or a cylinder (block-shapes.js)
  const col = b.mover ? 0x5ad1ff : b.water ? 0x3a8cff : b.portal ? 0xc58cff : b.hole ? 0xff5a5a : KIND_COLOR.box;
  const g = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: b.portal ? 0.35 : b.water ? 0.12 : b.hole ? 0.18 : 0.25, depthWrite: false }));
  if (b.water) {                            // the surface of the water
    const below = b.water.below ?? 16, rel = 0.5 - below / Math.max(1, size[2]);
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: { dirty: 0x5d6a3a, toxic: 0x5be04a, burning: 0xff7a1a }[b.water.kind] || 0x3a8cff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = rel;
    g.add(surf);
  }
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), b.hole ? new THREE.LineDashedMaterial({ color: 0xff8080, dashSize: 0.06, gapSize: 0.04 })
    : new THREE.LineBasicMaterial({ color: 0xe8edf5 }));
  if (b.hole) edges.computeLineDistances();      // a hole: what it cuts away shows after the rebuild
  g.add(edges);
  g.scale.set(size[0], size[2], size[1]);
  g.position.copy(T([(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2]));
  g.userData = { box: b, source: 'box', kind: 'box' };
  g.quaternion.copy(rotations.quat(b.rot));
  if (b.sign && texUrl(b.sign.tex)) {      // a sign: its text on its front, as the game will show it
    const tex = new THREE.TextureLoader().load(texUrl(b.sign.tex));
    tex.colorSpace = THREE.SRGBColorSpace;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex }));
    const f = b.sign.face;
    // the unit box is scaled by the block's size: the plane sits on the face, facing out
    if (f[1] === 'x') { front.position.x = f[0] === '+' ? 0.51 : -0.51; front.rotation.y = f[0] === '+' ? Math.PI / 2 : -Math.PI / 2; }
    else { front.position.z = f[0] === '+' ? 0.51 : -0.51; front.rotation.y = f[0] === '+' ? 0 : Math.PI; }
    g.add(front);
  }
  proxies.add(g);
  dressBlock(g);
  return g;
}
// a new or changed block, until a Rebuild: its texture as the game will map it (then the map's own faces show it)
function blockLook(name) {
  const key = mapName + '|' + name;
  if (!blockLooks.has(key)) blockLooks.set(key, (async () => {
    const t = mapTex && mapTex[texFull[name]];
    let url = texUrl(name) || (t && t.png ? `/cache/${mapName}/${t.png}` : ''), masked = false;
    const tile = await api('/api/texture_tile?tex=' + encodeURIComponent(name));      // also its full name
    if (!url) ({ url, masked } = await api('/api/texture_source?tex=' + encodeURIComponent(texFull[name] || tile.ref || name) + '&script=' + encodeURIComponent(script)));
    const map = new THREE.TextureLoader().load(url);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    return { map, tile, masked };
  })().catch(() => { blockLooks.delete(key); return null; }));
  return blockLooks.get(key);
}
async function dressBlock(g) {
  const b = g.userData.box;
  if (!b) return;
  if (b.hole || b.water || b.portal || b.mover || b.sign || !b.tex || builtBoxes.get(b.name) === boxSig(b)) {
    if (g.userData.dressed) { g.material.dispose(); g.material = g.userData.plain; g.userData.dressed = false; }
    return;
  }
  const tex = b.tex, look = await blockLook(tex);
  if (!look || g.userData.box !== b || b.tex !== tex || g.parent !== proxies) return;
  g.geometry.dispose();
  g.geometry = blockGeometry(THREE, b, look.tile);
  if (g.userData.dressed) g.material.dispose(); else g.userData.plain = g.material;
  g.material = new THREE.MeshBasicMaterial({ map: look.map, color: 0xd9d9d9, alphaTest: look.masked ? 0.5 : 0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  g.userData.dressed = true;
}

// ---------------------------------------------------------------- signs with your own text
// "+ Sign": a thin block whose front face shows the text drawn here (a picture imported as a texture
// of the map, stretched over the face by editor/textures.py sign_mats); edges and back are iron
const SIGN_FRAME = 'DrtyIronPlain_A';
const SIGN_STYLES = {
  // like the game's own signs (stopscrtyarea, DangerHighVolt, HK_Signs; tools/mapkit/signs.py draws the same):
  // a condensed grotesque in capitals, an ANSI band on top, enamel that has lived a little, screws
  dxunatco: { label: 'Deus Ex: UNATCO plate', bg: '#dedcd2', fg: '#161618', header: 'unatco', font: 'Arial Narrow', wear: 50, screws: true },
  dxdanger: { label: 'Deus Ex: DANGER', bg: '#dedcd2', fg: '#161618', header: 'danger', font: 'Arial Narrow', wear: 50, screws: true },
  dxcaution: { label: 'Deus Ex: CAUTION', bg: '#dedcd2', fg: '#161618', header: 'caution', font: 'Arial Narrow', wear: 50, screws: true },
  dxrestricted: { label: 'Deus Ex: RESTRICTED AREA', bg: '#dedcd2', fg: '#161618', header: 'restricted', font: 'Arial Narrow', wear: 50, screws: true },
  dxstop: { label: 'Deus Ex: STOP, white on red', bg: '#a8181c', fg: '#f0ece8', line: '#ece4e0', font: 'Arial', wear: 45 },
  dxyellow: { label: 'Deus Ex: yellow plate', bg: '#deb220', fg: '#121212', line: '#121212', font: 'Arial Narrow', wear: 55, screws: true },
  dxblue: { label: 'Deus Ex: UNATCO blue', bg: '#1c2f54', fg: '#eceef0', line: '#c8ced6', font: 'Arial Narrow', wear: 45, screws: true },
  dxlabel: { label: 'Deus Ex: shipping label', bg: '#e4dec9', fg: '#18181a', font: 'Arial Narrow', wear: 30 },
  unatco: { label: 'UNATCO: white on blue', bg: '#203f73', fg: '#f3f6fa', line: '#a9bdd8' },
  notice: { label: 'Notice: black on white', bg: '#ebe7dc', fg: '#161616', line: '#3a3a3a' },
  warning: { label: 'Warning: black on yellow', bg: '#e9c419', fg: '#121212', stripes: true },
  danger: { label: 'Danger: white on red', bg: '#a4171c', fg: '#ffffff', line: '#ffffff' },
  street: { label: 'Street: white on green', bg: '#1d6a3b', fg: '#ffffff', line: '#e9efe9' },
  neon: { label: 'Neon: glowing red', bg: '#14070a', fg: '#ff4053', glow: true },
  neonblue: { label: 'Neon: glowing blue', bg: '#060a16', fg: '#5ad2ff', glow: true },
  screen: { label: 'Screen: green on black', bg: '#04100a', fg: '#4cf38f', glow: true, mono: true },
};
// the bands on top of a sign (ANSI): band colour, word colour, word, the oval of DANGER
const SIGN_HEADERS = {
  unatco: { label: 'UNATCO', band: '#1c2f54', ink: '#eceef0', word: 'UNATCO' },
  danger: { label: 'DANGER', band: '#101010', ink: '#f4f4f4', word: 'DANGER', oval: '#b21a1e' },
  caution: { label: 'CAUTION', band: '#deb220', ink: '#101010', word: 'CAUTION' },
  notice: { label: 'NOTICE', band: '#1a428c', ink: '#f4f4f4', word: 'NOTICE' },
  restricted: { label: 'RESTRICTED AREA', band: '#a8181c', ink: '#f4f0ec', word: 'RESTRICTED AREA' },
};
// the same sign drawn again gives the same scratches (a seed from its text)
function signRandom(text) {
  let a = 2166136261;
  for (const ch of String(text)) a = Math.imul(a ^ ch.codePointAt(0), 16777619);
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// a plate that has lived a little: grain, grime low and at the rim, a few faint scratches, chips at the edge
function signWear(g, tw, th, amount, rnd) {
  if (!(amount > 0)) return;
  const k = amount / 100;
  const img = g.getImageData(0, 0, tw, th), px = img.data;
  const cells = 24, blot = Array.from({ length: (cells + 1) * (cells + 1) }, () => rnd() - 0.5);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const u = x / tw * cells, v = y / th * cells, i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
      const b = (blot[j0 * (cells + 1) + i0] * (1 - fu) + blot[j0 * (cells + 1) + i0 + 1] * fu) * (1 - fv)
        + (blot[(j0 + 1) * (cells + 1) + i0] * (1 - fu) + blot[(j0 + 1) * (cells + 1) + i0 + 1] * fu) * fv;
      const rim = Math.min(x, tw - 1 - x) / tw * 8, rimy = Math.min(y, th - 1 - y) / th * 6;
      const shade = 1 - k * (0.10 * (y / th) + 0.12 * Math.max(0, 1 - Math.min(rim, rimy)));
      const n = 1 + k * (b * 0.22 + (rnd() - 0.5) * 0.08);
      const i = (y * tw + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, px[i + c] * shade * n));
    }
  }
  g.putImageData(img, 0, 0);
  g.save();
  g.globalAlpha = 0.35; g.strokeStyle = '#cdcdc6'; g.lineWidth = Math.max(0.5, th / 256);
  for (let s = 0; s < Math.round(6 * k); s++) {
    const x = rnd() * tw, y = rnd() * th, len = (0.03 + rnd() * 0.07) * tw;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (rnd() - 0.5) * 0.5 * len); g.stroke();
  }
  g.globalAlpha = 0.5; g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let s = 0; s < Math.round(5 * k); s++) {
    const side = Math.floor(rnd() * 4), r = (0.5 + rnd() * 0.7) * th / 80;
    const x = side < 2 ? rnd() * tw : (side === 2 ? 0 : tw), y = side < 2 ? (side === 0 ? 0 : th) : rnd() * th;
    g.beginPath(); g.ellipse(x, y, r * 1.5, r, 0, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
function signScrews(g, tw, th) {
  const r = Math.max(2.5, Math.min(tw, th) * 0.035);
  for (const [x, y] of [[r * 2.2, r * 2.2], [tw - r * 2.2, r * 2.2], [r * 2.2, th - r * 2.2], [tw - r * 2.2, th - r * 2.2]]) {
    g.fillStyle = '#282828'; g.beginPath(); g.arc(x, y, r * 1.25, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#969692'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c4c4be'; g.beginPath(); g.ellipse(x - r * 0.2, y - r * 0.4, r * 0.4, r * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#363636'; g.lineWidth = Math.max(1, r / 3);
    g.beginPath(); g.moveTo(x - r * 0.8, y + r * 0.3); g.lineTo(x + r * 0.8, y - r * 0.3); g.stroke();
  }
}
// the block of a sign: centre c, a face w wide and h high, d thick, facing sign.face
function signShape(b, c, w, h, d) {
  const along = b.sign.face[1] === 'x' ? [d, w] : [w, d];
  b.lo = [c[0] - along[0] / 2, c[1] - along[1] / 2, c[2] - h / 2];
  b.hi = [c[0] + along[0] / 2, c[1] + along[1] / 2, c[2] + h / 2];
}
const signSize = (b) => { const k = b.sign.face[1] === 'x' ? 1 : 0; return [b.hi[k] - b.lo[k], b.hi[2] - b.lo[2]]; };
// A sign's look: its own settings (Inspector), over the ones of its preset (older signs have a preset only)
function signLook(sign) {
  const st = SIGN_STYLES[sign.style] || SIGN_STYLES.unatco;
  return Object.assign({ font: st.font || (st.mono ? 'Consolas' : 'Bahnschrift'), bold: true, italic: false, align: 'center', size: 'auto', fg: st.fg,
    outline: '#000000', outlineWidth: 0, glow: !!st.glow, shadow: false, bg: st.bg, bgTex: '', border: st.line || '', stripes: !!st.stripes,
    header: st.header || '', wear: st.wear || 0, screws: !!st.screws }, sign.look || {});
}
const signPictures = new Map();
// the picture of a texture for a sign's background: one imported in the editor, or one of the game
async function signPicture(name) {
  if (!name) return null;
  if (signPictures.has(name)) return signPictures.get(name);
  let url = texUrl(name);
  if (!url) {
    try { url = (await api('/api/texture_source?tex=' + encodeURIComponent(texFull[name] || name) + '&script=' + encodeURIComponent(script))).url; } catch (_) { url = ''; }
  }
  const img = url ? await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url; }) : null;
  signPictures.set(name, img);
  return img;
}
async function signCanvas(sign, tw, th) {
  const st = signLook(sign);
  const cv = document.createElement('canvas');
  cv.width = tw; cv.height = th;
  const g = cv.getContext('2d');
  g.fillStyle = st.bg; g.fillRect(0, 0, tw, th);
  const pic = await signPicture(st.bgTex);
  if (pic) {                                 // the picture fills the sign (cut to its shape, not stretched)
    const k = Math.max(tw / pic.width, th / pic.height);
    g.drawImage(pic, (tw - pic.width * k) / 2, (th - pic.height * k) / 2, pic.width * k, pic.height * k);
  }
  let top = 0, bottom = th;
  if (st.stripes) {                          // hazard stripes along the top and the bottom
    const band = Math.round(th * 0.16);
    g.save(); g.fillStyle = '#121212';
    for (const y0 of [0, th - band]) {
      g.save(); g.beginPath(); g.rect(0, y0, tw, band); g.clip();
      for (let x = -band * 2; x < tw + band * 2; x += band * 1.4) { g.beginPath(); g.moveTo(x, y0 + band); g.lineTo(x + band * 0.7, y0 + band); g.lineTo(x + band * 1.4, y0); g.lineTo(x + band * 0.7, y0); g.fill(); }
      g.restore();
    }
    g.restore();
    top = band; bottom = th - band;
  }
  const head = SIGN_HEADERS[st.header];
  if (head) {                                // an ANSI band on top: its word, DANGER in a red oval
    const band = Math.round(th * 0.28);
    g.fillStyle = head.band; g.fillRect(0, 0, tw, band);
    if (head.oval) {
      g.font = `bold ${Math.round(band * 0.6)}px Arial, sans-serif`;
      const ow = g.measureText(head.word).width * 1.32, oh = band * 0.8;
      g.fillStyle = '#ececec'; g.beginPath(); g.ellipse(tw / 2, band / 2, ow / 2 + 2, oh / 2 + 2, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = head.oval; g.beginPath(); g.ellipse(tw / 2, band / 2, ow / 2, oh / 2, 0, 0, Math.PI * 2); g.fill();
    }
    drawText(g, { text: head.word, font: 'Arial', bold: true, align: 'center', color: head.ink, size: 'auto', lineHeight: 1 },
      { x: tw * 0.1, y: band * 0.18, w: tw * 0.8, h: band * 0.64 });
    top = band;
  }
  const screwed = !!st.screws;
  if (st.border && !head) {
    const lw = Math.max(2, Math.round(th * 0.035)), m = Math.round(screwed ? Math.max(2.5, Math.min(tw, th) * 0.035) * 4.6 : th * 0.07);   // inside the screws
    g.strokeStyle = st.border; g.lineWidth = lw; g.strokeRect(m, m, tw - 2 * m, th - 2 * m);
  }
  const h = (bottom - top) * (head ? 0.72 : 0.78), mx = tw * (screwed ? 0.1 : 0.07);
  drawText(g, { text: sign.text || '', font: st.font, bold: st.bold, italic: st.italic, align: st.align, color: st.fg,
    size: st.size === 'auto' ? 'auto' : th * (+st.size || 40) / 100, outline: st.outline, outlineRatio: (+st.outlineWidth || 0) / 100,
    glow: st.glow, shadow: st.shadow, lineHeight: 1.12 }, { x: mx, y: (top + bottom - h) / 2, w: tw - 2 * mx, h });
  signWear(g, tw, th, +st.wear || 0, signRandom(sign.text || ''));
  if (screwed) signScrews(g, tw, th);
  return cv;
}
// the picture of a sign's text, imported as a texture of the map (the previous one is dropped)
async function updateSignTexture(b) {
  const [w, h] = signSize(b);
  const tw = 512, th = Math.max(64, Math.min(512, 2 ** Math.round(Math.log2(512 * h / Math.max(1, w)))));
  const png = (await signCanvas(b.sign, tw, th)).toDataURL('image/png');
  const info = await api('/api/texture_import?script=' + encodeURIComponent(script),
    { png, base: 'Sign', world: null, existing: Object.keys(edits.textures || {}) });
  edits.textures = edits.textures || {};
  const old = b.sign.tex;
  if (old && old !== info.name && !edits.boxes.some((x) => x !== b && x.sign && x.sign.tex === old)) delete edits.textures[old];
  edits.textures[info.name] = { pcx: info.pcx, png: info.png, w: info.w, h: info.h, masked: false, scale: 1, from: 'sign' };
  b.sign.tex = info.name;
  setDirty();
  const keep = selected && selected.userData.box === b;
  rebuildProxies();
  if (keep) { const q = proxies.children.find((x) => x.userData.box === b); if (q) select(q); }
}

function rebuildProxies() {
  textureTransfer?.cancel();
  surfaceTexturePreview?.restore();
  const keep = selected && selected.userData;
  const keepGroup = selected === groupPivot ? { nest: groupPivot.userData.nest, keys: selKeys() } : null;
  tc.detach();
  for (const q of proxies.children) disposeEffectPoint(q);
  disposeViewportIcons(proxies);
  proxies.clear();
  selected = null;
  syncStructures();
  const added = new Set(edits.added.map((a) => a.name));
  for (const a of baseActors) {
    if (added.has(a.name) || edits.deleted[a.name]) continue;
    if (/^UCEdit\d+$/.test(a.name)) continue;      // added here, then deleted: its built copy goes at the next Rebuild
    const m = edits.moved[a.name];
    const st = structures[actorStruct[a.name]];
    let shown = a;
    if (m) shown = Object.assign({}, a, { loc: m.loc, rot: m.rot || a.rot });
    else if (st) {                       // its structure was moved: it goes along (until the rebuild)
      const pose = poseOf(st);
      if (pose.deleted) continue;
      const f = poseToPose(st, st.placement, pose);
      shown = Object.assign({}, a, { loc: f(a.loc), rot: rotations.carry(a.rot, st.placement, pose) });
    }
    makeProxy(shown, 'map');
  }
  for (const a of edits.added) makeProxy(Object.assign({ kind: addedKind(a.cls) }, a, { light: /^(Light|Spotlight)$/.test(a.cls) ? { hue: a.props?.LightHue ?? 32, sat: a.props?.LightSaturation ?? 160 } : null }), 'added');
  for (const b of edits.boxes) makeBoxProxy(b);
  for (const dp of edits.drawn || []) proxies.add(drawTools.proxy(dp));     // Map > Draw wall / road / floor / roof
  applyTextureOverrides();
  applyLighting();
  applyObjectVisibility();
  if (keepGroup) {                       // several things, or a nest: picked again from what they are now
    if (keepGroup.nest && nestById(keepGroup.nest)) selectNest(keepGroup.nest);
    else selectKeys(keepGroup.keys.filter((k) => !k.startsWith('n:') || nestById(k.slice(2))));
  } else if (keep) {
    let again = null;
    if (keep.kind === 'structure') again = structures[keep.name]?.obj;
    else again = proxies.children.find((p) => (keep.actor && p.userData.actor?.name === keep.actor.name) || (keep.box && p.userData.box?.name === keep.box.name));
    if (again) select(again);
  }
  showChanges();
  buildStructList();
  buildHierarchy();
}

// ---------------------------------------------------------------- selection and transforms
const ray = new THREE.Raycaster();
// Tools > Draw wall / road / floor / ceiling: points clicked on the map (draw-tools.js; brushes by editor/drawn.py)
// the end of stairs or a roof clicked on a wall just under a ledge: the ledge's floor (rays down round the
// point; only up onto one, within `radius`): the point stays where it was clicked, at the ledge's height
function ledgeNear(ue, radius) {
  const rc = new THREE.Raycaster();
  rc.camera = camera;
  let best = null;
  for (const r of [radius * 0.5, radius]) for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    rc.set(T([ue[0] + Math.cos(a) * r, ue[1] + Math.sin(a) * r, ue[2] + radius * 2]), new THREE.Vector3(0, -1, 0));
    rc.far = radius * 4;
    // the face as seen from the ray (the world's faces can be wound either way: placeAt turns them the same way)
    const facing = (x) => { const n = x.face.normal.clone().transformDirection(x.object.matrixWorld); return n.y < 0 ? -n.y : n.y; };
    const h = visibleHits(rc.intersectObjects(worldMeshes, false)).find((x) => x.face && facing(x) > 0.7);
    if (!h) continue;
    const top = UE(h.point);
    if (top[2] - ue[2] < 4) continue;
    const d = Math.hypot(top[0] - ue[0], top[1] - ue[1]) + Math.abs(top[2] - ue[2]) * 0.5;
    if (!best || d < best.d) best = { d, z: top[2] };
  }
  return best ? [ue[0], ue[1], Math.round(best.z * 10) / 10] : null;
}
const drawTools = createDrawTools({ THREE, T, scene, getEdits: () => edits, status, escapeHtml, getSnap: () => snap, texList: () => texList, probe: ledgeNear });
// Map > Sky & time of day (sky-tool.js; the sky box by editor/zones.py)
const skyTool = createSkyTool({ THREE, scene, getEdits: () => edits, getScript: () => script, pushUndo, setDirty, rebuildProxies, api, log, escapeHtml, nextName });
// Pose here: a character posed against the map where it stands (map-pose.js)
const mapPose = createMapPose({ THREE, scene, camera, canvas, world, proxies, mouseRay, visibleHits, wake, api, edits: () => edits, pushUndo, setDirty,
  status, log, animsOf, animFrames, animatedModel, fitAnimated, meshOf, stopPreview, select, animsChanged, UE, commit });
const surfaceTools = createSurfaceTools({ THREE, getEdits: () => edits, pushUndo, setDirty,
  deselect: () => select(null), status, log, escapeHtml,
  textures: () => [...Object.keys(mapTex), ...Object.keys(edits.textures || {}), ...texturePreviewInfo.keys()],
  canShowPanel: () => !inspectorIsPinned(),
  canEditFace: face => !selectionLocked(structures[face.structure]?.obj),
  onChange: () => { refreshSurfaceTexturePreview(); wake(); } });
function textureInfoFor(ref) {
  if (texturePreviewInfo.has(ref)) return texturePreviewInfo.get(ref);
  const ownName = edits.textures?.[ref] ? ref : shortTex(ref), own = edits.textures?.[ownName];
  if (own && (ref === ownName || /^MyLevel\./i.test(ref))) return { ref, url: texUrl(ownName), w: own.w, h: own.h };
  const info = mapTex[ref];
  return info?.png ? { ref, url: `/cache/${mapName}/${info.png}`, w: info.w, h: info.h } : null;
}
function refreshSurfaceTexturePreview() {
  if (!surfaceTexturePreview) return;
  const meshes = surfaceTools.geometry; // Only built geometry, never source-ID clones awaiting Rebuild.
  surfaceTexturePreview.apply(meshes, geoFaces, edits);
  // Saved drops whose source is not in this map's BSP still preview after reopening.
  for (const row of edits.surfaces || []) {
    const ref = row.op === 'texture' && row.args?.[0];
    if (!ref || textureInfoFor(ref) || texturePreviewPending.has(ref) || !script) continue;
    const generation = mapGeneration, currentScript = script;
    texturePreviewPending.set(ref, true);
    api('/api/texture_source?tex=' + encodeURIComponent(ref) + '&script=' + encodeURIComponent(currentScript)).then(info => {
      if (generation !== mapGeneration || script !== currentScript) return;
      texturePreviewInfo.set(ref, { ...info, ref });
      refreshSurfaceTexturePreview(); wake();
    }).catch(() => {}); // A failed source is retried on reopening, not in every frame.
  }
}
surfaceTexturePreview = createSurfaceTexturePreview({ THREE, textureInfo: textureInfoFor,
  materialFor: (info, mesh) => {
    const flags = tf(info.ref, mesh.userData.flags), temporary = new THREE.Mesh(mesh.geometry, makeMaterial(info.url, flags, ''));
    temporary.userData = { world: true, flags };
    setMeshLight(temporary);
    return temporary.material.clone();
  } });
textureTransfer = createTextureTransfer({ canvas,
  context: () => script && !mapLoading && !gameView?.active ? `${projectContext?.id || ''}|${script}|${mapGeneration}|${tutorialSession.revision}` : null,
  status,
  targetAt: (at, quiet = false) => {
    const ray = mouseRay(at), hit = visibleHits(ray.intersectObjects(world.children, true))[0];
    const prop = visibleHits(ray.intersectObjects(proxies.children, true)).find(h => h.object.userData.tex !== undefined || h.object.userData.box);
    const face = surfaceTools.faceAt(hit);
    const block = prop && prop.object.userData.box && (!hit || prop.distance < hit.distance - .1) ? prop.object : null;
    if (block) {
      const b = block.userData.box;
      if (b.hole || b.water || b.portal || b.sign) { if (!quiet) status('Holes, water, zone portals and signs keep their own look: choose a wall, floor, ceiling or block.', 'warn'); return null; }
      if (selectionLocked(block)) { if (!quiet) status('Unlock this block before changing its texture.', 'warn'); return null; }
      return { block, label: `${blockLabel(b)} ${b.name}` };
    }
    if (!face || (prop && (!hit || prop.distance < hit.distance - .1))) {
      if (!quiet) status('Choose a wall, floor, ceiling or block, not a model.', 'warn');
      return null;
    }
    const object = structureOf(hit.object);
    if (object && selectionLocked(object)) { if (!quiet) status('Unlock this structure before changing its texture.', 'warn'); return null; }
    return { ...face, hit, object };
  },
  apply: async (texture, target, isCurrent) => {
    if (target.block) {
      const p = target.block, b = p.userData.box;
      if (!isCurrent() || p.parent !== proxies) throw new Error('The map changed before this texture could be applied.');
      if (!requireUnlocked(p)) throw new Error('Unlock this block first.');
      pushUndo();
      b.tex = lastBlockTex = shortTex(texture.ref);
      setDirty();
      dressBlock(p);
      if (selected === p) showDetails();
      return;
    }
    let info = texture;
    if (!info.url || !info.w || !info.h) info = { ...texture, ...await api('/api/texture_source?tex=' + encodeURIComponent(texture.ref) + '&script=' + encodeURIComponent(script)) };
    if (!isCurrent() || surfaceTools.faceAt(target.hit)?.brush !== target.brush || surfaceTools.faceAt(target.hit)?.poly !== target.poly)
      throw new Error('The map changed before this texture could be applied.');
    if (!visibleHits([target.hit]).length || (target.object && target.object.parent !== world)) throw new Error('The target is no longer visible in this map.');
    if (texture.requiredLocal && !edits.textures?.[texture.requiredLocal]) throw new Error('This imported texture was removed. Select another texture.');
    if (target.object && !requireUnlocked(target.object)) throw new Error('Unlock the target structure first.');
    texturePreviewInfo.set(texture.ref, info);
    if (!surfaceTools.applyTextureAtHit(target.hit, texture.ref)) throw new Error('This face cannot be changed.');
    wake();
  } });
// Alt+drag on a transform handle duplicates; Alt+click elsewhere still picks a face.
canvas.addEventListener('pointerdown', e => {
  if (e.button === 0 && !placing && !lkPicking && (surfaceTools.mode || (e.altKey && !tc.axis)) && selected) select(null);
}, true);
function mouseRay(e) {
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  return ray;
}
function visibleHits(hits, pickable = false) {
  return hits.filter((h) => { let o = h.object; while (o) { if (!o.visible || (pickable && keyOf(o) && objectLocked(o))) return false; o = o.parent; } return true; });
}
function pick(e) {
  if (textureTransfer?.armed) return void textureTransfer.paint(e);
  if (routeTest) return routeClick(e);       // Test a route: the clicks are its places
  const r = mouseRay(e);
  const hp = visibleHits(r.intersectObjects(proxies.children, true), !lkPicking)[0];
  const hw = visibleHits(r.intersectObjects(world.children, true), !lkPicking)[0];
  if (!lkPicking && (e.altKey || surfaceTools.mode)) return surfaceTools.pick(hw, e.shiftKey);
  if (lkPicking) {                          // an interaction waits for its object (or a place)
    let o = null;
    if (hp && (!hw || hp.distance <= hw.distance + 4)) { o = hp.object; while (o.parent !== proxies) o = o.parent; }
    const at = hw || hp;
    const who = o && (o.userData.actor || (o.userData.box && o.userData.box.mover ? lkActor(o.userData.box.name) : null));
    lkPicked(who, at ? UE(at.point.clone().add(new THREE.Vector3(0, 40, 0))) : null);
    return;
  }
  if (e.ctrlKey || e.shiftKey) {            // Ctrl+click or Shift+click: one more (or one less) in the selection
    let o = null;
    if (hp && (!hw || hp.distance <= hw.distance + 4)) { o = hp.object; while (o.parent !== proxies) o = o.parent; }
    else if (hw) o = structureOf(hw.object);
    if (o && !objectLocked(o)) toggleMulti(o);
    return;
  }
  if (hp && (!hw || hp.distance <= hw.distance + 4)) {
    let o = hp.object;
    while (o.parent !== proxies) o = o.parent;
    return pickOne(o, e);
  }
  pickOne(hw ? structureOf(hw.object) : null, e);
}
// like a clip in Premiere: what is in a nest is picked as the whole nest; a double click picks it alone
function pickOne(o, e) {
  if (o && objectLocked(o)) return;
  const n = o && !e.inside && outerNest(keyOf(o));
  if (n) return selectNest(n.id);
  select(o);
}
canvas.addEventListener('dblclick', (e) => {
  if (e.button !== 0 || placing || lkPicking || e.altKey || surfaceTools.mode || e.ctrlKey || e.shiftKey) return;
  pick({ inside: true, clientX: e.clientX, clientY: e.clientY, ctrlKey: false, altKey: false, shiftKey: e.shiftKey });
});

function isStruct(p) { return p && p.userData.kind === 'structure'; }

// ---------------------------------------------------------------- several objects at once
// Ctrl+click or Shift+click adds or takes away an object (in the 3D view; Shift+click in the Hierarchy picks
// the rows in between), Ctrl+drag or Shift+drag selects the objects inside a rectangle. The gizmo moves them together and turns them about their middle; Delete,
// Ctrl+D, Ctrl+C / Ctrl+V and End work on all of them. Objects and blocks (structures move on their own).
const groupPivot = new THREE.Object3D();
groupPivot.userData = { kind: 'group', members: [] };
scene.add(groupPivot);
const multiBoxes = new THREE.Group();
scene.add(multiBoxes);
let groupStart = null;
// structures too (a nest can hold them): they move with their objects, as when moved alone
const liveStruct = (p) => isStruct(p) && p.parent === world && !!structures[p.userData.name] && !structures[p.userData.name].dissolved
  && !poseOf(structures[p.userData.name]).deleted;
const canGroup = (p) => !!(p && ((p.parent === proxies && (p.userData.kind === 'box' || p.userData.kind === 'drawn' || p.userData.actor)) || liveStruct(p)));
function members() { return selected === groupPivot ? groupPivot.userData.members.filter((m) => m.parent === proxies || liveStruct(m)) : []; }
// nest: the selection is that nest (one is enough); keys: what was picked (nests among them, for Nest)
function setMulti(list, nest = null, keys = null) {
  list = [...new Set(list.filter(canGroup))];
  if (list.length < (nest ? 1 : 2)) return select(list[0] || null);
  groupPivot.userData.members = list;
  groupPivot.userData.nest = nest;
  groupPivot.userData.keys = keys || list.map(keyOf);
  const c = new THREE.Vector3();
  for (const m of list) c.add(m.position);
  groupPivot.position.copy(c.multiplyScalar(1 / list.length));
  groupPivot.rotation.set(0, 0, 0);
  groupPivot.scale.set(1, 1, 1);
  select(groupPivot);
}
function toggleMulti(p) {
  if (!canGroup(p)) return;
  const cur = selKeys(), k = keyOf(p);
  selectKeys(cur.includes(k) ? cur.filter((x) => x !== k) : cur.concat([k]));
}
function drawMultiBoxes() {                // the outline of every member (each frame: they move)
  const ms = members();
  multiBoxes.visible = ms.length > 0;
  if (!ms.length) return;
  while (multiBoxes.children.length < ms.length) multiBoxes.add(createSelectionOutline(THREE));
  multiBoxes.children.forEach((h, i) => { h.visible = i < ms.length && !objectHidden(ms[i]); if (h.visible) h.setFromObject(ms[i]); });
}
// a rectangle of the view: the objects whose centre is in it join the selection
let marquee = null;
function marqueeSelect(x0, y0, x1, y1) {
  const r = canvas.getBoundingClientRect(), lo = [Math.min(x0, x1), Math.min(y0, y1)], hi = [Math.max(x0, x1), Math.max(y0, y1)];
  const inside = [...proxies.children, ...Object.values(structures).filter(st => liveStruct(st.obj)).map(st => st.obj)].filter((q) => {
    if (!canGroup(q) || !q.visible || objectLocked(q)) return false;
    const bounds = placementGeometry.bounds(q);
    const v = (bounds.isEmpty() ? q.getWorldPosition(new THREE.Vector3()) : bounds.getCenter(new THREE.Vector3())).project(camera);
    if (v.z > 1 || v.z < -1) return false;
    const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height;
    return sx >= lo[0] && sx <= hi[0] && sy >= lo[1] && sy <= hi[1];
  });
  const cur = selected === groupPivot ? members() : (canGroup(selected) ? [selected] : []);
  setMulti(cur.concat(inside));
  status(`${members().length || (selected ? 1 : 0)} selected`);
}

function select(p, keepInspector = false) {
  hierFolderOn = null;
  soundBrowser?.clearSelection(false);
  surfaceTools.clear();
  showPieceBox(null);
  if (p !== groupPivot) { groupPivot.userData.nest = null; groupPivot.userData.keys = null; }
  if (anim && p !== anim.p) closeAnim();
  if (propertySlider) finishPropertySlider(true);
  if (selected && selected.userData.body && selected.userData.model) selected.userData.body.visible = false;
  selected = p;
  tc.detach();
  outline.visible = false;
  if (p && p.userData.body && p.userData.model) p.userData.body.visible = !objectHidden(p);     // outline of the real object
  if (isStruct(p)) { outline.setFromObject(p); outline.visible = !objectHidden(p); }
  showLightRange(p);
  showSoundRange(p);
  revealInHierarchy(p);
  buildHierarchy();
  if (p && !selectionLocked(p) && !objectHidden(p) && !(p === groupPivot && members().some(objectHidden))) {
    tc.attach(p);
    const st = isStruct(p) && structures[p.userData.name];
    let m = tc.mode;
    if (m === 'scale' && !canScale(p)) m = 'translate';
    if (m === 'rotate' && st && !st.rotatable) m = 'translate';
    if (m === 'rotate' && p === groupPivot && !groupTurns()) m = 'translate';
    setMode(m);
  }
  if (!keepInspector) showDetails();
  applyObjectVisibility();
  window.dispatchEvent(new CustomEvent('deusedix:selection'));
}

function setMode(m) {
  if (selected && !requireUnlocked()) return;
  if (m === 'scale' && selected && !canScale(selected)) {
    status(selected === groupPivot ? 'This group contains objects with a fixed size. Select scalable members to resize them.' : 'This cannot be scaled: doors, elevators, lights and logic points keep their size.', 'warn');
    return;
  }
  if (m === 'rotate' && isStruct(selected) && !structures[selected.userData.name].rotatable) {
    status('This structure has doors or an elevator: it can be moved but not rotated.', 'warn');
    return;
  }
  if (m === 'rotate' && selected === groupPivot && !groupTurns()) {
    status('A structure in the selection has doors or an elevator: they can be moved but not rotated.', 'warn');
    return;
  }
  tc.setMode(m);
  tc.showX = tc.showZ = m !== 'rotate' || canTilt(selected);    // E: an object every way, the rest about the vertical
  tc.showY = true;
  applySnap();
  vpBar?.refresh();
}
const SNAP = { move: 16, rotate: 15 };       // grid snap steps: units, degrees (Settings, menubar.js)
function applySnap() {
  tc.setTranslationSnap(snap ? SNAP.move : null);
  tc.setRotationSnap(snap ? THREE.MathUtils.degToRad(SNAP.rotate) : null);
  tc.setScaleSnap(snap ? (selected && selected.userData.kind === 'box' ? 0.0001 : 0.05) : null);
  vpBar?.refresh();                        // the steps can change in File > Settings too
}

let scaleStart = null;                  // scale of an object when the drag began (objects scale evenly)
// The middle square of R scales like Unity's: by how far the mouse goes (right or up: bigger), 1% a pixel.
// three.js takes the pointer's distance from the object's middle instead, which jumps near the middle and
// turns the object inside out past it.
let evenScale = null;
let altCopyUndo = false;
function beginTransformUndo() {
  if (!altCopyUndo) pushUndo();
  altCopyUndo = false;
}
canvas.addEventListener('pointerdown', (e) => {          // before the gizmo's own (capture)
  evenScale = null;
  transformGesture = false;
  if (e.button !== 0 || !selected || tc.dragging || !tc.axis) return;
  transformGesture = true;
  if (e.altKey && !placing && !lkPicking && !surfaceTools.mode) {
    const axis = tc.axis;
    // Copy in place before TransformControls records its drag origin. The copy
    // and its complete drag are one Undo, not a copy plus a second move.
    if (!duplicateSelected({offset: 0})) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    tc.axis = axis;
    altCopyUndo = true;
  }
  if (tc.mode === 'scale' && tc.axis === 'XYZ') evenScale = { x: e.clientX, y: e.clientY, drag: 0, vertical: false };
  if (tc.mode === 'rotate' && canTilt(selected)) foldTilt(selected);
}, true);
canvas.addEventListener('pointermove', (e) => {
  if (!evenScale || !tc.dragging) return;
  const dx = e.clientX - evenScale.x, dy = evenScale.y - e.clientY;
  evenScale.x = e.clientX; evenScale.y = e.clientY;
  const big = Math.max(Math.abs(dx), Math.abs(dy));
  if (!big) return;
  if (Math.abs(Math.abs(dx) - Math.abs(dy)) / big > 0.1) evenScale.vertical = Math.abs(dy) > Math.abs(dx);
  evenScale.drag += Math.sign(evenScale.vertical ? dy : dx) * Math.hypot(dx, dy) * 0.01;
}, true);
function evenScaleNow() {
  if (!evenScale || tc.mode !== 'scale' || tc.axis !== 'XYZ' || !selected) return;
  const from = selected === groupPivot ? groupStart && groupStart.scale : scaleStart;
  if (!from) return;
  let f = 1 + evenScale.drag;
  if (snap && selected.userData.kind !== 'box') f = Math.round(f * 20) / 20;      // 5% steps (a block snaps to 8 units)
  selected.scale.copy(from).multiplyScalar(Math.max(0.05, f));
}
function beginGroupMove() {
  // A structure carries its own map actors, so a separately selected child is not transformed twice.
  const ms = members(), carried = new Set(ms.filter(isStruct).map(m => m.userData.name));
  return { pos: groupPivot.position.clone(), quat: groupPivot.quaternion.clone(), scale: groupPivot.scale.clone(), mode: tc.mode,
    m: ms.filter(m => !(m.userData.actor && m.userData.source === 'map' && carried.has(actorStruct[m.userData.actor.name])))
      .map(m => ({ m, pos: m.position.clone(), quat: rotations.quat(objectRotation(m)), scale: m.scale.clone(), st: isStruct(m) ? beginStructMove(m) : null })) };
}
function followGroupMove(state) {
  if (!state) return;
  const dq = groupPivot.quaternion.clone().multiply(state.quat.clone().invert()), delta = groupPivot.position.clone().sub(state.pos);
  let factor = 1;
  if (state.mode === 'scale') {
    const values = ['x', 'y', 'z'].map(k => groupPivot.scale[k] / state.scale[k]);
    const index = values.map(v => Math.abs(v - 1)).indexOf(Math.max(...values.map(v => Math.abs(v - 1))));
    factor = Math.max(0.05, values[index]);
    groupPivot.scale.copy(state.scale).multiplyScalar(factor);
  }
  for (const g of state.m) {
    g.m.position.copy(state.pos).add(g.pos.clone().sub(state.pos).multiplyScalar(factor).applyQuaternion(dq)).add(delta);
    g.m.scale.copy(g.scale).multiplyScalar(factor);
    if (!g.st || g.st.st.rotatable !== false) setObjectRotation(g.m, rotations.rot(dq.clone().multiply(g.quat)));
    if (g.st) followStructure(g.st);
  }
}
tc.addEventListener('dragging-changed', (e) => {
  if (selected === groupPivot) {            // several objects: each one written when the drag ends
    if (e.value) {
      beginTransformUndo();
      groupStart = beginGroupMove();
    } else {
      const sts = groupStart ? groupStart.m.filter((g) => g.st) : [];
      for (const g of groupStart ? groupStart.m : []) { if (g.st) commitStructure(g.st, true); else commit(g.m); }
      if (sts.length) setDirty();
      groupStart = null; evenScale = null; showDetails();
    }
    return;
  }
  if (e.value) { beginTransformUndo(); if (isStruct(selected)) beginStructMove(); scaleStart = selected ? selected.scale.clone() : null; }
  else {
    evenScale = null;
    if (selected && selected.userData.folded) unfoldTilt(selected);
    commit(selected);
  }
});
tc.addEventListener('objectChange', () => {
  evenScaleNow();
  if (selected === groupPivot && groupStart) {
    followGroupMove(groupStart);
    return;
  }
  const p = selected;
  if (p && p.userData.folded) return;          // turning every way: its numbers when it is let go
  if (p && tc.mode === 'scale' && p.userData.actor && scaleStart) {   // a model has one scale in Deus Ex: all axes together
    const d = [p.scale.x - scaleStart.x, p.scale.y - scaleStart.y, p.scale.z - scaleStart.z];
    const i = d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs)));
    p.scale.setScalar(Math.max(0.05, [p.scale.x, p.scale.y, p.scale.z][i]));
  }
  if (isStruct(selected)) followStructure();
  showDetails(true);
});

// Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z): each change is one state (applying a texture from the Texture Editor too:
// Ctrl+Z takes it away, Ctrl+Y puts it back; Gabby, 17 Oct 2026)
const redoStack = [];
function pushUndo() {
  undo.push(JSON.stringify(edits));
  if (undo.length > 100) undo.shift();
  redoStack.length = 0;
}
function afterHistory() { rebuildProxies(); setDirty(); showDetails(); if (logicBox.style.display === 'block') renderLogic(); }

// write the proxy's current transform into the edits
function commit(p) {
  if (!p) return;
  if (!requireUnlocked(p)) return;
  if (anim && p === anim.p) return animRecord();     // the Animation panel is open: a key at the playhead
  const d = p.userData;
  if (d.kind === 'structure') return commitStructure();
  if (d.kind === 'drawn') { drawTools.commitMove(p); setDirty(); showDetails(); return; }
  if (d.kind === 'box') {
    const b = d.box, c = UE(p.position);
    b.rot = rotations.rot(p.quaternion);
    const sx = Math.abs(p.scale.x), sy = Math.abs(p.scale.z), sz = Math.abs(p.scale.y);
    const snapv = (v) => snap ? Math.max(8, Math.round(v / 8) * 8) : Math.max(4, r1(v));
    const w = snapv(sx), dpt = snapv(sy), h = snapv(sz);
    b.lo = [r1(c[0] - w / 2), r1(c[1] - dpt / 2), r1(c[2] - h / 2)];
    b.hi = [r1(c[0] + w / 2), r1(c[1] + dpt / 2), r1(c[2] + h / 2)];
    p.scale.set(w, h, dpt);
    dressBlock(p);
  } else if (d.source === 'map') {
    const a = d.actor;
    const prev = edits.moved[a.name];
    // its original place: where the last build put it, moved along with its structure if that moved since
    let orig = baseActors.find((x) => x.name === a.name).loc;
    const st = structures[actorStruct[a.name]];
    if (!prev && st) orig = poseToPose(st, st.placement, poseOf(st))(orig).map(r1);
    const r0 = a.rot || [0, 0, 0];            // pitch and roll stay as they are (tilted cameras, signs)
    edits.moved[a.name] = { cls: a.cls, loc: UE(p.position), rot: [d.tilt ?? (r0[0] || 0), radToYaw(p.rotation.y), d.roll ?? (r0[2] || 0)], orig: prev?.orig || orig };
    const s = Math.round(p.scale.x * (builtScale[a.name] || 1) * 100) / 100;
    if (Math.abs(s - 1) > 0.005) edits.moved[a.name].scale = s;
  } else if (d.source === 'added') {
    const e = edits.added.find((x) => x.name === d.actor.name);
    e.loc = UE(p.position);
    e.rot = [d.tilt || 0, radToYaw(p.rotation.y), d.roll || 0];      // its pitch and roll stay (a spotlight, a stuck object, a book)
    const s = Math.round(p.scale.x * 100) / 100;
    if (Math.abs(s - 1) > 0.005) e.scale = s; else delete e.scale;
  }
  setDirty();
  showDetails();
}

function setDirty() { editRevision++; dirty = true; showChanges(); buildStructList(); buildHierarchy(); status(`${mapName}: unsaved changes`, 'warn'); }

function dropSelected() {
  if (!requireUnlocked()) return;
  placeOnSurfaces('drop');
}
function placeOnSurfaces(mode) {
  const many = selected === groupPivot, all = (many ? members() : [selected]).filter(Boolean);
  const carried = new Set(all.filter(isStruct).map(p => p.userData.name));
  const list = all.filter(p => !(p.userData.actor && carried.has(actorStruct[p.userData.actor.name])));
  const ignored = new Set(all);
  for (const p of proxies.children) if (p.userData.actor && carried.has(actorStruct[p.userData.actor.name])) ignored.add(p);
  const found = list.filter(p => !selectionLocked(p))
    .map(p => [p, mode === 'stick' ? stickTarget(p, ignored) : dropTarget(p, ignored)]).filter(([, hit]) => hit);
  if (!found.length) { log(`${placeModeLabel(mode)}: no reachable surface for this selection.`, 'warn'); return; }
  pushUndo();
  const keep = many ? { nest: groupPivot.userData.nest, keys: selKeys() } : null;
  for (const [p, hit] of found) {
    const ms = isStruct(p) ? beginStructMove(p) : null;
    if (mode === 'stick' && p.userData.actor) { stickOne(p, hit); continue; }
    if (mode === 'stick' && (!isStruct(p) || structures[p.userData.name].rotatable)) placementGeometry.align(p, hit.n);
    placementGeometry.contact(p, hit.point, mode === 'drop' ? new THREE.Vector3(0, 1, 0) : hit.n);
    if (ms) { followStructure(ms); commitStructure(ms, true); } else commit(p);
  }
  setDirty(); showDetails();
  if (keep) selectKeys(keep.keys, keep.nest);
  log(`${found.length} item${found.length === 1 ? '' : 's'} ${mode === 'stick' ? 'stuck to the surface' : 'dropped to the floor'}.${found.length < list.length ? ' Some items had no reachable surface or are locked.' : ''} Ctrl+Z undoes.`, 'ok');
}
function surfaceHit(from, dir, ignored, far) {
  scene.updateMatrixWorld(true);
  ray.set(from, dir.clone().normalize()); ray.far = far;
  try {
    const hits = ray.intersectObjects([...world.children, ...proxies.children], true);
    return visibleHits(hits).find(h => h.distance > 0.05 && h.face && !placementGeometry.belongs(h.object, ignored)
      && !h.object.isSprite && (h.object.userData.world || structureOf(h.object) || h.object.parent?.userData.model === h.object
        || placementGeometry.belongs(h.object, new Set(proxies.children.filter(p => p.userData.model || p.userData.box || p.userData.drawn)))));
  } finally { ray.far = Infinity; }
}
function dropTarget(p, ignored) {
  const box = placementGeometry.bounds(p), from = box.isEmpty() ? p.position.clone() : box.getCenter(new THREE.Vector3());
  if (!box.isEmpty()) from.y = box.min.y + 1;
  const hit = surfaceHit(from, new THREE.Vector3(0, -1, 0), ignored, 5000);
  return hit ? { point: hit.point.clone(), n: new THREE.Vector3(0, 1, 0) } : null;
}
// ---- Drop to floor / Stick to surface: the Drop button's menu (and the right-click and Edit menus) chooses
// the mode, End does it (surface-stick.js). Stick: toward the surface behind the object as the camera sees
// it (else behind its back), its back flush on the first wall, floor, door, block or object it meets.
const safeStorage = () => { try { return window.localStorage; } catch (e) { return null; } };
let placeMode = loadPlaceMode(safeStorage());
function placeSelected(mode) {
  if (mode) { placeMode = mode === 'stick' ? 'stick' : 'drop'; savePlaceMode(safeStorage(), placeMode); }
  if (placeMode === 'stick') stickSelected(); else dropSelected();
  if (mode) showDetails();                  // the Drop button shows the mode chosen
}
function openPlaceMenu(btn) {
  const r = btn.getBoundingClientRect(), k = menuKey('drop') || 'End';
  openMenu(r.left, r.bottom + 2, PLACE_MODES.map(([m, label]) => ({ label: (m === placeMode ? '\u25cf ' : '\u2003') + label, key: m === placeMode ? k : '', run: () => placeSelected(m) })));
}
function placeButtons(id) {
  const stick = placeMode === 'stick', k = menuKey('drop') || 'End';
  return `<span class="place-split">${ib(id, stick ? 'stick' : 'drop', stick ? 'Stick' : 'Drop', `${placeModeLabel(placeMode)} (${k})`)}<button class="ib place-mode" id="${id}mode" title="Choose what this button and ${k} do: Drop to floor or Stick to surface" aria-haspopup="menu">${ICON.chev}</button></span>`;
}
function stickSelected() {
  if (!requireUnlocked()) return;
  placeOnSurfaces('stick');
}
// the surface behind it: {point, n (three.js normal, toward the object)} or null. The floor it stands on
// does not count (that is Drop to floor): looking down at it, the ray goes on level with the floor.
function stickTarget(p, ignored = new Set([p])) {
  const d = p.userData, box = placementGeometry.bounds(p);
  const from = box.isEmpty() ? p.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
  const half = box.isEmpty() ? 8 : (box.max.y - box.min.y) / 2;
  const cast = (dir) => {
    if (dir.lengthSq() < 1e-6) return null;
    dir.normalize();
    const hit = surfaceHit(from, dir, ignored, 4000);
    if (!hit) return null;
    const n = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
    if (n.dot(dir) > 0) n.negate();
    return { point: hit.point.clone(), n };
  };
  const underIt = (r) => r.n.y > 0.7 && from.y - r.point.y <= half + 8;
  const r0 = objectRotation(p), back = rotationToVector(r0[0], r0[1]).map((v) => -v);
  for (const dir of [from.clone().sub(camera.position), new THREE.Vector3(back[0], back[2], back[1])]) {
    let r = cast(dir.clone());
    if (r && underIt(r)) r = cast(new THREE.Vector3(dir.x, 0, dir.z));
    if (r && !underIt(r)) return r;
  }
  return null;
}
// how far the object reaches behind its pivot (its back), in units
function backDepth(p) {
  const d = p.userData;
  if (d.fxGizmo) return 1.5;
  if (d.kind === 'light' || d.kind === 'path' || d.kind === 'logic') return 4;
  const m = d.model;
  if (m) {
    m.updateWorldMatrix(true, true);
    const inv = m.matrixWorld.clone().invert(), box = new THREE.Box3(), part = new THREE.Box3(), rel = new THREE.Matrix4();
    m.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(part.copy(o.geometry.boundingBox).applyMatrix4(rel.multiplyMatrices(inv, o.matrixWorld)));
    });
    if (!box.isEmpty()) { const s = new THREE.Vector3(); m.getWorldScale(s); return Math.max(0, -box.min.x * s.x); }
  }
  return Math.max(4, d.actor.radius || 16) * p.scale.x;
}
// the game's decorations fall when they are not on a floor: Physics None keeps a stuck one there
function fallsInGame(a) {
  if (!a || a.cls === 'UCMeshDeco') return false;
  const chain = chainNow[a.cls];
  if (chain) return chain.includes('DeusExDecoration');
  return palette.some((c) => c.category === 'Decorations' && c.items.some((it) => it.cls === a.cls));
}
function stickOne(p, r) {
  const d = p.userData, a = d.actor, n = [r.n.x, r.n.z, r.n.y];
  const rot = normalToRotation(n, radToYaw(p.rotation.y));
  d.tilt = rot.pitch; d.roll = 0;
  p.rotation.y = yawToRad(rot.yaw);
  applyTilt(p);
  p.position.copy(T(stickPoint([r.point.x, r.point.z, r.point.y], n, backDepth(p))));
  let physics = false;
  if (fallsInGame(a) && (!isFloor(n) || rot.pitch)) {
    edits.props = edits.props || {};
    (edits.props[a.name] || (edits.props[a.name] = {})).Physics = 'PHYS_None';
    physics = true;
  }
  commit(p);
  return physics;
}
// E turns every selectable object about all three axes. While a ring is held the whole turn is on the object's
// group; let go, it is split again into its yaw (the group) and its pitch and roll (its model), the way
// Deus Ex turns things: Yaw, then Pitch, then Roll. In three.js: Y(-yaw) . Z(pitch) . X(roll).
function canTilt(p) {
  const d = p && p.userData;
  return !!d;
}
function objectRotation(p) {
  const d = p.userData;
  return d.actor && !d.folded ? [d.tilt || 0, radToYaw(p.rotation.y), d.roll || 0] : rotations.rot(p.quaternion);
}
function setObjectRotation(p, rot) {
  const d = p.userData;
  if (!d.actor || d.folded) p.quaternion.copy(rotations.quat(rot));
  else { d.tilt = signedRot(rot[0]); d.roll = signedRot(rot[2]); p.rotation.set(0, yawToRad(rot[1]), 0); applyTilt(p); }
}
const tiltQuat = (pitch, roll) => new THREE.Quaternion().setFromEuler(new THREE.Euler(roll * 2 * Math.PI / YAW, 0, pitch * 2 * Math.PI / YAW, 'ZXY'));
// the models of the map are exported unrotated (UC_MESHES): all of its pitch and roll is drawn
function foldTilt(p) {
  const d = p.userData;
  if (d.folded || !d.actor) return;
  p.quaternion.multiply(tiltQuat(d.tilt || 0, d.roll || 0));
  for (const o of [d.model, d.body, d.fxGizmo]) if (o && !o.isSprite) o.quaternion.identity();
  d.folded = true;
}
function unfoldTilt(p) {
  const d = p.userData;
  if (!d.folded) return;
  d.folded = false;
  const e = new THREE.Euler().setFromQuaternion(p.quaternion, 'YZX');
  const ue = (r) => signedRot(Math.round(r * YAW / (2 * Math.PI)));
  d.tilt = ue(e.z); d.roll = ue(e.x);
  p.rotation.set(0, e.y, 0, 'XYZ');
  applyTilt(p);
}
// its pitch and roll on the screen: an effect point's gizmo its pitch, a model both
function applyTilt(p) {
  const d = p && p.userData, a = d && d.actor;
  if (!a) return;
  const rad = (v) => v * 2 * Math.PI / YAW;
  const q = tiltQuat(d.tilt || 0, d.roll || 0);
  for (const o of [d.model, d.body, d.fxGizmo]) if (o && !o.isSprite) o.quaternion.copy(q);
}
// what the preview of an effect point shows this frame (effect-point.js), or null
function fxWant(p) {
  const a = p.userData.actor;
  if (!a || !edits) return null;
  const pv = fxPreviewOf(edits, a.name);
  if (p !== selected && !pv.always) return null;
  const kind = fxPreviewKind(edits, a.name);
  if (kind === 'none') return null;
  const light = fxEffectsOn(edits.links, a.name).find((e) => e.kind === 'blinklight' || e.kind === 'pulse');
  return { kind, colour: light ? light.colour : 'red' };
}
// the Effect point section of its Properties: the preview (editor only) and the rules that use it
function fxPointSection(a, redraw) {
  const pv = fxPreviewOf(edits, a.name);
  const rules = lkList().filter((l) => (l.do || []).some((x) => x.verb === 'effect' && x.target === a.name));
  let h = '<div class="hint" style="margin:2px 0">The big orange arrow is the way the effect goes: mist, smoke, sparks and fire blow along it, a light shines from the point. Turn it with E, Rotation and Pitch; Stick to surface puts it on a wall with the arrow out of it.</div>';
  h += `<div class="row"><label title="Only in the editor: nothing of it goes into the game">Preview</label><select data-fxp="kind" style="flex:1;min-width:0">${FX_PREVIEW_KINDS.map(([k, l]) => `<option value="${k}" ${k === pv.kind ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></div>
    <div class="row"><label style="width:auto" title="Off: only while the point is selected"><input type="checkbox" data-fxp="always" ${pv.always ? 'checked' : ''}> always play the preview</label></div>`;
  h += rules.length ? rules.map((l) => `<div class="hint" style="margin:2px 0">${escapeHtml(lkSentence(l))}</div>`).join('')
    : '<div class="hint" style="margin:2px 0">No effect uses it yet: in the Interactions of a button, a trigger or a timer add "An effect on it" and click this point (or press "at an Effect point...").</div>';
  const wire = () => {
    for (const input of $('#propsec').querySelectorAll('[data-fxp]')) input.onchange = () => lkChange(null, () => {
      const cur = Object.assign(fxPreviewOf(edits, a.name), { [input.dataset.fxp]: input.type === 'checkbox' ? input.checked : input.value });
      edits.fxpreview = edits.fxpreview || {};
      if (cur.kind === 'auto' && !cur.always) delete edits.fxpreview[a.name]; else edits.fxpreview[a.name] = cur;
      wake();
    }, redraw);
  };
  return { html: inspectorSection('effectpoint', 'Effect point', h, true), wire };
}
function removeOne(p) {                    // an object or a block out of the map (the undo is the caller's)
  const d = p.userData;
  if (d.kind === 'drawn') edits.drawn = (edits.drawn || []).filter((x) => x !== d.drawn);
  else if (d.kind === 'box') edits.boxes = edits.boxes.filter((b) => b !== d.box);
  else if (d.source === 'added') edits.added = edits.added.filter((a) => a.name !== d.actor.name);
  else {
    let orig = baseActors.find((x) => x.name === d.actor.name).loc;
    const st = structures[actorStruct[d.actor.name]];
    if (st) orig = poseToPose(st, st.placement, poseOf(st))(orig).map(r1);
    edits.deleted[d.actor.name] = { cls: d.actor.cls, orig: edits.moved[d.actor.name]?.orig || orig };
    delete edits.moved[d.actor.name];
  }
  proxies.remove(p);
}

function confirmMoverDeletion(items, deletingStructures = false) {
  const movers = items.filter(p => !isStruct(p) && animIsMover(p));
  if (!movers.length) return true;
  const name = p => p.userData.actor?.name || p.userData.box?.name || 'Moving object';
  const title = movers.length === 1 ? `Delete "${name(movers[0])}" (door / elevator)?` : `Delete ${movers.length} doors / elevators?`;
  return confirm(title + '\n\n' + (deletingStructures
    ? 'The selected structures and their contents will also be removed.'
    : 'Only the selected objects will be removed. Surrounding walls and structures will stay.') +
    '\nButtons, triggers or mission scripts that use them may stop working.\n\nCtrl+Z restores the deletion. Continue?');
}

function deleteSelected() {
  if (!requireUnlocked()) return;
  if (selected === groupPivot) {
    const ms = members(), nest = groupPivot.userData.nest;
    const sts = ms.filter(isStruct).map((m) => structures[m.userData.name]);
    if (sts.some((st) => st.gameplay) && !confirm('Some of these structures contain objects the mission uses (doors, characters, named objects). Delete them anyway?')) return;
    if (!confirmMoverDeletion(ms, sts.length > 0)) return;
    if (anim && ms.includes(anim.p)) closeAnim();
    pushUndo();
    const gone = ms.map(keyOf);
    for (const m of ms) { if (isStruct(m)) removeStructure(structures[m.userData.name]); else removeOne(m); }
    if (nest) gone.push('n:' + nest, ...nestsWithin(nest).map((id) => 'n:' + id));     // a nest goes with what it held
    forgetKeys(gone);
    tc.detach(); selected = null;
    setDirty(); if (sts.length) rebuildProxies(); showDetails();
    log(`${ms.length} ${nest ? 'things and their nest' : 'things'} deleted (Ctrl+Z brings them back).`);
    return;
  }
  const p = selected;
  if (!p) return;
  const d = p.userData;
  if (!confirmMoverDeletion([p])) return;
  if (d.kind === 'structure') {
    const st = structures[d.name];
    if (st.gameplay && !confirm(`"${st.label}" contains objects the mission uses (doors, characters, named objects). Delete it anyway?`)) return;
    pushUndo();
    removeStructure(st);
    forgetKeys(['s:' + st.name]);
    tc.detach(); select(null);
    setDirty(); rebuildProxies();
    return;
  }
  if (anim && anim.p === p) closeAnim();
  pushUndo();
  forgetKeys([keyOf(p)]);
  removeOne(p);                         // the mover's real geometry belongs to this proxy, not the walls
  tc.detach(); selected = null;
  setDirty(); showDetails();
}

function removeStructure(st) {             // a structure out of the map (the undo is the caller's)
  if (st.paste) edits.prefabs = edits.prefabs.filter((e) => 'paste~' + e.pid !== st.name);
  else if (st.copy_of) edits.copies = edits.copies.filter((c) => `${c.group}~${c.id}` !== st.name);
  else edits.groups[st.name] = Object.assign({}, poseOf(st), { deleted: true });
}

function restoreStructure(name) {
  const st = structures[name];
  if (!st || st.copy_of) return;
  pushUndo();
  const e = edits.groups[name];
  if (e && e.deleted) { delete e.deleted; if (!(e.offset || []).some((v) => v) && !e.yaw) delete edits.groups[name]; }
  else {           // back where the script puts it, with its objects
    selected = st.obj;
    beginStructMove();
    showPose(st, { offset: [0, 0, 0], yaw: 0 });
    followStructure();
    commitStructure();
  }
  setDirty(); rebuildProxies();
  select(structures[name].obj);
}

function addedKind(cls) {
  if (/\.UC[WA]_\w+$/.test(cls)) return 'prop';                       // Tools > Weapons: things to pick up, drawn with their model
  if (window.__scripts && String(cls).startsWith(window.__scripts.package + '.')) return 'logic';     // Tools > Scripts
  if (/^(Light|Spotlight)$/.test(cls)) return 'light';
  if (/^UCCustom/.test(cls)) return 'pawn';
  if (NAV_CLASSES.test(cls)) return 'path';
  if (/^(UCSoundFX|AmbientSound|Trigger|UCTriggerBox|UCCutscene|UCTimer|UCEffectPoint)$/.test(cls) || ZONE_CLASSES.test(cls)) return 'logic';
  if (palette.some((c) => c.category === 'Characters' && c.items.some((it) => it.cls === cls))) return 'pawn';
  if (/Teleporter|PlayerStart|MapExit/.test(cls)) return 'logic';
  return 'prop';
}
function nextTag(prefix) {               // a Tag nobody in this map has yet
  const used = new Set(allActors().map((a) => String(actorProp(a, 'Tag') || a.tag || '').toLowerCase()));
  let i = 1;
  while (used.has((prefix + i).toLowerCase())) i++;
  return prefix + i;
}
function nextName(prefix) {
  const used = new Set([...baseActors.map((a) => a.name), ...edits.added.map((a) => a.name), ...edits.boxes.map((b) => b.name)]);
  // Deleted objects can still own settings (and Undo can restore them). A new
  // object must not inherit that name's activation, properties or Scene state.
  for (const field of ['moved', 'deleted', 'disabled', 'props', 'anims', 'motions', 'texts', 'documents', 'cutscenes'])
    for (const name of Object.keys(edits[field] || {})) used.add(name);
  const state = viewState();
  for (const key of [...state.hidden, ...state.locked]) if (/^[ab]:/.test(key)) used.add(key.slice(2));
  let i = 0;
  while (used.has(prefix + i)) i++;
  return prefix + i;
}

function dupOne(p, offset = 48) {           // no undo or selection: shared by Duplicate and Alt-drag
  const d = p.userData;
  if (d.kind === 'drawn') {
    const b = JSON.parse(JSON.stringify(d.drawn));
    let i = 1; while ((edits.drawn || []).some(x => x.name === b.name + '_copy' + i)) i++;
    b.name += '_copy' + i; b.pts = b.pts.map(([x, y]) => [x + offset, y]);
    (edits.drawn ||= []).push(b); const obj = drawTools.proxy(b); proxies.add(obj); return obj;
  }
  if (d.kind === 'box') {
    const b = JSON.parse(JSON.stringify(d.box));
    b.name = nextName('UCEditBox'); b.lo[0] += offset; b.hi[0] += offset;
    edits.boxes.push(b);
    return makeBoxProxy(b);
  }
  const a = d.actor;
  const original = d.source === 'added' ? edits.added.find(x => x.name === a.name) || a : a;
  const e = { name: nextName('UCEdit'), cls: a.cls, loc: UE(p.position.clone().add(new THREE.Vector3(offset, 0, 0))), rot: objectRotation(p),
              props: JSON.parse(JSON.stringify({...(/Light$/.test(a.cls) ? lightProps(a) : {}), ...original.props, ...edits.props?.[a.name]})), radius: a.radius, height: a.height };
  e.scale = p.scale.x * (d.source === 'map' ? builtScale[a.name] || 1 : 1);
  if (a.custom) { e.custom = a.custom; e.kind = 'pawn'; }
  for (const field of ['anims', 'motions', 'texts', 'documents', 'cutscenes', 'disabled']) {
    if (edits[field]?.[a.name] !== undefined) edits[field][e.name] = JSON.parse(JSON.stringify(edits[field][a.name]));
  }
  edits.added.push(e);
  return makeProxy(Object.assign({ kind: a.kind }, e, { light: a.light }), 'added');
}
// a copy of a structure next to it, in the edits (no undo, no selection): its name, null when it cannot
function dupStructure(st, dx = null) {
  if (!st.copyable) return null;
  const size = new THREE.Box3().setFromObject(st.obj).getSize(new THREE.Vector3());
  const step = dx ?? Math.ceil((size.x + 64) / 16) * 16;
  if (st.paste) {                 // another copy of the same piece from the other map
    const e0 = pasteEntry(st.name), e = Object.assign(JSON.parse(JSON.stringify(e0)), { pid: nextPid() });
    e.offset = [e0.offset[0] + step, e0.offset[1], e0.offset[2]];
    edits.prefabs.push(e);
    return 'paste~' + e.pid;
  }
  const group = st.copy_of || st.name, pose = poseOf(st);
  let i = 1;
  while (edits.copies.some((c) => c.group === group && c.id === 'c' + i) || structures[`${group}~c${i}`]) i++;
  const c = setPose({ group, id: 'c' + i }, { ...pose, offset: [pose.offset[0] + step, pose.offset[1], pose.offset[2]] });
  edits.copies.push(c);
  return `${group}~${c.id}`;
}
function duplicateSelected({offset = 48} = {}) {
  if (!selected || !requireUnlocked()) return false;
  const all = selected === groupPivot ? members() : [selected];
  const carried = new Set(all.filter(isStruct).map(m => m.userData.name));
  const list = all.filter(m => !(m.userData.source === 'map' && m.userData.actor && carried.has(actorStruct[m.userData.actor.name])));
  const blocked = list.filter(m => isStruct(m) ? !structures[m.userData.name]?.copyable : m.userData.kind === 'mover');
  if (blocked.length) {
    const names = blocked.map(m => isStruct(m) ? structures[m.userData.name].label : m.userData.actor?.name).join(', ');
    const message = `Nothing duplicated: ${names} needs a reusable prefab. Un-nest to copy individual pieces, or use Objects → Movers for a door or elevator.`;
    status(message, 'warn'); log(message, 'warn'); return false;
  }
  if (!list.length) return false;
  const nest = selected === groupPivot && groupPivot.userData.nest, news = [];
  pushUndo();
  for (const m of list) news.push(isStruct(m) ? 's:' + dupStructure(structures[m.userData.name], offset) : keyOf(dupOne(m, offset)));
  let n = null;
  if (nest) {
    const n0 = nestById(nest), up = parentNest('n:' + nest);
    n = newNest(`${n0.label} (copy)`, news);
    if (up) up.items.push('n:' + n.id);
  }
  setDirty(); rebuildProxies();
  if (n) selectNest(n.id); else selectKeys(news);
  status(`Duplicated ${news.length} selected ${news.length === 1 ? 'item' : 'items'}. ${offset ? 'The copies are selected beside the originals.' : 'Drag to place the copies.'}`, 'ok');
  return true;
}

function lightProps(a) {
  const l = a.light || { b: 128, hue: 32, sat: 160, radius: 12 };
  return { LightBrightness: l.b ?? 128, LightHue: l.hue ?? 32, LightSaturation: l.sat ?? 160, LightRadius: l.radius ?? 12 };
}

function focusSelected() {
  if (!selected) return;
  const box = new THREE.Box3();
  for (const o of selected === groupPivot ? members() : [selected]) box.union(new THREE.Box3().setFromObject(o));
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(24, box.getSize(new THREE.Vector3()).length() * 0.6);      // small things (a gun, a can) come close too
  camera.position.copy(c.clone().addScaledVector(forward(), -r * 1.4));
}

// ---------------------------------------------------------------- copy and paste (also between maps)
const prefabDisplays = {};
function loadPrefabDisplay(id) {
  return prefabDisplays[id] || (prefabDisplays[id] = fetch(`/prefabs/${id}/display.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
}
function nextPid() { let i = 1; while (edits.prefabs.some((e) => e.pid === 'p' + i)) i++; return 'p' + i; }
function clipboard() { try { return JSON.parse(localStorage.getItem(projectStorageKey('clipboard', projectContext)) || 'null'); } catch (e) { return null; } }
let copyInFlight = null, clipboardSequence = 0, clipboardPastes = null;
const clipClone = value => JSON.parse(JSON.stringify(value));
// Capture the displayed pose at Ctrl+C, not the saved pose, the camera or the
// selection when an asynchronous export finishes. All entries use world UE axes.
function clipboardItem(p) {
  const d = p.userData, loc = UE(p.position), rot = objectRotation(p);
  if (isStruct(p)) {
    const st = structures[d.name], pose = livePose(st);
    if (st.paste) return clipClone({ kind: 'prefab-entry', loc, entry: setPose({ ...pasteEntry(st.name) }, pose) });
    if (!st.copyable) throw new Error(`"${st.label}" contains protected objects. Un-nest to copy its individual pieces.`);
    const built = st.placement || NO_POSE;
    const unchanged = pose.offset.every((v, i) => Math.abs(v - (built.offset?.[i] || 0)) < 0.05) &&
      scaleOf(pose).every((v, i) => Math.abs(v - scaleOf(built)[i]) < 0.0001) &&
      Math.abs(rotations.pose(pose).dot(rotations.pose(built))) > 0.99999999 && !!pose.stretch === !!built.stretch;
    return clipClone({ kind: 'structure', loc, group: st.copy_of || st.name, pose, label: st.label,
      exportName: !st.pendingPiece && !st.pendingCopy && unchanged ? st.name : null });
  }
  if (d.kind === 'box') {
    const size = [p.scale.x, p.scale.z, p.scale.y];
    return clipClone({ kind: 'box', loc, box: { ...d.box, rot, lo: loc.map((v, i) => v - size[i] / 2), hi: loc.map((v, i) => v + size[i] / 2) } });
  }
  if (d.kind === 'drawn') {
    const b = d.drawn, origin = d.origin || loc;
    return clipClone({ kind: 'drawn', loc, drawn: { ...b, rot, z: loc[2], pts: b.pts.map(([x, y]) => [x + loc[0] - origin[0], y + loc[1] - origin[1]]) } });
  }
  if (d.kind === 'mover') throw new Error('This map-native door or elevator needs a brush-backed prefab. Use Objects → Movers; no selected items were copied.');
  if (!d.actor) throw new Error('This selection cannot be copied. Select its object or structure.');
  const a = d.actor, original = d.source === 'added' ? edits.added.find(x => x.name === a.name) || a : a;
  const state = {};
  for (const field of ['anims', 'motions', 'texts', 'documents', 'cutscenes', 'disabled'])
    if (edits[field]?.[a.name] !== undefined) state[field] = edits[field][a.name];
  return clipClone({ kind: 'actor', loc, rot, cls: a.cls, actorKind: a.kind || addedKind(a.cls), custom: a.custom,
    radius: a.radius, height: a.height, scale: p.scale.x,
    // A map export already contains its built DrawScale. Apply only the live
    // multiplier to that value; multiplying builtScale again would double it.
    props: { ...(/Light$/.test(a.cls) ? lightProps(a) : {}), ...original.props, ...edits.props?.[a.name] }, state,
    exportActor: d.source === 'map' ? a.name : null });
}
function copySelected() {
  const seq = ++clipboardSequence, sourceScript = script, generation = mapGeneration;
  const storageKey = projectStorageKey('clipboard', projectContext);
  const task = (async () => {
    try {
      if (!selected) throw new Error('Select an object or a structure to copy first.');
      const all = selected === groupPivot ? members() : [selected];
      const carried = new Set(all.filter(isStruct).map(m => m.userData.name));
      const list = all.filter(m => !(m.userData.source === 'map' && m.userData.actor && carried.has(actorStruct[m.userData.actor.name])));
      const items = list.map(clipboardItem); // preflight every member before exporting any
      if (!items.length) throw new Error('Select something to copy first.');
      const anchor = items.reduce((c, it) => c.map((v, i) => v + it.loc[i] / items.length), [0, 0, 0]);
      busy('Copying...');
      for (const it of items) {
        if (it.exportActor) {
          const base = await api('/api/copy?script=' + encodeURIComponent(sourceScript), { actor: it.exportActor });
          it.props = { ...base.props, ...it.props };
          delete it.exportActor;
        }
        if (it.exportName) {
          // Optional portable fallback. Local copy/paste never depends on a
          // Rebuild and never substitutes stale, baked geometry for a live pose.
          try { it.portable = await api('/api/copy?script=' + encodeURIComponent(sourceScript), { structure: it.exportName }); }
          catch (_) { /* the local structure recipe is still complete */ }
          delete it.exportName;
        }
      }
      if (seq !== clipboardSequence || sourceScript !== script || generation !== mapGeneration || storageKey !== projectStorageKey('clipboard', projectContext)) return false;
      localStorage.setItem(storageKey, JSON.stringify({ version: 2, kind: 'selection', script: sourceScript, anchor, items }));
      clipboardPastes = null;
      status(`Copied ${items.length} ${items.length === 1 ? 'item' : 'items'}. Ctrl+V pastes nearby with the same rotation.`, 'ok');
      return true;
    } catch (e) {
      if (seq === clipboardSequence) {
        // A failed multi-copy must not leave an old light/object ready to paste.
        try { localStorage.removeItem(storageKey); } catch (_) { /* storage unavailable */ }
        status('Nothing copied: ' + e.message, 'warn'); log('Copy failed: ' + e.message, 'warn');
      }
      return false;
    } finally { if (seq === clipboardSequence) busy(''); }
  })();
  copyInFlight = task;
  task.finally(() => { if (copyInFlight === task) copyInFlight = null; });
  return task;
}
function pastePoint() {
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = visibleHits(ray.intersectObjects(worldMeshes, false))[0];
  return hit && hit.distance < 4000 ? hit.point.clone() : camera.position.clone().addScaledVector(forward(), 400);
}
function clipboardPasteDelta(clip, count) {
  const sameMap = clip.script === script;
  const target = sameMap ? T(clip.anchor) : pastePoint();
  const direction = target.clone().sub(camera.position), distance = direction.length();
  // Keep a nearby source beside its original. A distant source is pulled along
  // the camera-to-source line to within 256 UE units, never to the far wall.
  const nearby = sameMap && distance <= 320;
  if (!nearby && distance > 256) target.copy(camera.position).addScaledVector(direction, 256 / distance);
  target.x += 48 * (nearby ? count : count - 1);
  const reach = target.clone().sub(camera.position);
  if (reach.length() > 320) target.copy(camera.position).addScaledVector(reach.normalize(), 320);
  return UE(target).map((v, i) => v - clip.anchor[i]);
}
async function pasteClipboard() {
  if (copyInFlight && !await copyInFlight) return;
  if (!script || gameView?.active) return;
  const clip = clipboard();
  if (!clip) { status('Nothing to paste: select something and press Ctrl+C.', 'warn'); return; }
  if (clip.version !== 2) return pasteLegacyClipboard();
  const sameMap = clip.script === script;
  // Validate the entire selection before changing edits or adding an Undo step.
  for (const it of clip.items) {
    if (it.kind === 'structure' && !(sameMap && structures[it.group]?.copyable) && !it.portable) {
      status(`Nothing pasted: "${it.label}" needs its source geometry. Rebuild and copy it again before pasting into another map.`, 'warn'); return;
    }
  }
  const identity = JSON.stringify(clip) + '|' + script;
  const count = clipboardPastes?.identity === identity ? clipboardPastes.count + 1 : 1;
  const delta = clipboardPasteDelta(clip, count);
  const news = [];
  pushUndo();
  for (const original of clip.items) {
    const it = clipClone(original), at = add3(it.loc, delta);
    if (it.kind === 'prefab-entry') {
      const e = it.entry; e.pid = nextPid(); e.offset = add3(e.offset || [0, 0, 0], delta);
      edits.prefabs.push(e); news.push('s:paste~' + e.pid);
    } else if (it.kind === 'structure') {
      if (sameMap && structures[it.group]?.copyable) {
        let i = 1;
        while (edits.copies.some(c => c.group === it.group && c.id === 'c' + i) || structures[`${it.group}~c${i}`]) i++;
        const e = setPose({ group: it.group, id: 'c' + i }, { ...it.pose, offset: add3(it.pose.offset, delta) });
        edits.copies.push(e); news.push(`s:${e.group}~${e.id}`);
      } else {
        const pf = it.portable;
        const e = { pid: nextPid(), prefab: pf.id, label: pf.label, source: pf.source, pivot: pf.pivot,
          rotatable: pf.rotatable !== false, offset: delta, yaw: 0, ...moverFields(pf) };
        edits.prefabs.push(e); news.push('s:paste~' + e.pid);
      }
    } else if (it.kind === 'box') {
      const b = it.box; b.name = nextName('UCEditBox'); b.lo = add3(b.lo, delta); b.hi = add3(b.hi, delta);
      edits.boxes.push(b); news.push('b:' + b.name);
    } else if (it.kind === 'drawn') {
      const b = it.drawn; let i = 1;
      while ((edits.drawn || []).some(x => x.name === b.name + '_copy' + i)) i++;
      b.name += '_copy' + i; b.pts = b.pts.map(p => [p[0] + delta[0], p[1] + delta[1]]); b.z += delta[2];
      (edits.drawn ||= []).push(b); news.push('d:' + b.name);
    } else if (it.kind === 'actor') {
      const e = { name: nextName('UCEdit'), cls: it.cls, loc: at, rot: it.rot, scale: it.scale,
        radius: it.radius, height: it.height, props: it.props, kind: it.actorKind };
      if (it.custom) e.custom = it.custom;
      edits.added.push(e);
      for (const [field, value] of Object.entries(it.state || {})) (edits[field] ||= {})[e.name] = value;
      news.push('a:' + e.name);
    }
  }
  clipboardPastes = { identity, count };
  setDirty(); rebuildProxies(); selectKeys(news);
  status(`Pasted ${news.length} ${news.length === 1 ? 'item' : 'items'} nearby. Rotation and relative spacing kept.`, 'ok');
}
function pasteLegacyClipboard() {
  const clip = clipboard();
  if (!clip) { status('Nothing to paste: select something and press Ctrl+C (in this or another map).', 'warn'); return; }
  pushUndo();
  const c = UE(pastePoint());
  if (clip.kind === 'group') {               // several: the group's bottom on the point, each in its place
    const half = (it) => it.clip.kind === 'box' ? (it.clip.box.hi[2] - it.clip.box.lo[2]) / 2 : (it.clip.height || 16);
    const lift = -Math.min(...clip.items.map((it) => it.off[2] - half(it)));
    const news = [];
    for (const it of clip.items) {
      const at = [c[0] + it.off[0], c[1] + it.off[1], c[2] + lift + it.off[2]];
      if (it.clip.kind === 'box') {
        const b = it.clip.box, sz = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
        const nb = Object.assign({}, b, { name: nextName('UCEditBox'), lo: at.map((v, k) => r1(v - sz[k] / 2)), hi: at.map((v, k) => r1(v + sz[k] / 2)) });
        edits.boxes.push(nb);
        news.push(makeBoxProxy(nb));
      } else {
        const r0 = it.clip.rot || [0, 0, 0];
        const e2 = { name: nextName('UCEdit'), cls: it.clip.cls, loc: at.map(r1), rot: [r0[0] || 0, it.yaw ?? r0[1] ?? 0, r0[2] || 0], radius: it.clip.radius, height: it.clip.height || 16, props: it.clip.props || {} };
        edits.added.push(e2);
        news.push(makeProxy(Object.assign({ kind: addedKind(e2.cls) }, e2), 'added'));
      }
    }
    setDirty();
    setMulti(news);
    log(`Pasted ${news.length} objects.`);
    return;
  }
  if (clip.kind === 'prefab') {
    const e = { pid: nextPid(), prefab: clip.id, label: clip.label, source: clip.source, pivot: clip.pivot, rotatable: clip.rotatable !== false, ...moverFields(clip),
                offset: [Math.round(c[0] - clip.pivot[0]), Math.round(c[1] - clip.pivot[1]), Math.round(c[2] - clip.pivot[2])], yaw: 0 };
    edits.prefabs.push(e);
    setDirty(); rebuildProxies();
    select(structures['paste~' + e.pid].obj);
    log(`Pasted "${clip.label}" from ${clip.source}: move it where you want, then Rebuild.`);
  } else if (clip.kind === 'box') {
    const b = clip.box, s = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
    const nb = Object.assign({}, b, { name: nextName('UCEditBox'), lo: [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2]], hi: [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2]] });
    edits.boxes.push(nb); setDirty(); select(makeBoxProxy(nb));
  } else {
    const h = clip.height || 16, r0 = clip.rot || [0, 0, 0];
    const e2 = { name: nextName('UCEdit'), cls: clip.cls, loc: [c[0], c[1], r1(c[2] + h + 0.5)], rot: r0.slice(),
                 radius: clip.radius, height: h, props: clip.props || {} };
    edits.added.push(e2); setDirty();
    select(makeProxy(Object.assign({ kind: /Light$/.test(clip.cls) ? 'light' : 'prop' }, e2), 'added'));
  }
}
$('#paste').onclick = pasteClipboard;

// ---------------------------------------------------------------- Play from here
// The game opens on the installed map with JC standing on the floor below the camera, looking where
// the camera looks, after a mission state (the mod's debug commands) and flags; then you play.
function playStart() {
  if (temporaryTutorial()) return { at: [-120, -170, 48], yaw: 0, pitch: 0, floor: true };
  ray.set(camera.position.clone(), new THREE.Vector3(0, -1, 0));
  ray.far = 4000;
  const hit = ray.intersectObjects(worldMeshes, false)[0];
  ray.far = Infinity;
  const p = hit ? hit.point.clone().add(new THREE.Vector3(0, 52, 0)) : camera.position.clone();
  const yaw = ((Math.round(cam.yaw * 32768 / Math.PI) % YAW) + YAW) % YAW;
  const pitch = Math.max(-12000, Math.min(12000, Math.round(cam.pitch * 32768 / Math.PI)));
  return { at: UE(p), yaw, pitch, floor: !!hit };
}
async function openPlay() {
  if (!script || gameView?.active) return;
  if (!requirePlayerStart()) return;
  const box = $('#playbox');
  let info;
  try { info = await api('/api/play_info?script=' + encodeURIComponent(script)); } catch (e) { log(e.message, 'bad'); return; }
  const s = playStart();
  const warn = [];
  if (info.running) warn.push('The game is already open: close it first (Close game).');
  if (dirty || window.__story?.dirty) warn.push('Play saves your edits and rebuilds a temporary game copy.');
  box.innerHTML = `<b>${temporaryTutorial() ? 'Play tutorial' : 'Play from here'}</b> <span class="hint" style="margin:0">· ${escapeHtml(info.map)}</span>
    <div class="hint" style="margin:6px 0 10px">${temporaryTutorial() ? 'Every test starts in the reception room. Then the controls are yours.' : `The game opens on this map with JC ${s.floor ? 'standing below the camera' : 'at the camera (no floor found below it)'}, looking where you look. Then the controls are yours.` }</div>
    <div class="row"><label>Play in</label><select id="pmode"><option value="embedded">Editor</option><option value="external">Game window</option></select></div>
    <div class="row"><label>Mission preset</label><select id="pstate"><option value="">Normal map start</option>
      ${info.setups.map((x) => `<option value="${escapeHtml(x.name)}">${escapeHtml(x.text)}</option>`).join('')}</select></div>
    ${STANDALONE ? '' : `<div class="row"><label></label><label style="width:auto"><input type="checkbox" id="proute" checked> UNATCO route (the editor's story needs it)</label></div>`}
    <div id="play-states" style="margin:12px 0"></div>
    ${warn.map((w) => `<div class="warn" style="margin:6px 0">${escapeHtml(w)}</div>`).join('')}
    <div class="hint" style="margin:8px 0">JC starts at ${s.at.map((v) => Math.round(v)).join(', ')}. Shift+F1 releases the mouse; Stop ends the test.</div>
    <div class="row" style="justify-content:flex-end"><button id="pcancel">Cancel</button><button id="pgo" class="primary" ${info.running ? 'disabled' : ''}>Play</button></div>`;
  if (temporaryTutorial()) $('#pstate').disabled = true;
  box.style.display = 'block';
  const testStates = mountPlayStates($('#play-states'), { mountField: mountStateField });
  $('#pcancel').onclick = () => { testStates.destroy(); box.style.display = 'none'; };
  $('#pgo').onclick = async () => {
    const flags = testStates.value;
    testStates.destroy();
    box.style.display = 'none';
    await gameView.start($('#pmode').value, {
      at: s.at, yaw: s.yaw, pitch: s.pitch, setup: $('#pstate').value, flags,
      route: !!$('#proute')?.checked });
  };
}
$('#playhere').onclick = () => gameView?.active ? gameView.stop() : gameView?.start('embedded');
$('#factionsbtn').onclick = () => openFactions().catch((e) => log(e.message, 'bad'));
$('#charbtn').onclick = () => window.__characters && window.__characters.open();
// a character saved again in the Character Creator: its copies placed in this map take the new look
function updateCustom(id, props, body, cls) {
  let n = 0;
  for (const a of edits.added) {
    if (a.custom !== id) continue;
    if (!n) pushUndo();
    a.props = Object.assign({}, props, { BindName: a.props && a.props.BindName ? a.props.BindName : `"UCEd_${a.name}"` });
    a.cls = cls || a.cls;
    a.radius = body.radius; a.height = body.height;
    n++;
  }
  if (n) { setDirty(); rebuildProxies(); }
  return n;
}

// ---------------------------------------------------------------- palette and placing
// every object of the game: categories that open and close, subcategories, search on all the names
const openCats = new Set(['Most used']);
// the game's own placeholder names ("DEFAULT DECORATION NAME - REPORT THIS AS A BUG") are no names: the class then
const gameName = (n) => (n && !/DEFAULT\s+\w+\s+NAME|REPORT THIS AS A BUG/i.test(n) ? n : '');
function itemLabel(it) { return (it.preset && gameName(it.name)) || NAMES[it.cls] || gameName(it.name) || it.cls.replace(/([a-z])([A-Z0-9])/g, '$1 $2'); }
function buildPalette() {
  const q = $('#search').value.trim().toLowerCase();
  let html = '';
  const mine = window.__characters && window.__characters.paletteCategory();
  const categories = (mine && mine.items.length ? [mine] : []).concat(palette);
  categories.splice(Math.max(0, categories.findIndex(c => c.category === 'Most used') + 1), 0, { category: 'Movers', items: [], movingLibrary: true });
  for (const c of categories) {
    if (c.movingLibrary) {
      html += `<details data-cat="Movers" ${q || openCats.has('Movers') ? 'open' : ''}><summary>Movers</summary><div id="object-movers"></div></details>`;
      continue;
    }
    const items = c.items.filter((it) => !q || [it.cls, gameName(it.name), NAMES[it.cls] || '', c.category, it.sub || ''].some((s) => s.toLowerCase().includes(q)));
    if (!items.length) continue;
    html += `<details data-cat="${escapeHtml(c.category)}" ${q || openCats.has(c.category) ? 'open' : ''}><summary>${escapeHtml(c.category)} <small>${items.length}</small></summary>`;
    let sub = null;
    for (const it of items) {
      if ((it.sub || '') !== sub && c.category !== 'Most used') { sub = it.sub || ''; if (sub) html += `<div class="cat">${escapeHtml(sub)}</div>`; }
      const label = itemLabel(it);
      if (it.custom) {
        html += `<button class="item" data-custom="${escapeHtml(it.custom)}" title="${escapeHtml(it.name)}: your character (Characters)"><span class="th" data-th="char:${escapeHtml(it.custom)}|${escapeHtml(window.__characters.stamp(it.custom))}"></span><span class="tl">${escapeHtml(it.name)}</span><small>${escapeHtml(it.sub || '')}</small></button>`;
        continue;
      }
      html += `<button class="item" data-cls="${it.cls}" data-r="${it.radius}" data-h="${it.height}" ${it.preset ? `data-preset="${escapeHtml(JSON.stringify(it.preset))}" data-name="${escapeHtml(it.name)}"` : ''} title="${escapeHtml(label)} · ${escapeHtml(it.cls)}"><span class="th" ${paletteHas.has(it.cls) ? `data-th="cls:${it.cls}"` : ''}>${iconOf(it.cls)}</span><span class="tl">${escapeHtml(label)}</span><small>${label === it.cls ? '' : it.cls}</small></button>`;
    }
    html += '</details>';
  }
  $('#palette').innerHTML = html || '<div class="hint">No objects match this name.</div>';
  for (const d of document.querySelectorAll('#palette details')) d.addEventListener('toggle', () => {
    if (!q) (d.open ? openCats.add(d.dataset.cat) : openCats.delete(d.dataset.cat));
    if (d.dataset.cat === 'Movers') { if (d.open) void moversBrowser.render(); else moversBrowser.suspend(); }
    observeThumbs();
  });
  for (const b of document.querySelectorAll('#palette .item')) {
    b.onclick = () => (b.dataset.custom ? startPlacing(window.__characters.item(b.dataset.custom), b)
      : startPlacing({ cls: b.dataset.cls, radius: +b.dataset.r, height: +b.dataset.h, preset: b.dataset.preset ? JSON.parse(b.dataset.preset) : null,
        name: b.dataset.name || '' }, b));
  }
  if (bottomTab === 'objects') void moversBrowser.render();
  observeThumbs();
}
function iconOf(cls) {               // objects without a 3D model: lights, triggers, points...
  return objectPreviewIcon(cls);
}

// ---------------------------------------------------------------- the browser (bottom panel): tabs
let bottomTab = 'objects';
try { bottomTab = localStorage.getItem('ucmap.btab') || 'objects'; } catch (e) { /* no storage */ }
// the media browser's sections (left): [its pane, its search box, its title]
const BTABS = { objects: ['palette', 'search', 'Objects'], models: ['models', 'msearch', 'Models'], pieces: ['pieces', 'psearch', 'Pieces'],
  prefabs: ['prefabs', 'pfsearch', 'Prefabs'],
  gamevoices: ['gamevoices', 'gvsearch', 'Game voices'],
  sounds: ['sounds', 'sndsearch', 'Sounds'], mymodels: ['models', 'msearch', 'My models'], mysounds: ['sounds', 'sndsearch', 'My sounds'] };
function showTab(t) {
  if (!BTABS[t]) t = 'objects';
  bottomTab = t;
  piecesBrowser.suspend(); moversBrowser.suspend();
  for (const b of document.querySelectorAll('#bottom .btab')) b.classList.toggle('on', b.dataset.tab === t);
  const [pane, search, title] = BTABS[t];
  for (const id of ['palette', 'pieces', 'prefabs', 'models', 'sounds', 'gamevoices']) if ($('#' + id)) $('#' + id).style.display = id === pane ? '' : 'none';
  for (const id of ['search', 'msearch', 'psearch', 'pfsearch', 'sndsearch', 'gvsearch']) if ($('#' + id)) $('#' + id).style.display = id === search ? '' : 'none';
  if ($('#bpath')) $('#bpath').textContent = title;
  try { localStorage.setItem('ucmap.btab', t); } catch (e) { /* no storage */ }
  if (pane === 'palette') void moversBrowser.render();
  if (pane === 'pieces') buildPieces();
  if (pane === 'prefabs') prefabBrowser.render();
  if (pane === 'models') buildModels();
  if (pane === 'sounds') buildSounds();
  if (pane === 'gamevoices') window.__gamecons?.browser();
  observeThumbs();
}

// ---------------------------------------------------------------- Pieces: the objects of the original levels made of brushes
// gamelib.py: fences, railings, grates, pipes, signs, lamps, ladders... each whole and once. Click one,
// then a floor or a wall: it is pasted as a prefab (built into the map by Rebuild).
let pieceCat = null, pieceShapes = {};
const piecesBrowser = createPiecesBrowser({
  api, escapeHtml, isVisible: () => bottomTab === 'pieces',
  filterItem: item => !['door', 'elevator'].includes(item.kind),
  getContext: () => mapGeneration,
  canPlace: () => !!script && !gameView?.active,
  onCatalog: catalog => { pieceCat = catalog; },
  onThumbnails: observeThumbs,
  onPlace: (clip, button) => startPlacing({ prefab: clip, radius: 4, height: 0 }, button),
});
const moversBrowser = createPiecesBrowser({
  api, escapeHtml, containerSelector: '#object-movers', searchSelector: '#search', noun: 'movers',
  searchTerms: ['mover', 'movers'],
  isVisible: () => bottomTab === 'objects' && !!$('#object-movers')?.parentElement.open,
  filterItem: item => ['door', 'elevator'].includes(item.kind),
  categoryLabel: category => category.startsWith('Doors') ? 'Doors' : 'Elevators · two stops',
  canPlace: () => !!script && !gameView?.active, getContext: () => mapGeneration,
  onCatalog: catalog => { pieceCat = catalog; }, onThumbnails: observeThumbs,
  onPlace: (clip, button) => startPlacing({ prefab: clip, radius: 4, height: 0 }, button),
});
function buildPieces() { return piecesBrowser.render(); }
function pieceShapesOf(map, revision = '') {
  const key = map + ':' + revision;
  return pieceShapes[key] || (pieceShapes[key] = Promise.all([
    fetch(`/cache/_objects/${encodeURIComponent(map)}.json?v=${encodeURIComponent(revision)}`)
      .then(r => { if (!r.ok) throw new Error('Piece preview unavailable. Refresh Pieces to regenerate it.'); return r.json(); }),
    // the textures' own flags in that map (masked grates and fences, translucent glass): a library made before
    // 17 Oct 2026 has only the surfaces' (Gabby: purple holes in shelves, black backgrounds)
    fetch(`/cache/ref_${encodeURIComponent(map)}/texflags.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
  ]).then(([sh, own]) => {
    for (const groups of Object.values(sh.objects || {})) for (const g of groups) g.flags = (g.flags || 0) | ((own[g.tex] || 0) & TEX_FLAG_BITS);
    return sh;
  }).catch(error => { delete pieceShapes[key]; throw error; }));
}
// the preview group of a piece (its polygons around its pivot)
async function pieceModel(id) {
  const objectId = id.split('|')[0];
  const it = pieceCat && pieceCat.items.find((x) => x.id === objectId);
  if (!it) return null;
  const sh = await pieceShapesOf(it.map, it.revision || ''), g = new THREE.Group();
  for (const grp of sh.objects[objectId] || []) g.add(new THREE.Mesh(geometryUE(grp.pos, grp.uv), makeMaterial(sh.textures[grp.tex] || null, tf(grp.tex, grp.flags), '')));
  return g.children.length ? g : null;
}
// the ghost of a prefab while it is being placed
async function prefabGhost(clip) {
  const d = await loadPrefabDisplay(clip.id), g = new THREE.Group();
  if (!d) return null;
  for (const grp of d.groups) g.add(new THREE.Mesh(geometryUE(grp.pos, grp.uv, clip.pivot), makeMaterial((d.textures[grp.tex] || {}).png, tf(grp.tex, grp.flags), `/prefabs/${clip.id}/`)));
  return g;
}
for (const b of document.querySelectorAll('#bottom .btab')) b.onclick = () => showTab(b.dataset.tab);
$('#bchars').onclick = () => window.__characters && window.__characters.open();

// ---------------------------------------------------------------- Models: every 3D model of the game, and imported ones
// The Models tab lists every mesh the game can load, by package (editor/models.py: the game, HDTP, Revision,
// other mods' packages, the mod's UCModels). A package's models are exported the first time it is opened.
// A model is placed as a UCMeshDeco of the mod: its Mesh, a collision cylinder round it, a PrePivot that
// centres it; at the size the game uses it (the DrawScale of the game's object that has it).
let modelList = null, modelReplace = null;
const modelOpen = new Set(), modelPkgs = {}, meshModels = {}, meshTex = {};
function meshOf(a) { const m = /'([^']+)'/.exec(String(actorProp(a, 'Mesh') || '')); return m ? m[1] : ''; }
function prePivotZ(a) { const m = /Z=(-?[\d.]+)/.exec(String(actorProp(a, 'PrePivot') || '')); return m ? +m[1] : 0; }
function previewMesh(a, source) {
  const changed = edits.props?.[a.name] || {};
  // a character of the Character Creator has its Mesh with its own skins (characters.js parts), not a bare mesh
  if (a.custom && !changed.Mesh && window.__characters && window.__characters.isCustom(a.cls)) return '';
  return (changed.Mesh || (source === 'added' && a.props?.Mesh) ||
    (a.cls === 'UCMeshDeco' && (!meshLib[a.name] || changed.PrePivot))) ? meshOf(a) : '';
}
function modelClassInfo(a) {
  return (palette || []).flatMap(c => c.items || []).find(it => it.cls === a.cls && it.mesh) || {};
}
function replacementPose(a, source) {
  const info = modelClassInfo(a), scale = +(a.meshDrawScale ?? info.meshDrawScale ?? 1);
  const value = String(actorProp(a, 'PrePivot') ?? a.meshPrePivot ?? '');
  const pivot = ['X', 'Y', 'Z'].map(axis => +(new RegExp(axis + '=(-?[\\d.]+)', 'i').exec(value)?.[1] || 0));
  return { scale: Number.isFinite(scale) ? scale : 1, pivot };
}
function canReplaceModel(p) {
  const d = p?.userData, a = d?.actor;
  return !!a && ['prop', 'pawn'].includes(d.kind) && !animIsMover(p) &&
    a.cls !== 'PlayerStart' && !!(d.model || meshOf(a) || a.mesh || modelClassInfo(a).mesh || paletteHas.has(a.cls));
}
function beginModelReplacement(p) {
  if (!canReplaceModel(p) || !requireUnlocked(p)) return;
  cancelPlacing(); closeAnim(); stopPreview();
  modelReplace = { name: p.userData.actor.name, generation: mapGeneration, busy: false };
  showTab('models');
  status('Choose a replacement model. Logic, transform and collision stay unchanged. Esc cancels.');
}
function cancelModelReplacement() {
  modelReplace = null;
  status('Model replacement cancelled.');
  buildModels();
}
function modelReplaceRow(a, id) {
  const cur = meshOf(a) || a.mesh || modelClassInfo(a).mesh;
  return `<div class="row"><span class="hint" style="margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(cur || a.cls)}">${escapeHtml(cur || 'Class model')}</span><button id="${id}" style="flex:none;padding:0 8px" title="Replace the visual model and its skins; keep the same actor, logic, transform and collision">Replace…</button></div>`;
}
async function buildModels() {
  const el = $('#models');
  if (modelReplace && modelReplace.generation !== mapGeneration) modelReplace = null;
  if (!modelList) {
    el.innerHTML = '<div class="hint">Reading the models of the game (the first time, a few seconds)...</div>';
    try { modelList = await api('/api/models'); } catch (e) { el.innerHTML = `<div class="hint bad">${escapeHtml(e.message)}</div>`; return; }
    if (!modelOpen.size && modelList.packages.length) modelOpen.add(modelList.packages[0].name);
  }
  const q = $('#msearch').value.trim().toLowerCase(), mine = bottomTab === 'mymodels';
  let html = modelReplace ? `<div class="row"><span class="hint" style="margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(modelReplace.name)}">${modelReplace.busy ? 'Loading model for' : 'Replace model of'} ${escapeHtml(modelReplace.name)}</span><button id="model-replace-cancel" style="flex:none;height:var(--ui-control,22px);padding:0 8px;line-height:18px" title="Cancel replacement (Esc)">Cancel</button></div>` : '';
  for (const p of modelList.packages) {
    if (mine && p.name !== MODELS_PKG) continue;              // My models: only the imported ones
    const items = modelList.meshes.filter((m) => m.pkg === p.name && (!q || [m.mesh, m.label || '', m.used || ''].some((s) => s.toLowerCase().includes(q))));
    if (!items.length) continue;
    const open = q || mine || modelOpen.has(p.name);
    html += `<details data-pkg="${escapeHtml(p.name)}" ${open ? 'open' : ''}><summary>${escapeHtml(p.name === MODELS_PKG ? (/^DXP_/i.test(MODELS_PKG) ? 'My models' : MODELS_PKG) + ' (imported)' : p.name)} <small>${items.length}</small></summary>`;
    if (open) {
      for (const m of items.slice(0, q ? 300 : 900)) {
        const short = m.mesh.split('.').slice(1).join('.');
        html += `<button class="item" data-mesh="${escapeHtml(m.mesh)}" title="${escapeHtml(m.mesh)} · ${m.tris} triangles${m.frames > 1 ? ` · ${m.frames} frames` : ''}${m.used ? ` · the game's ${escapeHtml(m.label || m.used)}` : ''}"><span class="th" data-th="mesh:${escapeHtml(m.mesh)}"></span><span class="tl">${escapeHtml(m.label || short)}</span><small>${escapeHtml(m.label ? short : '')}</small></button>`;
      }
    }
    html += '</details>';
  }
  el.innerHTML = html || (mine && !q ? `<div class="hint sintro">No models of yours yet. <b>Import...</b> (above), or drop the files on the browser: a model made in Blender, 3ds Max, Maya... (glTF/GLB, FBX, OBJ with its .mtl, DAE, with its textures). It becomes one of ${escapeHtml(modelsWhere())}, which the game draws like its own; then click it, or drag it onto the 3D view.</div>`
    : '<div class="hint">No model has this name.</div>');
  for (const d of el.querySelectorAll('details')) d.addEventListener('toggle', () => {
    if (q) return;
    if (d.open) { modelOpen.add(d.dataset.pkg); if (!d.querySelector('.item')) buildModels(); } else modelOpen.delete(d.dataset.pkg);
    observeThumbs();
  });
  if ($('#model-replace-cancel')) $('#model-replace-cancel').onclick = cancelModelReplacement;
  for (const b of el.querySelectorAll('[data-mesh]')) {
    b.disabled = !!modelReplace?.busy;
    b.onclick = () => placeModel(b.dataset.mesh, b).catch((e) => log('Models: ' + e.message, 'bad'));
  }
  observeThumbs();
}
$('#msearch').addEventListener('input', () => buildModels());
function modelPkg(pkg) {                   // the exported models of a package (made once by the server)
  if (!modelPkgs[pkg]) {
    status(`Reading the models of ${pkg} (the first time, up to a minute)...`);
    modelPkgs[pkg] = api('/api/models_pkg?pkg=' + encodeURIComponent(pkg)).then((d) => { meshTex[pkg] = d.textures || {}; status(''); return d; })
      .catch((e) => { delete modelPkgs[pkg]; status(''); throw e; });
  }
  return modelPkgs[pkg];
}
async function meshInfo(mesh) {
  if (!mesh) return null;
  const pkg = mesh.split('.')[0], d = await modelPkg(pkg), info = d.models[mesh];
  if (!info) return null;
  if (!meshModels[mesh]) meshModels[mesh] = await fetch(`/cache/_models/${encodeURIComponent(pkg)}/${info.file}`).then((r) => r.json());
  return { info, model: meshModels[mesh] };
}
function modelProps(mesh, info) {
  return { Mesh: `${info.cls}'${mesh}'`, CollisionRadius: info.r.toFixed(6), CollisionHeight: info.h.toFixed(6),
           PrePivot: `(X=0.000000,Y=0.000000,Z=${info.pz.toFixed(6)})` };
}
// an idle animation or a pose plays while the character stands (Orders Standing): one whose class wanders by
// default (a Butler, a scientist) never stood still for it (Crypt Test, 20 Oct 2026). Patrolling and sitting keep theirs.
function standForIdle(name) {
  const a = allActors().find((x) => x.name === name);
  if (!a) return;
  const orders = String(actorProp(a, 'Orders') ?? '');
  if (!orders || ['Standing', 'Patrolling', 'Sitting', 'Dancing'].includes(orders)) return;
  putProp(a, 'Orders', 'Standing');
  log(`${hierLabel(a)} now stands (Orders Standing, was ${orders}): the animation plays while they stand still.`, 'ok');
}
// a model imported again under its name: the copies already in the open map take its new size (collision and
// pivot), not the old model's (Crypt Test, 20 Oct 2026: a monster kept a 131-unit collision after its fix)
async function refitPlaced(mesh) {
  const placed = (edits.added || []).filter((a) => a.cls === 'UCMeshDeco' && String((a.props || {}).Mesh || '').includes(`'${mesh}'`));
  if (!placed.length) return;
  const r = await meshInfo(mesh);
  if (!r) return;
  pushUndo();
  const fresh = modelProps(mesh, r.info);
  for (const a of placed) for (const k of ['CollisionRadius', 'CollisionHeight', 'PrePivot']) a.props[k] = fresh[k];
  setDirty(); rebuildProxies();
  log(`${placed.length} ${placed.length === 1 ? 'copy' : 'copies'} of ${mesh.split('.').pop().replace(/^UCM_/, '')} in this map took the new size; other maps take it when you open them and import again, or place them again.`, 'ok');
}
async function placeModel(mesh, btn, extra = null) {
  if (!mapName) return;
  const request = modelReplace, generation = mapGeneration;
  if (request?.busy) return;
  if (request && request.generation !== generation) { cancelModelReplacement(); return; }
  if (request) { request.busy = true; buildModels(); }
  let r;
  try { r = await meshInfo(mesh); }
  finally { if (request && modelReplace === request) { request.busy = false; buildModels(); } }
  // A cancelled/old asynchronous click must never become placement or edit another target.
  if (generation !== mapGeneration || modelReplace !== request) return;
  if (!r) { log(`${mesh}: this model could not be read.`, 'warn'); return; }
  const { info } = r, k = info.scale || 1;
  if (request) {
    const who = allActors().find(x => x.name === request.name), target = proxyOf(request.name);
    if (!who || edits.deleted?.[request.name] || !canReplaceModel(target) || !requireUnlocked(target)) {
      cancelModelReplacement(); return;
    }
    if (isCharacter(who) && !confirm(`Replace the model of ${who.name}?\n\nThe character keeps its AI, dialogue and mission logic. The new model needs compatible animation sequences; otherwise walking, gestures or weapon attachment may look wrong.\n\nCollision and transform stay unchanged. Ctrl+Z undoes this change.`)) return;
    pushUndo();
    putProp(who, 'Mesh', `${info.cls}'${mesh}'`);
    putProp(who, 'Skin', 'None');
    for (let i = 0; i < 8; i++) putProp(who, `MultiSkins(${i})`, 'None');
    // Old per-slot textures belong to the old visual; retain all non-visual authoring data.
    if (edits.retexture) edits.retexture = edits.retexture.filter(t => !(t.kind === 'actor' && t.name === who.name));
    modelReplace = null;
    setDirty(); rebuildProxies();
    log(`${who.name}: model replaced with ${info.label || mesh}. Logic and collision unchanged. Rebuild to apply in game.`, 'ok');
    buildModels();
    return;
  }
  // an imported animated model loops its animation (UCMeshDeco.IdleAnim)
  const own = (modelList && modelList.imported || []).find((m) => m.mesh === mesh);
  const idle = extra || (own && own.idle ? { IdleAnim: own.idle } : {});
  startPlacing({ cls: 'UCMeshDeco', radius: info.r * k, height: info.h * k, base: { r: info.r, h: info.h }, mesh, scale: k,
                 preset: Object.assign(modelProps(mesh, info), info.label ? { ItemName: `"${info.label}"` } : {}, idle),
                 name: info.label || mesh.split('.').pop() }, btn);
}

// ---------------------------------------------------------------- Import a 3D model (glTF/GLB, FBX, OBJ, DAE)
// Read here by three.js, turned into Unreal's axes and units, centred, and sent as triangles (UVs on their
// corners, as Unreal's files keep them) with their pictures; the server makes it a mesh of UCModels with
// the game's own importer (editor/models.py).
const MODEL_MAX_TRIS = 30000;
const importBox = $('#mimportbox');
let importView = null;
function closeImport() {
  importBox.style.display = 'none';
  if (importView) { importView.stop = true; importView.r.dispose(); importView = null; }
}
async function readModelFiles(files) {
  const main = files.find((f) => /\.(glb|gltf|fbx|obj|dae)$/i.test(f.name));
  if (!main) throw new Error('choose a .glb, .gltf, .fbx, .obj or .dae file (with its textures)');
  const urls = new Map(files.map((f) => [f.name.toLowerCase(), URL.createObjectURL(f)]));
  const manager = new THREE.LoadingManager(), missing = new Map();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const name = decodeURIComponent(url.split(/[\\/]/).pop().split('?')[0]), n = name.toLowerCase();
    if (!urls.get(n) && /\.(png|jpe?g|tga|bmp|webp|gif|tiff?|dds)$/i.test(n)) missing.set(n, name);   // asked for, not chosen
    return urls.get(n) || url;
  });
  const ext = main.name.split('.').pop().toLowerCase(), url = urls.get(main.name.toLowerCase());
  let root, clips = [];
  if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gl = await new GLTFLoader(manager).loadAsync(url);
    root = gl.scene; clips = gl.animations || [];
  } else if (ext === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    // three.js's FBX reader gives up on some files (Annabel's many shape keys: out of memory): say what to do
    try { root = await new FBXLoader(manager).loadAsync(url); }
    catch (e) { throw new Error(`this FBX could not be read (${e.message}). Save it as glTF/GLB from Blender (File > Export > glTF 2.0): it keeps the textures, the skeleton and the animations`); }
    clips = root.animations || [];
  } else if (ext === 'dae') {
    const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
    const dae = await new ColladaLoader(manager).loadAsync(url);
    root = dae.scene; clips = dae.animations || root.animations || [];
  } else {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    const loader = new OBJLoader(manager);
    const mtl = files.find((f) => /\.mtl$/i.test(f.name));
    if (mtl) {
      const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
      const mats = await new MTLLoader(manager).loadAsync(urls.get(mtl.name.toLowerCase()));
      mats.preload();
      loader.setMaterials(mats);
    }
    root = await loader.loadAsync(url);
  }
  // the pictures load after the model: wait for them (at most a few seconds)
  for (let i = 0; i < 60; i++) {
    let waiting = false;
    root.traverse((o) => { for (const m of [].concat(o.material || [])) if (m.map && !(m.map.image && (m.map.image.width || m.map.image.videoWidth))) waiting = true; });
    if (!waiting) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  root.updateMatrixWorld(true);
  clips = clips.filter((c) => c && c.duration > 0 && c.tracks && c.tracks.length);
  return { root, ext, name: main.name.replace(/\.[^.]+$/, ''), clips, missing: [...missing.values()] };
}
// the parts of a model, for the import dialog (Crypt Test, 20 Oct 2026: a monster's rig brought its blendshape
// targets beside the body, and 50 000 points of fur cards that Simplify made lumps of): each one ticked or not;
// parts that do not follow the skeleton and fur/hair cards start unticked
function modelParts(root) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.geometry?.attributes.position) meshes.push(o); });
  const skinned = meshes.some((o) => o.isSkinnedMesh);
  const tris = (o) => Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3);
  const total = meshes.reduce((n, o) => n + tris(o), 0);
  const out = meshes.map((o) => {
    let underBone = false;
    for (let q = o.parent; q; q = q.parent) if (q.isBone) underBone = true;
    const names = [o.name, ...[].concat(o.material || []).map((m) => m.name || '')].join(' ');
    const stray = skinned && !o.isSkinnedMesh && !underBone;
    const hair = /hair|fur\b|fur_|lash|brow|whisk|beard|card/i.test(names) && tris(o) > 2000;
    const label = String(o.name || 'part').replace(/^.*:/, '').replace(/_PLY$|_GEO$/i, '') || 'part';
    o.userData.skipPart = stray || (hair && total > MODEL_MAX_TRIS);
    o.visible = !o.userData.skipPart;
    return { o, label, tris: tris(o), stray, hair };
  });
  // the rig's own prefix, the same on every part (a Maya namespace such as "studio_rig_004..."): out of the names shown
  if (out.length > 1) {
    let pre = out[0].label;
    for (const x of out) while (pre && !x.label.startsWith(pre)) pre = pre.slice(0, -1);
    if (pre.length >= 4) for (const x of out) x.label = x.label.slice(pre.length).replace(/^[_:\s-]+/, '') || x.label;
  }
  return out;
}
// the colours painted on a model's points (vertex colours), which Deus Ex has not: drawn into a picture over
// its UVs, one colour a triangle (flat, as the game would shade it), times the material's own colour
// colours that say something: not one colour all over (a sculpting tool's layer comes all white), and a UV map to draw on
function paintedColors(g) {
  const c = g?.attributes.color;
  if (!c || !g.attributes.uv) return false;
  for (let i = 1; i < c.count; i++) for (let k = 0; k < 3; k++) if (Math.abs(c.getComponent(i, k) - c.getComponent(0, k)) > 0.02) return true;
  return false;
}
function bakeVertexColors(root, on) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !paintedColors(o.geometry)) return;
    if (!on) { if (o.userData.vcOrig) { o.material = o.userData.vcOrig; delete o.userData.vcOrig; } return; }
    if (o.userData.vcOrig) { n++; return; }
    const mats = [].concat(o.material);
    if (mats.some((m) => m.map)) return;                      // a picture of its own: its colours stay out
    const g = o.geometry, col = g.attributes.color, uv = g.attributes.uv, idx = g.index;
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d'), base = mats[0].color || new THREE.Color(1, 1, 1);
    const css = (r, gg, b) => `rgb(${[r, gg, b].map((v) => Math.round(255 * Math.min(1, Math.max(0, Math.pow(v, 1 / 2.2))))).join(',')})`;
    ctx.fillStyle = css(base.r, base.g, base.b); ctx.fillRect(0, 0, S, S);
    const count = idx ? idx.count : col.count;
    for (let k = 0; k + 2 < count; k += 3) {
      const v = [0, 1, 2].map((j) => (idx ? idx.getX(k + j) : k + j));
      const c = [0, 1, 2].map((j) => v.reduce((s, i) => s + col.getComponent(i, j), 0) / 3);
      ctx.fillStyle = ctx.strokeStyle = css(c[0] * base.r, c[1] * base.g, c[2] * base.b);
      ctx.beginPath();
      v.forEach((i, j) => { const x = uv.getX(i) * S, y = (1 - uv.getY(i)) * S; if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    o.userData.vcOrig = o.material;
    const tex = new THREE.CanvasTexture(cv);
    const made = mats.map((m) => { const c = m.clone(); c.map = tex; c.color = new THREE.Color(1, 1, 1); c.vertexColors = false; return c; });
    o.material = made.length === 1 ? made[0] : made;
    n++;
  });
  return n;
}
function matPicture(mat) {
  const img = mat.map && mat.map.image;
  if (!img || !(img.width || img.videoWidth)) return '';
  const w = Math.min(1024, img.width || img.videoWidth), h = Math.min(1024, img.height || img.videoHeight);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/png');
}
// one material for each look: a file can repeat the same one (a glTF loader clones it for skinned or coloured parts)
function matKey(m) {
  const img = m.map && m.map.image;
  return `${img ? 'map:' + (img.currentSrc || img.src || m.map.uuid) : 'plain'}|${m.color ? m.color.getHexString() : 'b3b3b3'}|${m.side === THREE.DoubleSide ? 2 : 1}`;
}
// The game takes 8 textures a model. More: the plain colours (no picture) go into one small picture of
// colour squares, their triangles drawn on their own square (the monster, Crypt Test, 20 Oct 2026: 13
// materials, its skin and clothes all drawn with the 8th, a purple collar). Changes triMat and uvs in place.
function fitMaterials(mats, triMat, uvs, opts) {
  const own = (m, i) => ({ name: m.name || `material ${i + 1}`, color: m.color ? [m.color.r, m.color.g, m.color.b] : [0.7, 0.7, 0.7],
    twosided: opts.twoSided || m.side === THREE.DoubleSide, png: matPicture(m) });
  if (mats.length <= 8) return mats.map(own);
  const pics = mats.map((m) => matPicture(m)), plain = mats.map((_, i) => i).filter((i) => !pics[i]);
  const pictured = mats.map((_, i) => i).filter((i) => pics[i]);
  const keep = pictured.slice(0, plain.length ? 7 : 8), slot = new Map(keep.map((i, k) => [i, k]));
  const out = keep.map((i) => Object.assign(own(mats[i], i), { png: pics[i] }));
  const square = new Map();
  if (plain.length) {
    const n = Math.ceil(Math.sqrt(plain.length)), cell = 16, c = document.createElement('canvas');
    c.width = c.height = n * cell;
    const g = c.getContext('2d');
    plain.forEach((i, k) => {
      const col = mats[i].color || new THREE.Color(0.7, 0.7, 0.7), x = k % n, y = Math.floor(k / n);
      g.fillStyle = '#' + col.getHexString();
      g.fillRect(x * cell, y * cell, cell, cell);
      square.set(i, [(x + 0.5) / n, (y + 0.5) / n]);
    });
    out.push({ name: 'colours', color: [1, 1, 1], twosided: opts.twoSided || plain.every((i) => mats[i].side === THREE.DoubleSide), png: c.toDataURL('image/png') });
  }
  const last = out.length - 1;
  for (let t = 0; t < triMat.length; t++) {
    const m = triMat[t];
    if (square.has(m)) {
      const [u, v] = square.get(m);
      for (let j = 0; j < 3; j++) { uvs[(t * 3 + j) * 2] = u; uvs[(t * 3 + j) * 2 + 1] = v; }
      triMat[t] = last;
    } else triMat[t] = slot.has(m) ? slot.get(m) : last;     // pictures past the 8th: with the last one
  }
  return out;
}
// the model in Unreal's axes (X, Y, Z up) and units, centred: positions shared by the triangles (welded,
// so it is shaded smooth as the game's models), UVs on the corners
function modelPayload(root, opts) {
  const pos = [], uvs = [], idx = [], triMat = [], mats = [], matIndex = new Map(), weld = new Map();
  const rot = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(opts.turn || 0));
  if (opts.standUp) rot.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const box = new THREE.Box3(), v = new THREE.Vector3(), tmp = [], from = [];
  // opts.skinned: a skinned model as its skeleton holds it (what is drawn, and what the animations start from).
  // A Maya rig can keep its points lying down and stand them up with the skeleton: measured lying, its animations
  // came out three times the height asked for (Crypt Test, 20 Oct 2026). Off for a file whose skeleton is broken
  // (skinSpread): then the points as stored are the better guess.
  const point = (o, p, i) => (opts.skinned && o.isSkinnedMesh ? o.getVertexPosition(i, v) : v.fromBufferAttribute(p, i));
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.userData.skipPart) return;
    const m = new THREE.Matrix4().multiplyMatrices(rot, o.matrixWorld), p = o.geometry.attributes.position, usedBy = drawnVertices(o.geometry);
    for (let i = 0; i < p.count; i++) if (usedBy[i]) box.expandByPoint(point(o, p, i).applyMatrix4(m));
  });
  if (box.isEmpty()) throw new Error('the file has no triangles');
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  // the height asked for is the model's own (a flat one, a rug or a panel, has none: its biggest side then)
  const tall = size.y > 1e-3 * Math.max(size.x, size.z) ? size.y : Math.max(size.x, size.y, size.z);
  const s = opts.height / Math.max(1e-6, tall);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.userData.skipPart) return;
    const g = o.geometry, p = g.attributes.position, t = g.attributes.uv;
    const m = new THREE.Matrix4().multiplyMatrices(rot, o.matrixWorld), mirrored = m.determinant() < 0;
    const local = [], si = g.attributes.skinIndex, sw = g.attributes.skinWeight, morph = !!g.morphAttributes.position;
    const usedBy = drawnVertices(g);
    for (let i = 0; i < p.count; i++) {
      if (!usedBy[i]) { local.push(-1); continue; }         // left out by Simplify: not in the model
      point(o, p, i).applyMatrix4(m).sub(center).multiplyScalar(s);
      const ue = [Math.round(v.x * 100) / 100, Math.round(v.z * 100) / 100, Math.round(v.y * 100) / 100];   // three -> Unreal
      let key = ue.join(',');
      // an animated model: two vertices in one place weld only if they move together (lips, eyelids): on the
      // same bones (the bones themselves: the parts of one model, one for each material, share them)
      if (o.isSkinnedMesh && si && sw) {
        const bone = (k) => (sw.getComponent(i, k) > 0.005 ? `${o.skeleton.bones[si.getComponent(i, k)]?.uuid}*${sw.getComponent(i, k).toFixed(2)}` : '');
        key += '|' + [0, 1, 2, 3].map(bone).filter(Boolean).sort().join(',');
      }
      if (morph) key += `|${o.id}:${i}`;
      if (!weld.has(key)) { weld.set(key, pos.length / 3); pos.push(...ue); from.push([o, i]); }
      local.push(weld.get(key));
    }
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : p.count, materialIndex: 0 }];
    const materials = [].concat(o.material || []);
    for (const gr of groups) {
      const mat = materials[gr.materialIndex] || materials[0] || {}, key = matKey(mat);
      if (!matIndex.has(key)) { matIndex.set(key, mats.length); mats.push(mat); }
      const mi = matIndex.get(key), flipV = !(mat.map && mat.map.flipY === false);
      const end = Math.min(gr.start + gr.count, g.index ? g.index.count : p.count);
      for (let k = gr.start; k + 2 < end; k += 3) {
        let c = [0, 1, 2].map((j) => (g.index ? g.index.getX(k + j) : k + j));
        if (mirrored !== opts.flip) c = [c[0], c[2], c[1]];       // the winding the game draws as the front
        if (local[c[0]] === local[c[1]] || local[c[1]] === local[c[2]] || local[c[0]] === local[c[2]]) continue;
        tmp.length = 0;
        for (const i of c) tmp.push(t ? t.getX(i) : 0, t ? (flipV ? 1 - t.getY(i) : t.getY(i)) : 0);
        // Unreal's UVs are bytes 0-1 on each triangle: a tiled one is moved back into the picture
        const du = Math.floor(Math.min(tmp[0], tmp[2], tmp[4]) + 1e-6), dv = Math.floor(Math.min(tmp[1], tmp[3], tmp[5]) + 1e-6);
        for (let j = 0; j < 3; j++) uvs.push(Math.min(1, Math.max(0, tmp[j * 2] - du)), Math.min(1, Math.max(0, tmp[j * 2 + 1] - dv)));
        idx.push(local[c[0]], local[c[1]], local[c[2]]);
        triMat.push(mi);
      }
    }
  });
  const materials = fitMaterials(mats, triMat, uvs, opts);
  const out = { positions: pos, uvs, indices: idx, triMaterials: triMat, materials, size: [size.x * s, size.z * s, size.y * s] };
  Object.defineProperty(out, 'bake', { value: { from, rot, center, s } });   // for bakeClips (not sent)
  return out;
}
// the vertices a geometry's triangles use (all of them for a geometry without an index)
function drawnVertices(g) {
  const n = g.attributes.position.count, used = new Uint8Array(n);
  if (!g.index) { used.fill(1); return used; }
  const idx = g.index.array, ranges = g.groups.length ? g.groups : [{ start: 0, count: idx.length }];
  for (const r of ranges) for (let k = r.start, end = Math.min(idx.length, r.start + r.count); k < end; k++) used[idx[k]] = 1;
  return used;
}
const modelTris = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh && o.geometry?.attributes.position && !o.userData.skipPart) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return Math.round(n); };
// Simplify (Gabby, 20 Oct 2026: today's models are 100 000 triangles, the game's own about 1000): meshoptimizer's
// simplifier (MIT, Arseny Kapoulkine; static/meshopt_simplifier.js, version 1.2) collapses edges where the shape
// changes least, the texture's UVs counted too. It keeps a subset of the model's own vertices, so the skeleton's
// weights, the shape keys and the UVs stay as they were and the animations bake as before. Each material's part
// is simplified by itself, the vertices two parts share locked (no cracks between them). The model as read is
// kept (userData.simplifyFrom): simplifying again starts from it, 0 puts it back.
async function simplifyModel(root, target) {
  const { MeshoptSimplifier: M } = await import('/static/meshopt_simplifier.js');
  await M.ready;
  const { mergeVertices } = await import('three/addons/utils/BufferGeometryUtils.js');
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.geometry?.attributes.position && !o.userData.skipPart) meshes.push(o); });
  for (const o of meshes) {                     // back to the model as read
    if (o.userData.simplifyFrom) { o.geometry = o.userData.simplifyFrom.geometry; delete o.userData.simplifyFrom; }
  }
  const total = modelTris(root);
  if (!target || target >= total) return { before: total, after: total };
  const ratio = target / total;
  for (const o of meshes) {
    const read = o.geometry;
    // vertices shared by its triangles (FBX gives each triangle its own): the same point, normal, UV and bones
    let g = read.index ? read.clone() : mergeVertices(read.clone(), 1e-5);
    if (!g.index) continue;
    const pos = g.attributes.position, uv = g.attributes.uv, n = pos.count;
    const P = new Float32Array(n * 3), A = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { P[3 * i] = pos.getX(i); P[3 * i + 1] = pos.getY(i); P[3 * i + 2] = pos.getZ(i); if (uv) { A[2 * i] = uv.getX(i); A[2 * i + 1] = uv.getY(i); } }
    const idx = g.index.array, groups = g.groups.length ? g.groups.map((x) => ({ ...x })) : [{ start: 0, count: idx.length, materialIndex: 0 }];
    const owner = new Int32Array(n).fill(-1), lock = new Uint8Array(n);
    groups.forEach((gr, k) => { for (let j = gr.start; j < gr.start + gr.count; j++) { const v = idx[j]; if (owner[v] >= 0 && owner[v] !== k) lock[v] = 1; owner[v] = k; } });
    const out = [], newGroups = [];
    for (const gr of groups) {
      const part = Uint32Array.from(idx.subarray(gr.start, gr.start + gr.count));
      const want = Math.max(3, Math.round(part.length * ratio / 3) * 3);
      const [kept] = part.length > want
        ? M.simplifyWithAttributes(part, P, 3, A, 2, uv ? [0.5, 0.5] : [0, 0], lock, want, 1.0, [])
        : [part];
      newGroups.push({ start: out.length, count: kept.length, materialIndex: gr.materialIndex });
      for (const x of kept) out.push(x);
    }
    g.setIndex(out);
    g.clearGroups();
    for (const gr of newGroups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    o.userData.simplifyFrom = { geometry: read };
    o.geometry = g;
  }
  root.updateMatrixWorld(true);
  return { before: total, after: modelTris(root) };
}

// An animated model (a skeleton or shape keys, and clips): the game's models have no bones, every animation is
// frames of positions. Each chosen clip is played here and its vertices read at the clip's frame rate, in the
// same axes, centre and scale as the model; the server makes them the sequences of the mesh (editor/models.py).
const MODEL_MAX_FRAMES = 4000, MODEL_MAX_FRAME_VERTICES = 3000000, MODEL_MAX_VERTICES = 8191;
// animated: a skeleton, shape keys or parts that move (a fan's blades: clips on the objects themselves)
const isAnimatedRoot = (root, clips) => {
  let a = false;
  root.traverse((o) => { if (o.isSkinnedMesh || (o.isMesh && o.morphTargetInfluences && o.morphTargetInfluences.length)) a = true; });
  return a || clips.some((c) => c.tracks.some((t) => /\.(position|quaternion|scale)$/.test(t.name)));
};
const clipFrames = (clip, fps) => Math.max(1, Math.round(clip.duration * fps));
// The bones a clip pulls away from the bone they hang on (Crypt Test, 20 Oct 2026: a walk cycle exported from
// Maya put the jaw a metre under the head; the chin stretched to the chest while the teeth stayed). Played at a
// few moments; the bones that move the skin only; [{name, part of the model's height}], the worst first.
function pulledBones(root, clip, height) {
  const used = new Set();
  root.traverse((o) => {
    if (!o.isSkinnedMesh || o.userData.skipPart) return;
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    if (si && sw) for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 0.05) used.add(o.skeleton.bones[si.getComponent(i, k)]);
  });
  const bones = [...used].filter((b) => b && b.parent && b.parent.isBone);
  if (!bones.length || !(height > 0)) return [];
  const saved = [];
  root.traverse((o) => saved.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), gap = (o) => o.getWorldPosition(a).distanceTo(o.parent.getWorldPosition(b));
  root.updateMatrixWorld(true);
  const rest = new Map(bones.map((o) => [o, gap(o)])), worst = new Map();
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  for (let i = 0; i <= 8; i++) {
    mixer.setTime(clip.duration * i / 8);
    root.updateMatrixWorld(true);
    for (const o of bones) { const d = (gap(o) - rest.get(o)) / height; if (d > (worst.get(o) || 0)) worst.set(o, d); }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  for (const [o, p, q, s] of saved) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); }
  root.updateMatrixWorld(true);
  return [...worst].filter(([, d]) => d > 0.15).sort((x, y) => y[1] - x[1])
    .map(([o, d]) => ({ name: String(o.name).replace(/^.*:/, '').replace(/^\w*?_rig_\d+(?=[A-Z])/, ''), part: d }));
}
function bakeClips(root, payload, chosen) {
  const { from, rot, center, s } = payload.bake, nv = from.length;
  const total = chosen.reduce((n, c) => n + clipFrames(c.clip, c.fps), 0);
  const frames = new Float32Array(total * nv * 3), sequences = [];
  const mixer = new THREE.AnimationMixer(root), v = new THREE.Vector3(), mats = new Map();
  // every node as it was read: each clip starts from it (what a clip does not move must not keep the pose of
  // the one before) and the model goes back to it (skeleton.pose() rebuilt the bones of a scaled FBX armature
  // wrong, and the next clip's points flew thousands of units away)
  const saved = [];
  root.traverse((o) => saved.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone(), o.morphTargetInfluences ? o.morphTargetInfluences.slice() : null]));
  const putBack = () => {
    for (const [o, p, q, s, m] of saved) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); if (m) for (let i = 0; i < m.length; i++) o.morphTargetInfluences[i] = m[i]; }
    root.updateMatrixWorld(true);
  };
  let at = 0, start = 0;
  for (const c of chosen) {
    mixer.stopAllAction();
    putBack();
    const action = mixer.clipAction(c.clip);
    action.reset().play();
    const n = clipFrames(c.clip, c.fps);                  // a looping clip's last frame is its first: not twice
    for (let f = 0; f < n; f++) {
      mixer.setTime(f / c.fps);
      root.updateMatrixWorld(true);
      mats.clear();
      for (let w = 0; w < nv; w++) {
        const [o, i] = from[w];
        let m = mats.get(o);
        if (!m) { m = new THREE.Matrix4().multiplyMatrices(rot, o.matrixWorld); mats.set(o, m); }
        o.getVertexPosition(i, v).applyMatrix4(m).sub(center).multiplyScalar(s);
        frames[at++] = v.x; frames[at++] = v.z; frames[at++] = v.y;                // three -> Unreal
      }
    }
    sequences.push({ name: c.name, start, count: n, rate: c.fps });
    start += n;
  }
  const size = Math.max(1e-6, ...payload.size);
  let far = 0;
  for (let i = 0; i < frames.length; i += 3) far = Math.max(far, Math.hypot(frames[i], frames[i + 1], frames[i + 2]) / size);
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  putBack();                                                // back as it was read
  if (far > SKIN_FAR) throw new Error(`the animations throw the model's points ${Math.round(far)} times its size away: the file's skeleton does not fit its model (save it as glTF/GLB from Blender, with the armature's scale applied)`);
  return { frames, sequences };
}
// how far the skeleton, as the file is read, throws the model's points from where they are: about 1 for a model
// whose bones fit it, thousands for a file whose skeleton does not (an FBX with a scaled armature and a second
// skeleton: Sully, 20 Oct 2026). Measured on a few hundred points, in the model's own size.
function skinSpread(payload) {
  const { from, rot, center, s } = payload.bake, v = new THREE.Vector3(), m = new THREE.Matrix4();
  const size = Math.max(1e-6, ...payload.size), step = Math.max(1, Math.floor(from.length / 400));
  let far = 0;
  for (let w = 0; w < from.length; w += step) {
    const [o, i] = from[w];
    if (!o.isSkinnedMesh) continue;
    o.getVertexPosition(i, v).applyMatrix4(m.multiplyMatrices(rot, o.matrixWorld)).sub(center).multiplyScalar(s);
    far = Math.max(far, v.length() / size);
  }
  return far;
}
const SKIN_FAR = 3;                               // a point three times the model's size away: the file is broken
function base64Of(buffer) {
  const u = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
// the preview: the model as the editor will show it, next to JC (90 units tall)
function importPreview(payload) {
  const el = $('#miview');
  if (!importView) {
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setSize(420, 260);
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x14171f);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(0.5, 1, 0.7);
    sc.add(sun);
    const cam = new THREE.PerspectiveCamera(35, 420 / 260, 1, 100000);
    const jc = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 90, 16), new THREE.MeshBasicMaterial({ color: 0x5aa2ff, wireframe: true }));
    sc.add(jc);
    importView = { r, sc, cam, jc, group: null, stop: false, a: 0 };
    const loop = () => {
      if (!importView || importView.stop) return;
      importView.a += 0.01;
      const iv = importView, d = iv.dist || 300;
      iv.cam.position.set(Math.cos(iv.a) * d, d * 0.45, Math.sin(iv.a) * d);
      iv.cam.lookAt(0, iv.lookY || 0, 0);
      iv.r.render(iv.sc, iv.cam);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  el.innerHTML = '';
  el.appendChild(importView.r.domElement);
  if (importView.group) importView.sc.remove(importView.group);
  const g = new THREE.Group(), byMat = {};
  for (let t = 0; t < payload.indices.length / 3; t++) {
    const mi = payload.triMaterials[t];
    const b = byMat[mi] || (byMat[mi] = { pos: [], uv: [] });
    for (let j = 0; j < 3; j++) {
      const i = payload.indices[t * 3 + j];
      b.pos.push(payload.positions[i * 3], payload.positions[i * 3 + 1], payload.positions[i * 3 + 2]);
      b.uv.push(payload.uvs[(t * 3 + j) * 2], payload.uvs[(t * 3 + j) * 2 + 1]);
    }
  }
  for (const [mi, b] of Object.entries(byMat)) {
    const mat = payload.materials[mi] || {}, c = mat.color || [0.7, 0.7, 0.7];
    const opts = { color: mat.png ? 0xffffff : new THREE.Color(c[0], c[1], c[2]), side: THREE.DoubleSide };
    if (mat.png) { const tx = new THREE.TextureLoader().load(mat.png); tx.colorSpace = THREE.SRGBColorSpace; tx.flipY = false; opts.map = tx; opts.alphaTest = 0.5; }
    g.add(new THREE.Mesh(geometryUE(b.pos, b.uv), new THREE.MeshLambertMaterial(opts)));
  }
  const h = payload.size[2];
  g.position.set(0, h / 2, 0);
  importView.jc.position.set(Math.max(payload.size[0], payload.size[1]) / 2 + 40, 45, 0);
  importView.sc.add(g);
  importView.group = g;
  importView.dist = Math.max(160, Math.max(...payload.size) * 1.8);
  importView.lookY = Math.max(h, 90) / 2;
}
async function openImport() {
  importBox.style.display = 'block';
  const mine = (modelList && modelList.imported) || (await api('/api/models').catch(() => ({}))).imported || [];
  importBox.innerHTML = `<div class="row"><b style="flex:1">Import a 3D model</b><button id="miclose">Close</button></div>
    <div class="hint" style="margin:2px 0 8px">A model made in Blender, 3ds Max, Maya... saved as <b>glTF / GLB</b> (best: its textures inside),
      <b>FBX</b>, <b>OBJ</b> (with its .mtl) or <b>DAE</b>: choose the file together with its textures (Ctrl+click). It becomes one of
      ${modelsWhere()}, which the game draws like its own, up to ${MODEL_MAX_TRIS} triangles and 8 textures (made 256
      colours, as the game's). A model with a skeleton (or shape keys) and animations keeps them: each one becomes frames of the
      model, as the game keeps its own, and a placed model loops the one you choose.</div>
    <div class="row"><input type="file" id="mifile" multiple accept=".glb,.gltf,.fbx,.obj,.mtl,.dae,.bin,.png,.jpg,.jpeg,.tga,.bmp,.webp" style="flex:1;min-width:0"></div>
    <div id="miview" style="margin:6px 0"></div><div id="miopts"></div>
    ${mine.length ? '<div class="hint" style="margin:10px 0 2px;font-weight:600">Your models</div>' + mine.map((m) => `<div class="row"><span style="flex:1">${escapeHtml(m.name)} <span class="hint" style="margin:0">${m.tris} triangles${m.source ? ' · ' + escapeHtml(m.source) : ''}</span></span><button data-midel="${escapeHtml(m.name)}" title="Take it out of UCModels (maps that use it lose it)">Delete</button></div>`).join('') : ''}`;
  $('#miclose').onclick = closeImport;
  for (const b of importBox.querySelectorAll('[data-midel]')) b.onclick = async () => {
    if (!confirm(`Delete the model ${b.dataset.midel}? The maps that use it lose it.`)) return;
    busy('Making your models again...');
    try { const r = await api('/api/model_delete', { name: b.dataset.midel }); for (const l of r.lines || []) log(l); }
    catch (e) { log('Delete: ' + e.message, 'bad'); } finally { busy(''); }
    modelsChanged();
    openImport();
  };
  $('#mifile').onchange = async () => {
    const files = [...$('#mifile').files];
    if (!files.length) return;
    $('#miopts').innerHTML = '<div class="hint">Reading the model...</div>';
    let read;
    try { read = await readModelFiles(files); } catch (e) { $('#miopts').innerHTML = `<div class="hint bad">${escapeHtml(e.message)}</div>`; return; }
    const animated = read.clips.length > 0 && isAnimatedRoot(read.root, read.clips), used = new Set();
    // a skinned model measured as its skeleton holds it: a Maya rig's parts may keep their points 100 times smaller
    // than its bones (the monster, Crypt Test, 20 Oct 2026: 4500 units tall read as it is, 2 metres as it stands)
    const parts = modelParts(read.root);              // its parts: the ones that would spoil it start left out
    const raw = new THREE.Box3();
    read.root.updateMatrixWorld(true);
    read.root.traverse((o) => { if (o.isMesh && !o.userData.skipPart) raw.expandByObject(o, animated); });
    if (raw.isEmpty()) raw.setFromObject(read.root, animated);
    const rawSize = raw.getSize(new THREE.Vector3());
    // its size in units: glTF is in metres; a big number is centimetres; a small one, metres
    const tall = rawSize.y > 1e-3 * Math.max(rawSize.x, rawSize.z) ? rawSize.y : Math.max(rawSize.x, rawSize.y, rawSize.z);   // as modelPayload measures it
    const h0 = read.ext === 'glb' || read.ext === 'gltf' || tall < 5 ? tall * 52.5 : tall > 1000 ? tall * 0.525 : tall;
    const opts = { name: read.name.replace(/\W+/g, '_').slice(0, 28), height: Math.max(1, Math.round(h0)), turn: 0, standUp: false, twoSided: false, flip: false, skinned: animated };
    // its animations: each a sequence of the model (a name the game can call, its frames per second)
    // which clips move the model: a Maya/Blender rig also exports its controls' own clips ("ctl|Take 001|BaseLayer"),
    // which move no bone of the skin (Crypt Test, 20 Oct 2026: four clips all called BaseLayer, the first a control's)
    const skinBones = new Set();
    read.root.traverse((o) => { if (o.isSkinnedMesh) for (const b of o.skeleton.bones) skinBones.add(b.name); });
    const movesModel = (clip) => !skinBones.size || clip.tracks.some((tr) => skinBones.has(tr.name.slice(0, tr.name.lastIndexOf('.'))) || /morphTargetInfluences/.test(tr.name));
    // its name: the last part that says something ("Armature|Take 001|BaseLayer" -> Armature), without a Maya namespace
    const clipName = (clip) => {
      const parts = String(clip.name || '').split('|').map((s) => s.trim()).filter(Boolean);
      const own = parts.filter((s) => !/^(BaseLayer\d*|Take[ _]?\d+|mixamo\.com|Action|Animation|Default|Scene)$/i.test(s)).pop() || parts.pop() || '';
      return own.replace(/^.*:/, '');
    };
    const anims = animated ? read.clips.map((clip, i) => {
      let base = clipName(clip).replace(/\W+/g, '_').replace(/^_+|_+$/g, '') || `Anim${i + 1}`;
      if (/^\d/.test(base)) base = 'A' + base;
      let name = base.slice(0, 32), k = 2;
      while (used.has(name.toLowerCase()) || name.toLowerCase() === 'all') name = `${base.slice(0, 29)}${k++}`;
      used.add(name.toLowerCase());
      const moves = movesModel(clip);
      return { clip, name, on: moves, still: !moves };
    }) : [];
    const anim = { fps: 15, idle: (anims.find((a) => a.on) || anims[0])?.name || '' };
    const simple = { target: Math.min(MODEL_MAX_TRIS, 3000), done: null };   // Simplify: the triangles to keep
    let colorParts = 0;
    read.root.traverse((o) => { if (o.isMesh && paintedColors(o.geometry)) colorParts++; });
    // painted colours: a glTF has them only when they are used; an FBX may carry a sculpting tool's leftovers
    const vc = { on: colorParts > 0 && (read.ext === 'glb' || read.ext === 'gltf') };
    if (vc.on) bakeVertexColors(read.root, true);
    let first;
    try { first = modelPayload(read.root, opts); } catch (e) {          // e.g. an animation-only FBX: say so, never hang
      const why = /no triangles/.test(e.message) && read.clips.length
        ? `${e.message}: it holds only animations (${read.clips.length}), no model. Export the model with its mesh (or a file that has both).` : e.message;
      $('#miopts').innerHTML = `<div class="hint bad">${escapeHtml(why)}</div>`;
      return;
    }
    let broken = animated && skinSpread(first) > SKIN_FAR, rebound = false;
    if (broken) {
      // its inverse bind matrices do not fit its bones (an armature scaled to other units: an FBX in centimetres):
      // bound again to the model as it stands, each bone's place now its rest; kept only if that holds together
      const saved = [];
      read.root.traverse((o) => { if (o.isSkinnedMesh) saved.push([o, o.skeleton.boneInverses.map((m) => m.clone()), o.bindMatrix.clone()]); });
      for (const [o] of saved) { o.skeleton.calculateInverses(); o.bind(o.skeleton, o.matrixWorld); }
      read.root.updateMatrixWorld(true);
      let ok = skinSpread(modelPayload(read.root, opts)) <= SKIN_FAR;
      if (ok) {
        try { const c = anims.find((a) => !a.still); if (c) bakeClips(read.root, modelPayload(read.root, opts), [{ clip: c.clip, name: 'T', fps: 5 }]); }
        catch (e) { ok = false; }
      }
      if (ok) { broken = false; rebound = true; }
      else for (const [o, inv, bm] of saved) { o.skeleton.boneInverses = inv; o.bindMatrix.copy(bm); o.bindMatrixInverse.copy(bm).invert(); }
    }
    opts.skinned = animated && !broken;              // from now on measured as the skeleton holds it (modelPayload)
    if (!broken) for (const a of anims) a.pulled = a.still ? [] : pulledBones(read.root, a.clip, tall);
    if (broken) for (const a of anims) a.on = false;
    const render = () => {
      let p;
      try { p = modelPayload(read.root, opts); } catch (e) { $('#miopts').innerHTML = `<div class="hint bad">${escapeHtml(e.message)}</div>`; return; }
      const tris = p.indices.length / 3, tooMany = tris > MODEL_MAX_TRIS;
      const tooHeavy = () => { const nf = anims.filter((a) => a.on).reduce((n, a) => n + clipFrames(a.clip, anim.fps), 0); return nf > MODEL_MAX_FRAMES || nf * p.positions.length / 3 > MODEL_MAX_FRAME_VERTICES; };
      const tooManyPoints = p.positions.length / 3 > MODEL_MAX_VERTICES, heavy = tooMany || tooManyPoints;
      importPreview(p);
      $('#miopts').innerHTML = `<div class="row"><label>Name</label><input type="text" id="miname" value="${escapeHtml(opts.name)}" style="flex:1;min-width:0"></div>
        <div class="row"><label title="JC is about 90 units tall, a door 128">Height (units)</label><input type="number" id="miheight" value="${opts.height}" min="1" step="1" style="width:80px">
          <span class="hint" style="margin:0">${Math.round(p.size[0])} x ${Math.round(p.size[1])} x ${Math.round(p.size[2])} · JC is about 90</span></div>
        <div class="row"><label>Turn</label><select id="miturn">${[0, 90, 180, 270].map((d) => `<option ${d === opts.turn ? 'selected' : ''}>${d}</option>`).join('')}</select>
          <label style="width:auto" title="For a model that comes in lying on its back (made with Z up)"><input type="checkbox" id="mistand" ${opts.standUp ? 'checked' : ''}> stand it up</label>
          <label style="width:auto" title="Both sides of every face drawn (leaves, cloth, thin panels)"><input type="checkbox" id="mitwo" ${opts.twoSided ? 'checked' : ''}> two-sided</label></div>
        ${anims.length ? (() => {
          const on = anims.filter((a) => a.on), nf = on.reduce((n, a) => n + clipFrames(a.clip, anim.fps), 0);
          return `<div class="hint" style="margin:8px 0 2px;font-weight:600">Animations</div>
          ${rebound ? `<div class="hint" style="margin:0 0 4px">Its skeleton was made for other units (an armature scaled from centimetres): it was bound again to the model as it stands.</div>` : ''}
          ${broken ? `<div class="hint" style="margin:0 0 4px;color:var(--bad)">This file's skeleton does not fit its model (read as it is, it throws the model's points far away: often an FBX with a scaled armature or two skeletons). The animations are left out; the model can be imported still. To keep them, save it as glTF/GLB from Blender with the armature's scale applied.</div>` : ''}
          <div class="hint" style="margin:0 0 4px">Each one ticked becomes a sequence of the model with this name (the names the game uses, such as Walk, Run or BreatheLight, let a character use them).</div>
          ${anims.map((a, i) => `<div class="row"><label style="width:auto"><input type="checkbox" data-mianim="${i}" ${a.on ? 'checked' : ''} ${broken ? 'disabled' : ''}></label>
            <input type="text" data-mianame="${i}" value="${escapeHtml(a.name)}" list="miseqnames" style="flex:1;min-width:0">
            <span class="hint" style="margin:0;width:110px;text-align:right" ${a.still ? 'title="It moves no bone of the model (a control of the rig): nothing would move"' : ''}>${a.still ? 'moves nothing · ' : ''}${a.clip.duration.toFixed(2)} s · ${clipFrames(a.clip, anim.fps)} frames</span></div>
            ${a.pulled && a.pulled.length ? `<div class="hint" style="margin:0 0 4px 22px;color:var(--warn)">▲ This animation pulls ${a.pulled.slice(0, 3).map((x) => `<b>${escapeHtml(x.name)}</b> (${Math.round(x.part * 100)}%)`).join(', ')}${a.pulled.length > 3 ? ` and ${a.pulled.length - 3} more` : ''} away from the bone it hangs on (in % of the model's height): the parts on it stretch. It is in the file's animation, not the import: try another animation of this model, or fix that bone in Blender or Maya.</div>` : ''}`).join('')}
          <datalist id="miseqnames">${['Still', 'BreatheLight', 'Walk', 'Run', 'Idle1', 'Idle2', 'Sit', 'SitBreathe', 'Dance', 'Shoot', 'Wave', 'Talk', 'Panic', 'Crouch', 'Jump'].map((n) => `<option value="${n}">`).join('')}</datalist>
          <div class="row"><label title="How many frames a second the animations are kept at: more is smoother and heavier">Frames/s</label><select id="mifps">${[10, 15, 20, 25, 30].map((f) => `<option ${f === anim.fps ? 'selected' : ''}>${f}</option>`).join('')}</select>
            <label style="width:auto;margin-left:8px" title="What the model does when placed in a map (it can be changed in its Properties: IdleAnim)">Loops in the map</label>
            <select id="miidle" style="flex:1;min-width:0"><option value="">(still)</option>${on.map((a) => `<option ${a.name === anim.idle ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select></div>
          <div class="hint" style="margin:2px 0 6px">${nf} frames in all${tooHeavy() ? ` · <b style="color:var(--bad)">too much animation: at most ${MODEL_MAX_FRAMES} frames, and ${MODEL_MAX_FRAME_VERTICES / 1e6} million frames x vertices (fewer animations, fewer frames a second, or a simpler model)</b>` : ''}</div>`;
        })() : ''}
        ${parts.length > 1 ? `<details ${parts.some((x) => x.o.userData.skipPart) ? 'open' : ''} style="margin:6px 0"><summary class="hint" style="font-weight:600;cursor:pointer">Parts (${parts.filter((x) => !x.o.userData.skipPart).length} of ${parts.length})</summary>
          ${parts.map((x, i) => `<div class="row" style="margin:1px 0"><label style="width:auto;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(x.o.name)}"><input type="checkbox" data-mipart="${i}" ${x.o.userData.skipPart ? '' : 'checked'}> ${escapeHtml(x.label)}</label>
            <span class="hint" style="margin:0;text-align:right" title="${x.stray ? 'It does not follow the skeleton (often a rig blendshape target, kept beside the body)' : x.hair ? 'Hair or fur cards: thousands of thin textured planes, which Simplify turns into lumps' : ''}">${x.stray ? 'not on the skeleton · ' : x.hair ? 'hair cards · ' : ''}${x.tris} tris</span></div>`).join('')}</details>` : ''}
        ${colorParts ? `<div class="row"><label style="width:auto" title="Colours painted on the model's points: Deus Ex has none, so they are drawn into a picture over its UVs"><input type="checkbox" id="mivc" ${vc.on ? 'checked' : ''}> its painted colours (${colorParts} part${colorParts === 1 ? '' : 's'})</label></div>` : ''}
        ${read.missing.length ? `<div class="hint" style="margin:4px 0;color:var(--warn)">Pictures it asks for and you did not choose: <b>${read.missing.map(escapeHtml).join(', ')}</b> (those parts take their colour). <button id="miaddpics">Add pictures…</button><input type="file" id="mipics" multiple accept="image/*,.tga,.dds" style="display:none"></div>` : ''}
        <div class="hint" style="margin:2px 0 6px">${tris} triangles, ${p.positions.length / 3} vertices, ${p.materials.length} texture${p.materials.length === 1 ? '' : 's'}${p.materials.some((m) => !m.png) ? ' (the ones without a picture take their colour)' : ''}.
          ${tooMany || tooManyPoints ? `<b style="color:var(--bad)">Too many ${tooMany ? 'triangles' : 'points'} for Deus Ex: simplify it below.</b>` : tris > 5000 ? 'Many triangles for Deus Ex: fine for a few objects, heavy if repeated everywhere.' : ''}</div>
        ${heavy || tris > 3000 || simple.done ? `<div class="hint" style="margin:6px 0 2px;${heavy ? 'color:var(--warn)' : ''}">${heavy
          ? `<b>Too detailed for Deus Ex</b> (${tris} triangles, ${p.positions.length / 3} points: at most ${MODEL_MAX_TRIS} and ${MODEL_MAX_VERTICES}; the game's own characters have about 1000). Simplify it here: the shape, the textures, the skeleton and the animations are kept.`
          : simple.done ? `Simplified from ${simple.done.before} triangles.` : 'A detailed model: simplifying it makes it lighter for the game.'}</div>
        <div class="row"><label title="How many triangles the model keeps: the game's characters have about 1000-2000, a big object a few thousand">Triangles</label>
          <input type="number" id="mitarget" value="${simple.target}" min="100" max="${MODEL_MAX_TRIS}" step="100" style="width:80px">
          <button id="misimplify" ${heavy ? 'class="primary"' : ''}>Simplify</button>${simple.done ? '<button id="mioriginal" title="Back to the model as it was read">Original</button>' : ''}</div>` : ''}
        <div class="row"><button id="migo" class="primary" ${tooMany || tooManyPoints || tooHeavy() ? 'disabled' : ''}>Import</button><span id="mimsg" class="hint" style="margin:0"></span></div>`;
      $('#miname').onchange = () => { opts.name = $('#miname').value.trim(); };
      for (const c of $('#miopts').querySelectorAll('[data-mipart]')) c.onchange = async () => {
        const x = parts[+c.dataset.mipart];
        x.o.userData.skipPart = !c.checked; x.o.visible = c.checked;
        if (simple.done) simple.done = await simplifyModel(read.root, simple.target);     // the triangles shared again
        render();
      };
      if ($('#mivc')) $('#mivc').onchange = () => { vc.on = $('#mivc').checked; bakeVertexColors(read.root, vc.on); render(); };
      if ($('#miaddpics')) $('#miaddpics').onclick = () => $('#mipics').click();
      if ($('#mipics')) $('#mipics').onchange = () => {            // read again with the pictures added
        const dt = new DataTransfer();
        for (const f of [...files, ...$('#mipics').files]) dt.items.add(f);
        $('#mifile').files = dt.files;
        $('#mifile').dispatchEvent(new Event('change', { bubbles: true }));
      };
      $('#miheight').onchange = () => { opts.height = Math.max(1, +$('#miheight').value || opts.height); render(); };
      $('#miturn').onchange = () => { opts.turn = +$('#miturn').value; render(); };
      $('#mistand').onchange = () => { opts.standUp = $('#mistand').checked; render(); };
      $('#mitwo').onchange = () => { opts.twoSided = $('#mitwo').checked; render(); };
      if ($('#mitarget')) $('#mitarget').onchange = () => { simple.target = Math.max(100, Math.min(MODEL_MAX_TRIS, +$('#mitarget').value || simple.target)); };
      if ($('#misimplify')) $('#misimplify').onclick = async () => {
        simple.target = Math.max(100, Math.min(MODEL_MAX_TRIS, +$('#mitarget').value || simple.target));
        $('#mimsg').textContent = 'Simplifying...';
        try {
          let r = await simplifyModel(read.root, simple.target);
          // still too many points (a model of many small parts): a little less each time
          for (let k = 0, want = simple.target; k < 6 && modelPayload(read.root, opts).positions.length / 3 > MODEL_MAX_VERTICES; k++) r = await simplifyModel(read.root, want = Math.round(want * 0.75));
          simple.done = r;
        } catch (e) { $('#mimsg').textContent = 'Simplify: ' + e.message; return; }
        render();
      };
      if ($('#mioriginal')) $('#mioriginal').onclick = async () => { await simplifyModel(read.root, 0); simple.done = null; render(); };
      for (const c of $('#miopts').querySelectorAll('[data-mianim]')) c.onchange = () => { anims[+c.dataset.mianim].on = c.checked; render(); };
      for (const c of $('#miopts').querySelectorAll('[data-mianame]')) c.onchange = () => {
        const a = anims[+c.dataset.mianame], was = a.name;
        let n = c.value.trim().replace(/\W+/g, '_').slice(0, 32);
        if (/^\d/.test(n)) n = 'A' + n;
        if (!n || n.toLowerCase() === 'all' || anims.some((x) => x !== a && x.name.toLowerCase() === n.toLowerCase())) { c.value = was; $('#mimsg').textContent = 'Each animation needs a name of its own.'; return; }
        a.name = n;
        if (anim.idle === was) anim.idle = n;
        render();
      };
      if ($('#mifps')) $('#mifps').onchange = () => { anim.fps = +$('#mifps').value; render(); };
      if ($('#miidle')) $('#miidle').onchange = () => { anim.idle = $('#miidle').value; };
      $('#migo').onclick = async () => {
        opts.name = $('#miname').value.trim() || opts.name;
        busy('Making the model with the game\'s importer...');
        try {
          const payload = modelPayload(read.root, opts), body = Object.assign({ name: opts.name, source: files.map((f) => f.name).join(', ') }, payload);
          const on = anims.filter((a) => a.on);
          if (on.length) {
            busy('Baking the animations into frames...');
            await new Promise((r) => setTimeout(r, 30));
            const baked = bakeClips(read.root, payload, on.map((a) => ({ clip: a.clip, name: a.name, fps: anim.fps })));
            Object.assign(body, { frames: base64Of(baked.frames.buffer), sequences: baked.sequences, idle: on.some((a) => a.name === anim.idle) ? anim.idle : '' });
            busy('Making the model with the game\'s importer...');
          }
          const r = await api('/api/model_import', body);
          for (const l of r.lines || []) log(l, r.ok ? '' : 'bad');
          if (!r.ok) throw new Error('the model was not made: see Messages');
          modelsChanged();
          closeImport();
          showTab('models');
          await refitPlaced(r.mesh);
          await placeModel(r.mesh, null, body.idle ? { IdleAnim: body.idle } : null);
          log(`Model ${r.mesh.split(".").pop().replace(/^UCM_/, "")} ready${body.sequences ? ` with ${body.sequences.length} animation${body.sequences.length === 1 ? '' : 's'}` : ''}: click where it goes (it is also under My models).`, 'ok');
        } catch (e) { $('#mimsg').textContent = e.message; log('Import: ' + e.message, 'bad'); } finally { busy(''); }
      };
    };
    render();
  };
}
function modelsChanged() {                 // UCModels made again: lists and models read again
  modelList = null;
  delete modelPkgs[MODELS_PKG];
  for (const k of Object.keys(meshModels)) if (k.startsWith(MODELS_PKG + '.')) delete meshModels[k];
  for (const k of Object.keys(modelCache)) if (k.startsWith('mesh:' + MODELS_PKG + '.')) delete modelCache[k];
  for (const k of Object.keys(thumbDone)) if (k.startsWith('mesh:' + MODELS_PKG + '.')) delete thumbDone[k];
  if (bottomTab === 'models' || bottomTab === 'mymodels') buildModels();
}
$('#bimport').onclick = () => openImport().catch((e) => log('Import: ' + e.message, 'bad'));

// ---------------------------------------------------------------- 3D previews of the browser
// Made in a small view of their own when they scroll into sight, one at a time. The game's objects are
// kept by the server (cache/_palette/thumbs: the next time they show at once); the structures of the
// map and your characters only in this page.
const thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
thumbR.setPixelRatio(1);
thumbR.setSize(176, 168);
thumbR.outputColorSpace = THREE.SRGBColorSpace;
const thumbScene = new THREE.Scene();
thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.7));
const thumbSun = new THREE.DirectionalLight(0xffffff, 1.1);
thumbSun.position.set(0.6, 1, 0.8);
thumbScene.add(thumbSun);
const thumbCam = new THREE.PerspectiveCamera(30, 176 / 168, 0.5, 400000);
const thumbDone = {}, thumbQueue = [], thumbMissing = new Set();
let thumbBusy = false;
// the picture the server keeps for a tile (the game's objects, the pieces, the models of other packages)
function keptThumb(key) {
  const kind = key.slice(0, key.indexOf(':')), id = key.slice(key.indexOf(':') + 1);
  if (kind === 'cls') return id;
  if (kind === 'piece') return 'piece_' + id.replace(/[^\w.-]/g, '_');
  if (kind === 'mesh' && !id.startsWith(MODELS_PKG + '.')) return 'mesh_' + id.replace(/[^\w.-]/g, '_');
  return null;
}
// the next tiles of the queue start loading their model and textures while this one is drawn
function warmTile(el) {
  if (sceneAssetsPending()) return;
  const generation = mapGeneration;
  const key = el.dataset.th || '';
  if (!key.startsWith('cls:') || thumbDone[key]) return;
  const id = key.slice(4);
  loadPaletteModel(id).then((m) => { if (m && generation === mapGeneration) modelFor({ cls: id }, 'palette', true); }).catch(() => {});
}
function frameThumb(obj) {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return false;
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z) * 0.6 + 1, d = r / Math.sin(THREE.MathUtils.degToRad(15));
  thumbCam.position.copy(c).addScaledVector(new THREE.Vector3(1, 0.55, 0.8).normalize(), d);
  thumbCam.near = Math.max(0.5, d - r * 3);
  thumbCam.far = d + r * 3;
  thumbCam.updateProjectionMatrix();
  thumbCam.lookAt(c);
  return true;
}
function texturesReady(obj) {
  let ok = true;
  obj.traverse((o) => { const m = o.material; if (m && m.map && (m.map.userData.pending || m.map.userData.failed || !(m.map.image && m.map.image.width))) ok = false; });
  return ok;
}
async function renderThumb(obj, wait = true) {
  for (let i = 0; wait && i < 250 && !texturesReady(obj); i++) await new Promise((r) => setTimeout(r, 60));
  if (wait && !texturesReady(obj)) return null; // Never save a permanent placeholder thumbnail.
  const parent = obj.parent, swapped = [];
  thumbScene.add(obj);                // a structure leaves the map for a moment (the same frame)
  obj.traverse((o) => { if (o.isMesh && o.userData.matBase && o.material !== o.userData.matBase) { swapped.push([o, o.material]); o.material = o.userData.matBase; } });
  let url = null;                     // previews always in the editor's soft light (not Lit: night maps are dark)
  if (frameThumb(obj)) { thumbR.render(thumbScene, thumbCam); url = thumbR.domElement.toDataURL('image/png'); }
  for (const [o, m] of swapped) o.material = m;
  if (parent) parent.add(obj); else thumbScene.remove(obj);
  return url;
}
function serverThumb(cls) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img.src);
    img.onerror = () => res(null);
    img.src = `/cache/_palette/thumbs/${encodeURIComponent(cls)}.png`;
  });
}
async function fillThumb(el) {
  const generation = mapGeneration;
  const key = el.dataset.th, kind = key.slice(0, key.indexOf(':')), id = key.slice(key.indexOf(':') + 1);
  let url = thumbDone[key] || null;
  if (!url && kind === 'cls') {
    if (!thumbMissing.has(key)) url = await serverThumb(id);
    if (!url) {
      await loadPaletteModel(id);
      if (generation !== mapGeneration) return;
      const m = modelFor({ cls: id }, 'palette', true);
      if (m && !texturesReady(m)) {          // its shape at once, its textures when they arrive
        const quick = await renderThumb(m, false);
        if (quick && !el.querySelector('img')) el.innerHTML = `<img src="${quick}" alt="">`;
      }
      if (m) url = await renderThumb(m);
      if (url && generation === mapGeneration) fetch('/api/thumb?cls=' + encodeURIComponent(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ png: url }) }).catch(() => {});
    }
  } else if (!url && kind === 'char' && window.__characters) {
    await window.__characters.ready();
    if (generation !== mapGeneration) return;
    const m = modelFor({ cls: 'UCCustomCivilian', props: window.__characters.propsOf(id.split('|')[0]) }, 'added', true);
    if (m) url = await renderThumb(m);
  } else if (!url && kind === 'piece') {
    const key = 'piece_' + id.replace(/[^\w.-]/g, '_');
    if (!thumbMissing.has(el.dataset.th)) url = await serverThumb(key);
    if (!url) {
      const m = await pieceModel(id);
      if (m) url = await renderThumb(m);
      if (url) fetch('/api/thumb?cls=' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ png: url }) }).catch(() => {});
    }
  } else if (!url && kind === 'mesh') {
    const own = id.startsWith(MODELS_PKG + '.'), skey = 'mesh_' + id.replace(/[^\w.-]/g, '_');
    if (!own && !thumbMissing.has(key)) url = await serverThumb(skey);
    if (!url) {
      const r = await meshInfo(id).catch(() => null);
      if (generation !== mapGeneration) return;
      const m = r && modelFor({ cls: 'UCMeshDeco', props: { Mesh: `${r.info.cls}'${id}'` } }, 'added', true);
      if (m) url = await renderThumb(m);
      if (url && !own) fetch('/api/thumb?cls=' + encodeURIComponent(skey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ png: url }) }).catch(() => {});
    }
  } else if (!url && kind === 'st' && structures[id] && structures[id].obj) {
    url = await renderThumb(structures[id].obj);
  }
  if (url && generation === mapGeneration) { thumbDone[key] = url; el.innerHTML = `<img src="${url}" alt="">`; }
}
function sceneAssetsPending() {
  return mapLoading || modelQueue.length || modelActive || sceneTextures.pending('scene');
}
async function runThumbs() {
  thumbBusy = true;
  while (thumbQueue.length) {
    if (sceneAssetsPending()) { await new Promise(r => setTimeout(r, 60)); continue; }
    const el = thumbQueue.shift();
    if (!document.body.contains(el)) continue;
    for (const next of thumbQueue.slice(0, 8)) warmTile(next);
    try { await fillThumb(el); } catch (e) { /* it keeps its icon */ }
    await new Promise((r) => setTimeout(r, 0));
  }
  thumbBusy = false;
}
// the tiles in sight of the browser (and a little more) get their preview
let thumbScan = 0;
function observeThumbs() { clearTimeout(thumbScan); thumbScan = setTimeout(scanThumbs, 60); }
function scanThumbs() {
  for (const pane of [$('#palette'), $('#pieces'), $('#models')]) {
    if (!pane || pane.style.display === 'none') continue;
    const r = pane.getBoundingClientRect();
    for (const el of pane.querySelectorAll('.th[data-th]:not([data-q])')) {
      const b = el.getBoundingClientRect();
      if (!b.height || b.bottom < r.top - 150 || b.top > r.bottom + 150) continue;
      el.dataset.q = '1';
      const key = el.dataset.th;
      if (thumbDone[key]) { el.innerHTML = `<img src="${thumbDone[key]}" alt="">`; continue; }
      const kept = !thumbMissing.has(key) && keptThumb(key);
      if (kept) {                   // drawn before: its picture from the server, all of them at once
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.onload = () => { thumbDone[key] = img.src; el.innerHTML = ''; el.appendChild(img); };
        img.onerror = () => { thumbMissing.add(key); thumbQueue.push(el); if (!thumbBusy) runThumbs(); };
        img.src = `/cache/_palette/thumbs/${encodeURIComponent(kept)}.png`;
        continue;
      }
      thumbQueue.push(el);
    }
  }
  if (thumbQueue.length && !thumbBusy) runThumbs();
}
// left alone, the editor draws the game's objects it has never drawn, one at a time, and the server keeps
// them: the next time every object of the browser shows at once (pictures made here, from this PC's game)
let lastInput = performance.now(), warmList = null;
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel'])
  window.addEventListener(ev, () => { lastInput = performance.now(); }, { capture: true, passive: true });
// 8 at a time: their models and textures load together, then each one is drawn (17 Oct 2026: it was one at
// a time, only after 5 s of rest). It waits while the map's own objects load and while you drag or fly.
let warmTotal = 0, warmDone = 0;
async function warmThumbs() {
  if (document.hidden || thumbBusy || thumbQueue.length || sceneAssetsPending() || tc.dragging || cam.look
      || performance.now() - lastInput < 600 || !paletteHas.size) return setTimeout(warmThumbs, 1200);
  if (!warmList) {
    const have = new Set(await fetch('/api/thumbs').then((r) => r.json()).catch(() => []));
    warmList = [...paletteHas].filter((c) => !have.has(c)).sort();
    warmTotal = warmList.length; warmDone = 0;
  }
  const batch = warmList.filter((c) => !thumbDone['cls:' + c]).slice(0, 8);
  if (!batch.length) {                      // all of them: nothing more to do
    if (warmTotal) status(`Previews of the game's objects ready (${warmTotal} made; kept for every project of this game).`, 'ok');
    warmTotal = 0;
    return;
  }
  warmList = warmList.filter((c) => !batch.includes(c));
  thumbBusy = true;
  const generation = mapGeneration;
  const texBefore = new Set(Object.values(texCache)), matBefore = new Set(Object.values(matCache));
  const had = new Set(Object.values(modelCache));
  try {
    await Promise.all(batch.map((c) => loadPaletteModel(c).then(() => generation === mapGeneration && modelFor({ cls: c }, 'palette', true)).catch(() => null)));
    for (const cls of batch) {
      if (generation !== mapGeneration || sceneAssetsPending()) break;
      const m = modelFor({ cls }, 'palette', true), url = m && await renderThumb(m).catch(() => null);
      warmDone++;
      if (!url || generation !== mapGeneration) continue;
      thumbDone['cls:' + cls] = url;
      fetch('/api/thumb?cls=' + encodeURIComponent(cls), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ png: url }) }).catch(() => {});
    }
    if (warmTotal > 8) status(`Preparing the previews of the game's objects: ${warmDone}/${warmTotal} (once: kept for every project of this game)`);
  } catch (e) { /* the next ones */ } finally {
    // Preview resources have their own ownership. Never collect resources created
    // by a map load or an object placed while this asynchronous batch was running.
    if (generation === mapGeneration) {
      for (const [k, m] of Object.entries(modelCache)) if (k.startsWith('preview:') && !had.has(m)) {
        m.obj.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); delete modelCache[k];
      }
      for (const [k, m] of Object.entries(matCache)) if (k.startsWith('preview:') && !matBefore.has(m)) { m.dispose(); delete matCache[k]; }
      for (const [k, t] of Object.entries(texCache)) if (k.startsWith('preview:') && !texBefore.has(t)) { t.dispose(); delete texCache[k]; }
    }
    thumbBusy = false;
  }
  if (thumbQueue.length) runThumbs();
  setTimeout(warmThumbs, 30);
}
setTimeout(warmThumbs, 3000);
$('#palette').addEventListener('scroll', observeThumbs);
$('#pieces').addEventListener('scroll', observeThumbs);
$('#models').addEventListener('scroll', observeThumbs);
window.addEventListener('resize', observeThumbs);

// ---------------------------------------------------------------- Hierarchy (left panel): every object of the level
// Like Unity's Hierarchy: the structures with their objects inside, then the other objects by kind.
// Click: select. Double click (or F): go to it. The bin: delete it (Delete key too).
const HIER_KINDS = [['pawn', 'Characters'], ['light', 'Lights'], ['prop', 'Objects'], ['mover', 'Doors and elevators'],
  ['logic', 'Triggers and logic'], ['path', 'AI paths'], ['box', 'Blocks']];
const hierOpen = new Set(['k:pawn', 'k:light']);
let hierTimer = 0, hierItems = [];
// Like Unity: the order of the rows is the user's. Inside a nest it is the nest's own list; in the folders
// (Structures > Roof, Lights...) edits.order ranks the keys moved by hand (the rest stay alphabetical after
// them). A row just moved flashes and its folders open, so it is found at once.
const hierRank = () => new Map((edits.order || []).map((k, i) => [k, i]));
let hierFlash = null;                 // {keys: Set, until: time}
function flashInHierarchy(keys) {
  hierFlash = { keys: new Set(keys), until: performance.now() + 2500 };
  for (const k of keys) { const o = objOf(k); if (o) revealInHierarchy(o); }
  buildHierarchy();
}
// Like Unity's and PlayCanvas' hierarchies: Shift+click selects every row between the last one clicked and
// this one; with the Hierarchy clicked, the arrows walk it (up/down) and open or close its folders (right/left).
let hierAnchor = null;
function hierRows() {               // the rows that can be selected, in the order they are shown
  return [...$('#hier').querySelectorAll('[data-key]')].filter((r) => r.offsetParent && (r.dataset.hi !== undefined || r.dataset.nest));
}
function hierRangeTo(key) {
  const keys = hierRows().map((r) => r.dataset.key), a = keys.indexOf(hierAnchor), b = keys.indexOf(key);
  if (a < 0 || b < 0) return false;
  selectKeys(keys.slice(Math.min(a, b), Math.max(a, b) + 1));
  return true;
}
{
  const hier = $('#hier');
  hier.tabIndex = 0;
  hier.addEventListener('keydown', (e) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target.closest('input, select, textarea')) return;
    const rows = hierRows();
    if (!rows.length) return;
    e.preventDefault(); e.stopPropagation();
    let i = rows.findIndex((r) => r.dataset.key === hierAnchor);
    if (i < 0) i = rows.findIndex((r) => r.classList.contains('on'));
    const row = rows[i];
    const pick = (r) => (r?.querySelector('.hl') || r)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const box = row?.tagName === 'SUMMARY' ? row.parentElement : null;
    if (e.key === 'ArrowDown') pick(rows[Math.min(rows.length - 1, i + 1)]);
    else if (e.key === 'ArrowUp') pick(rows[Math.max(0, i - 1)]);
    else if (e.key === 'ArrowRight') { if (box && !box.open) box.open = true; else if (box) pick(rows[i + 1]); }
    else if (e.key === 'ArrowLeft') {
      if (box && box.open) { box.open = false; return; }
      const up = (box || row)?.parentElement?.closest('details')?.querySelector(':scope > summary');
      if (up?.dataset.key) pick(up);
    }
  });
}
// a class as DeusEdix shows it: its classes still carry UNATCO Continues' "UC" (renamed later: ROADMAP)
// a class as people read it: no package (a script of Tools > Scripts is "Pkg.Name", a project's Pkg a made-up id)
function clsShown(c) { const s = String(c || '').split('.').pop(); return STANDALONE ? s.replace(/^UC(?=[A-Z])/, '') : s; }
function hierLabel(a) {
  if (a.cls === 'PatrolPoint' && tagOf(a) && tagOf(a) !== 'None') return 'Patrol point ' + tagOf(a);
  if (a.cls === 'UCCutscene') return 'Cutscene ' + (((edits.cutscenes || {})[a.name] || {}).title || '');
  if (a.cls === 'UCMeshDeco') {             // a model of the Models tab: its name, else its mesh
    const own = unquote(actorProp(a, 'ItemName') || ''), mesh = meshOf(a).split('.').pop().replace(/^UCM_/, '');
    return own && own !== 'Object' ? own : mesh || 'Model';
  }
  const made = /Scripts\.UC([WA])_(\w+)$/.exec(a.cls || '');                    // Tools > Weapons
  if (made) return (made[1] === 'W' ? 'Weapon ' : 'Ammo ') + made[2];
  if (/Scripts\.\w+$/.test(a.cls || '')) return 'Script ' + clsShown(a.cls);      // Tools > Scripts
  const own = unquote(actorProp(a, 'FamiliarName') || '');
  const s = own || NAMES[a.cls] || a.label || clsShown(a.cls).replace(/([a-z])([A-Z0-9])/g, '$1 $2');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function buildHierarchy() { clearTimeout(hierTimer); hierTimer = setTimeout(renderHierarchy, 40); }
function hierColor(kind) { return '#' + (KIND_COLOR[kind] || KIND_COLOR.prop).toString(16).padStart(6, '0'); }
const HIER_SYMBOLS = {
  pawn: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M9 21v-4m6 4v-4"/>',
  light: '<path d="M9 17h6m-6 3h6m-5 2h4M8.5 14.5a6 6 0 1 1 7 0L15 17H9l-.5-2.5Z"/><path d="M12 1V0M3 5 1.5 4M21 5l1.5-1M3 12H1m20 0h2"/>',
  prop: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10 9-5M3 8l9 5v9M7.5 5.5l9 5"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10 9-5M3 8l9 5v9"/>',
  mover: '<path d="M4 21V3h16v18M8 21V6l9-2v17H3m14 0h4"/><path d="M13 12v2"/>',
  logic: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h6a3 3 0 0 1 3 3v6m-3-3 3 3 3-3M6 9v12"/>',
  path: '<circle cx="5" cy="18" r="3"/><circle cx="19" cy="6" r="3"/><path d="M5 15v-4a5 5 0 0 1 5-5h6m-8 12h5a6 6 0 0 0 6-6V9"/>',
  structure: '<path d="m12 2 10 5-10 5L2 7l10-5ZM2 12l10 5 10-5M2 17l10 5 10-5"/>',
  folder: '<path d="M3 20V4h7l2 3h9v13H3Z"/>',
  nest: '<rect x="3" y="8" width="13" height="13" rx="2"/><path d="M8 8V4h12v12h-4"/>',
  piece: '<path d="M4 10h10v10H4z"/><path d="M14 4h6v6M20 4l-7 7"/>',
  start: '<path d="M5 22V3m0 0h14l-4 5 4 5H5"/>',
  helicopter: '<path d="M6 3h15M14 3v4m-6 9h12a3 3 0 0 0 2-5l-4-4h-7l-3 4H4L2 7H1l2 9h5Zm4 0v4m7-4v4M8 20h14M16 7v5h6"/>',
  sound: '<path d="M3 9h4l5-5v16l-5-5H3V9Zm13-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16"/>',
  camera: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-4v12l-6-4"/>',
};
function npcDisposition(a) {
  const relation = relationsOf(a).find(r => r.name.toLowerCase() === 'player');
  if (relation) return levelKey(relation.level) === '1' ? 'friendly' : levelKey(relation.level) === '-1' ? 'hostile' : 'neutral';
  if (factionOf(a).toLowerCase() === 'player') return 'friendly';
  return factionData?.classes[a.cls] ? 'neutral' : 'unknown';
}
function hierarchyIcon(kind, a = null) {
  let symbol = HIER_SYMBOLS[kind] ? kind : 'prop', color = hierColor(kind);
  let label = { pawn: 'Characters', light: 'Light', prop: 'Object', mover: 'Door / elevator', logic: 'Trigger / logic', path: 'AI path', box: 'Block', structure: 'Structure', folder: 'Folder', nest: 'Nest', piece: 'Piece of a structure' }[kind] || 'Object';
  if (kind === 'nest') color = 'var(--acc)';
  if (a?.cls === 'PlayerStart') { symbol = 'start'; color = 'var(--acc)'; label = 'Player start'; }
  else if (/Helicopter/.test(a?.cls || '')) { symbol = 'helicopter'; color = 'var(--acc)'; label = 'Helicopter'; }
  else if (/^(AmbientSound|UCSoundFX)$/.test(a?.cls || '')) { symbol = 'sound'; label = 'Sound'; }
  else if (/^(SecurityCamera|CameraPoint|InterpolationPoint|UCCutscene)$/.test(a?.cls || '')) { symbol = 'camera'; label = 'Camera / cutscene'; }
  else if (kind === 'pawn') {
    const state = a ? npcDisposition(a) : 'neutral';
    color = `var(--npc-${state === 'unknown' ? 'neutral' : state})`;
    if (a) label = { friendly: 'Ally of JC', neutral: 'Neutral towards JC', hostile: 'Enemy of JC', unknown: 'NPC — relation defaults unavailable' }[state] + ' · at map start';
  }
  const speech = a && window.__gamecons?.data?.actors[a.name]?.length ? '<span class="gc-speech-icon" title="Has original conversations" role="img" aria-label="Original conversations"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h14v10H8l-5 4V3Z"/></svg></span>' : '';
  return `<span class="hier-icon" style="color:${color}" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${HIER_SYMBOLS[symbol]}</svg></span>` + speech;
}
function renderHierarchy() {
  const el = $('#hier');
  if (!el) return;
  if (hierarchyDragging) { clearTimeout(hierTimer); hierTimer = setTimeout(renderHierarchy, 100); return; }
  if (hierRenaming) { clearTimeout(hierTimer); hierTimer = setTimeout(renderHierarchy, 150); return; }
  const q = $('#hsearch').value.trim().toLowerCase();
  const has = (s) => String(s || '').toLowerCase().includes(q);
  const inNest = new Map();                  // what a nest holds is shown inside it, not in its usual place
  for (const n of nests()) for (const k of n.items) inNest.set(k, n.id);
  const inStruct = new Map(), byKind = new Map(), rowOf = new Map();
  hierItems = [];
  for (const p of proxies.children) {
    const d = p.userData, a = d && d.actor;
    if (!d || (!a && !d.box)) continue;
    const name = a ? a.name : d.box.name, label = a ? hierLabel(a) : d.box.sign ? 'Sign: ' + d.box.sign.text.split('\n')[0] : blockLabel(d.box);
    const it = { p, name, label, kind: d.kind || 'prop', key: keyOf(p), match: !q || has(name) || has(label) || !!(a && has(a.cls)) };
    const st = a && d.source === 'map' && structures[actorStruct[a.name]];
    if (st && !st.dissolved) {                // with its structure, wherever that is
      if (!inStruct.has(st.name)) inStruct.set(st.name, []);
      inStruct.get(st.name).push(it);
      continue;
    }
    if (inNest.has(it.key)) { rowOf.set(it.key, it); continue; }
    if (!it.match) continue;
    if (!byKind.has(it.kind)) byKind.set(it.kind, []);
    byKind.get(it.kind).push(it);
  }
  // every object of a multiple selection is highlighted, as in Unity (not only the one clicked last)
  const picked = selected === groupPivot ? new Set(members()) : new Set(selected ? [selected] : []);
  const trash = ICON.trash, focus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/></svg>';
  const open = (k) => (q || hierOpen.has(k) ? 'open' : '');
  const inAttr = (nid) => (nid ? ` data-in="${escapeHtml(nid)}"` : '');
  const stateClass = (p) => `${objectHidden(p) ? ' hier-hidden' : ''}${selectionLocked(p) ? ' hier-locked' : ''}${p.userData.actor && edits.disabled?.[p.userData.actor.name] ? ' hier-inactive' : ''}`;
  const stateButtons = key => {
    const targets = stateTargets([key]), hidden = targets.length > 0 && targets.every(objectHidden), locked = targets.some(p => selectionLocked(p));
    return `<button class="hb hstate" data-view-key="${escapeHtml(key)}" data-view-state="hidden" data-view-value="${!hidden}" aria-pressed="${hidden}" aria-label="${hidden ? 'Show in Scene' : 'Hide in Scene'}" title="${hidden ? 'Show in Scene (and reveal hidden parents)' : 'Hide in Scene only; stays in game'}">${ICON[hidden ? 'eyeoff' : 'eye']}</button><button class="hb hstate" data-view-key="${escapeHtml(key)}" data-view-state="locked" data-view-value="${!locked}" aria-pressed="${locked}" aria-label="${locked ? 'Unlock selection' : 'Lock selection'}" title="${locked ? 'Unlock selection' : 'Lock selection against accidental edits'}">${ICON[locked ? 'lock' : 'unlock']}</button>`;
  };
  const row = (it, nid) => {
    const i = hierItems.push(it.p) - 1;
    const named = it.p.userData.actor && unquote(actorProp(it.p.userData.actor, 'FamiliarName') || '');
    return `<div class="hrow ${named ? 'hier-named ' : ''}${picked.has(it.p) ? 'on' : ''}${stateClass(it.p)}" data-hi="${i}" data-key="${escapeHtml(it.key)}" draggable="${!selectionLocked(it.p)}"${inAttr(nid)} title="${escapeHtml(it.label)} · ${escapeHtml(it.name)}${edits.disabled?.[it.name] ? ' · disabled in game' : ''}">${hierarchyIcon(it.kind, it.p.userData.actor)}<span class="hl">${escapeHtml(it.label)}</span><small>${escapeHtml(it.name)}</small>${stateButtons(it.key)}<button class="hb" data-hf="${i}" title="Focus (F)">${focus}</button><button class="hb del" data-hd="${i}" title="Delete (Del)" ${selectionLocked(it.p) ? 'disabled' : ''}>${trash}</button></div>`;
  };
  const rank = hierRank(), byRank = (a, b) => (rank.has(a) ? rank.get(a) : Infinity) - (rank.has(b) ? rank.get(b) : Infinity);
  const sortRows = (list) => list.sort((x, y) => byRank(x.key, y.key) || x.label.localeCompare(y.label) || x.name.localeCompare(y.name));
  const pieceRow = (st, pc, nid) => `<div class="hrow hpiece" data-piece="${escapeHtml(st.name + '|' + pc.id)}" draggable="${!selectionLocked(st.obj)}"${inAttr(nid)} title="${escapeHtml(pc.label)}: a piece of ${escapeHtml(st.label)}. Drag it out of the structure (or right click) to move it on its own.">${hierarchyIcon('piece')}<span class="hl">${escapeHtml(pc.label)}</span><small>piece</small></div>`;
  // a structure with what is inside it: its pieces (when it has more than one) and its objects
  const structNode = (st, nid) => {
    const all = inStruct.get(st.name) || [], objs = sortRows(all.filter((it) => it.match || has(st.label)));
    const pcs = piecesInside(st), pcsShown = pcs.length > 1 || (pcs.length && all.length) ? pcs.filter((pc) => !q || has(pc.label) || has(st.label)) : [];
    if (q && !objs.length && !pcsShown.length && !has(st.label)) return '';
    if (pcs.length <= 1 && !all.length) {      // a single piece on its own (one taken out of a structure): a piece, not an empty structure
      const i = hierItems.push(st.obj) - 1;
      const tip = `${st.label}: a single piece${st.pendingPiece ? ', taken out of its structure (on its own from the next Rebuild)' : ''}`;
      return `<div class="hrow hpiece-loose ${picked.has(st.obj) ? 'on' : ''}${stateClass(st.obj)}" data-hi="${i}" data-key="s:${escapeHtml(st.name)}" draggable="${!selectionLocked(st.obj)}"${inAttr(nid)} title="${escapeHtml(tip)}">${hierarchyIcon('piece')}<span class="hl">${escapeHtml(st.label)}</span><small>piece</small>${stateButtons('s:' + st.name)}<button class="hb" data-hf="${i}" title="Focus (F)">${focus}</button><button class="hb del" data-hd="${i}" title="Delete (Del)" ${selectionLocked(st.obj) ? 'disabled' : ''}>${trash}</button></div>`;
    }
    const i = hierItems.push(st.obj) - 1;
    const title = st.pendingPiece ? ` title="${escapeHtml(st.label)}: taken out of its structure, a structure of its own at the next Rebuild"` : '';
    return `<details data-hk="s:${escapeHtml(st.name)}" ${open('s:' + st.name)}><summary class="${picked.has(st.obj) ? 'on' : ''}${stateClass(st.obj)}" data-hi="${i}" data-key="s:${escapeHtml(st.name)}" draggable="${!selectionLocked(st.obj)}"${inAttr(nid)}${title}>${hierarchyIcon('structure')}<span class="hl">${escapeHtml(st.label)}</span><small>${pcsShown.length + objs.length}</small>${stateButtons('s:' + st.name)}<button class="hb" data-hf="${i}" title="Focus (F)">${focus}</button><button class="hb del" data-hd="${i}" title="Delete the whole structure (Del)" ${selectionLocked(st.obj) ? 'disabled' : ''}>${trash}</button></summary>${pcsShown.map((pc) => pieceRow(st, pc, nid)).join('')}${objs.map((it) => row(it, nid)).join('')}</details>`;
  };
  // a nest: what it holds, in the order it was put there (other nests too)
  const nestNode = (n, seen) => {
    if (seen.has(n.id)) return '';
    seen.add(n.id);
    let inner = '';
    for (const k of n.items) {
      if (k.startsWith('n:')) { const c = nestById(k.slice(2)); if (c) inner += nestNode(c, seen); }
      else if (k.startsWith('s:')) { const st = structures[k.slice(2)]; if (st && !st.dissolved && !poseOf(st).deleted) inner += structNode(st, n.id); }
      else { const it = rowOf.get(k); if (it && (it.match || has(n.label))) inner += row(it, n.id); }
    }
    if (q && !inner && !has(n.label)) return '';
    const on = (selected === groupPivot && groupPivot.userData.nest === n.id) || (!selected && hierFolderOn === n.id);
    const locked = nestLeaves(n).some(p => selectionLocked(p));
    return `<details data-hk="n:${escapeHtml(n.id)}" ${open('n:' + n.id)}><summary class="hnest ${on ? 'on' : ''}" data-nest="${escapeHtml(n.id)}" data-key="n:${escapeHtml(n.id)}" data-in="${escapeHtml(n.id)}" draggable="${!locked}" title="${escapeHtml(n.label)}: a nest, moved as one. Double click: focus. Drag objects in and out.">${hierarchyIcon('nest')}<span class="hl">${escapeHtml(n.label)}</span><small>${n.items.length}</small>${stateButtons('n:' + n.id)}<button class="hb" data-nf="${escapeHtml(n.id)}" title="Focus (F)">${focus}</button><button class="hb del" data-nd="${escapeHtml(n.id)}" title="Delete the nest and its contents (Del)" ${locked ? 'disabled' : ''}>${trash}</button></summary>${inner}</details>`;
  };
  let html = '';
  for (const n of nests().filter((x) => !inNest.has('n:' + x.id)).map((x, i) => [x, i]).sort((a, b) => byRank('n:' + a[0].id, 'n:' + b[0].id) || a[1] - b[1]).map(([x]) => x))
    html += nestNode(n, new Set());
  // the structures, by category
  const cats = new Map();
  let nStruct = 0;
  for (const st of Object.values(structures)) {
    if (poseOf(st).deleted || st.dissolved || inNest.has('s:' + st.name)) continue;
    const node = structNode(st, null);
    if (!node) continue;
    nStruct++;
    const c = st.category || 'Other';
    if (!cats.has(c)) cats.set(c, []);
    cats.get(c).push({ st, node });
  }
  const catNames = [...cats.keys()].sort((a, b) => (CATS.indexOf(a) + 1 || 99) - (CATS.indexOf(b) + 1 || 99));
  if (catNames.length) {
    html += `<details data-hk="structs" ${open('structs')}><summary>${hierarchyIcon('structure')}<span class="hl">Structures</span><small>${nStruct}</small></summary>`;
    for (const c of catNames) {
      const list = cats.get(c).sort((x, y) => byRank('s:' + x.st.name, 's:' + y.st.name) || x.st.label.localeCompare(y.st.label));
      html += `<details data-hk="c:${escapeHtml(c)}" ${open('c:' + c)}><summary>${hierarchyIcon('folder')}<span class="hl">${escapeHtml(c)}</span><small>${list.length}</small></summary>${list.map((x) => x.node).join('')}</details>`;
    }
    html += '</details>';
  }
  // the other objects, by kind
  for (const [k, title] of HIER_KINDS) {
    const list = byKind.get(k);
    if (!list || !list.length) continue;
    html += `<details data-hk="k:${k}" ${open('k:' + k)}><summary>${hierarchyIcon(k)}<span class="hl">${title}</span><small>${list.length}</small></summary>${sortRows(list).map((it) => row(it, null)).join('')}</details>`;
  }
  el.innerHTML = html || `<div class="hint">${q ? 'Nothing in this level has this name.' : 'Open a map.'}</div>`;
  for (const d of el.querySelectorAll('details')) d.addEventListener('toggle', () => { if (!q) (d.open ? hierOpen.add(d.dataset.hk) : hierOpen.delete(d.dataset.hk)); });
  for (const r of el.querySelectorAll('[data-hi]')) {
    const p = hierItems[+r.dataset.hi];
    r.addEventListener('click', (e) => {
      if (e.target.closest('.hb')) return;
      if (r.tagName === 'SUMMARY' && !e.target.closest('.hl')) return;        // the arrow opens and closes
      e.preventDefault();
      if (lkPicking) { lkPicked(p && (p.userData.actor || (p.userData.box && p.userData.box.mover ? lkActor(p.userData.box.name) : null)), null); return; }
      if (p && p.parent) {
        if (e.ctrlKey) toggleMulti(p);
        else if (!(e.shiftKey && hierRangeTo(r.dataset.key))) { select(p); hierAnchor = r.dataset.key; }
      }
    });
    r.addEventListener('dblclick', (e) => { e.preventDefault(); if (p && p.parent) { select(p); focusSelected(); } });
  }
  for (const b of el.querySelectorAll('[data-hf]')) b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const p = hierItems[+b.dataset.hf]; if (p) { select(p); focusSelected(); } };
  for (const b of el.querySelectorAll('[data-hd]')) b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const p = hierItems[+b.dataset.hd]; if (p) { select(p); deleteSelected(); } };
  for (const b of el.querySelectorAll('[data-view-state]')) b.onclick = e => { e.preventDefault(); e.stopPropagation(); setObjectView([b.dataset.viewKey], b.dataset.viewState, b.dataset.viewValue === 'true'); };
  // nests: a click picks all of it (Ctrl: adds it to the selection), a double click goes to it
  for (const r of el.querySelectorAll('[data-nest]')) {
    const id = r.dataset.nest;
    r.addEventListener('click', (e) => {
      if (e.target.closest('.hb') || !e.target.closest('.hl')) return;
      e.preventDefault();
      if (!e.ctrlKey) { if (!(e.shiftKey && hierRangeTo('n:' + id))) { selectNest(id); hierAnchor = 'n:' + id; if (!selected) hierFolderOn = id; } return; }
      const cur = selKeys(), k = 'n:' + id;
      selectKeys(cur.includes(k) ? cur.filter((x) => x !== k) : cur.concat([k]));
    });
    r.addEventListener('dblclick', (e) => { e.preventDefault(); selectNest(id); focusSelected(); });
  }
  for (const b of el.querySelectorAll('[data-nf]')) b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); selectNest(b.dataset.nf); focusSelected(); };
  for (const b of el.querySelectorAll('[data-nd]')) b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); selectNest(b.dataset.nd); if (selected === groupPivot) deleteSelected(); else deleteFolder(b.dataset.nd); };
  // a piece still inside its structure: shown where it is (the structure is what moves)
  for (const r of el.querySelectorAll('[data-piece]')) {
    const [g, id] = r.dataset.piece.split('|');
    const show = (go) => {
      const st = structures[g], pc = st && (st.pieces || []).find((x) => x.id === id);
      if (!pc) return;
      select(st.obj);
      showPieceBox(st, pc);
      if (go) focusPieceBox();
      status(`"${pc.label}" is part of "${st.label}": drag it out of the structure (or right click > Take out) to move it on its own.`);
    };
    r.addEventListener('click', (e) => { e.preventDefault(); show(false); });
    r.addEventListener('dblclick', (e) => { e.preventDefault(); show(true); });
  }
  const on = el.querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
  if (hierFlash && performance.now() < hierFlash.until) {
    const rows = [...hierFlash.keys].map((k) => el.querySelector(`[data-key="${CSS.escape(k)}"]`)).filter(Boolean);
    for (const r of rows) r.classList.add('hier-flash');
    if (rows[0]) {
      rows[0].scrollIntoView({ block: 'center' });
      const path = [];
      for (let d = rows[0].closest('details'); d; d = d.parentElement.closest('details')) {
        const s = d.querySelector(':scope > summary');
        if (s && s !== rows[0]) path.unshift(s.querySelector('.hl')?.textContent || '');
      }
      status(`${rows.length > 1 ? rows.length + ' things are' : 'It is'} now in ${path.length ? path.join(' › ') : 'the top of the list'} (highlighted in the Hierarchy).`, 'ok');
    }
    hierFlash = null;
  }
}
// the selected object's folders open in the Hierarchy
function revealInHierarchy(p) {
  if (!p) return;
  const d = p.userData;
  const openNests = (key) => {
    const seen = new Set();
    for (let n = parentNest(key); n && !seen.has(n.id); n = parentNest('n:' + n.id)) { seen.add(n.id); hierOpen.add('n:' + n.id); }
  };
  if (p === groupPivot) { if (d.nest) openNests('n:' + d.nest); return; }
  if (d.kind === 'structure') {
    hierOpen.add('structs'); hierOpen.add('c:' + (structures[d.name].category || 'Other'));
    openNests('s:' + d.name);
  } else if (d.actor && d.source === 'map' && structures[actorStruct[d.actor.name]]) {
    const st = structures[actorStruct[d.actor.name]];
    hierOpen.add('structs'); hierOpen.add('c:' + (st.category || 'Other')); hierOpen.add('s:' + st.name);
    openNests('s:' + st.name);
  } else {
    hierOpen.add('k:' + (d.kind || 'prop'));
    openNests(keyOf(p));
  }
}
$('#hsearch').addEventListener('input', renderHierarchy);
// ------------------------------- the Hierarchy's + (Gabby, 18 Oct 2026): folders named on the spot, and solids as
// in Unity (a cube, a wedge, a cylinder) to texture and shape; F2, Enter or right click > Rename name a folder
function currentFolder() {
  if (selected === groupPivot && groupPivot.userData.nest && nestById(groupPivot.userData.nest)) return groupPivot.userData.nest;
  return !selected && hierFolderOn && nestById(hierFolderOn) ? hierFolderOn : null;
}
function createFolder() {
  pushUndo();
  const up = currentFolder() && nestById(currentFolder());
  const n = newNest(nextNestLabel(), []);
  n.folder = true;                               // kept when it is empty
  if (up) { up.items.push('n:' + n.id); hierOpen.add('n:' + up.id); }
  setDirty();
  select(null);
  hierFolderOn = n.id;
  renderHierarchy();
  renameFolder(n.id);
}
function deleteFolder(id) {                      // an empty folder (one with things in it goes with them: Del)
  const n = nestById(id);
  if (!n || nestLeaves(n).length) return false;
  pushUndo();
  const gone = new Set(['n:' + id, ...nestsWithin(id).map((x) => 'n:' + x)]);
  edits.nests = nests().filter((x) => !gone.has('n:' + x.id));
  for (const x of nests()) x.items = x.items.filter((k) => !gone.has(k));
  hierFolderOn = null;
  setDirty();
  status(`Folder "${n.label}" deleted.`);
  return true;
}
function renameFolder(id) {
  const n = nestById(id);
  if (!n) return;
  if (hierRenaming && hierRenaming.done) hierRenaming.done(true);
  for (let up = parentNest('n:' + id), seen = new Set(); up && !seen.has(up.id); up = parentNest('n:' + up.id)) { seen.add(up.id); hierOpen.add('n:' + up.id); }
  const rowOf = () => $(`#hier summary[data-nest="${CSS.escape(id)}"]`);
  if (!rowOf()) { hierRenaming = null; renderHierarchy(); }
  const row = rowOf(), hl = row && row.querySelector('.hl');
  if (!hl) return;
  const input = document.createElement('input');
  input.className = 'hrename'; input.value = n.label; input.setAttribute('aria-label', 'Folder name'); input.spellcheck = false;
  hl.replaceWith(input);
  row.draggable = false;
  row.scrollIntoView({ block: 'nearest' });
  input.focus(); input.select();
  let over = false;
  const done = (keep) => {
    if (over) return;
    over = true;
    const v = input.value.trim();
    if (keep && v && v !== n.label) { pushUndo(); n.label = v; setDirty(); if (currentFolder() === id && selected === groupPivot) showDetails(); }
    const span = document.createElement('span');
    span.className = 'hl'; span.textContent = n.label;
    if (input.isConnected) input.replaceWith(span);
    // the click that ended it reaches its row before the Hierarchy is drawn again
    hierRenaming = { settling: true };
    const release = () => { if (hierRenaming && hierRenaming.settling) { hierRenaming = null; buildHierarchy(); } };
    window.addEventListener('pointerup', release, { once: true });
    setTimeout(release, 400);
  };
  hierRenaming = { id, done };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); done(true); $('#hier').focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); done(false); $('#hier').focus(); }
  });
  input.addEventListener('keyup', (e) => e.preventDefault());       // a space does not open or close the folder
  input.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  input.addEventListener('blur', () => done(true));
}
// a cube, a wedge or a cylinder where the view looks (on the floor there), into the folder chosen
function createSolid(shape) {
  const s = 128, r = new THREE.Raycaster();
  r.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = visibleHits(r.intersectObjects(world.children, true))[0];
  let c;
  if (hit && hit.distance < 4000) {
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    if (n.dot(r.ray.direction) > 0) n.negate();          // on the side the view sees
    c = hit.point.clone().addScaledVector(n, s / 2 + 1);
    if (n.y > 0.7) c.y = hit.point.y + s / 2;
  } else c = camera.position.clone().addScaledVector(r.ray.direction, 600);
  const u = UE(c);
  if (snap) for (const k of [0, 1]) u[k] = Math.round(u[k] / 8) * 8;
  pushUndo();
  const b = { name: nextName('UCEditBox'), shape, lo: u.map((v) => r1(v - s / 2)), hi: u.map((v) => r1(v + s / 2)), tex: lastBlockTex, solid: true };
  edits.boxes.push(b);
  const folder = currentFolder() && nestById(currentFolder());
  if (folder) { folder.items.push('b:' + b.name); hierOpen.add('n:' + folder.id); }
  setDirty();
  select(makeBoxProxy(b));
  if (camera.position.distanceTo(T(u)) < s * 1.3) focusSelected();     // the view was inside it: step back
  status(`${blockLabel(b)} added: W moves it, E turns it, R resizes it; drop a texture of the Browser on it. Rebuild puts it in the game.`, 'ok');
}
$('#hieradd').onclick = (e) => {
  if (!script) { status('Open a map first.', 'warn'); return; }
  const r = e.currentTarget.getBoundingClientRect();
  openMenu(r.left, r.bottom + 2, [{ label: 'Folder', run: createFolder }, { sep: true },
    ...BLOCK_SHAPES.map(([k, l]) => ({ label: l, run: () => createSolid(k) }))]);
};
showTab(bottomTab);
$('#search').addEventListener('input', buildPalette);

// friendly names of common classes (search works on both these and the class names)
const NAMES = {
  UCSoundFX: 'Sound effect', AmbientSound: 'Ambient sound', Trigger: 'Trigger', UCTriggerBox: 'Collision box', UCCutscene: 'Cutscene camera',
  UCTimer: 'Timer', UCEffectPoint: 'Effect point',
  CrateUnbreakableSmall: 'small crate', CrateUnbreakableMed: 'medium crate', CrateUnbreakableLarge: 'large crate',
  CrateBreakableMedGeneral: 'wooden crate', CrateBreakableMedCombat: 'military crate', CrateBreakableMedMedical: 'medical crate',
  BoxSmall: 'small box', BoxMedium: 'medium box', BoxLarge: 'large box', Barrel1: 'barrel', BarrelFire: 'burning barrel',
  CrateExplosiveSmall: 'explosive crate', Trashbag: 'trash bag', Trashbag2: 'trash bag 2',
  TrashCan1: 'trash can 1', TrashCan2: 'trash can 2', TrashCan3: 'trash can 3', TrashCan4: 'trash can 4', TrashPaper: 'paper litter',
  Mailbox: 'mailbox', RoadBlock: 'road barrier', SignFloor: 'wet floor sign', OfficeChair: 'office chair',
  Chair1: 'chair', ChairLeather: 'armchair', CouchLeather: 'couch', WHChairDining: 'elegant chair', CoffeeTable: 'coffee table',
  Pillow: 'pillow', Plant1: 'plant 1', Plant2: 'plant 2', Plant3: 'plant 3', Lamp1: 'lamp 1', Lamp2: 'lamp 2', Lamp3: 'lamp 3',
  WaterCooler: 'water cooler', VendingMachine: 'soda machine', CigaretteMachine: 'cigarette machine',
  ClothesRack: 'clothes rack', ComputerPersonal: 'computer', ComputerSecurity: 'security terminal', Phone: 'phone',
  ControlPanel: 'control panel', Switch1: 'switch 1', Switch2: 'switch 2', Valve: 'valve', Keypad1: 'keypad',
  Button1: 'button', SatelliteDish: 'satellite dish', FireExtinguisher: 'fire extinguisher', AlarmUnit: 'alarm', SecurityCamera: 'security camera',
  HKTukTuk: 'tuk tuk', HKHangingLantern: 'lantern', HKHangingLantern2: 'lantern 2', HKChair: 'Chinese chair', HKBuddha: 'Buddha',
  HKIncenseBurner: 'incense burner', HKBirdcage: 'birdcage', HKHangingPig: 'hanging pig', HangingChicken: 'hanging chicken',
  HKMarketLight: 'market light', Van: 'van', CarStripped: 'stripped car', Cart: 'cart', MedKit: 'medkit',
  Multitool: 'multitool', Lockpick: 'lockpick', Ammo10mm: '10mm ammo', Credits: 'credits', Sodacan: 'soda can',
  Candybar: 'candy bar', SoyFood: 'soy food', BioelectricCell: 'bioelectric cell', Light: 'light',
};

function startPlacing(item, button) {
  if (!script) return;
  soundBrowser?.clearSelection();
  cancelPlacing();
  placing = item;
  if (button) button.classList.add('active');
  ghostBody.geometry.dispose();
  ghostBody.geometry = item.box ? new THREE.BoxGeometry(item.size[0], item.size[2], item.size[1])
    : new THREE.CylinderGeometry(Math.max(4, item.radius), Math.max(4, item.radius), 2 * Math.max(4, item.height), 18);
  ghostBody.visible = true;
  if (item.prefab) {
    ghostBody.visible = false;
    prefabGhost(item.prefab).then((g) => { if (g && placing === item) ghost.add(g); });
  } else if (item.custom) {
    const model = modelFor({ cls: item.cls, props: window.__characters.propsOf(item.custom) }, 'added');
    if (model) { ghost.add(model); ghostBody.visible = false; }
  } else if (item.mesh) {
    meshInfo(item.mesh).then(() => {
      if (placing !== item) return;
      const model = modelFor({ cls: 'UCMeshDeco', props: item.preset }, 'added');
      if (model) { model.scale.setScalar(item.scale || 1); ghost.add(model); ghostBody.visible = false; }
    }).catch(() => {});
  } else if (!item.box && item.cls !== 'Light' && item.cls !== 'Spotlight') {
    loadPaletteModel(item.cls).then(() => {
      if (placing !== item) return;
      const model = modelFor({ cls: item.cls }, 'palette');
      if (model) { ghost.add(model); ghostBody.visible = false; }
    });
  }
  status(`Click a ${item.sign ? 'wall' : 'floor or a wall'} to place: ${item.sign ? 'sign' : item.box ? 'block' : item.prefab ? item.prefab.label : itemLabel(item)}  (Esc cancels)`);
}
function startDraw(kind, button) {
  if (!script || !DRAW_LABELS[kind]) return;
  if (document.activeElement) document.activeElement.blur();      // Enter ends the drawing, not a button
  soundBrowser?.clearSelection();
  cancelPlacing();
  placing = { draw: kind, radius: 0, height: 0 };                  // no ghost: the shape itself follows the mouse
  if (button) button.classList.add('active');
  ghost.visible = false;
  drawTools.begin(kind);
}
function finishDraw() {
  const p = drawTools.finish(new Set((edits.drawn || []).map((x) => x.name)));
  cancelPlacing();
  if (!p) return;
  pushUndo();
  (edits.drawn = edits.drawn || []).push(p);
  setDirty(); rebuildProxies();
  const q = proxies.children.find((x) => x.userData.drawn === p);
  if (q) select(q);
  log(p.kind === 'stairs' || p.kind === 'roof'
    ? `${DRAW_LABELS[p.kind]} drawn: shape, sizes and textures in the Inspector, then Rebuild.`
    : `${DRAW_LABELS[p.kind]} drawn (${p.pts.length} points): set its sizes and textures in the Inspector, then Rebuild.`, 'ok');
}
function cancelPlacing() {
  try { drawTools.cancel(); } catch (_) { /* before the tools are made */ }
  placing = null;
  ghost.visible = false;
  for (const c of [...ghost.children]) if (c !== ghostBody) ghost.remove(c);
  for (const b of document.querySelectorAll('.item.active')) b.classList.remove('active');
}
// what is not built yet counts as a surface too: drawn walls, floors, stairs, and the solid blocks (Crypt Test,
// 20 Oct 2026: a lever placed on a wall just drawn went through it, onto the room's wall behind)
function pendingSurfaces() {
  return proxies.children.filter((p) => p.userData.drawn || (p.userData.box && ['solid', 'detail', 'mover'].includes(boxKind(p.userData.box))));
}
function placeAt(e) {
  const ray = mouseRay(e);
  const hits = ray.intersectObjects(worldMeshes, false)
    .concat(ray.intersectObjects(pendingSurfaces(), true).filter((h) => h.object.isMesh && h.face))
    .sort((a, b) => a.distance - b.distance);
  const hit = visibleHits(hits)[0];
  if (!hit) return null;
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if (n.dot(ray.ray.direction) > 0) n.negate();
  const p = hit.point.clone();
  const half = placing.box ? placing.size[2] / 2 : Math.max(0, placing.height);
  const rad = placing.box ? placing.size[0] / 2 : placing.radius;
  if (n.y > 0.6) p.y += half + 0.5;                       // on a floor
  else if (n.y < -0.6) p.y -= half + 0.5;                 // under a ceiling
  else p.addScaledVector(new THREE.Vector3(n.x, 0, n.z).normalize(), rad + 0.5);   // against a wall
  if (snap) {                               // a sign keeps its distance from its wall: no snap across it
    if (!placing.sign || Math.abs(n.x) < 0.6) p.x = Math.round(p.x / 8) * 8;
    if (!placing.sign || Math.abs(n.z) < 0.6) p.z = Math.round(p.z / 8) * 8;
  }
  return { p, n, hit: hit.point.clone(), tex: hit.object.userData.tex };
}
function movePlacing(e) {
  if (placing && placing.draw) {           // drawing: the shape follows the mouse
    const rd = placeAt(e);
    ghost.visible = false;
    drawTools.hover(rd ? UE(rd.hit) : null, e.shiftKey, rd ? rd.n.y > 0.6 : false);
    return;
  }
  const r = placeAt(e);
  ghost.visible = !!r;
  if (r) {
    ghost.position.copy(r.p);
    if (placing.prefab) ghost.rotation.y = yawToRad(prefabYaw(placing.prefab, r.n) + (placing.turn || 0));
    else if (!placing.box) ghost.rotation.y = (Math.abs(r.n.y) < 0.6 ? -Math.atan2(r.n.z, r.n.x) : cam.yaw + Math.PI) - yawToRad(placing.turn || 0);
  }
}
// a piece keeps its own orientation on a floor; against a wall its front (if it has one) faces out
function prefabYaw(clip, n) {
  if (Math.abs(n.y) >= 0.6 || clip.facing === null || clip.facing === undefined) return 0;
  return ((radToYaw(-Math.atan2(n.z, n.x)) - clip.facing) % YAW + YAW) % YAW;
}
function finishPlacing(e) {
  const r = placeAt(e);
  if (!r) return;
  if (placing.draw) {                      // one more point of a wall, road, floor or roof
    if (drawTools.addPoint(UE(r.hit), e.shiftKey, r.n.y > 0.6) === 'done') finishDraw();
    return;
  }
  pushUndo();
  if (placing.prefab) {
    const clip = placing.prefab, c = UE(r.p), yaw = (prefabYaw(clip, r.n) + (placing.turn || 0)) % YAW;
    const pe = { pid: nextPid(), prefab: clip.id, label: clip.label, source: clip.source, pivot: clip.pivot, rotatable: clip.rotatable !== false, ...moverFields(clip),
                 offset: [Math.round(c[0] - clip.pivot[0]), Math.round(c[1] - clip.pivot[1]), Math.round(c[2] - 0.5 - clip.pivot[2])], yaw };
    edits.prefabs.push(pe);
    setDirty(); rebuildProxies();
    if (structures['paste~' + pe.pid]) select(structures['paste~' + pe.pid].obj);
    log(clip.mover ? `Placed ${clip.mover.kind}: adjust its mover settings in the Inspector, then Rebuild to play.`
      : `Placed "${clip.label}" (from ${clip.source}): it becomes part of the map with Rebuild.`);
  } else if (placing.route) {               // a patrol route being drawn: one more point, and on to the next
    const a = allActors().find((x) => x.name === placing.route);
    if (a) addRoutePoint(a, UE(r.p));
    return;
  } else if (placing.sign) {
    // a sign: on a wall it faces out of it, on a floor it stands facing the camera
    const c = UE(r.p), n = UE(r.n);
    let face;
    if (Math.abs(n[2]) < 0.6) face = Math.abs(n[0]) >= Math.abs(n[1]) ? (n[0] > 0 ? '+x' : '-x') : (n[1] > 0 ? '+y' : '-y');
    else { const f = UE(forward()); face = Math.abs(f[0]) >= Math.abs(f[1]) ? (f[0] > 0 ? '-x' : '+x') : (f[1] > 0 ? '-y' : '+y'); }
    const b = { name: nextName('UCEditBox'), lo: [0, 0, 0], hi: [0, 0, 0], tex: SIGN_FRAME, solid: true,
                sign: { text: 'YOUR TEXT', style: 'unatco', face } };
    signShape(b, c, 128, 64, 6);
    if (Math.abs(n[2]) < 0.6) {              // flat against the wall: its back on the wall
      const k = 'xy'.indexOf(face[1]), d = b.hi[k] - b.lo[k];
      const wall = c[k] - (face[0] === '+' ? 1 : -1) * 3.5;
      b.lo[k] = face[0] === '+' ? wall : wall - d; b.hi[k] = b.lo[k] + d;
    }
    edits.boxes.push(b);
    setDirty();
    select(makeBoxProxy(b));
    updateSignTexture(b).catch((e2) => log('Sign: ' + e2.message, 'bad'));
  } else if (placing.water || placing.portal) {
    const b = placing.water ? waterBox(r) : portalBox(r);
    if (!b) { status(placing.water ? 'Click a floor for the pool.' : 'Click the floor inside a doorway (walls on both sides, a top).', 'warn'); return; }
    edits.boxes.push(b);
    setDirty();
    select(makeBoxProxy(b));
    log(placing.water ? 'Pool: after Rebuild the water is a zone of its own (JC swims in it). Resize it with R, choose the liquid in its panel.'
      : `Zone portal ${Math.round(Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1]))} x ${Math.round(b.hi[2] - b.lo[2])}: put one in every doorway of the room, then a Zone (Objects > Zones) inside it.`, 'ok');
  } else if (placing.hole) {
    const b = holeBox(r);
    edits.boxes.push(b);
    setDirty();
    select(makeBoxProxy(b));
    log(`Hole ${Math.round(b.hi[0] - b.lo[0])} x ${Math.round(b.hi[1] - b.lo[1])} x ${Math.round(b.hi[2] - b.lo[2])}: it cuts through what it touches at Rebuild (resize it with R or in the panel). Its sides take ${b.tex}, the texture of the surface you clicked: click its picture in the panel to choose another.`, 'ok');
  } else if (placing.box) {
    const c = UE(r.p), s = placing.size;
    const b = { name: nextName('UCEditBox'), lo: [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2], hi: [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2],
                tex: placing.tex || 'ClenGreyCncrt_A', solid: true };
    edits.boxes.push(b);
    setDirty();
    select(makeBoxProxy(b));
  } else {
    const facing = ((Math.abs(r.n.y) < 0.6 ? radToYaw(-Math.atan2(r.n.z, r.n.x)) : radToYaw(-(cam.yaw + Math.PI))) + (placing.turn || 0)) % YAW;
    const isLight = placing.cls === 'Light' || placing.cls === 'Spotlight', spot = placing.cls === 'Spotlight';
    const e2 = { name: nextName('UCEdit'), cls: placing.cls, loc: UE(r.p), rot: [spot ? -16384 : 0, facing, 0], radius: placing.radius, height: placing.height,
                 props: isLight ? Object.assign(lightProps({}), spot ? { LightEffect: 'LE_Spotlight', LightCone: 64 } : {}) : {} };
    if (placing.cls === 'UCEffectPoint') {     // its arrow out of the wall, floor or ceiling clicked
      const fr = normalToRotation([r.n.x, r.n.z, r.n.y], facing);
      e2.rot = [fr.pitch, fr.yaw, 0];
    }
    if (placing.preset) {               // a map exit, an arrival point (Links): their properties, a tag of their own
      e2.props = Object.assign({}, placing.preset);
      if (e2.props.Tag === 'Arrival') e2.props.Tag = nextTag('Arrival');
      if (e2.props.Tag === 'SoundFX') e2.props.Tag = nextTag('SoundFX');
    }
    if (placing.mesh) {                 // a model: its cylinder at DrawScale 1, its size by the editor's scale (UC_SCALE)
      e2.radius = placing.base.r;
      e2.height = placing.base.h;
      if (Math.abs((placing.scale || 1) - 1) > 1e-3) e2.scale = placing.scale;
    }
    if (placing.custom) {               // a character of the Character Creator: its look, faction, weapons; its own BindName
      e2.custom = placing.custom;
      e2.kind = 'pawn';
      e2.bind = 'UCEd_' + e2.name;
      e2.props = Object.assign(window.__characters.propsOf(placing.custom), { BindName: `"${e2.bind}"` });
    }
    edits.added.push(e2);
    setDirty();
    select(makeProxy(Object.assign({ kind: addedKind(placing.cls) }, e2, { light: isLight ? { hue: 32, sat: 160 } : null }), 'added'));
    if (placing.preset && 'URL' in placing.preset) log('Map exit placed: choose where it leads in its Properties (Leads to).', 'ok');
    // a script of Tools > Scripts: what sets it off, asked at once (its icon is small to find again later)
    if (/Scripts\.(?!UC[WA]_)\w+$/.test(placing.cls)) setTimeout(((scriptName) => () => {
      const c = $('#lkconnect');
      if (!c) return;
      c.click();
      status(`Script ${scriptName} placed: now click what sets it off (a lever, a button, a trigger zone), or Esc to do it later (🔗 Connect to... in its Properties).`);
    })(placing.cls.split('.').pop()), 80);
    if (placing.cls === 'UCSoundFX' || placing.cls === 'AmbientSound') {     // its sound, chosen at once
      const prop = placing.cls === 'UCSoundFX' ? 'FXSound' : 'AmbientSound', who = e2, trig = e2.props.bOnTouch === 'False';
      const use = (name) => {
        if (!name) return;
        setProp(who, prop, `Sound'${name}'`);
        const q = proxyOf(who.name);
        if (q) select(q);
        if (trig) log(`Sound effect ${who.props.Tag}: put this Tag in the Event of a door, a button, a keypad or a trigger (their Properties) and it plays when they do.`, 'ok');
      };
      if (placing.sound) use(placing.sound);         // dragged from the browser's sounds: that one
      else pickSound('', use);
    }
  }
  if (!e.shiftKey) cancelPlacing();          // Shift+click keeps placing copies
}
$('#addbox').onclick = () => startPlacing({ box: true, size: [128, 128, 16], tex: 'ClenGreyCncrt_A' }, $('#addbox'));
for (const b of document.querySelectorAll('[data-draw]')) b.onclick = () => startDraw(b.dataset.draw, b);
$('#addhole').onclick = () => {
  startPlacing({ box: true, hole: true, size: [64, 64, 112] }, $('#addhole'));
  status('Click a wall for a doorway (on the floor below), a floor for a pit, a ceiling for an opening (Esc cancels)');
};

// ---------------------------------------------------------------- Animation: keyframes of any object (editor/motions.py)
// Like Premiere's Motion (rows Position, Rotation, Scale with their keys) and Unity's Animation window (a
// timeline with a playhead). With the panel open, what is moved with the gizmo becomes a key at the playhead.
// Doors, elevators and moving blocks keep the engine's own keys (up to 8: who stands on them moves with
// them); every other object is moved by the mod's UCMotion. Interactions play them (Play its animation,
// Play it backwards, Stop) and can start when one has finished.
const ANIM_CURVES = [[0, 'Linear', 'Straight to the next key at one speed'], [1, 'Smooth', 'Through this key without slowing down'],
  [2, 'Ease in', 'At rest at this key: it starts slowly from it'], [3, 'Ease out', 'It slows down to a stop at the next key'],
  [4, 'Hold', 'It stays until the next key, then jumps']];
const ANIM_TRACKS = [['pos', 'Position', 3], ['rot', 'Rotation', 3], ['scale', 'Scale', 1]];
const animBox = $('#animbox');
let anim = null;              // {name, p, mover, base: {pos, yaw, scale}, t, sel: [track, i] | null, playing, dir}
function motionOf(name, create) {
  edits.motions = edits.motions || {};
  if (!edits.motions[name] && create) edits.motions[name] = { pos: [], rot: [], scale: [], mode: 'once', autoplay: false };
  return edits.motions[name] || null;
}
function motionLength(m) { return m ? Math.max(0, ...['pos', 'rot', 'scale'].flatMap((k) => (m[k] || []).map((x) => +x.t || 0))) : 0; }
// The keys, as UCMotion moves an object in the game: through a smooth key with the speed its neighbours give (a
// Catmull-Rom spline in time), along a Linear step with its speed; at rest at the first and the last key (a loop
// whose last key is its first goes on through it), at an Ease in, at the key an Ease out goes to, at a Hold.
function animComp(k, c) { return Array.isArray(k.v) ? +k.v[c] : +k.v; }
function animCloses(keys, c, loop, len) {
  const n = keys.length;
  return loop && n >= 3 && keys[0].t <= 0.001 && Math.abs(keys[n - 1].t - len) <= 0.001 && animComp(keys[0], c) === animComp(keys[n - 1], c);
}
function animSlope(keys, i, c, loop, len) {     // UCMotion.Slope: how fast component c changes at key i
  const n = keys.length, E = (j) => keys[j].e ?? 1, V = (j) => animComp(keys[j], c), Tm = (j) => keys[j].t;
  let ia = i - 1, ib = i + 1, ta = 0, tb = 0, eOut = E(i);
  if ((i === 0 || i === n - 1) && animCloses(keys, c, loop, len)) {
    ia = n - 2; ib = 1; eOut = E(0);
    if (i === 0) ta = -len; else tb = len;
  }
  const bIn = ia >= 0, bOut = ib < n, eIn = bIn ? E(ia) : 1;
  if (eOut === 2 || eOut === 4 || (bIn && eIn === 3)) return 0;
  if (bIn && eIn === 0) return (V(i) - V(ia)) / Math.max(0.001, Tm(i) - Tm(ia) - ta);
  if (bOut && eOut === 0) return (V(ib) - V(i)) / Math.max(0.001, Tm(ib) + tb - Tm(i));
  if (bIn && bOut && eIn !== 4) return (V(ib) - V(ia)) / Math.max(0.001, Tm(ib) + tb - Tm(ia) - ta);
  if (bIn && bOut) return (V(ib) - V(i)) / Math.max(0.001, Tm(ib) + tb - Tm(i));
  return 0;
}
function animValue(keys, i, c, t, loop, len) {  // UCMotion.Value: between key i and the next, a cubic with their speeds
  const d = Math.max(0.001, keys[i + 1].t - keys[i].t), u = Math.max(0, Math.min(1, (t - keys[i].t) / d));
  const p0 = animComp(keys[i], c), p1 = animComp(keys[i + 1], c), e = keys[i].e ?? 1;
  if (e === 4) return p0;
  if (e === 0) return p0 + (p1 - p0) * u;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * d * animSlope(keys, i, c, loop, len)
    + (3 * u2 - 2 * u3) * p1 + (u3 - u2) * d * animSlope(keys, i + 1, c, loop, len);
}
function sampleTrack(keys, t, size, loop = false, len = 0) {     // as UCMotion.Apply does in the game
  if (!keys || !keys.length) return size === 1 ? 1 : [0, 0, 0];
  if (t <= keys[0].t) return keys[0].v;
  let i = keys.length - 1;
  while (i > 0 && keys[i].t > t) i--;
  if (i >= keys.length - 1) return keys[keys.length - 1].v;
  return size === 1 ? animValue(keys, i, 0, t, loop, len) : [0, 1, 2].map((c) => animValue(keys, i, c, t, loop, len));
}
// A door, an elevator, a moving block, as the engine moves it (motions.py mover_keys, mover_glide): a key at every
// time of its tracks (at most 8), straight between them, all gliding (eased in and out: it stops at each) or all
// at one speed (Linear keys; when the curves differ, the one that rules most of its time).
function animLinear(keys, t, size) {
  if (!keys || !keys.length) return size === 1 ? 1 : [0, 0, 0];
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    if (t > keys[i + 1].t) continue;
    const u = keys[i + 1].t <= keys[i].t ? 0 : (t - keys[i].t) / (keys[i + 1].t - keys[i].t);
    return size === 1 ? keys[i].v + (keys[i + 1].v - keys[i].v) * u : keys[i].v.map((a, k) => a + (keys[i + 1].v[k] - a) * u);
  }
  return keys[keys.length - 1].v;
}
function moverGlide(m) {
  let eased = 0, linear = 0;
  for (const tr of ['pos', 'rot']) {
    const keys = (m && m[tr]) || [];
    for (let i = 0; i + 1 < keys.length; i++) {
      const d = Math.max(0, keys[i + 1].t - keys[i].t);
      if ((keys[i].e ?? 1) === 0) linear += d; else eased += d;
    }
  }
  return eased >= linear;
}
function moverPose(m, t) {
  const times = [...new Set([0, ...['pos', 'rot'].flatMap((k) => (m[k] || []).map((x) => Math.round(x.t * 1000) / 1000))])].sort((a, b) => a - b).slice(0, 8);
  const at = (s) => ({ pos: animLinear(m.pos, s, 3), rot: animLinear(m.rot, s, 3), scale: 1 });
  const start = [0];              // when it reaches each key: every step takes at least 0.05 s (UCMotion's Seg)
  for (let j = 1; j < times.length; j++) start.push(start[j - 1] + Math.max(0.05, times[j] - times[j - 1]));
  let j = 0;
  while (j < times.length - 1 && start[j + 1] <= t) j++;
  if (j >= times.length - 1 || t <= start[0]) return at(times[j]);
  let u = (t - start[j]) / (start[j + 1] - start[j]);
  if (moverGlide(m)) u = u * u * (3 - 2 * u);
  const a = at(times[j]), b = at(times[j + 1]);
  return { pos: a.pos.map((v, k) => v + (b.pos[k] - v) * u), rot: a.rot.map((v, k) => v + (b.rot[k] - v) * u), scale: 1 };
}
function animIsMover(p) { return !!(p && (p.userData.kind === 'mover' || (p.userData.box && p.userData.box.mover) || /Mover/.test((p.userData.actor || {}).cls || ''))); }
function animNameOf(p) { return p.userData.box ? p.userData.box.name : p.userData.actor.name; }
function animPose(t) {
  const m = motionOf(anim.name) || {};
  if (anim.mover) return moverPose(m, t);
  const loop = m.mode === 'loop', len = motionLength(m);
  return { pos: sampleTrack(m.pos, t, 3, loop, len), rot: sampleTrack(m.rot, t, 3, loop, len), scale: sampleTrack(m.scale, t, 1, loop, len) };
}
function animApply(t) {
  const p = anim.p, b = anim.base, q = animPose(t);
  p.position.copy(T([b.pos[0] + q.pos[0], b.pos[1] + q.pos[1], b.pos[2] + q.pos[2]]));
  p.rotation.y = yawToRad(b.yaw + q.rot[1]);
  p.rotation.z = q.rot[0] * 2 * Math.PI / YAW;       // pitch and roll: a preview (the game turns it exactly)
  p.rotation.x = q.rot[2] * 2 * Math.PI / YAW;
  if (!anim.mover) p.scale.setScalar(b.scale * q.scale);
}
function animKeyTimes(m) { return new Set(['pos', 'rot'].flatMap((k) => (m[k] || []).map((x) => Math.round(x.t * 1000) / 1000))); }
function animSetKey(track, t, v) {
  const m = motionOf(anim.name, true);
  const keys = m[track] = m[track] || [];
  t = Math.max(0, Math.round(t * 100) / 100);
  const e = anim.mover && !moverGlide(m) ? 0 : 1;      // a mover's new keys move as its others (one way for all)
  if (!keys.length && t > 0.001) keys.push({ t: 0, v: track === 'scale' ? 1 : [0, 0, 0], e });   // where it rests
  const k = keys.find((x) => Math.abs(x.t - t) < 0.011);
  if (k) k.v = v;
  else {
    if (anim.mover && track !== 'scale' && !animKeyTimes(m).has(t) && animKeyTimes(m).size >= 8) {
      status('A door, an elevator or a moving block has at most 8 keys (the engine\'s): move or delete one first.', 'warn');
      return false;
    }
    keys.push({ t, v, e });
    keys.sort((a, b) => a.t - b.t);
  }
  return true;
}
// the gizmo moved the object: keys at the playhead for what changed
function animRecord() {
  const p = anim.p, b = anim.base, q = animPose(anim.t), cur = UE(p.position);
  const dp = [r1(cur[0] - b.pos[0]), r1(cur[1] - b.pos[1]), r1(cur[2] - b.pos[2])];
  let dy = (radToYaw(p.rotation.y) - ((b.yaw + q.rot[1]) % YAW + YAW) % YAW) % YAW;
  if (dy > YAW / 2) dy -= YAW;
  if (dy < -YAW / 2) dy += YAW;
  pushUndo();
  if (dp.some((v, k) => Math.abs(v - q.pos[k]) > 0.05)) animSetKey('pos', anim.t, dp);
  if (Math.abs(dy) > 1) animSetKey('rot', anim.t, [q.rot[0], Math.round(q.rot[1] + dy), q.rot[2]]);
  if (!anim.mover && Math.abs(p.scale.x / b.scale - q.scale) > 0.001) animSetKey('scale', anim.t, Math.round(p.scale.x / b.scale * 1000) / 1000);
  setDirty();
  renderAnim();
  animApply(anim.t);
}
function openAnim(p) {
  if (!requireUnlocked(p)) return;
  if (!p) return;
  if (anim) closeAnim();
  if (p.userData.box && !p.userData.box.mover) {
    if (p.userData.box.hole || p.userData.box.water || p.userData.box.portal) { log('Holes, water and portals cannot move: a solid or detail block can.', 'warn'); return; }
    pushUndo();
    p.userData.box.mover = true;              // a block that moves is a mover (a moving block)
    setDirty();
    log(`${p.userData.box.name} is now a moving block (a mover): it moves in the game as you animate it, carrying JC.`, 'ok');
  }
  const a = p.userData.actor;
  anim = { name: animNameOf(p), p, mover: animIsMover(p), t: 0, sel: null, playing: false, dir: 1,
           base: { pos: UE(p.position), yaw: radToYaw(p.rotation.y), scale: p.userData.box ? 1 : p.scale.x || 1 } };
  if (a && /^(Light|Spotlight)$/.test(a.cls)) log('A light that moves is made non-static at Rebuild.', 'ok');
  renderAnim();
  animApply(0);
}
function closeAnim() {
  if (!anim) return;
  anim.playing = false;
  animHandles(true);
  const p = anim.p, b = anim.base;
  if (p.parent) {
    p.position.copy(T(b.pos));
    p.rotation.set(0, yawToRad(b.yaw), 0);
    if (!anim.mover) p.scale.setScalar(b.scale);
  }
  anim = null;
  animBox.style.display = 'none';
  animBox.innerHTML = '';
}
function animPlay(dir) {
  const m = motionOf(anim.name);
  const len = motionLength(m);
  if (!m || len <= 0) { status('Make two keys first: move the object at another time of the timeline.', 'warn'); return; }
  anim.playing = true;
  anim.dir = dir;
  let t = anim.t;
  if (dir > 0 && t >= len) t = 0;
  if (dir < 0 && t <= 0) t = len;
  let last = performance.now();
  const step = (now) => {
    if (!anim || !anim.playing) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt * anim.dir;
    const mode = m.mode || 'once';
    if (t >= len || t <= 0) {
      if (mode === 'loop' && !anim.mover) t = anim.dir > 0 ? t - len : t + len;
      else if (mode === 'pingpong' || mode === 'loop') { t = Math.max(0, Math.min(len, t)); anim.dir = -anim.dir; }
      else { t = Math.max(0, Math.min(len, t)); anim.playing = false; }
    }
    anim.t = t;
    animApply(t);
    animPlayhead();
    if (anim.playing) requestAnimationFrame(step); else renderAnim();
  };
  requestAnimationFrame(step);
  renderAnim();
}
function animPlayhead() {
  const ph = $('#anplayhead'), tl = $('#antl');
  if (!ph || !tl) return;
  ph.style.left = (anim.t / +tl.dataset.max * 100) + '%';
  const tt = $('#antime');
  if (tt) tt.textContent = anim.t.toFixed(2) + ' s';
}
// while it plays, the object is seen as in the game: no gizmo, no outline
function animHandles(on) {
  tc.visible = on;
  if (anim && anim.p.userData.body) anim.p.userData.body.visible = on && !!anim.p.userData.model;
}
function renderAnim() {
  if (!anim) return;
  animHandles(!anim.playing);
  const m = motionOf(anim.name) || { pos: [], rot: [], scale: [], mode: 'once' };
  const len = motionLength(m), max = Math.max(5, Math.ceil(len + 1));
  const q = animPose(anim.t);
  const label = anim.p.userData.actor ? hierLabel(anim.p.userData.actor) : anim.name;
  const sel = anim.sel && (m[anim.sel[0]] || [])[anim.sel[1]];
  // a mover moves one way through all its keys: one choice for it, and what its keys ask that the game cannot do
  const glide = anim.mover && moverGlide(m);
  const curves = new Set(['pos', 'rot'].flatMap((tr) => (m[tr] || []).slice(0, -1).map((k) => k.e ?? 1)));
  const moverOdd = anim.mover && ((curves.has(0) && curves.size > 1) || [2, 3, 4].some((e) => curves.has(e)));
  const val = (track, k) => (track === 'scale' ? Math.round(q.scale * 1000) / 1000 : Math.round((track === 'rot' ? q.rot[k] * 360 / YAW : q.pos[k]) * 10) / 10);
  const rows = ANIM_TRACKS.map(([tr, name, n]) => {
    const off = anim.mover && tr === 'scale';
    const fields = n === 1 ? `<input type="number" data-anv="${tr}" data-k="0" value="${val(tr, 0)}" step="0.05" style="width:58px" ${off ? 'disabled' : ''}>`
      : (tr === 'pos' ? ['X', 'Y', 'Z'] : ['Pitch', 'Yaw', 'Roll']).map((lab2, k) => `<input type="number" data-anv="${tr}" data-k="${k}" value="${val(tr, k)}" step="${tr === 'rot' ? 15 : 8}" title="${lab2}${tr === 'rot' ? ' (degrees; 360 = a whole turn)' : ' (units from where it stands)'}" style="width:58px">`).join('');
    const keys = (m[tr] || []).map((k, i) => `<span class="an-key ${anim.sel && anim.sel[0] === tr && anim.sel[1] === i ? 'on' : ''}" data-ank="${tr}" data-i="${i}" style="left:${k.t / max * 100}%" title="${k.t.toFixed(2)} s · ${ANIM_CURVES[k.e ?? 1][1]}"></span>`).join('');
    return [`<div class="an-left ${off ? 'off' : ''}"><span class="an-name">${name}</span>${fields}<button data-ankey="${tr}" title="A key here (or take it away)" ${off ? 'disabled' : ''}>◆</button></div>`,
      `<div class="an-track ${off ? 'off' : ''}" data-antr="${tr}">${keys}</div>`];
  });
  const ticks = Array.from({ length: max + 1 }, (_, s) => `<span style="left:${s / max * 100}%">${s}s</span>`).join('');
  animBox.innerHTML = `<div class="row" style="flex-wrap:wrap;row-gap:4px"><b style="margin-right:6px">Animation · ${escapeHtml(label)}</b>
      <button id="anplay" title="Play">${anim.playing && anim.dir > 0 ? '❚❚' : '▶'}</button><button id="anback" title="Play backwards">◀</button><button id="anstop" title="Stop, back to the start">■</button>
      <span id="antime" class="hint" style="margin:0 6px;min-width:52px">${anim.t.toFixed(2)} s</span>
      <select id="anmode" title="What happens at the end"><option value="once" ${m.mode === 'once' ? 'selected' : ''}>Once</option><option value="loop" ${m.mode === 'loop' ? 'selected' : ''}>Loop</option><option value="pingpong" ${m.mode === 'pingpong' ? 'selected' : ''}>Back and forth</option></select>
      <label style="width:auto" title="It starts when the map starts (else an interaction plays it)"><input type="checkbox" id="anauto" ${m.autoplay ? 'checked' : ''}> at the start</label>
      <span class="hint" style="margin:0 6px">${len.toFixed(1)} s${anim.mover ? ' · door / elevator / moving block: up to 8 keys, who stands on it moves with it' : ''}</span>
      ${anim.mover ? `<select id="anglide" title="The engine moves a door, an elevator or a moving block one way through all its keys"><option value="1" ${glide ? 'selected' : ''}>Glide (eases in and out, stops at every key)</option><option value="0" ${glide ? '' : 'selected'}>Constant speed</option></select>` : ''}
      <span style="flex:1"></span>
      ${sel && !anim.mover ? `<label style="width:auto">Curve</label><select id="ancurve">${ANIM_CURVES.map(([v, l, tip]) => `<option value="${v}" title="${tip}" ${v === (sel.e ?? 1) ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}${sel ? '<button id="ankdel" title="Delete this key">Delete key</button>' : ''}
      <button id="anclear" title="Take the animation away">Clear</button><button id="anclose">Close</button></div>
    ${moverOdd ? `<div class="hint" style="margin:2px 0 0;color:var(--warn)">Its keys have different curves (or Ease in, Ease out, Hold), which the game cannot do for a door, an elevator or a moving block: it ${glide ? 'glides through all of them' : 'goes at a constant speed'}, as shown here. Pick one above to make them all the same.</div>` : ''}
    <div class="hint" style="margin:2px 0 6px">Move the playhead, then move, turn${anim.mover ? '' : ' or scale'} the object with the gizmo (W, E${anim.mover ? '' : ', R'}) or type its values: each change is a key at that time. Drag a key to move it in time. Then play it from an interaction (<i>Then... → Play its animation</i>) or tick <i>at the start</i>.</div>
    <div class="an-grid"><div class="an-lefts"><div class="an-ticks-pad"></div>${rows.map((r) => r[0]).join('')}</div>
      <div id="antl" class="an-tl" data-max="${max}"><div class="an-ticks">${ticks}</div>${rows.map((r) => r[1]).join('')}<div id="anplayhead" class="an-ph" style="left:${anim.t / max * 100}%"></div></div></div>`;
  animBox.style.display = 'block';
  wireAnim2(m, max);
}
function wireAnim2(m, max) {
  const change = (fn) => { pushUndo(); fn(); setDirty(); renderAnim(); animApply(anim.t); };
  $('#anplay').onclick = () => { if (anim.playing && anim.dir > 0) { anim.playing = false; renderAnim(); } else animPlay(1); };
  $('#anback').onclick = () => animPlay(-1);
  $('#anstop').onclick = () => { anim.playing = false; anim.t = 0; animApply(0); renderAnim(); };
  $('#anclose').onclick = closeAnim;
  $('#anclear').onclick = () => { if (confirm('Take away the whole animation of this object?')) change(() => { delete edits.motions[anim.name]; anim.sel = null; }); };
  $('#anmode').onchange = (e) => change(() => { motionOf(anim.name, true).mode = e.target.value; });
  $('#anauto').onchange = (e) => change(() => { motionOf(anim.name, true).autoplay = e.target.checked; });
  const cu = $('#ancurve');
  if (cu) cu.onchange = () => change(() => { m[anim.sel[0]][anim.sel[1]].e = +cu.value; });
  const gl = $('#anglide');
  if (gl) gl.onchange = () => change(() => { for (const tr of ['pos', 'rot']) for (const k of motionOf(anim.name, true)[tr] || []) k.e = +gl.value; });
  const kd = $('#ankdel');
  if (kd) kd.onclick = () => change(() => { m[anim.sel[0]].splice(anim.sel[1], 1); anim.sel = null; });
  for (const b of animBox.querySelectorAll('[data-ankey]')) b.onclick = () => change(() => {
    const tr = b.dataset.ankey, mm = motionOf(anim.name, true), keys = mm[tr] = mm[tr] || [];
    const i = keys.findIndex((x) => Math.abs(x.t - anim.t) < 0.011);
    if (i >= 0) { keys.splice(i, 1); anim.sel = null; } else animSetKey(tr, anim.t, animPose(anim.t)[tr]);
  });
  for (const inp of animBox.querySelectorAll('[data-anv]')) inp.onchange = () => change(() => {
    const tr = inp.dataset.anv, k = +inp.dataset.k, q = animPose(anim.t);
    let v = q[tr];
    if (tr === 'scale') v = Math.max(0.01, +inp.value || 1);
    else { v = v.slice(); v[k] = tr === 'rot' ? Math.round((+inp.value || 0) * YAW / 360) : (+inp.value || 0); }
    animSetKey(tr, anim.t, v);
  });
  // the playhead: click or drag on the timeline; a key: click to select (and go there), drag to move it in time
  const tl = $('#antl'), timeAt = (e) => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(max, (e.clientX - r.left) / r.width * max)); };
  const scrub = (e) => { anim.playing = false; anim.t = Math.round(timeAt(e) * 20) / 20; animApply(anim.t); animPlayhead(); };
  tl.addEventListener('pointerdown', (e) => {
    if (e.target.dataset.ank) return;
    scrub(e);
    const up = () => { window.removeEventListener('pointermove', scrub); window.removeEventListener('pointerup', up); renderAnim(); };
    window.addEventListener('pointermove', scrub);
    window.addEventListener('pointerup', up);
  });
  for (const k of animBox.querySelectorAll('[data-ank]')) k.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const tr = k.dataset.ank, i = +k.dataset.i, keys = m[tr], key = keys[i], track = k.parentElement;
    anim.sel = [tr, i];
    anim.t = key.t;
    animApply(anim.t);
    let moved = false;
    pushUndo();
    const move = (ev) => {
      const r = track.getBoundingClientRect();
      const t = Math.max(0, Math.min(max, Math.round((ev.clientX - r.left) / r.width * max * 20) / 20));
      if (Math.abs(t - key.t) < 0.001) return;
      moved = true;
      key.t = t;
      k.style.left = (t / max * 100) + '%';
      anim.t = t;
      animPlayhead();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) { keys.sort((a, b) => a.t - b.t); anim.sel = [tr, keys.indexOf(key)]; setDirty(); } else undo.pop();
      renderAnim();
      animApply(anim.t);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

// ---------------------------------------------------------------- collision volumes: box or cylinder, same actor and links
function refreshTriggerBox(p) {
  if (p?.userData.actor?.cls !== 'UCTriggerBox') return;
  collisionVolumes.add(p);
  updateCollisionVolume(p, actorProp);
}

// ---------------------------------------------------------------- zones: water, zone portals, sky (editor/zones.py)
// "+ Water": a pool cut into the floor whose surface is a zone portal (the water below is a zone of its own,
// a WaterZone in it: JC swims). "+ Portal": an invisible sheet that fills a doorway and closes a room into a
// zone of its own (for a Zone of Objects > Zones). A hole can open to the sky (its top shows the sky).
const LIQUIDS = { water: 'Clean water', dirty: 'Dirty water (canal, sewer)', toxic: 'Toxic water (radiation)', burning: 'Burning liquid' };
const SKIES = { hongkong: 'Hong Kong at night', newyork: 'New York at night', stars: 'Night sky, stars', sunset: 'Sunset', clouds: 'Grey clouds',
  brightclouds: 'Bright clouds (day)', orangehaze: 'Orange haze (dusk)' };
const ZONE_CLASSES = /^(ZoneInfo|WaterZone|PrecipitationZone|SnowZone|SkyZoneInfo|RevSoundZone|RevZoneInfo)$/;
function waterBox(r) {
  const h = UE(r.hit), n = UE(r.n);
  if (n[2] < 0.6) return null;              // a floor
  const sn = (v) => (snap ? Math.round(v / 8) * 8 : r1(v));
  const x = sn(h[0]), y = sn(h[1]), f = r1(h[2]);
  return { name: nextName('UCEditBox'), lo: [x - 128, y - 128, f - 96], hi: [x + 128, y + 128, f + 8],
           tex: String(r.tex || 'ClenGreyCncrt_A').split('.').pop(), solid: true, hole: true, water: { kind: 'water', below: 16 } };
}
// a zone portal that fills the doorway clicked: rays to the walls on both sides and up to the lintel
function portalBox(r) {
  const h = UE(r.hit), n = UE(r.n);
  if (n[2] < 0.6) return null;
  const ray = (from, dir) => {
    const rc = new THREE.Raycaster(T(from), T(dir).normalize(), 0.5, 3000);
    const hit = visibleHits(rc.intersectObjects(worldMeshes, false))[0];
    return hit ? hit.distance : 3000;
  };
  const at = [h[0], h[1], h[2] + 40];
  const px = ray(at, [1, 0, 0]), nx = ray(at, [-1, 0, 0]), py = ray(at, [0, 1, 0]), ny = ray(at, [0, -1, 0]);
  const up = ray([h[0], h[1], h[2] + 2], [0, 0, 1]);
  const spanX = px + nx, spanY = py + ny;
  if (Math.min(spanX, spanY) > 1024 || up >= 3000) return null;     // no doorway here
  const across = spanX < spanY;             // the opening is narrow along X: the sheet goes across X
  const lo = [0, 0, h[2] - 4], hi = [0, 0, h[2] + 2 + up + 4];
  if (across) { lo[0] = h[0] - nx - 4; hi[0] = h[0] + px + 4; lo[1] = h[1] - 1; hi[1] = h[1] + 1; }
  else { lo[1] = h[1] - ny - 4; hi[1] = h[1] + py + 4; lo[0] = h[0] - 1; hi[0] = h[0] + 1; }
  return { name: nextName('UCEditBox'), lo: lo.map(r1), hi: hi.map(r1), tex: 'ClenGreyCncrt_A', solid: true, portal: true };
}
function boxKind(b) { return b.mover ? 'mover' : b.water ? 'water' : b.portal ? 'portal' : b.hole ? 'hole' : b.solid ? 'solid' : 'detail'; }
$('#addwater').onclick = () => {
  startPlacing({ box: true, water: true, size: [256, 256, 104] }, $('#addwater'));
  status('Click a floor: a pool of water 256 x 256, 96 deep, a zone of its own (Esc cancels)');
};
$('#addportal').onclick = () => {
  startPlacing({ box: true, portal: true, size: [8, 96, 128] }, $('#addportal'));
  status('Click the floor in the middle of a doorway: an invisible zone portal fills it (Esc cancels)');
};
// a hole where the click is: a doorway through a wall (standing on the floor below), a pit in a floor, an
// opening in a ceiling. Its sides take the texture of the surface clicked.
function holeBox(r) {
  const h = UE(r.hit), n = UE(r.n), tex = String(r.tex || 'ClenGreyCncrt_A').split('.').pop();
  const b = { name: nextName('UCEditBox'), lo: [0, 0, 0], hi: [0, 0, 0], tex, solid: true, hole: true };
  const sn = (v) => (snap ? Math.round(v / 8) * 8 : r1(v));
  if (Math.abs(n[2]) < 0.6) {               // a wall: 64 wide, 112 high, from 8 in front of it to 56 inside
    const k = Math.abs(n[0]) >= Math.abs(n[1]) ? 0 : 1, a = 1 - k, s = n[k] > 0 ? 1 : -1;
    b.lo[a] = sn(h[a]) - 32; b.hi[a] = sn(h[a]) + 32;
    b.lo[k] = Math.min(h[k] + 8 * s, h[k] - 56 * s); b.hi[k] = Math.max(h[k] + 8 * s, h[k] - 56 * s);
    // the floor below, in front of the wall
    const from = T([h[0] + n[0] * 16, h[1] + n[1] * 16, h[2]]);
    ray.set(from, new THREE.Vector3(0, -1, 0)); ray.far = 400;
    const below = ray.intersectObjects(worldMeshes, false)[0];
    ray.far = Infinity;
    const floor = below ? UE(below.point)[2] : h[2] - 56;
    b.lo[2] = r1(floor); b.hi[2] = r1(floor + 112);
  } else if (n[2] > 0) {                     // a floor: a pit 128 x 128, 96 deep
    b.lo = [sn(h[0]) - 64, sn(h[1]) - 64, r1(h[2] - 96)]; b.hi = [sn(h[0]) + 64, sn(h[1]) + 64, r1(h[2] + 8)];
  } else {                                   // a ceiling: an opening 128 x 128, 96 up
    b.lo = [sn(h[0]) - 64, sn(h[1]) - 64, r1(h[2] - 8)]; b.hi = [sn(h[0]) + 64, sn(h[1]) + 64, r1(h[2] + 96)];
  }
  return b;
}
$('#addsign').onclick = () => startPlacing({ box: true, sign: true, size: [6, 6, 64], tex: SIGN_FRAME }, $('#addsign'));

// ---------------------------------------------------------------- side panels
// ---------------------------------------------------------------- Properties panel (editor/props.py)
// The properties that matter for a mission, with the class defaults; edits.props[actor][prop or prop(i)]
// = the value as UnrealEd text (applied by the builds with UC_PROP). Links: Tag / Event arrows in 3D.
const propSchema = {};
let propItems = [];
const linkLines = new THREE.Group();
scene.add(linkLines);

function clearLinks() {
  lkClearArea();
  for (const c of [...linkLines.children]) { linkLines.remove(c); if (c.dispose) c.dispose(); }
  lkEdges = [];
  edgeBox.innerHTML = '';
}
// The other end of a link far away or out of the view: a label at the edge of the view, its arrow turned
// towards it, with its distance; a click goes there. Far but in view: the label next to it. (A link to
// another map: a label by the object.) Moved every frame (animate).
let lkEdges = [];
const edgeBox = document.createElement('div');
edgeBox.id = 'lkedge';
Object.assign(edgeBox.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 4 });
document.body.appendChild(edgeBox);
const EDGE_FAR = 2400;                     // units (about 45 m): beyond it the label shows even in view
function lkEdgeAdd(name, from, text, fixed) {
  if (lkEdges.some((e) => e.name === name && e.text === text)) return;
  const el = document.createElement('div');
  el.className = 'lk-edge';
  el.innerHTML = `<span class="lk-edge-arrow">➜</span><span class="lk-edge-text"></span>`;
  el.title = fixed ? 'This rule takes JC to another map' : 'Go to it';
  if (!fixed) el.onclick = () => { const q = proxyOf(name); if (q) { select(q); focusSelected(); } };
  edgeBox.appendChild(el);
  lkEdges.push({ name, from, text, fixed, el });
}
function updateLinkEdges() {
  lkUpdateAreaMarkers();
  if (!lkEdges.length) return;
  const r = canvas.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, m = 46;
  for (const e of lkEdges) {
    const q = proxyOf(e.name);
    if (!q) { e.el.style.display = 'none'; continue; }
    const pos = q.position.clone(), v = pos.clone().project(camera);
    const behind = pos.clone().sub(camera.position).dot(forward()) < 0;
    const dist = pos.distanceTo(camera.position);
    let x = cx + v.x * r.width / 2, y = cy - v.y * r.height / 2;
    const inView = !behind && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    e.el.querySelector('.lk-edge-text').textContent = e.fixed ? e.text : `${e.text} · ${Math.round(dist / 52.5)} m`;
    const arrow = e.el.querySelector('.lk-edge-arrow');
    if (e.fixed) {                          // by the object itself
      if (!inView) { e.el.style.display = 'none'; continue; }
      arrow.style.display = 'none';
      Object.assign(e.el.style, { display: 'flex', left: (x + 14) + 'px', top: (y - 26) + 'px' });
      continue;
    }
    if (inView && dist < EDGE_FAR) { e.el.style.display = 'none'; continue; }
    arrow.style.display = '';
    if (!inView) {
      // on the edge of the view, towards it (behind the camera: the other way round)
      let dx = v.x * (behind ? -1 : 1), dy = -v.y * (behind ? -1 : 1);
      if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) dy = 1;
      const k = Math.min((r.width / 2 - m) / Math.max(1e-4, Math.abs(dx)), (r.height / 2 - m) / Math.max(1e-4, Math.abs(dy)));
      x = cx + dx * k; y = cy + dy * k;
      arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    } else { arrow.style.transform = 'rotate(90deg)'; y -= 22; }    // just above it, pointing down at it
    const w = e.el.offsetWidth || 160;
    Object.assign(e.el.style, { display: 'flex', left: Math.max(r.left + 4, Math.min(r.right - w - 4, x - w / 2)) + 'px', top: Math.max(r.top + 4, Math.min(r.bottom - 30, y - 14)) + 'px' });
  }
}
// "both": the object of a rule and the one it acts on in the view together
function frameBoth(a, b) {
  const pa = proxyOf(a), pb = proxyOf(b);
  if (!pa || !pb) return;
  const c = pa.position.clone().add(pb.position).multiplyScalar(0.5);
  const r = Math.max(200, pa.position.distanceTo(pb.position) * 0.5);
  const dir = c.clone().sub(camera.position).normalize();
  cam.yaw = Math.atan2(dir.z, dir.x);
  cam.pitch = Math.max(-1.2, Math.min(0.3, Math.asin(Math.max(-1, Math.min(1, dir.y))) - 0.25));
  camera.position.copy(c.clone().addScaledVector(forward(), -r * 2.4));
}
const unquote = (v) => { v = String(v ?? ''); return v.length > 1 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v; };
// (A="x",B=Class'Y',C=(X=1)) -> [[A, '"x"'], [B, "Class'Y'"], [C, '(X=1)']]
function parseStruct(text) {
  const s = String(text || '').trim().replace(/^\(/, '').replace(/\)$/, '');
  const out = [];
  let depth = 0, q = false, cur = '';
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }).filter((kv) => kv[0]);
}
const structText = (pairs) => '(' + pairs.map(([k, v]) => `${k}=${v}`).join(',') + ')';
function mergeStruct(def, val) {            // a T3D struct only has the fields that differ from the default
  const m = new Map(parseStruct(def));
  for (const [k, v] of parseStruct(val)) m.set(k, v);
  return [...m.entries()];
}
const classRef = (v) => { const m = /Class'([^']+)'/i.exec(String(v || '')); return m ? m[1] : ''; };

function actorProp(a, key) {               // edited value, else the map's, else undefined (= class default)
  if (propertySlider && propertySlider.a.name === a.name && propertySlider.key === key) return propertySlider.value;
  const e = edits.props && edits.props[a.name];
  if (e && key in e) return e[key];
  if (a.props && key in a.props) return a.props[key];
  return undefined;
}
function setProp(a, key, value) {
  const target = proxyOf(a.name);
  if (target && !requireUnlocked(target)) return;
  pushUndo();
  edits.props = edits.props || {};
  const e = edits.props[a.name] || (edits.props[a.name] = {});
  e[key] = value;
  setDirty();
}
function unsetProp(a, key) {               // back to the map's own value (or the class's)
  const e = (edits.props || {})[a.name];
  if (!e || !(key in e)) return;
  const target = proxyOf(a.name);
  if (target && !requireUnlocked(target)) return;
  pushUndo();
  delete e[key];
  if (!Object.keys(e).length) delete edits.props[a.name];
  setDirty();
}
// what behaviours.js needs of the editor (Movement, Tactics, Player movement)
const behaveApi = {
  get edits() { return edits; }, actorProp, setProp, unsetProp, pushUndo, setDirty, status, UE, requireUnlocked,
  section: (key, title, body, open) => inspectorSection(key, title, body, open),
};
function previewPropertySlider(p) {
  updateScriptTagField(p.userData.actor);
  refreshLight(p);
  showSoundRange(p);
  if (p.userData.kind !== 'light') return;
  const l = liveLight(p.userData.actor), color = $('#details [data-light-color]'), hint = $('#details [data-light-hint]');
  if (color) color.value = '#' + ueLightRGB(l.hue, l.sat).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
  if (hint) hint.textContent = `brightness ${l.b}, radius ${l.radius}`;
}
function finishPropertySlider(cancel = false) {
  const d = propertySlider;
  if (!d) return;
  propertySlider = null;
  cancelAnimationFrame(d.frame);
  if (cancel || d.value === d.initial) { d.r.value = d.initial; d.n.value = d.initial; }
  else setProp(d.a, d.key, d.value);
  previewPropertySlider(d.p);
}
function wirePropertySlider(p, r, n, key) {
  const byte = x => String(Math.max(0, Math.min(255, Math.round(+x || 0))));
  r.oninput = () => {
    if (propertySlider && propertySlider.r !== r) finishPropertySlider();
    if (!propertySlider) propertySlider = { p, a: p.userData.actor, key, initial: byte(n.value), value: byte(n.value), r, n, frame: 0 };
    const d = propertySlider;
    d.value = byte(r.value);
    n.value = d.value;
    if (!d.frame) d.frame = requestAnimationFrame(() => { d.frame = 0; if (propertySlider === d) previewPropertySlider(p); });
  };
  r.onchange = () => finishPropertySlider();
  r.addEventListener('pointercancel', () => finishPropertySlider(true));
  n.onchange = () => {
    const value = byte(n.value), initial = byte(r.value);
    n.value = r.value = value;
    if (value !== initial) setProp(p.userData.actor, key, value);
    previewPropertySlider(p);
  };
}
window.addEventListener('blur', () => finishPropertySlider(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) finishPropertySlider(true); });
function propValue(a, f, i = 0) {
  const key = f.default.length > 1 || i ? `${f.prop}(${i})` : f.prop;
  const v = actorProp(a, key);
  return v === undefined ? (f.default[i] ?? '') : v;
}
function allActors() {                    // the map's actors; one added in the editor and already built counts once
  const added = new Set((edits.added || []).map((a) => a.name));
  return baseActors.filter((a) => !added.has(a.name)).concat(edits.added || []);
}
function tagDescription(a) {
  const chain = chainNow[a.cls] || [], l = liveLight(a);
  let kind = lkCatOf(a);
  if (a.kind === 'light' || chain.includes('Light')) kind='light';
  else if (a.kind === 'pawn' || chain.includes('ScriptedPawn')) kind='character';
  if (chain.includes('PlayerPawn') || a.cls === 'PlayerStart') kind='player';
  if (a.kind === 'path') kind='path';
  if (kind === 'zone') kind='trigger';
  if (a.kind === 'prop' && kind === 'other') kind='object';
  return {cls:a.cls,kind,disposition:kind === 'character' ? npcDisposition(a) : '',hue:l.hue,saturation:l.sat,legacyTag:actorProp(a,'Tag') ?? a.tag};
}
function scriptingTagOf(a) { return a ? scriptTag(a,edits,tagDescription,bakedObjectTags) : ''; }
function scriptTagHtml(a) {
  const own=edits.objectTags?.[a.name] || bakedObjectTags[a.name], legacy=originalTag(tagDescription(a));
  const mode=own?.mode === 'manual' ? 'Custom' : (!own || own.mode === 'original') && legacy ? 'Original' : 'Auto';
  return inspectorSection('scripting-tag','Scripting tag',`<div class="row" style="flex-wrap:wrap"><label for="scriptingtag" style="width:auto">Tag</label><input id="scriptingtag" aria-label="Scripting tag" value="${escapeHtml(scriptingTagOf(a))}" maxlength="64" style="flex:1 1 100px;min-width:80px" title="Typing a tag makes it manual; colour and attitude changes will not replace it."><span data-script-tag-mode class="hint">${mode}</span><button data-script-tag-auto title="Follow the object's colour, type or attitude" ${mode === 'Auto' ? 'disabled' : ''}>Auto</button>${legacy && own ? '<button data-script-tag-original title="Use the original tag for new scripting rules again">Original</button>' : ''}</div>`,true);
}
function updateScriptTagField(a) {
  const input=$('#scriptingtag');
  if (input && (edits.objectTags?.[a.name] || bakedObjectTags[a.name])?.mode !== 'manual' && document.activeElement !== input) input.value=scriptingTagOf(a);
}
function wireScriptTag(a,p,redraw) {
  const input=$('#scriptingtag'); if (!input) return;
  const change=(entry) => { if (!requireUnlocked(p)) return; pushUndo(); edits.objectTags ||= {}; if (entry) edits.objectTags[a.name]=entry; else delete edits.objectTags[a.name]; setDirty(); redraw(); };
  input.oninput=() => input.setCustomValidity('');
  input.onchange=() => { const value=input.value.trim(); if (!validScriptTag(value)) { input.setCustomValidity('Use 1-64 letters, digits or underscores, starting with a letter or underscore.'); input.reportValidity(); return; } change({mode:'manual',value}); };
  $('[data-script-tag-auto]').onclick=() => change({mode:'auto'});
  const original=$('[data-script-tag-original]'); if (original) original.onclick=() => change({mode:'original'});
}
function tagSuggestions(id) {
  const tags=[...new Set(allActors().map(scriptingTagOf).filter(validScriptTag))].sort();
  return `<datalist id="${escapeHtml(id)}">${tags.map(tag=>`<option value="${escapeHtml(tag)}"></option>`).join('')}</datalist>`;
}
function lkTagTargets(x,source) {
  const kind=TAG_CHARACTER_VERBS.has(x.verb) ? 'character' : x.verb.startsWith('light') ? 'light' : TAG_DOOR_VERBS.has(x.verb) ? 'door' : '';
  return allActors().filter(a=>a.name !== source && lkAreaAvailable(a.name) && x.targetTag && tagMatches(scriptingTagOf(a),x.targetTag)
    && (!kind || tagDescription(a).kind === kind)).map(a=>a.name);
}
const TAG_CHARACTER_VERBS=new Set(['attack','hostile','friend','neutral','stand','wander','follow','goto','run','leave','appear']);
const TAG_DOOR_VERBS=new Set(['open','close','toggle','lock','unlock','blow']);

function tagOf(a) { const v = actorProp(a, 'Tag'); return String(v === undefined ? (a.tag || '') : v); }
function eventOf(a) { const v = actorProp(a, 'Event'); return String(v === undefined ? (a.event || '') : v); }
function proxyOf(name) { return proxies.children.find((c) => c.userData.actor && c.userData.actor.name === name); }

// who triggers what: Event -> Tag, keypads' FailEvent, security computers, keys and doors
function linksOf(a) {
  const out = [];
  const same = (x, y) => x && y && x.toLowerCase() === y.toLowerCase() && x.toLowerCase() !== 'none';
  const ev = eventOf(a), tag = tagOf(a);
  const own = { Event: ev, FailEvent: String(actorProp(a, 'FailEvent') || ''), cameraTag: String(actorProp(a, 'cameraTag') || ''),
    turretTag: String(actorProp(a, 'turretTag') || ''), doorTag: String(actorProp(a, 'doorTag') || ''),
    OrderTag: String(actorProp(a, 'OrderTag') || ''), Nextpatrol: String(actorProp(a, 'Nextpatrol') || '') };
  const WHY_OUT = { Event: 'triggers', OrderTag: 'order target', Nextpatrol: 'next patrol point' };
  const WHY_IN = { OrderTag: 'patrol of', Nextpatrol: 'previous patrol point' };
  const key = String(actorProp(a, 'KeyIDNeeded') || ''), keyId = String(actorProp(a, 'KeyID') || '');
  for (const b of allActors()) {
    if (!b.name || b.name === a.name) continue;
    for (const [what, v] of Object.entries(own)) if (same(v, tagOf(b))) out.push({ dir: 'out', name: b.name, cls: b.cls, why: WHY_OUT[what] || what });
    if (same(eventOf(b), tag) || ['FailEvent', 'cameraTag', 'turretTag', 'doorTag'].some((k) => same(String(actorProp(b, k) || ''), tag)))
      out.push({ dir: 'in', name: b.name, cls: b.cls, why: 'triggered by' });
    for (const k of ['OrderTag', 'Nextpatrol']) if (same(String(actorProp(b, k) || ''), tag)) out.push({ dir: 'in', name: b.name, cls: b.cls, why: WHY_IN[k] });
    if (same(key, String(actorProp(b, 'KeyID') || ''))) out.push({ dir: 'in', name: b.name, cls: b.cls, why: 'opened by the key' });
    if (same(keyId, String(actorProp(b, 'KeyIDNeeded') || ''))) out.push({ dir: 'out', name: b.name, cls: b.cls, why: 'opens' });
  }
  return out;
}
function drawLinks(p, links) {
  clearLinks();
  for (const l of links) {
    const q = proxyOf(l.name);
    if (!q) continue;
    const [from, to] = l.dir === 'out' ? [p.position, q.position] : [q.position, p.position];
    const dirv = to.clone().sub(from), len = dirv.length();
    if (len < 1) continue;
    const arrow = new THREE.ArrowHelper(dirv.normalize(), from, len, l.dir === 'out' ? 0xffa040 : 0x40c0ff, Math.min(48, len * 0.2), Math.min(24, len * 0.1));
    arrow.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; o.renderOrder = 10; } });
    linkLines.add(arrow);
  }
}

// ---------------------------------------------------------------- animations of the characters
// The model of a character class with every frame of its animations (editor/anims.py, host UC_ANIMDUMP).
// The Properties choose what they do when not busy (edits.anims[name] = {idle, rate, loc}; a patrol
// point's PatrolAnim), the mod's UCAnimSet makes it happen in the game, ▶ plays it here on the character.
const animInfo = {}, animData = {};
function animsOf(cls, mesh = '') {         // A visual replacement has its own animation sequences.
  const key = mesh ? 'mesh:' + mesh : cls;
  if (!(key in animInfo)) animInfo[key] = api('/api/anims?' + (mesh ? 'mesh=' + encodeURIComponent(mesh) : 'cls=' + encodeURIComponent(cls))).then((d) => {
    if (!d || !d.seqs || !d.seqs.length) return null;
    let at = d.counts.frames;                // the Studio's animations baked on this model: after its own frames
    for (const x of d.custom || []) { d.seqs.push({ name: x.name, group: 'Animation Studio', start: at, frames: x.frames, rate: x.rate, custom: true }); at += x.frames; }
    return d;
  }).catch(() => null);
  return animInfo[key];
}
function animFrames(info) {                // the arrays of a model, read once
  const key = info.mesh + '|' + (info.custom || []).map((x) => x.url).join(',');
  if (!animData[key]) animData[key] = Promise.all([fetch(info.url).then((r) => r.arrayBuffer()),
    ...(info.custom || []).map((x) => fetch(x.url).then((r) => r.arrayBuffer()))]).then(([buf, ...extra]) => parseAnim(info, buf, extra));
  return animData[key];
}
function animsChanged() {                  // the Studio saved: models and lists read again
  for (const k of Object.keys(animInfo)) delete animInfo[k];
  studioNames = null;
  if (selected && selected.userData.actor) renderProps(selected);
}
let studioNames = null;
function studioList() {
  if (!studioNames) studioNames = api('/api/studio').then((r) => (r.anims || []).map((a) => a.name)).catch(() => []);
  return studioNames;
}
function parseAnim(info, buf, extra = []) {
  const c = info.counts, dv = new DataView(buf);
  let o = info.offset;
  const faces = new Uint16Array(c.faces * 4), wedges = new Uint16Array(c.wedges), uvs = new Float32Array(c.wedges * 2);
  for (let i = 0; i < c.faces * 4; i++, o += 2) faces[i] = dv.getUint16(o, true);
  for (let i = 0; i < c.wedges; i++, o += 4) { wedges[i] = dv.getUint16(o, true); uvs[2 * i] = dv.getUint8(o + 2) / 256; uvs[2 * i + 1] = dv.getUint8(o + 3) / 256; }
  const special = new Uint16Array(c.specialFaces * 4);
  for (let i = 0; i < c.specialFaces * 4; i++, o += 2) special[i] = dv.getUint16(o, true);
  const more = extra.reduce((k, b) => k + b.byteLength / 2, 0);
  const raw = new Int16Array(c.verts * 3 + more);
  for (let i = 0; i < c.verts * 3; i++, o += 2) raw[i] = dv.getInt16(o, true);
  let at = c.verts * 3;
  for (const b of extra) { raw.set(new Int16Array(b), at); at += b.byteLength / 2; }
  const n = raw.length / 3;
  // the actor's space (Unreal axes): RotOrigin's yaw * Scale * (raw - Origin), as the engine's GetFrame
  const pos = new Float32Array(n * 3);
  const [kx, ky, kz] = info.scale, [ox, oy, oz] = info.origin, yaw = info.rot[1] * 2 * Math.PI / YAW, cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const x = (raw[3 * i] - ox) * kx, y = (raw[3 * i + 1] - oy) * ky, z = (raw[3 * i + 2] - oz) * kz;
    pos[3 * i] = x * cs - y * sn; pos[3 * i + 1] = x * sn + y * cs; pos[3 * i + 2] = z;
  }
  return { faces, wedges, uvs, special, raw, pos, frameVerts: c.frameVerts, specialVerts: c.specialVerts, frames: c.frames };
}
// the character's model made of the animation's triangles, with the materials of its own model (by skin slot)
function animatedModel(g, info, d) {
  const mats = {};
  if (g.userData.model) g.userData.model.traverse((o) => { if (o.isMesh && o.userData.slot !== undefined && !(o.userData.slot in mats)) mats[o.userData.slot] = o.userData.matBase || o.material; });
  const bySlot = {};
  for (let k = 0; k < info.counts.faces; k++) {
    const mat = info.mats[d.faces[4 * k + 3]] || [0, 0];
    if (mat[1] & 1 || !(mat[0] in mats)) continue;          // invisible, or a skin its model does not show
    (bySlot[mat[0]] || (bySlot[mat[0]] = [])).push(k);
  }
  const grp = new THREE.Group(), parts = [];
  for (const [slot, list] of Object.entries(bySlot)) {
    const idx = new Uint32Array(list.length * 3), uv = new Float32Array(list.length * 6);
    list.forEach((k, i) => {
      for (let j = 0; j < 3; j++) {
        const w = d.faces[4 * k + j];
        idx[3 * i + j] = d.wedges[w] + d.specialVerts;
        uv[6 * i + 2 * j] = d.uvs[2 * w]; uv[6 * i + 2 * j + 1] = d.uvs[2 * w + 1];
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.length * 9), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(geo, mats[slot]);
    m.userData = { slot: +slot, animated: true };
    grp.add(m);
    parts.push({ geo, idx });
  }
  grp.userData.anim = { parts, d };
  return grp;
}
// the model at a frame position (fractional: between two frames) of the whole animation table
function poseModel(grp, f0, f1, t) {
  const { parts, d } = grp.userData.anim, FV = d.frameVerts, P = d.pos;
  for (const { geo, idx } of parts) {
    const arr = geo.attributes.position.array;
    for (let i = 0; i < idx.length; i++) {
      const a = (f0 * FV + idx[i]) * 3, b = (f1 * FV + idx[i]) * 3;
      arr[3 * i] = P[a] + (P[b] - P[a]) * t;
      arr[3 * i + 1] = P[a + 2] + (P[b + 2] - P[a + 2]) * t;      // three: y up
      arr[3 * i + 2] = P[a + 1] + (P[b + 1] - P[a + 1]) * t;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }
}
let previewing = null;                     // {g, grp, seq, rate, t}
function stopPreview() {
  if (!previewing) return;
  const { g, grp } = previewing;
  g.remove(grp);
  if (g.userData.model) g.userData.model.visible = true;
  previewing = null;
  for (const b of document.querySelectorAll('[data-animplay]')) b.textContent = '▶';
}
async function startPreview(g, cls, seqName, rate = 1) {
  stopPreview();
  const info = await animsOf(cls, meshOf(g.userData.actor));
  const seq = info && info.seqs.find((s) => s.name === seqName);
  if (!seq || !g.parent) return false;
  const d = await animFrames(info);
  const grp = animatedModel(g, info, d);
  if (!grp.children.length) { log('This character has no model to animate here.', 'warn'); return false; }
  fitAnimated(g, info, d, grp, seq);
  g.add(grp);
  previewing = { g, grp, seq, rate, t: 0 };
  poseModel(grp, seq.start, seq.start, 0);
  return true;
}
// an animated model the size and place of the model shown (its DrawScale: the heights compared in the breathing pose)
function fitAnimated(g, info, d, grp, seq = info.seqs[0]) {
  const ref = (info.seqs.find((s) => s.name === 'BreatheLight') || info.seqs.find((s) => s.frames === 1) || seq).start;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < d.frameVerts; i++) { const z = d.pos[(ref * d.frameVerts + i) * 3 + 2]; lo = Math.min(lo, z); hi = Math.max(hi, z); }
  if (g.userData.model) {
    const box = new THREE.Box3();
    g.userData.model.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox); } });
    if (!box.isEmpty() && hi > lo) grp.scale.setScalar((box.max.y - box.min.y) / (hi - lo));
    if (previewMesh(g.userData.actor, g.userData.source)) {
      const pose = replacementPose(g.userData.actor, g.userData.source);
      grp.scale.setScalar(pose.scale); grp.position.copy(T(pose.pivot));
      grp.quaternion.copy(g.userData.model.quaternion);
    }
    g.userData.model.visible = false;
  }
}
function stepPreview(dt) {
  if (!previewing) return;
  const p = previewing;
  if (!p.g.parent) { previewing = null; return; }
  p.t += dt;
  const n = p.seq.frames, f = (p.t * p.seq.rate * p.rate) % Math.max(1, n), i = Math.floor(f);
  poseModel(p.grp, p.seq.start + i, p.seq.start + (n > 1 ? (i + 1) % n : 0), f - i);
}
function seqOptions(seqs, cur, none) {     // the animations of a model for a <select>, in groups
  const groups = {};
  for (const s of seqs) if (!/^(All|Mouth\w|Blink|Head(Up|Down|Left|Right))$/.test(s.name)) (groups[s.group === 'None' ? 'Other' : s.group] ||= []).push(s);
  let h = `<option value="">${escapeHtml(none)}</option>`;
  for (const [gname, list] of Object.entries(groups).sort((x, y) => (x[0] === 'Other') - (y[0] === 'Other') || x[0].localeCompare(y[0])))
    h += `<optgroup label="${escapeHtml(gname)}">` + list.map((s) => `<option value="${escapeHtml(s.name)}" ${s.name === cur ? 'selected' : ''}>${escapeHtml(s.name)} · ${(s.frames / s.rate).toFixed(1)} s</option>`).join('') + '</optgroup>';
  if (cur && !seqs.some((s) => s.name === cur)) h += `<option value="${escapeHtml(cur)}" selected>${escapeHtml(cur)} (not in this model)</option>`;
  return h;
}
// Stays put (Gabby, 18 Oct 2026): never turns, not even to talk; the body keeps its place and its animation,
// the head alone follows JC. edits.anims[name].still -> UCAnimSet.bStayPut (anims.py), animated or not.
function stayPutHtml(a) {
  const on = !!((edits.anims || {})[a.name] || {}).still;
  return `<div class="row"><label style="width:auto" title="Never turns, not even when JC talks to them: the body keeps its place and its animation, only the head follows JC"><input type="checkbox" id="anstill" ${on ? 'checked' : ''}> Stays put</label></div>`;
}
function wireStayPut(a, p) {
  const box = $('#anstill');
  if (!box) return;
  box.onchange = () => {
    if (!requireUnlocked(p)) { box.checked = !box.checked; return; }
    pushUndo();
    edits.anims = edits.anims || {};
    const e = Object.assign({}, edits.anims[a.name]);
    if (box.checked) Object.assign(e, { still: true, loc: e.loc || UE(p.position) });
    else delete e.still;
    if (Object.keys(e).some((k) => k !== 'loc')) edits.anims[a.name] = e;
    else delete edits.anims[a.name];
    setDirty();
    status(box.checked ? `${a.name} stays put: Rebuild to put it in the map.` : `${a.name} turns again as the game makes them.`, 'ok');
  };
}
function animHtml(a) {
  const e = (edits.anims || {})[a.name] || {};
  return inspectorSection('animation', 'Animation', `
    <div class="row"><label style="width:auto;min-width:96px" title="What they do while standing (Orders Standing) or waiting at a patrol point, instead of breathing">When idle</label><select id="anidle" style="flex:1;min-width:0"><option>...</option></select><button id="anplay" data-animplay="1" title="Play it here">▶</button></div>
    <div class="row"><label style="width:auto;min-width:96px">Speed</label><input type="number" id="anrate" value="${+(e.rate || 1)}" min="0.1" max="4" step="0.1" style="width:64px"><span class="hint" style="margin:0 0 0 6px" id="anhint"></span></div>
    <div class="row"><button id="anstudio" title="Animation Studio: make this character's animations, change the game's, import motion capture or Mixamo files">Animation Studio...</button>
      <button id="anpose" title="Pose the character here, against the map around it (a hand on a railing, the back on a wall): its pose when idle">Pose here...</button></div>`, !!e.idle);
}
function wireAnim(a, p, redraw) {
  animsOf(a.cls, meshOf(a)).then((info) => {
    const sel = $('#anidle');
    if (!sel || !document.body.contains(sel)) return;
    if (!info) { sel.innerHTML = '<option value="">(this character has no animations)</option>'; sel.disabled = true; return; }
    const e = (edits.anims || {})[a.name] || {};
    sel.innerHTML = seqOptions(info.seqs.filter((s) => !s.custom), e.idle || '', '(breathing, as the game does)');
    studioList().then((names) => {
      if (!document.body.contains(sel)) return;
      const og = document.createElement('optgroup');
      og.label = 'Animation Studio (yours)';
      for (const n of names) { const o = new Option(n, 'studio:' + n, false, e.own && e.idle === n); og.appendChild(o); }
      og.appendChild(new Option('+ make one in the Animation Studio...', 'studio:+'));
      sel.appendChild(og);
      if (e.own && e.idle) sel.value = 'studio:' + e.idle;
    });
    const orders = String(actorProp(a, 'Orders') ?? '');
    const hint = $('#anhint');
    if (hint && e.idle && orders && !['Standing', 'Patrolling'].includes(orders)) hint.textContent = `used with Orders Standing or Patrolling (now ${orders})`;
    const save = async () => {
      if (sel.value === 'studio:+') { window.__studio && window.__studio.open(a.cls); sel.value = e.idle ? (e.own ? 'studio:' + e.idle : e.idle) : ''; return; }
      const own = sel.value.startsWith('studio:'), idle = sel.value.replace(/^studio:/, '');
      if (own && window.__studio) {           // an animation of the Studio: baked on this character's models first
        sel.disabled = true;
        try { await window.__studio.ensure(a.cls, idle, (t) => status(t)); } catch (err) { log('Animation Studio: ' + err.message, 'bad'); sel.disabled = false; return; }
        sel.disabled = false;
        for (const k of Object.keys(animInfo)) delete animInfo[k];
      }
      pushUndo();
      edits.anims = edits.anims || {};
      const rate = Math.max(0.1, Math.min(4, +$('#anrate').value || 1));
      if (idle) { edits.anims[a.name] = Object.assign({}, edits.anims[a.name], { idle, rate, own: own || undefined, loc: UE(p.position) }); standForIdle(a.name); }
      else if (edits.anims[a.name]) { delete edits.anims[a.name].idle; delete edits.anims[a.name].rate; delete edits.anims[a.name].own; if (!Object.keys(edits.anims[a.name]).some((k) => k !== 'loc')) delete edits.anims[a.name]; }
      setDirty();
      if (own) status(`${a.name} does ${idle} (Animation Studio): Rebuild to put it in the map.`, 'ok');
      if (idle && previewing && previewing.g === p) startPreview(p, a.cls, idle, rate);
    };
    sel.onchange = save;
    $('#anrate').onchange = save;
    $('#anstudio').onclick = () => window.__studio && window.__studio.open(a.cls);
    $('#anpose').onclick = () => { if (requireUnlocked(p)) mapPose.open(p); };
    $('#anplay').onclick = async () => {
      if (previewing && previewing.g === p) { stopPreview(); return; }
      const s = sel.value.replace(/^studio:/, '') || (info.seqs.find((x) => x.name === 'BreatheLight') || {}).name;
      if (s && await startPreview(p, a.cls, s, +$('#anrate').value || 1)) $('#anplay').textContent = '■';
    };
    if (previewing && previewing.g === p) $('#anplay').textContent = '■';
  });
}

// ---------------------------------------------------------------- sounds (editor/sounds.py)
// The AmbientSound property: a sound of the game played over and over around the object; the picker lists
// every sound (ambient loops first) and plays them; the sphere shows how far it is heard.
const pinnedSoundInspector = document.createElement('div'); // Sound previews must not replace a pinned object's fields.
soundBrowser = createSoundBrowser({
  api, container: $('#sounds'), inspector: () => inspectorIsPinned() ? pinnedSoundInspector : $('#details'),
  onSelect: () => { cancelPlacing(); select(null); }, onClear: () => showDetails(),
  onError: message => log('Sound: ' + message, 'bad'),
  deleteSound: name => deleteBrowserSound(name), getCatalog: () => soundsNow(),
});
window.__soundBrowser = soundBrowser;
// how far a sound is heard: three circles (a wire sphere seen from inside is a tangle of lines)
const soundRange = new THREE.Group();
{
  const pts = [];
  for (let i = 0; i <= 96; i++) { const t = i / 96 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t), 0, Math.sin(t))); }
  const ring = new THREE.BufferGeometry().setFromPoints(pts), mat = new THREE.LineBasicMaterial({ color: 0x6bd6c8, transparent: true, opacity: 0.6 });
  for (const [rx, rz] of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2]]) { const l = new THREE.Line(ring, mat); l.rotation.set(rx, 0, rz); soundRange.add(l); }
}
soundRange.visible = false;
scene.add(soundRange);
const triggerZone = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xc58cff, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }));
triggerZone.visible = false;
scene.add(triggerZone);
function classDefault(a, prop) {
  const f = (propSchema[a.cls] || []).find((x) => x.prop === prop);
  return f ? f.default[0] : undefined;
}
function showSoundRange(p) {
  const a = p && p.userData.actor;
  refreshTriggerBox(p);
  // a trigger's zone (also a sound effect played when JC walks in): where touching it counts
  // UCTriggerBox uses BoxX/Y/Z and disables the inherited cylinder in game.
  const touch = a && a.cls !== 'UCTriggerBox' && (/Trigger/.test(a.cls) || (a.cls === 'UCSoundFX' && String(actorProp(a, 'bOnTouch') ?? classDefault(a, 'bOnTouch') ?? 'True') !== 'False'));
  actorOverlays.bind(triggerZone, p, !!touch);
  if (touch) {
    const r = +(actorProp(a, 'CollisionRadius') ?? classDefault(a, 'CollisionRadius') ?? a.radius ?? 40), h = +(actorProp(a, 'CollisionHeight') ?? classDefault(a, 'CollisionHeight') ?? a.height ?? 40);
    triggerZone.scale.set(r, h, r);
  }
  if (a && a.cls === 'UCSoundFX') {
    const near = String(actorProp(a, 'bAtPlayer') ?? 'False') !== 'True';
    actorOverlays.bind(soundRange, p, near);
    if (near) soundRange.scale.setScalar(+(actorProp(a, 'FXRadius') ?? classDefault(a, 'FXRadius') ?? 1024));
    return;
  }
  const snd = a && String(actorProp(a, 'AmbientSound') || (a.cls === 'AmbientSound' ? '' : 'None'));
  actorOverlays.bind(soundRange, p, !!(a && snd && snd !== 'None'));
  if (!soundRange.visible) return;
  const r = +(actorProp(a, 'SoundRadius') ?? (a.cls === 'AmbientSound' ? 64 : 32));
  soundRange.scale.setScalar(25 * (r + 1));
}
async function playSound(name, btn) {
  if (btn && name) btn.dataset.splay = name;
  return soundBrowser.play(name);
}
const soundRef = (v) => { const m = /Sound'([^']+)'/i.exec(String(v || '')); return m ? m[1] : ''; };
async function pickSound(current, onPick) {
  const box = $('#soundbox');
  box.style.display = 'block';
  box.innerHTML = '<div class="hint">Reading the sounds of the game (the first time, a few seconds)...</div>';
  if (!soundCat) soundCat = await api('/api/sounds');
  let filter = '';
  const render = () => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const list = soundCat.sounds.filter((x) => words.every((w) => x.name.toLowerCase().includes(w)));
    let html = '', group = '';
    for (const x of list.slice(0, 600)) {
      if (x.group !== group) { group = x.group; html += `<div class="sb-g">${x.own ? `Your sounds <small>(${escapeHtml(group)}: imported in the browser)</small>` : escapeHtml(group)}${soundCat.ambient.includes(group) ? ' <small>(loops for places)</small>' : ''}</div>`; }
      html += `<div class="sb-i ${x.name === current ? 'on' : ''}" data-snd="${escapeHtml(x.name)}"><button data-splay="${escapeHtml(x.name)}" title="Listen">▶</button><span>${escapeHtml(x.name.split('.').pop())}</span><button data-suse="${escapeHtml(x.name)}">Use</button></div>`;
    }
    $('#sblist').innerHTML = html || '<div class="hint">No sound has these words.</div>';
    for (const b of box.querySelectorAll('[data-splay]')) b.onclick = () => playSound(b.dataset.splay, b);
    for (const b of box.querySelectorAll('[data-suse]')) b.onclick = () => { playSound(null); box.style.display = 'none'; onPick(b.dataset.suse); };
  };
  box.innerHTML = `<div class="row"><b style="flex:1">Sounds</b><input id="sbq" placeholder="search: rain, hum, wind, machine, crowd, water..." style="flex:2;min-width:0">
    <button id="sbnone">No sound</button><button id="sbclose">Close</button></div><div id="sblist"></div>`;
  $('#sbq').oninput = () => { filter = $('#sbq').value; render(); };
  $('#sbclose').onclick = () => { playSound(null); box.style.display = 'none'; };
  $('#sbnone').onclick = () => { playSound(null); box.style.display = 'none'; onPick(''); };
  render();
  $('#sbq').focus();
}

// ---------------------------------------------------------------- the browser: Sounds, My sounds, Import, drag and drop
// Sounds lists every sound of the game, My sounds the user's own: Import... (or files dropped anywhere on the
// editor) takes any file the browser can decode, made here mono 16 bit 44.1 kHz and by the server a sound of
// the editor's package (sounds.py). ▶ listens. A sound dragged onto the 3D view becomes a sound effect there
// (it plays when JC walks in, heard within its radius: its Properties); onto an object with sounds of its
// own (a door, a lamp, a machine) it takes one of them (a menu says which); onto a sound of the Inspector it
// replaces that one. The tiles of the other sections can be dragged onto the 3D view too (placed there).
let SOUNDS_PKG = 'UCSounds', dragSound = null, dragTile = false;
const soundOpen = new Set();
async function soundsNow(force) {
  if (!soundCat || force) soundCat = await api('/api/sounds');
  SOUNDS_PKG = soundCat.package || SOUNDS_PKG;
  soundBrowser?.setCatalog(soundCat, !!force);
  return soundCat;
}
async function buildSounds() {
  const el = $('#sounds'), mine = bottomTab === 'mysounds';
  if (!soundCat) {
    el.innerHTML = '<div class="hint">Reading the sounds of the game (the first time, a few seconds)...</div>';
    try { await soundsNow(); } catch (e) { el.innerHTML = `<div class="hint bad">${escapeHtml(e.message)}</div>`; return; }
  }
  const words = $('#sndsearch').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = soundCat.sounds.filter((x) => !!x.own === mine && words.every((w) => x.name.toLowerCase().includes(w)));
  soundBrowser.setCatalog(soundCat);
  let html = `<div class="hint sintro">${mine ? 'Imported sounds.' : 'Game sounds.'} Select for details. ▶ previews. Drag into the scene or onto a sound field.</div>`;
  if (!list.length) { el.innerHTML = html + `<div class="hint">${mine && !words.length ? 'No sounds of yours yet.' : 'No sound has these words.'}</div>`; return; }
  const groups = new Map();
  for (const x of list) { if (!groups.has(x.group)) groups.set(x.group, []); groups.get(x.group).push(x); }
  for (const [g, items] of groups) {
    const open = mine || words.length || soundOpen.has(g);
    html += `<details data-sgroup="${escapeHtml(g)}" ${open ? 'open' : ''}><summary>${escapeHtml(mine ? 'My sounds' : g)}${soundCat.ambient.includes(g) ? ' · loops for places' : ''} <small>${items.length}</small></summary>`;
    if (open) {
      html += '<div class="sound-grid">';
      for (const x of items.slice(0, 500)) html += soundBrowser.tileHtml(x);
      html += '</div>';
    }
    html += '</details>';
  }
  el.innerHTML = html;
  for (const d of el.querySelectorAll('details')) d.addEventListener('toggle', () => {
    if (mine || words.length) return;
    if (d.open) { soundOpen.add(d.dataset.sgroup); if (!d.querySelector('.srow')) buildSounds(); } else soundOpen.delete(d.dataset.sgroup);
  });
  soundBrowser.wireTiles();
}
async function deleteBrowserSound(name) {
    if (!confirm(`Delete your sound ${name.split('.').pop()}? The maps that use it lose it.`)) return;
    playSound(null);
    busy(`Making ${SOUNDS_PKG} again...`);
    try { const r = await api('/api/sound_delete', { name }); for (const l of r.lines || []) log(l); }
    catch (err) { log('Delete: ' + err.message, 'bad'); } finally { busy(''); }
    await soundsNow(true).catch(() => {});
    buildSounds();
}
$('#sndsearch').addEventListener('input', () => buildSounds());

// ------------------------------- Import: models (the model window) and sounds (straight in)
const MODEL_EXT = /\.(glb|gltf|fbx|obj|mtl|dae|bin|png|jpe?g|tga|bmp|webp)$/i, SOUND_EXT = /\.(wav|mp3|ogg|oga|flac|m4a|aac|opus|webm)$/i;
async function importFiles(files) {
  files = [...files];
  const snd = files.filter((f) => SOUND_EXT.test(f.name)), mdl = files.filter((f) => MODEL_EXT.test(f.name));
  if (!snd.length && !mdl.length) { status('Import takes 3D models (glTF/GLB, FBX, OBJ, DAE, with their textures) and sounds (WAV, MP3, OGG, FLAC).', 'warn'); return; }
  const imported = snd.length ? await importSounds(snd) : [];
  if (mdl.length && mdl.some((f) => !/\.(png|jpe?g|tga|bmp|webp|mtl|bin)$/i.test(f.name))) {
    showTab('mymodels');
    await openImport();
    const dt = new DataTransfer();
    for (const f of mdl) dt.items.add(f);
    const inp = $('#mifile');
    if (inp) { inp.files = dt.files; inp.onchange(); }
  }
  return imported;
}
// Imports are serialized: two quick drops must not race to rebuild the same package.
let fileImportQueue = Promise.resolve();
function queueFileImport(files, destination = null) {
  const batch = [...files];
  fileImportQueue = fileImportQueue.then(async () => {
    const names = await importFiles(batch) || [];
    if (destination && names.length === 1 && script === destination.script) {
      const p = proxyOf(destination.actor), a = p?.userData.actor;
      if (a && !selectionLocked(p)) {
        setProp(a, destination.prop, `Sound'${names[0]}'`);
        showSoundRange(p); if (inspectedObject() === p) showDetails();
        status(`${hierLabel(a)}: ${destination.prop} assigned`, 'ok');
        return;
      }
    }
    if (names.length) {
      window.__workspace?.show('browser');
      window.__soundBrowser?.selectByName(names[0]);
    }
  }).catch(error => { busy(''); log('Import: ' + error.message, 'bad'); });
  return fileImportQueue;
}
function wavBlob(samples, rate) {             // mono, 16 bit
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
  return new Blob([buf], { type: 'audio/wav' });
}
const dataUrlOf = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
async function importSounds(files) {
  await soundsNow().catch(() => {});
  const items = [];
  busy(`Reading ${files.length} sound${files.length === 1 ? '' : 's'}...`);
  let ctx = null;
  try {
    ctx = new AudioContext();
    for (const f of files) {
      try {
        const buf = await ctx.decodeAudioData(await f.arrayBuffer());
        if (buf.duration > 600) { log(`${f.name}: ${Math.round(buf.duration)} seconds, at most 10 minutes.`, 'bad'); continue; }
        // one channel (a sound heard from a place is mono in the game), 44.1 kHz
        const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 44100)), 44100);
        const src = off.createBufferSource();
        src.buffer = buf; src.connect(off.destination); src.start();
        const mono = (await off.startRendering()).getChannelData(0);
        let name = f.name.replace(/\.[^.]+$/, '').trim().replace(/[\s-]+/g, '_').replace(/\W/g, '').slice(0, 40) || 'Sound';
        if (/^\d/.test(name)) name = ('S' + name).slice(0, 40);
        items.push({ name, source: f.name, wav: await dataUrlOf(wavBlob(mono, 44100)) });
      } catch (e) { log(`${f.name}: not a sound the browser can read (${e.message || e}).`, 'bad'); }
    }
  } finally { if (ctx) ctx.close(); busy(''); }
  if (!items.length) return;
  let imported = [];
  busy(`Making ${SOUNDS_PKG} (${items.length} sound${items.length === 1 ? '' : 's'})...`);
  try {
    const r = await api('/api/sound_import', { items });
    for (const l of r.lines || []) log(l, r.ok ? '' : 'bad');
    if (r.ok) { imported = r.names || []; log(`Imported: ${imported.map((n) => n.split('.').pop()).join(', ')}. Drag onto the scene or a sound property.`, 'ok'); }
  } catch (e) { log('Import: ' + e.message, 'bad'); } finally { busy(''); }
  await soundsNow(true).catch(() => {});
  $('#sndsearch').value = '';                 // the new ones in sight
  showTab('mysounds');
  return imported;
}
$('#bimportany').onclick = () => $('#bimportfile').click();
$('#bimportfile').onchange = () => { const f = [...$('#bimportfile').files]; $('#bimportfile').value = ''; if (f.length) queueFileImport(f); };
// + Create: the blocks, holes, water, portals, signs and cutscene cameras (what B, the Map menu... add)
$('#bcreate').onclick = (e) => { e.stopPropagation(); $('#bcreatemenu').classList.toggle('open'); };
$('#bcreatemenu').addEventListener('click', () => $('#bcreatemenu').classList.remove('open'));
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.bcreate')) $('#bcreatemenu').classList.remove('open'); }, true);

// ------------------------------- drag and drop
{
  const bottomEl = $('#bottom'), insp = $('#details');
  const hasFiles = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
  const dropHint = document.createElement('div');
  dropHint.id = 'asset-drop-hint'; dropHint.hidden = true; dropHint.setAttribute('role', 'status'); document.body.appendChild(dropHint);
  let fileDepth = 0, draggedTile = null;
  const clearDropFeedback = () => { fileDepth = 0; dropHint.hidden = true; bottomEl.classList.remove('filedrop'); canvas.classList.remove('asset-drop'); for (const el of document.querySelectorAll('.sounddrop')) el.classList.remove('sounddrop'); };
  // OS files import into the asset browser. A single sound can also be dropped
  // directly on a sound slot; capture that actor before asynchronous decoding.
  window.addEventListener('dragenter', e => { if (projectContext && !projectHub?.visible && hasFiles(e)) fileDepth++; });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    if (!projectContext || projectHub?.visible) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; clearDropFeedback(); return; }
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    const slot = e.target.closest?.('#details [data-sndprop]');
    dropHint.textContent = slot ? 'Drop audio to import and assign this sound' : 'Drop models or audio to import';
    dropHint.hidden = false; bottomEl.classList.add('filedrop');
    for (const el of document.querySelectorAll('.sounddrop')) if (el !== slot) el.classList.remove('sounddrop');
    slot?.classList.add('sounddrop');
  });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && (--fileDepth <= 0 || !e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0))) clearDropFeedback(); });
  window.addEventListener('drop', (e) => {
    clearDropFeedback();
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    if (!projectContext || projectHub?.visible) return;
    const files = [...e.dataTransfer.files], slot = e.target.closest?.('#details [data-sndprop]'), inspected = inspectedObject(), actor = inspected?.userData.actor;
    const target = slot && actor && !selectionLocked(inspected) && files.length === 1 && SOUND_EXT.test(files[0].name)
      ? { script, actor: actor.name, prop: slot.dataset.sndprop } : null;
    queueFileImport(files, target);
  });
  window.addEventListener('blur', clearDropFeedback);
  window.addEventListener('dragend', clearDropFeedback);
  // what is dragged out of the browser: a sound, or a tile to place
  bottomEl.addEventListener('pointerdown', (e) => { const it = e.target.closest('#palette .item, #models .item, #pieces .item'); if (it) it.draggable = true; }, true);
  bottomEl.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest('.srow');
    if (row) {
      dragSound = row.dataset.snd; e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-deusedix-sound', dragSound); e.dataTransfer.setData('text/plain', dragSound);
      const file = window.__soundBrowser?.getDragData(dragSound);
      if (file?.url) e.dataTransfer.setData('DownloadURL', `audio/wav:${file.filename}:${file.url}`);
      return;
    }
    const it = e.target.closest && e.target.closest('#palette .item, #models .item, #pieces .item');
    if (!it) return;
    dragTile = true;
    draggedTile = it;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', 'place');
    e.dataTransfer.setData('application/x-deusedix-asset', 'place');
    // Defer placement until a valid drop, so dropping outside the viewport or
    // outside the app never leaves a ghost attached to the mouse.
  });
  bottomEl.addEventListener('dragend', () => { dragSound = null; dragTile = false; draggedTile = null; clearDropFeedback(); });
  canvas.addEventListener('dragover', (e) => {
    if (!script || !dragTile && !dragSound) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; canvas.classList.add('asset-drop');
    dropHint.hidden = false; dropHint.textContent = dragSound ? 'Drop to place or assign sound' : 'Drop to place object';
  });
  canvas.addEventListener('dragleave', () => { canvas.classList.remove('asset-drop'); if (!fileDepth) dropHint.hidden = true; });
  canvas.addEventListener('drop', async (e) => {
    if (!script || !dragTile && !dragSound) return;
    e.preventDefault();
    clearDropFeedback();
    const at = { clientX: e.clientX, clientY: e.clientY, shiftKey: false, ctrlKey: false, altKey: false, button: 0 };
    if (dragTile) {
      const tile = draggedTile, currentMap = script;
      dragTile = false;
      draggedTile = null;
      try {
        await tile?.onclick?.(new MouseEvent('click'));
        if (script === currentMap && placing) finishPlacing(at);
      } catch (error) { log('Place: ' + error.message, 'bad'); }
      finally { cancelPlacing(); }
      return;
    }
    const name = dragSound;
    dragSound = null;
    dropSound(name, at);
  });
  // onto a sound of the Inspector (a door's, a lamp's hum, a sound effect's): that sound
  insp.addEventListener('dragover', (e) => {
    if (!dragSound) return;
    const t = e.target.closest('[data-sndprop]');
    for (const x of insp.querySelectorAll('.sounddrop')) if (x !== t) x.classList.remove('sounddrop');
    if (!t || !inspectedObject() || selectionLocked(inspectedObject())) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    t.classList.add('sounddrop');
  });
  insp.addEventListener('drop', (e) => {
    const t = e.target.closest('[data-sndprop]'), p = inspectedObject(), a = p && p.userData.actor;
    if (!dragSound || !t || !a || selectionLocked(p)) return;
    e.preventDefault();
    const name = dragSound;
    dragSound = null;
    setProp(a, t.dataset.sndprop, `Sound'${name}'`);
    showSoundRange(p);
    showDetails();
    status(`${a.name}: ${t.dataset.sndprop} = ${name.split('.').pop()}`, 'ok');
  });
}
// a sound let go over the 3D view: the sounds of the object under it, or a sound effect at that point
async function dropSound(name, at) {
  const currentMap = script;
  if (!currentMap) return;
  const r = mouseRay(at);
  const hp = visibleHits(r.intersectObjects(proxies.children, true))[0], hw = visibleHits(r.intersectObjects(worldMeshes, false))[0];
  let o = null;
  if (hp && (!hw || hp.distance <= hw.distance + 4)) { o = hp.object; while (o.parent !== proxies) o = o.parent; }
  const a = o && o.userData.actor;
  const here = () => { if (script === currentMap) soundEffectAt(name, at); };
  if (!a) return here();
  if (!propSchema[a.cls]) {
    try { const res = await api('/api/props?cls=' + encodeURIComponent(a.cls)); propSchema[a.cls] = res.fields || []; propItems = res.items || propItems; }
    catch (e) { propSchema[a.cls] = []; }
  }
  if (script !== currentMap || proxyOf(a.name) !== o) return;
  const slots = propSchema[a.cls].filter((f) => f.kind === 'sound');
  if (!slots.length) return here();
  select(o);
  const short = name.split('.').pop();
  openMenu(at.clientX, at.clientY, [
    ...slots.map((f) => ({ label: f.group && f.group !== 'Sound' ? `${f.group}: ${f.label}` : f.prop === 'AmbientSound' ? 'Ambient sound' : f.label, disabled: selectionLocked(o), run: () => {
      if (script !== currentMap || proxyOf(a.name) !== o || !requireUnlocked(o)) return;
      setProp(a, f.prop, `Sound'${name}'`);
      showSoundRange(o); showDetails();
      log(`${hierLabel(a)}: ${f.label.toLowerCase()} = ${short}.`, 'ok');
    } })),
    { sep: true },
    { label: `A sound effect here (${short})`, run: here }]);
}
function soundEffectAt(name, at) {
  const item = (palette || []).flatMap((c) => c.items || []).find((it) => it.cls === 'UCSoundFX' && (it.preset || {}).bOnTouch !== 'False');
  if (!item) { log('No sound effect in the Objects of this map.', 'bad'); return; }
  startPlacing(Object.assign({}, item, { sound: name }));
  finishPlacing(at);
  cancelPlacing();
  if (selected && selected.userData.actor && selected.userData.actor.cls === 'UCSoundFX')
    log(`A sound effect with ${name.split('.').pop()}: it plays when JC walks into its zone, heard within its radius (both in its Properties).`, 'ok');
}

// ---------------------------------------------------------------- AI paths and patrol routes
// The AI paths view (P) draws the network PATHS DEFINE made at the last rebuild (host UC_PATHS, the
// cache's paths.json): the characters walk from point to point along these links. A patrol route: a
// character with Orders = Patrolling walks a chain of patrol points (OrderTag = the Tag of the first,
// each point's Nextpatrol = the Tag of the next, the last one back to the first) and stops PauseTime
// seconds at each, turned the way the point faces (ScriptedPawn's state Patrolling).
const NAV_CLASSES = /^(PathNode|PatrolPoint|WanderPoint|HidePoint|AmbushPoint|GuardPoint)$/;
let pathData = null, showPaths = false;
const pathLines = new THREE.Group(), routeLines = new THREE.Group();
scene.add(pathLines, routeLines);
function disposeGroup(grp) {
  for (const c of [...grp.children]) {
    grp.remove(c);
    c.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  }
}
// Drawn the modern way (ai-paths.js): each link a strip on the floor, as wide as the engine's room for it,
// coloured by what it is, with arrows sliding the way it can be walked; red rings: points with no link.
// The floor's shape (ai-paths.js floorField, from the map's triangles): the strips lie on steps, ramps and
// bumps the way Unreal's navigation view does
let pathField = null;
function pathFloor(v) {                     // the floor under a navigation point (three coordinates)
  const y = pathField ? pathField.height(v.x, v.z, v.y + 8, v.y - 400) : null;
  return y !== null ? new THREE.Vector3(v.x, y, v.z) : v.clone().add(new THREE.Vector3(0, -40, 0));
}
let routeTest = null;                        // Test a route: null, or the places clicked so far
function drawPaths() {
  disposeGroup(pathLines);
  if (!showPaths || !pathData) { pathField = null; return; }
  // the map may have changed since (a route test's clicks: not)
  if (!routeTest || !pathField) pathField = floorField(THREE, worldMeshes);
  pathLines.add(buildPathView(THREE, pathData, T, pathFloor, pathField));
  if (routeTest && routeTest.route) pathLines.add(buildRouteView(THREE, pathData, routeTest.route, T, pathFloor, pathField));
}
function pathLegend() {
  const used = new Set(pathStrips(pathData).map((s) => s.kind));
  const parts = Object.entries(PATH_KINDS).filter(([k]) => used.has(k)).map(([, v]) => v.label);
  return parts.length ? ' Colours: ' + parts.join(', ') + '.' : '';
}
// The walkable area (navmesh.js, Gabby 17 Oct 2026): Recast's navigation mesh of the map against these paths:
// where a man can walk, and whether a path node is near enough for the game's AI to go there.
const navView = createNavmeshView({ THREE, scene, T, status,
  getMeshes: () => worldMeshes,
  // Only the map's geometry: the decorations' collision cylinders are not used (17 Oct 2026). Tried: Battery Park's
  // barricades of crates and road blocks are closed in cylinder terms (8-25 units between them) while JC gets
  // through in the game (he jumps, climbs crates, squeezes along their edges), so with them most of the park
  // looked unreachable. navmesh.js can take them (walkerGeometry's obstacles) once a better shape is known.
  getObstacles: () => [],
  getNodes: () => navNodes(true).map((n) => n.p),
  note: () => {
    const g = pathGroups(), apart = g.slice(1).reduce((s, x) => s + x.length, 0);
    return apart ? `${apart} path point${apart > 1 ? 's are' : ' is'} not linked to the main network (${g.length - 1} group${g.length > 2 ? 's' : ''} apart): `
      + 'the floor only they reach counts as not reached. ' : '';
  },
  // where JC comes in (the map's start, its arrival points): only the floor he can reach from there counts
  getStarts: () => allActors().filter((a) => /^(PlayerStart|Teleporter)$/.test(a.cls) && a.loc && !(edits.deleted || {})[a.name]).map((a) => T(a.loc)),
  colors: () => {
    const s = getComputedStyle(document.documentElement), v = (n, d) => s.getPropertyValue(n).trim() || d;
    return { ok: v('--ok', '#86cda6'), warn: v('--warn', '#e3b96b'), bad: v('--bad', '#f28780'), acc: v('--acc', '#89b9e8') };
  } });
function navKey() { return `${mapName}|${geoRev}|${worldMeshes.length}`; }      // the mesh; the colours follow navNodes
// the network's groups: the points the last rebuild linked to each other, the biggest (the main network) first
function pathGroups() {
  const pts = (pathData && pathData.points) || {}, links = (pathData && pathData.links) || [], up = {};
  if (!links.length) return [];
  for (const n of Object.keys(pts)) up[n] = n;
  const find = (x) => { while (up[x] !== x) { up[x] = up[up[x]]; x = up[x]; } return x; };
  for (const l of links) if (l[0] in up && l[1] in up) up[find(l[0])] = find(l[1]);
  const g = new Map();
  for (const n of Object.keys(up)) { const r = find(n); if (!g.has(r)) g.set(r, []); g.get(r).push(n); }
  return [...g.values()].sort((a, b) => b.length - a.length);
}
// the network's points: as the last rebuild made them, with the path nodes added, moved or deleted since.
// mainOnly: of the built ones, only those linked to the main network (where a character of it can go)
function navNodes(mainOnly = false) {
  const pts = (pathData && pathData.points) || {}, gone = edits.deleted || {}, moved = edits.moved || {}, out = [];
  const keep = mainOnly && pathGroups().length ? new Set(pathGroups()[0]) : null;
  for (const [name, p] of Object.entries(pts)) if (!gone[name] && (!keep || keep.has(name))) out.push({ name, p: T(moved[name]?.loc || [p[1], p[2], p[3]]) });
  for (const a of edits.added || []) if (NAV_CLASSES.test(a.cls) && !pts[a.name] && a.loc && !gone[a.name]) out.push({ name: a.name, p: T(a.loc) });
  return out;
}
// the decorations a filled path node must not stand in, nor a link cross (their collision cylinders)
function navBlockers() {
  const deco = new Map();
  for (const c of palette) if (c.category === 'Decorations') for (const it of c.items || []) deco.set(it.cls, it.sub || '');
  return allActors().filter((a) => !(edits.deleted || {})[a.name] && deco.has(a.cls) && !/hanging|books/.test(deco.get(a.cls))
      && (a.radius || 0) >= 8 && (a.height || 0) >= 6 && a.loc
      && String(actorProp(a, 'bBlockPlayers') ?? 'True') !== 'False' && String(actorProp(a, 'bCollideActors') ?? 'True') !== 'False')
    .map((a) => { const c = T(edits.moved?.[a.name]?.loc || a.loc); return { x: c.x, z: c.z, y0: c.y - a.height, y1: c.y + a.height, r: a.radius }; });
}
// The walkable area in the game (navmesh phase 3, editor/navbake.py): for a map whose characters are sent "on the
// walkable area", its polygons are made again before every Rebuild and saved in the edits (edits.navmesh); the
// rebuild puts them into the map as a UCNavMesh actor. Seeds: only the floor joined to them is kept.
function navSeeds() {
  const gone = edits.deleted || {}, out = [];
  for (const a of allActors()) {
    if (gone[a.name] || !a.loc) continue;
    const chain = chainNow[a.cls] || [];
    if (/^(PlayerStart|Teleporter)$/.test(a.cls) || NAV_CLASSES.test(a.cls) || a.kind === 'pawn' || chain.includes('ScriptedPawn'))
      out.push(T(edits.moved?.[a.name]?.loc || a.loc));
  }
  for (const n of navNodes()) out.push(n.p);
  for (const l of edits.links || []) for (const x of l.do || []) if ((x.verb === 'goto' || x.verb === 'run') && x.at) out.push(T(x.at).add(new THREE.Vector3(0, 40, 0)));
  return out;
}
// what stops a character, though not JC (he jumps onto crates and squeezes past them; Battery Park's barricades):
// the blocking decorations and the invisible walls for characters (BlockAll, BlockMonsters; not BlockPlayer)
function navObstacles() {
  const deco = new Map(), gone = edits.deleted || {};
  for (const c of palette) if (c.category === 'Decorations') for (const it of c.items || []) deco.set(it.cls, it.sub || '');
  return allActors().filter((a) => !gone[a.name] && a.loc && (a.radius || 0) >= 8 && (a.height || 0) >= 6
      && (/^(BlockAll|BlockMonsters)$/.test(a.cls) || (deco.has(a.cls) && !/hanging|books/.test(deco.get(a.cls))
        && String(actorProp(a, 'bBlockActors') ?? 'True') !== 'False' && String(actorProp(a, 'bCollideActors') ?? 'True') !== 'False')))
    .map((a) => ({ loc: edits.moved?.[a.name]?.loc || a.loc, radius: a.radius, height: a.height }));
}
// the doors characters cannot open (locked: the view leaves every door open), as solid boxes
function navLockedDoors() {
  const out = [];
  proxies.traverse((p) => {
    const a = p.userData && p.userData.actor;
    if (!a || p.userData.kind !== 'mover' || (edits.deleted || {})[a.name] || String(actorProp(a, 'bLocked') ?? 'False') !== 'True') return;
    const b = new THREE.Box3().setFromObject(p);
    if (!b.isEmpty()) out.push({ min: b.min.toArray(), max: b.max.toArray() });
  });
  return out;
}
async function navBakeIfNeeded() {
  let needed = false;
  try { needed = !!(await fetch('/api/navneeded?script=' + encodeURIComponent(script)).then((r) => r.json())).needed; } catch (_) { return; }
  if (!needed) {
    if (edits.navmesh) { delete edits.navmesh; await save(); }
    return;
  }
  busy('Making the walkable area for the game...');
  try {
    const r = await bakePolys(THREE, worldMeshes, navSeeds(), navObstacles(), T, navLockedDoors());
    edits.navmesh = { v: 1, key: navKey(), polys: r.polys };
    log(`Walkable area for the game: ${r.polys.length} polygons (of the ${r.all} of the map, those joined to where JC and the characters are).`);
  } catch (e) {
    log('Walkable area for the game: ' + (e.message || e) + '. The characters sent on it take the AI paths.', 'warn');
    delete edits.navmesh;
  }
  await save();
}
// Map > Fill AI paths (Gabby, 17 Oct 2026): path nodes wherever JC can walk and no node is near (navmesh.js
// fillPathNodes), added as if placed by hand: one Undo takes them all away, the rebuild links them.
async function fillPaths() {
  if (!script || mapLoading) return;
  status('Fill AI paths: looking for the places no path node reaches...');
  const nodes = navNodes(), index = new Map(nodes.map((n, i) => [n.name, i]));
  const links = ((pathData && pathData.links) || []).map((l) => [index.get(l[0]), index.get(l[1])]).filter(([i, j]) => i !== undefined && j !== undefined);
  let r;
  try { r = await navView.fill(navKey(), nodes, links, navBlockers()); }
  catch (e) { status('Fill AI paths: ' + (e.message || e) + '.', 'bad'); return; }
  if (!r.added.length) {
    status(r.apart ? `Fill AI paths: nothing added. ${r.apart} group${r.apart > 1 ? 's' : ''} of path points could not be joined to the main network: `
      + 'the game does not link them there (steep stairs, a ledge, a gap). Add path nodes there by hand, closer together, and rebuild.'
      : 'Fill AI paths: every place JC can walk on already has a path node near enough. Nothing added.', r.apart ? 'warn' : 'ok');
    return;
  }
  const item = palette.flatMap((c) => c.items || []).find((it) => it.cls === 'PathNode') || { radius: 12, height: 14.5 };
  pushUndo();
  for (const q of r.added)                // about where a path node stands; the rebuild drops it onto the floor
    edits.added.push({ name: nextName('UCEdit'), cls: 'PathNode', loc: UE(new THREE.Vector3(q.x, q.y + 40, q.z)), rot: [0, 0, 0],
                       radius: item.radius, height: item.height, props: {} });
  setDirty(); rebuildProxies();
  $('#navbtn').classList.add('on');
  await navView.show(navKey());
  navLayers();
  const msg = `Fill AI paths: ${r.added.length} path node${r.added.length > 1 ? 's' : ''} added`
    + (r.bridges ? ` (${r.bridges} of them join groups of points apart to the main network)` : '')
    + '; the walkable area counts them already. Rebuild (or Map > Rebuild AI paths) links them; Ctrl+Z takes them all away. '
    + 'After the rebuild, Fill AI paths again joins what the game left apart.'
    + (r.full ? ' It stopped at the most it adds in one go: run it again after the rebuild.' : '')
    + (r.apart ? ` ${r.apart} group${r.apart > 1 ? 's' : ''} of path points could not be joined: the game does not link them there (steep stairs, a ledge).` : '');
  status(msg, 'ok');
  log(msg, 'ok');
}
// The two layers of navigation (Gabby, 18 Oct 2026), each on or off by itself, like Unity's navigation overlay:
// AI paths (the nodes' network, P) and the walkable area (the navigation mesh); Test route works with either.
function toggleNav(on = !navView.on) {
  $('#navbtn').classList.toggle('on', on);
  if (on) navView.show(navKey()).then(() => { $('#navbtn').classList.toggle('on', navView.on); navLayers(); });
  else {
    navView.hide();
    if (!showPaths || (routeTest && !routeTest.ai)) endRouteTest(true); else navView.clearRoute();
    status('Walkable area hidden.');
  }
  navLayers();
}
function navLayers() {               // Test route with either layer; the 3D view's Navigation menu
  $('#routebtn').style.display = showPaths || navView.on ? '' : 'none';
  vpBar?.refresh();
}
$('#navbtn').onclick = () => toggleNav();
function togglePaths(on = !showPaths) {
  showPaths = on;
  $('#pathsbtn').classList.toggle('on', on);
  if (!on && !navView.on) endRouteTest(true);
  else if (!on && routeTest) routeTest = { places: [], hits: [], ai: false };    // on: the walkable area only
  navLayers();
  drawPaths();
  if (!on) return;
  const n = Object.keys(pathData?.points || {}).length, l = (pathData?.links || []).length, loose = pathData ? loosePoints(pathData).length : 0;
  status(l ? `AI paths: ${n} points, ${l} links, as the last rebuild made them. Arrows: the way they can be walked (one way: arrows one way only).${pathLegend()}`
      + (loose ? ` ${loose} point(s) in red have no link: nobody can use them.` : '')
    : 'AI paths: none yet. Place path nodes (Objects > AI) where characters must walk, then Rebuild.', l && !loose ? '' : 'warn');
}
$('#pathsbtn').onclick = () => togglePaths();
function startRouteTest() {
  // on the AI paths when they are shown (and built), on the walkable area when it is shown: both, side by side
  const ai = !!(showPaths && pathData && (pathData.links || []).length);
  if (!ai && !navView.on) {
    status(showPaths ? 'No AI paths yet: place path nodes and Rebuild first (or show the walkable area).' : 'Show the AI paths or the walkable area first.', 'warn');
    return;
  }
  routeTest = { places: [], hits: [], ai };
  $('#routebtn').classList.add('on');
  drawPaths();
  status('Test a route: click on the floor where the character starts.');
}
function endRouteTest(quiet) {
  if (!routeTest) return;
  routeTest = null;
  $('#routebtn').classList.remove('on');
  navView.clearRoute();
  drawPaths();
  if (!quiet) status('Route test closed.');
}
$('#routebtn').onclick = () => (routeTest ? endRouteTest() : startRouteTest());
function routeClick(e) {                    // a click while testing a route (pick hands it over)
  const hit = visibleHits(mouseRay(e).intersectObjects(world.children, true))[0];
  if (!hit) return;
  if (routeTest.places.length >= 2 || (routeTest.hits || []).length >= 2) { routeTest = { places: [], hits: [], ai: routeTest.ai }; navView.clearRoute(); drawPaths(); }
  (routeTest.hits ||= []).push(hit.point.clone());
  if (!routeTest.ai) {                       // the walkable area alone: Detour's way between the two places
    if (routeTest.hits.length === 1) { status('Start chosen. Now click where the character must go.'); return; }
    const len = navView.route(routeTest.hits[0], routeTest.hits[1]);
    status(len ? `On the walkable area: about ${Math.round(len / 16 * 0.3048)} m (the line in the accent colour). Show the AI paths too to compare it with the way the game's AI goes. Click again for another test, Esc to close.`
      : 'No way on the walkable area between those places.', len ? 'ok' : 'warn');
    return;
  }
  const at = UE(hit.point.clone().add(new THREE.Vector3(0, 40, 0)));
  const node = nearestPoint(pathData, at, 1200, routeTest.places.length === 1 ? 'to' : 'from');
  if (!node) { routeTest.hits.pop(); status('No AI path point near there (within 1200 units): pick a place nearer the network.', 'warn'); return; }
  routeTest.places.push(node);
  if (routeTest.places.length === 1) { status(`Start: ${node}. Now click where the character must go.`); return; }
  const [from, to] = routeTest.places;
  if (from === to) {
    routeTest.places = [from];
    status(`Both places are nearest the same AI path point (${from}): click a place further away.`, 'warn');
    return;
  }
  const r = findRoute(pathData, from, to);
  routeTest.route = r.route || null;
  drawPaths();
  // with the walkable area shown: the straight way on it too (Detour), between the very places clicked
  const navLen = navView.on && routeTest.hits.length === 2 ? navView.route(routeTest.hits[0], routeTest.hits[1]) : null;
  const navText = navView.on ? (navLen ? ` On the walkable area (the line in the accent colour): about ${Math.round(navLen / 16 * 0.3048)} m.`
    : ' No way on the walkable area between those places.') : '';
  if (r.route) {
    const special = [...new Set(r.kinds.filter((k) => k !== 'walk'))].map((k) => PATH_KINDS[k].label);
    status(`Route: ${r.route.length} points, about ${Math.round(r.length / 16 * 0.3048)} m` + (special.length ? ` (${special.join(', ')})` : '')
      + '. This is the way the game\'s AI goes.' + navText + ' Click again for another test, Esc to close.', 'ok');
  } else {
    status(`No way from ${from} to ${to}: the AI paths don't connect them (${r.reached.length} point(s) can be reached from the start). Add path nodes between them and Rebuild.`, 'warn');
  }
}
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && routeTest) { endRouteTest(); e.stopPropagation(); } }, true);

function putProp(a, key, value) {          // like setProp, inside an edit that already saved its undo
  edits.props = edits.props || {};
  (edits.props[a.name] || (edits.props[a.name] = {}))[key] = value;
}
function patrolByTag() {
  const m = new Map();
  for (const b of allActors()) {
    if (b.cls !== 'PatrolPoint' || edits.deleted[b.name]) continue;
    const t = tagOf(b).toLowerCase();
    if (t && t !== 'none' && !m.has(t)) m.set(t, b);
  }
  return m;
}
function routeOf(a) {                      // the character's patrol points in order; loop: the last leads back
  const byTag = patrolByTag(), points = [];
  let t = String(actorProp(a, 'OrderTag') || '').toLowerCase();
  while (t && t !== 'none' && byTag.has(t)) {
    const p = byTag.get(t);
    if (points.includes(p)) return { points, loop: true };
    points.push(p);
    t = String(actorProp(p, 'Nextpatrol') || '').toLowerCase();
  }
  return { points, loop: false };
}
const isCharacter = (a) => a && (a.kind === 'pawn' || addedKind(a.cls) === 'pawn' || (propSchema[a.cls] || []).some((f) => f.prop === 'Orders'));
function routeUsers(point) { return allActors().filter((x) => isCharacter(x) && !edits.deleted[x.name] && routeOf(x).points.some((q) => q.name === point.name)); }
function numberSprite(n, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill();
  g.fillStyle = '#10131a'; g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 32, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.setScalar(22);
  s.renderOrder = 11;
  return s;
}
function drawRoute(a) {
  const { points, loop } = routeOf(a);
  if (!points.length) return;
  const at = (b) => (proxyOf(b.name)?.position || T(b.loc)).clone();
  const chain = points.map(at);
  const leg = (from, to, dashed) => {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const m = dashed ? new THREE.LineDashedMaterial({ color: 0xffa040, dashSize: 12, gapSize: 8, depthTest: false, transparent: true })
      : new THREE.LineBasicMaterial({ color: 0xffa040, depthTest: false, transparent: true });
    const l = new THREE.Line(g, m);
    if (dashed) l.computeLineDistances();
    l.renderOrder = 10;
    routeLines.add(l);
    const d = to.clone().sub(from), len = d.length();
    if (dashed || len < 40) return;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 20, 8), new THREE.MeshBasicMaterial({ color: 0xffa040, depthTest: false, transparent: true }));
    cone.position.copy(from).addScaledVector(d, 0.5);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    cone.renderOrder = 10;
    routeLines.add(cone);
  };
  const me = proxyOf(a.name);
  if (me) leg(me.position.clone(), chain[0], true);         // where they start from
  for (let i = 0; i + 1 < chain.length; i++) leg(chain[i], chain[i + 1]);
  if (loop && chain.length > 1) leg(chain[chain.length - 1], chain[0]);
  chain.forEach((p, i) => { const s = numberSprite(i + 1, '#ffa040'); s.position.copy(p).add(new THREE.Vector3(0, 34, 0)); routeLines.add(s); });
}
function faceToward(b, loc) {              // a patrol point made here turns toward the next leg (where they look when waiting)
  const e = edits.added.find((x) => x.name === b.name);
  if (!e) return;
  e.rot = [0, radToYaw(-Math.atan2(loc[1] - e.loc[1], loc[0] - e.loc[0])), 0];
  const q = proxyOf(b.name);
  if (q) q.rotation.y = yawToRad(e.rot[1]);
}
function startRoute(a) {
  const target = proxyOf(a.name);
  if (target && !requireUnlocked(target)) return;
  if (document.activeElement) document.activeElement.blur();     // Enter ends the route, it must not press the button again
  startPlacing({ cls: 'PatrolPoint', radius: 12, height: 14.5, route: a.name }, $('#rtdraw'));
  status(`Patrol route of ${hierLabel(a)}: click the floor where they walk, point after point. Enter or Esc when done (they go round in a loop).`);
}
function endRoute() {
  const name = placing && placing.route;
  cancelPlacing();
  const q = name && proxyOf(name);
  if (q) select(q);
  status('Patrol route ready. Rebuild, then "Play from here" to watch them walk it (the AI paths are made again).', 'ok');
}
function addRoutePoint(a, loc) {
  const { points } = routeOf(a);
  const tag = nextTag(a.name + '_Patrol');
  const pt = { name: nextName('UCEdit'), cls: 'PatrolPoint', loc, rot: [0, 0, 0], radius: 12, height: 15, route: a.name,
               props: { Tag: tag, Nextpatrol: points.length ? tagOf(points[0]) : 'None' } };
  edits.added.push(pt);
  if (points.length) {
    const last = points[points.length - 1];
    putProp(last, 'Nextpatrol', tag);
    faceToward(last, loc);
  } else {
    putProp(a, 'Orders', 'Patrolling');
    putProp(a, 'OrderTag', tag);
  }
  makeProxy(Object.assign({ kind: 'path' }, pt), 'added');
  if (points.length) faceToward(pt, (points[0].loc || UE(proxyOf(points[0].name).position)));
  setDirty();
  const q = proxyOf(a.name);
  if (q) { if (selected !== q) select(q); else renderProps(q); }
}
function idleOrders(a) {                   // what they do without a route: the map's own orders, unless those were the patrol
  const o = a.props && a.props.Orders;
  return o && o !== 'Patrolling' ? o : 'Standing';
}
function removeRoutePoint(a, i) {
  const { points, loop } = routeOf(a);
  const b = points[i];
  if (!b) return;
  pushUndo();
  const rest = points.filter((x) => x !== b);
  if (!rest.length) { putProp(a, 'OrderTag', 'None'); putProp(a, 'Orders', idleOrders(a)); }
  else if (i === 0) {
    putProp(a, 'OrderTag', tagOf(rest[0]));
    if (loop) putProp(points[points.length - 1], 'Nextpatrol', rest.length > 1 ? tagOf(rest[0]) : 'None');
  } else {
    const next = points[i + 1] || (loop ? points[0] : null);
    putProp(points[i - 1], 'Nextpatrol', next && next !== points[i - 1] ? tagOf(next) : 'None');
  }
  if (edits.added.some((x) => x.name === b.name)) {
    edits.added = edits.added.filter((x) => x.name !== b.name);
    if (edits.props) delete edits.props[b.name];
  } else putProp(b, 'Nextpatrol', 'None');      // a point of the map stays, out of the route
  setDirty();
  rebuildProxies();
  const q = proxyOf(a.name);
  if (q) select(q);
}
function clearRouteOf(a) {
  const { points } = routeOf(a);
  const mine = points.filter((b) => edits.added.some((x) => x.name === b.name));
  if (mine.length < points.length && !confirm('This route uses patrol points of the map itself: they stay in the map, only this character stops using them. Go on?')) return;
  pushUndo();
  const gone = new Set(mine.map((b) => b.name));
  edits.added = edits.added.filter((x) => !gone.has(x.name));
  if (edits.props) for (const n of gone) delete edits.props[n];
  putProp(a, 'OrderTag', 'None');
  putProp(a, 'Orders', idleOrders(a));
  setDirty();
  rebuildProxies();
  const q = proxyOf(a.name);
  if (q) select(q);
}
function routeHtml(a) {
  const { points, loop } = routeOf(a);
  const orders = String(actorProp(a, 'Orders') ?? '');
  let h = '';
  if (!points.length) h += '<div class="hint" style="margin:0 0 4px">Draw route, then click the floor to add patrol points.</div>';
  else if (orders !== 'Patrolling') h += `<div class="hint" style="margin:0 0 4px;color:#ffd25a">Orders is ${escapeHtml(orders || 'not Patrolling')}: they follow the route only with Orders = Patrolling.</div>`;
  points.forEach((b, i) => {
    h += `<div class="row"><span style="width:18px;color:#ffa040;font-weight:700">${i + 1}</span><a href="#" data-rp="${i}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--accent, #5aa2ff)" title="Select this patrol point">${escapeHtml(tagOf(b))}</a>
      <label style="width:auto" title="Seconds they stop here, turned the way the point faces (turn it with E)">wait</label><input type="number" data-rw="${i}" value="${+actorProp(b, 'PauseTime') || 0}" min="0" step="1" style="width:52px"><button data-rx="${i}" title="Take this point out of the route">✕</button></div>`;
  });
  if (points.length > 1) h += `<div class="hint" style="margin:0 0 4px">${loop ? '↻ after the last point, back to 1' : 'they stop at the last point'}</div>`;
  h += `<div class="row"><button id="rtdraw" title="Click the floor where they walk, point after point (Enter or Esc when done)">${points.length ? '+ Add points' : 'Draw route'}</button>${points.length ? '<button id="rtclear">Clear route</button>' : ''}</div>`;
  return inspectorSection('patrol', 'Patrol route', h, points.length > 0);
}
function wireRoute(a, redraw) {
  const box = $('#propsec');
  const { points } = routeOf(a);
  for (const l of box.querySelectorAll('[data-rp]')) l.onclick = (e) => { e.preventDefault(); const q = proxyOf(points[+l.dataset.rp].name); if (q) { select(q); focusSelected(); } };
  for (const n of box.querySelectorAll('[data-rw]')) n.onchange = () => { setProp(points[+n.dataset.rw], 'PauseTime', Math.max(0, +n.value || 0).toFixed(6)); redraw(); };
  for (const b of box.querySelectorAll('[data-rx]')) b.onclick = () => removeRoutePoint(a, +b.dataset.rx);
  $('#rtdraw').onclick = () => startRoute(a);
  const c = $('#rtclear');
  if (c) c.onclick = () => clearRouteOf(a);
}

// ---------------------------------------------------------------- factions (the game's alliances)
// A character belongs to a faction (Alliance) and has relations (InitialAlliances: faction, level
// 1 friendly / 0 neutral / -1 hostile, bPermanent = fixed: attacks do not change it). 'Player' is JC.
let factionData = null;
let factionRequest = null;
const factionList = document.createElement('datalist');
factionList.id = 'factionlist';
document.body.appendChild(factionList);
const ATTITUDES = [['1', 'friendly'], ['0', 'neutral'], ['-1', 'hostile']];
const facLabel = (f) => (String(f).toLowerCase() === 'player' ? 'JC (Player)' : f);
const levelKey = (lv) => (lv > 0.3 ? '1' : lv < -0.3 ? '-1' : '0');

async function loadFactions() {
  if (!factionData) {
    if (!factionRequest) factionRequest = api('/api/factions').then(data => {
      factionData = data;
      buildHierarchy();
      return data;
    }).catch(() => null).finally(() => { factionRequest = null; });
    await factionRequest;
  }
  const names = new Set(factionData?.known || ['Player']);
  for (const m of factionMembers()) { if (m.faction && m.faction !== 'None') names.add(m.faction); for (const r of m.rel) names.add(r.name); }
  factionList.innerHTML = [...names].sort((a, b) => a.localeCompare(b)).map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(facLabel(f))}</option>`).join('');
  return factionData;
}
function relationsOf(a) {                  // [{slot, name, level, fixed}] of the used slots
  const def = ((factionData && factionData.classes[a.cls]) || {}).rel || [];
  const out = [];
  for (let i = 0; i < Math.max(8, def.length); i++) {
    const v = actorProp(a, `InitialAlliances(${i})`);
    const m = new Map(mergeStruct(def[i] || '(AllianceName=None,AllianceLevel=0.000000,bPermanent=False)', v === undefined ? '' : v));
    const name = String(m.get('AllianceName') || 'None');
    if (name !== 'None' && name !== '') out.push({ slot: i, name, level: parseFloat(m.get('AllianceLevel') || '0'), fixed: /true/i.test(m.get('bPermanent') || '') });
  }
  return out;
}
function factionOf(a) {
  const v = actorProp(a, 'Alliance');
  return String(v === undefined ? (((factionData && factionData.classes[a.cls]) || {}).alliance || 'None') : v);
}
function factionMembers() {               // the characters of the map, with the ones added in the editor
  if (!factionData) return [];
  return allActors().filter((a) => a.name && factionData.classes[a.cls]).map((a) => ({ a, name: a.name, cls: a.cls, faction: factionOf(a), rel: relationsOf(a) }));
}
// relation of a character towards a faction: the slot that has it, or the first free one
function setRelation(a, toward, key, fixed, undoable = true) {
  const rel = relationsOf(a);
  const used = rel.find((r) => r.name.toLowerCase() === toward.toLowerCase());
  let slot = used ? used.slot : -1;
  if (slot < 0) for (let i = 0; i < 8 && slot < 0; i++) if (!rel.some((r) => r.slot === i)) slot = i;
  if (slot < 0) return false;
  const text = key === 'none' ? '(AllianceName=None,AllianceLevel=0.000000,bPermanent=False)'
    : `(AllianceName=${toward},AllianceLevel=${(+key).toFixed(6)},bPermanent=${fixed ? 'True' : 'False'})`;
  if (undoable) setProp(a, `InitialAlliances(${slot})`, text);
  else { edits.props = edits.props || {}; (edits.props[a.name] = edits.props[a.name] || {})[`InitialAlliances(${slot})`] = text; }
  return true;
}

// Properties panel: the faction field and the relations list
function relationsHtml(a, id) {
  const rel = relationsOf(a);
  let html = rel.map((r) => `<div class="row" style="padding-left:8px;flex-wrap:wrap"><input type="text" list="factionlist" id="${id}_n${r.slot}" value="${escapeHtml(r.name)}" title="faction (Player = JC)" style="width:96px">
      <select id="${id}_l${r.slot}">${ATTITUDES.map(([k, t]) => `<option value="${k}" ${levelKey(r.level) === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label style="width:auto" title="fixed: it never changes by itself (attacks do not make them hostile)"><input type="checkbox" id="${id}_f${r.slot}" ${r.fixed ? 'checked' : ''}> fixed</label>
      <button id="${id}_x${r.slot}" title="remove">✕</button></div>`).join('');
  if (!rel.some((r) => r.name.toLowerCase() === 'player')) html += '<div class="hint" style="margin:2px 0 2px 8px">No relation with JC: neutral, unless the faction says otherwise.</div>';
  if (rel.length < 8) html += `<div class="row" style="padding-left:8px"><button id="${id}_add">+ relation</button></div>`;
  return html;
}
function wireRelations(a, id, redraw) {
  for (const r of relationsOf(a)) {
    const save = () => {
      const name = $(`#${id}_n${r.slot}`).value.trim().replace(/\W/g, '_') || 'None';
      setProp(a, `InitialAlliances(${r.slot})`, name === 'None' ? '(AllianceName=None,AllianceLevel=0.000000,bPermanent=False)'
        : `(AllianceName=${name},AllianceLevel=${(+$(`#${id}_l${r.slot}`).value).toFixed(6)},bPermanent=${$(`#${id}_f${r.slot}`).checked ? 'True' : 'False'})`);
      redraw();
    };
    $(`#${id}_n${r.slot}`).onchange = save; $(`#${id}_l${r.slot}`).onchange = save; $(`#${id}_f${r.slot}`).onchange = save;
    $(`#${id}_x${r.slot}`).onclick = () => { setProp(a, `InitialAlliances(${r.slot})`, '(AllianceName=None,AllianceLevel=0.000000,bPermanent=False)'); redraw(); };
  }
  const add = $(`#${id}_add`);
  if (add) add.onclick = () => { const has = relationsOf(a).some((r) => r.name.toLowerCase() === 'player'); setRelation(a, has ? 'NewFaction' : 'Player', '0', false); redraw(); };
}

// the Factions panel: every faction of the map, its members, how they treat JC; change a whole faction
const facBox = document.createElement('div');
facBox.id = 'facbox';
document.body.appendChild(facBox);
async function openFactions() {
  await loadFactions();
  const members = factionMembers();
  const groups = new Map();
  for (const m of members) { const k = m.faction === 'None' ? '(no faction)' : m.faction; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  const toJC = (list) => {
    const c = { 1: 0, 0: 0, '-1': 0 };
    for (const m of list) { const r = m.rel.find((x) => x.name.toLowerCase() === 'player'); c[r ? levelKey(r.level) : '0']++; }
    return ATTITUDES.filter(([k]) => c[k]).map(([k, t]) => `<span class="${k === '-1' ? 'bad' : k === '1' ? 'ok' : ''}">${t} ${c[k]}</span>`).join(' · ');
  };
  const names = [...groups.keys()].sort((x, y) => x.localeCompare(y));
  const facOptions = (sel) => [...new Set(['Player'].concat([...factionList.options].map((o) => o.value)))].map((f) => `<option value="${escapeHtml(f)}" ${f === sel ? 'selected' : ''}>${escapeHtml(facLabel(f))}</option>`).join('');
  facBox.innerHTML = `<div class="row"><b style="flex:1">Factions in ${escapeHtml(mapName)}</b><button id="fclose">Close</button></div>
    <div class="hint" style="margin:4px 0 8px">How the characters treat JC and each other when the map starts. Members of the same faction are always friends. A relation that is not <i>fixed</i> turns hostile when JC attacks them, as in the game. To change it during the mission (after a dialogue, when a flag is set...), use the Story: action <i>A faction...</i>.</div>
    <table class="ftab"><tr><th>Faction</th><th>Characters</th><th>Towards JC</th></tr>
    ${names.map((f, k) => `<tr><td><b>${escapeHtml(f)}</b></td><td><a href="#" data-fx="${k}">${groups.get(f).length}</a><div class="fmem" id="fmem${k}" style="display:none">${groups.get(f).map((m) => `<a href="#" data-sel="${escapeHtml(m.name)}">${escapeHtml(m.name)}</a>`).join(' ')}</div></td><td>${toJC(groups.get(f))}</td></tr>`).join('')
      || '<tr><td colspan="3" class="hint">No characters in this map.</td></tr>'}</table>
    <div class="row" style="margin-top:10px;flex-wrap:wrap"><b>Change a whole faction:</b>
      <select id="ffac">${names.filter((f) => f !== '(no faction)').map((f) => `<option>${escapeHtml(f)}</option>`).join('')}</select> towards
      <select id="fto">${facOptions('Player')}</select> becomes
      <select id="flev">${ATTITUDES.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}<option value="none">(no relation)</option></select>
      <label style="width:auto"><input type="checkbox" id="ffix"> fixed</label><button id="fapply" class="primary">Apply</button></div>`;
  facBox.style.display = 'block';
  $('#fclose').onclick = () => { facBox.style.display = 'none'; };
  for (const l of facBox.querySelectorAll('[data-fx]')) l.onclick = (e) => { e.preventDefault(); const d = $('#fmem' + l.dataset.fx); d.style.display = d.style.display === 'none' ? 'block' : 'none'; };
  for (const l of facBox.querySelectorAll('[data-sel]')) l.onclick = (e) => { e.preventDefault(); const q = proxyOf(l.dataset.sel); if (q) { select(q); focusSelected(); } };
  if ($('#fapply')) $('#fapply').onclick = () => {
    const fac = $('#ffac').value, to = $('#fto').value, lev = $('#flev').value, fixed = $('#ffix').checked;
    if (!fac) return;
    pushUndo();
    let n = 0, full = 0;
    for (const m of members) if (m.faction === fac) { if (setRelation(m.a, to, lev, fixed, false)) n++; else full++; }
    setDirty();
    log(`${fac}: ${n} character${n === 1 ? '' : 's'} now ${lev === 'none' ? 'without a relation with' : ATTITUDES.find((x) => x[0] === lev)[1] + ' towards'} ${facLabel(to)}${full ? ` (${full} had no free relation slot)` : ''}. Rebuild to put it in the map.`, 'ok');
    openFactions();
    if (selected) showDetails();
  };
}

// texts for the game's fonts (Latin-1): typographic quotes and dashes made plain
function plainText(s) {
  return String(s ?? '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-')
    .replace(/…/g, '...').replace(/[^\u0000-ÿ]/g, '?');
}
// a field of a struct value (Map from mergeStruct) whatever the case of its name: the game writes
// UserName where the class says userName
const skey = (m, k) => [...m.keys()].find((x) => x.toLowerCase() === k.toLowerCase()) || k;
const sget = (m, k) => m.get(skey(m, k));
// the logins of a computer's accounts (its userList, as edited)
function loginsOf(a, fields) {
  const uf = fields.find((x) => x.prop === 'userList');
  if (!uf) return [];
  const out = [];
  for (let i = 0; i < uf.default.length; i++) {
    const n = unquote(sget(new Map(mergeStruct(uf.default[i], propValue(a, uf, i))), 'userName') || '');
    if (n) out.push(n);
  }
  return out;
}
// a change to the emails or bulletins of a computer (edits.texts): the computer then reads its texts
// from the mod (TextPackage), a public terminal its own list of bulletins (bulletinTag)
function editTexts(a, fn) {
  pushUndo();
  edits.texts = edits.texts || {};
  const t = edits.texts[a.name] || (edits.texts[a.name] = { emails: [], bulletins: [] });
  t.emails = t.emails || []; t.bulletins = t.bulletins || [];
  fn(t);
  t.loc = (a.loc || [0, 0, 0]).map((v) => Math.round(v));
  edits.props = edits.props || {};
  const e = edits.props[a.name] || (edits.props[a.name] = {});
  if (t.emails.length || t.bulletins.length) e.TextPackage = PACKAGE;
  else delete e.TextPackage;
  if (t.bulletins.length) e.bulletinTag = `UCBulletins_${mapName.replace(/\W/g, '_')}_${a.name.replace(/\W/g, '_')}`;
  else delete e.bulletinTag;
  if (!t.emails.length && !t.bulletins.length) delete edits.texts[a.name];
  setDirty();
}

// The Inspector keeps existing fields and handlers inside native, keyboard-accessible foldouts.
const inspectorFolds = (() => { try { const value = JSON.parse(localStorage.getItem('deusedix.inspector.folds') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } })();
function inspectorSectionStart(key, title, open = false) {
  const expanded = Object.hasOwn(inspectorFolds, key) ? inspectorFolds[key] : open;
  return `<details class="inspector-section" data-inspector-section="${escapeHtml(key)}" ${expanded ? 'open' : ''}><summary>${escapeHtml(title)}</summary><div class="inspector-section-body">`;
}
function inspectorSection(key, title, body, open = false) { return inspectorSectionStart(key, title, open) + body + '</div></details>'; }
function wireInspectorSections(root) {
  for (const section of root.querySelectorAll('details.inspector-section')) {
    if (section.dataset.foldWired) continue;
    section.dataset.foldWired = '1';
    section.addEventListener('toggle', () => {
      inspectorFolds[section.dataset.inspectorSection] = section.open;
      try { localStorage.setItem('deusedix.inspector.folds', JSON.stringify(inspectorFolds)); } catch { /* optional preference */ }
    });
  }
}
function inspectorObjectControls(p) {
  const box = $('#details')?.firstElementChild;
  if (!box || !p) return;
  const keys = p === groupPivot ? selKeys() : [keyOf(p)], locked = selectionLocked(p);
  const targets = p === groupPivot ? members() : [p], hidden = targets.every(objectHidden), a = p.userData.actor;
  const fields = document.createElement('fieldset');
  fields.className = 'inspector-fields';
  fields.disabled = locked;
  while (box.firstChild) fields.appendChild(box.firstChild);
  const bar = document.createElement('div');
  bar.className = 'inspector-state';
  bar.innerHTML = `${a ? `<label title="Include this object in the game after Rebuild. Its settings are kept while disabled."><input type="checkbox" data-game-enabled ${edits.disabled?.[a.name] ? '' : 'checked'} ${locked ? 'disabled' : ''}> Enabled in game</label>` : '<span class="hint">Scene controls</span>'}
    <button type="button" class="hstate" data-inspector-eye aria-label="${hidden ? 'Show in Scene' : 'Hide in Scene'}" title="${hidden ? 'Show in Scene (and reveal hidden parents)' : 'Hide in Scene only; stays in game'}" aria-pressed="${hidden}">${ICON[hidden ? 'eyeoff' : 'eye']}</button>
    <button type="button" class="hstate" data-inspector-lock aria-label="${locked ? 'Unlock selection' : 'Lock selection'}" title="${locked ? 'Unlock selection' : 'Lock selection against accidental edits'}" aria-pressed="${locked}">${ICON[locked ? 'lock' : 'unlock']}</button>`;
  box.append(bar);
  if (locked) { const hint = document.createElement('p'); hint.className = 'hint inspector-lock-hint'; hint.textContent = 'Locked in the editor. Unlock to make changes.'; box.append(hint); }
  box.append(fields);
  bar.querySelector('[data-game-enabled]')?.addEventListener('change', e => setGameEnabled([a.name], e.target.checked));
  bar.querySelector('[data-inspector-eye]').onclick = () => { setObjectView(keys, 'hidden', !hidden); showDetails(); };
  bar.querySelector('[data-inspector-lock]').onclick = () => { setObjectView(keys, 'locked', !locked); showDetails(); };
}
function revealInspector(el) {
  if (!el?.closest('#details')) return;
  window.__workspace?.show('inspector');
  for (let parent = el; parent; parent = parent.parentElement) if (parent.matches('details.inspector-section')) parent.open = true;
}
async function focusInspector(spec, selector) {
  inspectorPin = null;                       // An explicit request to inspect another field wins.
  specSelect(spec);
  const p = selected;
  if (p?.userData.actor) await renderProps(p);
  if (selected !== p) return;
  const target = $('#details')?.querySelector(selector);
  revealInspector(target || $('#details'));
  if (target) { target.scrollIntoView({ block: 'nearest' }); (target.matches('input,button,select,textarea') ? target : target.querySelector('input,button,select,textarea,summary'))?.focus({ preventScroll: true }); }
}
function inspectorFieldGroup(f) {
  if (f.group !== 'Character') return f.group;
  if (['Orders', 'OrderTag', 'bInWorld'].includes(f.prop)) return 'Behaviour';
  if (['Alliance', 'InitialAlliances'].includes(f.prop)) return 'Relations';
  if (f.prop === 'InitialInventory') return 'Inventory';
  if (['FamiliarName', 'UnfamiliarName', 'BindName'].includes(f.prop)) return 'Identity';
  return 'Health';
}
const INSPECTOR_LABELS = { Tag: 'Engine tag (legacy)', KeyIDNeeded: 'Key ID', bPickable: 'Lockpickable', bBreakable: 'Breakable', bFrobbable: 'Opens by hand', bOneWay: 'One-way', MoveTime: 'Open time (s)', StayOpenTime: 'Stay open (s)', bToggleLock: 'Toggle lock', FailEvent: 'Wrong-code event', cameraTag: 'Camera tag', turretTag: 'Turret tag', doorTag: 'Door tag', OrderTag: 'Target tag', UnfamiliarName: 'Unknown name', BindName: 'Dialogue name', bImportant: 'Mission critical', PauseTime: 'Wait (s)', Nextpatrol: 'Next point', PatrolAnim: 'Waiting animation', gazeTag: 'Look at', gazeDuration: 'Look time (s)', bKillZone: 'Instant death', bSolidBox: 'Solid', bAnyPawn: 'Any character', ReTriggerDelay: 'Repeat delay (s)', bSpecialLit: 'Special-lit only' };

async function renderProps(p) {
  if (propertySlider && propertySlider.p === p) return;
  const a = p.userData.actor, box = $('#propsec');
  if (!box || !a) return;
  let fields = propSchema[a.cls];
  if (!fields) {
    try { const r = await api('/api/props?cls=' + encodeURIComponent(a.cls)); fields = r.fields || []; propItems = r.items || propItems; }
    catch (e) { fields = []; }
    propSchema[a.cls] = fields;
  }
  await loadFactions();
  if (fields.some((f) => f.kind === 'mapurl') && !allMapNames) {
    try { allMapNames = (await api('/api/newmap_info')).maps; } catch (e) { allMapNames = []; }
  }
  // the kinds of the objects of its interactions (what they can do, what can start them)
  const related = new Set([a.cls]);
  for (const l of lkList()) if (l.src === a.name || (l.do || []).some((x) => x.target === a.name))
    for (const n of [l.src, ...(l.do || []).map((x) => x.target)]) { const o = lkActor(n); if (o) related.add(o.cls); }
  await Promise.all([...related].map(chainOf));
  if (lkList().some((l) => (l.do || []).some((x) => x.verb === 'travel')) && !allMapNames) {
    try { allMapNames = (await api('/api/newmap_info')).maps; } catch (e) { allMapNames = []; }
  }
  if (inspectedObject() !== p || !document.body.contains(box)) return;
  if (lkList().some(l => (l.do || []).some(x => x.area)) && !await lkAreaReady()) return;
  if (inspectedObject() !== p || !document.body.contains(box)) return;
  const links = linksOf(a);
  drawLinks(p, links);
  lkDraw(a);
  disposeGroup(routeLines);                 // the patrol route of a character, or the routes through a patrol point
  const character = fields.some((f) => f.prop === 'Orders');
  if (character) drawRoute(a);
  else if (a.cls === 'PatrolPoint') for (const o of routeUsers(a)) drawRoute(o);
  const redraw = () => renderProps(p);
  const itemSel = (id, v) => `<select id="${id}" style="max-width:190px"><option value="">(nothing)</option>${[...new Set(propItems.map((x) => x.cat))].map((c) => `<optgroup label="${escapeHtml(c)}">${propItems.filter((x) => x.cat === c).map((x) => `<option value="${x.cls}" ${x.cls.toLowerCase() === v.toLowerCase() ? 'selected' : ''}>${escapeHtml(x.name)} · ${escapeHtml(x.cls.split('.').pop())}</option>`).join('')}</optgroup>`).join('')}</select>`;
  let html = scriptTagHtml(a), group = '';
  const wires = [() => wireScriptTag(a, p, redraw)];
  if (canReplaceModel(p)) {
    html += inspectorSectionStart('appearance-model', 'Model', true) + modelReplaceRow(a, 'replace-model') + '</div></details>';
    wires.push(() => { $('#replace-model').onclick = () => inspectorAction(p, () => beginModelReplacement(p)); });
  }
  const lk = lkSection(a, p, redraw);
  wires.push(lk.wire);
  fields.forEach((f, k) => {
    if (f.kind === 'mesh') return; // One shared appearance control for all mesh actors.
    if (a.cls === 'UCTriggerBox') {
      const cylinder = isCylinder(a, actorProp);
      if (cylinder && ['BoxX', 'BoxY', 'BoxZ'].includes(f.prop)) return;
      if (!cylinder && ['CylinderRadius', 'CylinderHeight'].includes(f.prop)) return;
    }
    const nextGroup = f.group === 'Model' ? 'Model behaviour' : inspectorFieldGroup(f);
    if (nextGroup !== group) {
      if (group) html += '</div></details>';
      group = nextGroup;
      html += inspectorSectionStart(group, group === 'Links' ? 'Tags & events' : group, !['Links', 'Sound', 'Door sounds', 'Inventory', 'Health'].includes(group));
    }
    const id = 'pp' + k, tip = f.help ? ` title="${escapeHtml(f.help)}"` : '';
    const label = INSPECTOR_LABELS[f.prop] || f.label;
    const lab = `<label style="width:auto;min-width:96px"${tip}>${escapeHtml(label)}</label>`;
    const v = propValue(a, f);
    if (f.prop === 'BindName' && window.__gamecons?.data?.actors[a.name]?.length) {
      html += `<div class="row">${lab}<input type="text" readonly aria-label="Original conversation BindName" value="${escapeHtml(unquote(v))}" style="flex:1;min-width:0" title="Used by the original conversations"></div>`;
    } else if (f.kind === 'collision_shape') {
      html += `<div class="row">${lab}<select id="${id}" aria-label="Collision shape" style="flex:1;min-width:0;padding:0 8px"${tip}><option value="False" ${!isCylinder(a, actorProp) ? 'selected' : ''}>Box</option><option value="True" ${isCylinder(a, actorProp) ? 'selected' : ''}>Cylinder</option></select></div>`;
      wires.push(() => { $('#' + id).onchange = () => {
        if (!requireUnlocked(p)) return;
        pushUndo();
        const cylinder = $('#' + id).value === 'True';
        putProp(a, 'bCylinder', cylinder ? 'True' : 'False');
        // Seed the first cylinder from this box. Later switches preserve both sets of dimensions.
        if (cylinder && actorProp(a, 'CylinderRadius') == null) putProp(a, 'CylinderRadius', Math.max(2, +(actorProp(a, 'BoxX') ?? 64), +(actorProp(a, 'BoxY') ?? 64)).toFixed(6));
        if (cylinder && actorProp(a, 'CylinderHeight') == null) putProp(a, 'CylinderHeight', Math.max(2, +(actorProp(a, 'BoxZ') ?? 64)).toFixed(6));
        setDirty(); refreshTriggerBox(p); wake(); redraw();
      }; });
    } else if (f.kind === 'bool') {
      html += `<div class="row"><label style="width:auto"${tip}><input type="checkbox" id="${id}" ${String(v).toLowerCase() === 'true' ? 'checked' : ''}> ${escapeHtml(label)}</label></div>`;
      wires.push(() => { $('#' + id).onchange = () => { setProp(a, f.prop, $('#' + id).checked ? 'True' : 'False'); showSoundRange(p); redraw(); }; });
      if (f.prop === 'bInWorld') { html += stayPutHtml(a); wires.push(() => wireStayPut(a, p)); }
    } else if (f.kind === 'mapurl') {
      const [toMap, toTag] = unquote(v).split('#');
      html += `<div class="row">${lab}<select id="${id}m" style="flex:1;min-width:0"${tip}><option value="">(nowhere: an arrival point)</option>${(allMapNames || []).map((m) => `<option ${m.toLowerCase() === (toMap || '').toLowerCase() ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}</select></div>
        <div class="row"><label style="width:auto;min-width:96px" title="where JC appears in that map">arriving at</label><select id="${id}t" style="flex:1;min-width:0"><option value="">${toMap ? '...' : '-'}</option></select></div>`;
      wires.push(() => {
        const ms = $('#' + id + 'm'), ts = $('#' + id + 't');
        const fill = async (m, keep) => {
          if (!m) { ts.innerHTML = '<option value="">-</option>'; return; }
          try {
            const r = await api('/api/arrivals?map=' + encodeURIComponent(m));
            ts.innerHTML = `<option value="">${r.start ? 'the start of the map' : 'the start of the map (it has no PlayerStart!)'}</option>` +
              r.tags.map((t) => `<option ${t.toLowerCase() === (keep || '').toLowerCase() ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('') +
              (keep && !r.tags.some((t) => t.toLowerCase() === keep.toLowerCase()) ? `<option selected>${escapeHtml(keep)}</option>` : '');
          } catch (e) { ts.innerHTML = `<option value="${escapeHtml(keep || '')}">${escapeHtml(keep || '?')}</option>`; }
        };
        fill(toMap, toTag);
        const save = () => {
          const m = ms.value;
          setProp(a, 'URL', m ? `"${m}${ts.value ? '#' + ts.value : ''}"` : '""');
          setProp(a, 'bEnabled', m ? 'True' : 'False');          // an exit is active, an arrival point is not
          redraw();
        };
        ms.onchange = async () => { await fill(ms.value, ''); save(); };
        ts.onchange = save;
      });
    } else if (f.kind === 'byte') {
      html += `<div class="row slider-row">${lab}<input type="range" id="${id}" aria-label="${escapeHtml(f.label)}" min="0" max="255" value="${+v || 0}" style="flex:1;min-width:0;padding:0"><input type="number" id="${id}n" aria-label="${escapeHtml(f.label)} value" min="0" max="255" value="${+v || 0}" style="width:58px"></div>`;
      wires.push(() => {
        const r = $('#' + id), n = $('#' + id + 'n');
        wirePropertySlider(p, r, n, f.prop);
      });
    } else if (f.kind === 'lightcolor') {
      // the colour of the light: UnrealEd's hue (0-255) and saturation (0 = full colour, 255 = white)
      const l = liveLight(a), hex = '#' + ueLightRGB(l.hue, l.sat).map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
      html += `<div class="row">${lab}<input type="color" data-light-color id="${id}c" value="${hex}" title="pick the colour (sets Hue and Saturation)" style="width:46px;height:28px;padding:1px">
        <span class="hint" data-light-hint style="margin:0">brightness ${l.b}, radius ${l.radius}</span></div>
        <div class="row slider-row"><label for="${id}" style="width:auto;min-width:96px">Hue</label><input type="range" id="${id}" aria-label="Hue" min="0" max="255" value="${l.hue}" style="flex:1;min-width:0;padding:0;background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"><input type="number" id="${id}n" aria-label="Hue value" min="0" max="255" value="${l.hue}" style="width:58px"></div>`;
      wires.push(() => {
        const r = $('#' + id), n = $('#' + id + 'n'), c = $('#' + id + 'c');
        wirePropertySlider(p, r, n, 'LightHue');
        c.onchange = () => {
          const [hue, sat] = ueHueSat(c.value);
          setProp(a, 'LightHue', String(hue));
          setProp(a, 'LightSaturation', String(sat));
          refreshLight(p);
          redraw();
        };
      });
    } else if (f.kind === 'int' || f.kind === 'float') {
      html += `<div class="row">${lab}<input type="number" id="${id}" value="${escapeHtml(String(+v || 0))}" step="${f.kind === 'int' ? 1 : 0.05}" style="width:80px"></div>`;
      wires.push(() => { $('#' + id).onchange = () => { const n = +$('#' + id).value || 0; setProp(a, f.prop, f.kind === 'int' ? String(Math.round(n)) : n.toFixed(6)); showSoundRange(p); redraw(); }; });
    } else if (f.kind === 'text') {
      html += `<div id="${id}" class="game-document"></div>`;
      wires.push(() => window.__gameDocuments?.mount($('#' + id), {
        actor:a, tag:unquote(propValue(a, fields.find(x=>x.prop==='textTag') || {prop:'textTag',default:['None']})),
        packageName:unquote(edits.props?.[a.name]?.TextPackage ?? a.props?.TextPackage ?? ''),
        special:unquote(v), current:edits.documents?.[a.name],
        save:doc=>{pushUndo(); edits.documents ||= {}; if(doc) edits.documents[a.name]=doc; else delete edits.documents[a.name]; setDirty(); redraw();}
      }));
    } else if (f.prop === 'textTag' && edits.documents?.[a.name]) {
      html += `<p class="hint">Using your document copy. Restore original above to use the game text again.</p>`;
    } else if (f.kind === 'options') {
      // a computer's special options: a button after logging in, its message, the event it triggers,
      // the account that has it (none: every account)
      const logins = loginsOf(a, fields);
      const rows = [];
      for (let i = 0; i < f.default.length; i++) {
        const m = new Map(mergeStruct(f.default[i], propValue(a, f, i)));
        if (unquote(sget(m, 'Text') || '')) rows.push([i, m]);
      }
      const free = [...Array(f.default.length).keys()].find((i) => !rows.some((r) => r[0] === i));
      html += `<div class="row">${lab}</div>`;
      for (const [i, m] of rows) {
        const user = unquote(sget(m, 'userName') || ''), ev = String(sget(m, 'TriggerEvent') || 'None');
        html += `<div class="box" style="margin:4px 0;padding:6px">
          <div class="row"><label style="width:62px">Button</label><input type="text" data-op="${i}" data-k="Text" value="${escapeHtml(unquote(sget(m, 'Text')))}" style="flex:1;min-width:0"><button data-opx="${i}" title="remove">✕</button></div>
          <div class="row"><label style="width:62px">Message</label><input type="text" data-op="${i}" data-k="TriggerText" value="${escapeHtml(unquote(sget(m, 'TriggerText') || ''))}" placeholder="what the screen says when it is used" style="flex:1;min-width:0"></div>
          <div class="row"><label style="width:62px">Triggers</label><input type="text" data-op="${i}" data-k="TriggerEvent" value="${escapeHtml(ev === 'None' ? '' : ev)}" placeholder="the Tag of a door, an alarm..." style="flex:1;min-width:0"></div>
          <div class="row"><label style="width:62px">Account</label><select data-op="${i}" data-k="userName"><option value="">(every account)</option>${[...new Set(logins.concat(user ? [user] : []))].map((l) => `<option ${l === user ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
            <label style="width:auto"><input type="checkbox" data-op="${i}" data-k="bTriggerOnceOnly" ${String(sget(m, 'bTriggerOnceOnly')) === 'True' ? 'checked' : ''}> once</label></div></div>`;
      }
      if (free !== undefined) html += `<div class="row"><button id="${id}_add">+ option</button></div>`;
      wires.push(() => {
        const save = (i) => {
          const m = new Map(mergeStruct(f.default[i], propValue(a, f, i)));
          for (const x of box.querySelectorAll(`[data-op="${i}"]`)) {
            const k = skey(m, x.dataset.k);
            if (k === skey(m, 'bTriggerOnceOnly')) m.set(k, x.checked ? 'True' : 'False');
            else if (k === skey(m, 'TriggerEvent')) m.set(k, x.value.trim().replace(/\W/g, '_') || 'None');
            else m.set(k, JSON.stringify(plainText(x.value)));
          }
          setProp(a, `${f.prop}(${i})`, structText([...m.entries()]));
        };
        for (const [i] of rows) {
          for (const x of box.querySelectorAll(`[data-op="${i}"]`)) x.onchange = () => { save(i); redraw(); };
          $(`[data-opx="${i}"]`, box).onclick = () => {
            setProp(a, `${f.prop}(${i})`, structText(mergeStruct(f.default[i], '').map(([k2, v2]) => [k2, v2.startsWith('"') ? '""' : v2])));
            redraw();
          };
        }
        const add = $('#' + id + '_add');
        if (add) add.onclick = () => {
          const m = new Map(mergeStruct(f.default[free], ''));
          m.set(skey(m, 'Text'), '"Open the door"'); m.set(skey(m, 'TriggerText'), '"Door opened."');
          setProp(a, `${f.prop}(${free})`, structText([...m.entries()]));
          redraw();
        };
      });
    } else if (f.kind === 'emails' || f.kind === 'bulletins') {
      // the emails of a personal computer (by account) or the bulletins of a public terminal:
      // edits.texts[name], made into texts of the map by editor/comptexts.py at Rebuild
      const t = (edits.texts || {})[a.name] || {};
      const emails = f.kind === 'emails', list = (emails ? t.emails : t.bulletins) || [];
      const logins = emails ? loginsOf(a, fields) : [];
      const ta = 'width:100%;min-width:0;resize:vertical;font:inherit;color:inherit;background:#262a33;border:1px solid var(--line);border-radius:5px;padding:5px 8px';
      html += `<div class="row">${lab}</div>`;
      if (emails && !logins.length) html += '<div class="hint" style="margin:0 0 4px">Add an account under Accounts first: an email belongs to an account.</div>';
      list.forEach((e, i) => {
        html += `<div class="box" style="margin:4px 0;padding:6px">`
          + (emails ? `<div class="row"><label style="width:58px">Account</label><select data-tx="${i}" data-k="user">${[...new Set(logins.concat(e.user ? [e.user] : []))].map((l) => `<option ${l === e.user ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select><span style="flex:1"></span><button data-txx="${i}" title="remove">✕</button></div>
            <div class="row"><label style="width:58px">From</label><input type="text" data-tx="${i}" data-k="from" value="${escapeHtml(e.from || '')}" style="flex:1;min-width:0"></div>
            <div class="row"><label style="width:58px">Subject</label><input type="text" data-tx="${i}" data-k="subject" value="${escapeHtml(e.subject || '')}" style="flex:1;min-width:0"></div>`
            : `<div class="row"><label style="width:58px">Title</label><input type="text" data-tx="${i}" data-k="title" value="${escapeHtml(e.title || '')}" style="flex:1;min-width:0"><button data-txx="${i}" title="remove">✕</button></div>`)
          + `<textarea data-tx="${i}" data-k="body" rows="5" placeholder="${emails ? 'The email' : 'The bulletin'}" style="${ta}">${escapeHtml(e.body || '')}</textarea></div>`;
      });
      html += `<div class="row"><button id="${id}_add" ${emails && !logins.length ? 'disabled' : ''}>+ ${emails ? 'Email' : 'Bulletin'}</button></div>`;
      wires.push(() => {
        const key = emails ? 'emails' : 'bulletins';
        for (const x of box.querySelectorAll('[data-tx]')) x.onchange = () => editTexts(a, (tt) => { tt[key][+x.dataset.tx][x.dataset.k] = plainText(x.value); });
        for (const b of box.querySelectorAll('[data-txx]')) b.onclick = () => { editTexts(a, (tt) => tt[key].splice(+b.dataset.txx, 1)); redraw(); };
        const add = $('#' + id + '_add');
        if (add) add.onclick = () => {
          editTexts(a, (tt) => tt[key].push(emails ? { user: logins[0], from: '', subject: '', body: '' } : { title: '', body: '' }));
          redraw();
        };
      });
    } else if (f.kind === 'name' || f.kind === 'string') {
      const shown = f.kind === 'name' && String(v) === 'None' ? '' : unquote(v);
      html += `<div class="row">${lab}<input type="text" id="${id}" value="${escapeHtml(shown)}" placeholder="${f.kind === 'name' ? 'None' : ''}" style="flex:1;min-width:0"></div>`;
      wires.push(() => { $('#' + id).onchange = () => { const t = $('#' + id).value.trim(); setProp(a, f.prop, f.kind === 'name' ? (t.replace(/\W/g, '_') || 'None') : t); redraw(); }; });
    } else if (f.kind === 'choice' || f.kind === 'enum') {
      const opts = f.options.includes(String(v)) ? f.options : [String(v)].concat(f.options);
      html += `<div class="row">${lab}<select id="${id}">${opts.map((o) => `<option ${o === String(v) ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></div>`;
      wires.push(() => { $('#' + id).onchange = () => { setProp(a, f.prop, $('#' + id).value); redraw(); }; });
    } else if (f.kind === 'anim') {
      // the animation of a patrol point: one of the characters patrolling through it (their models)
      const users = routeUsers(a);
      html += `<div class="row">${lab}<select id="${id}" style="flex:1;min-width:0"${tip}><option>...</option></select><button id="${id}p" data-animplay="1" title="Play it on the character">▶</button></div>`;
      if (!users.length) html += '<div class="hint" style="margin:0 0 4px">No character patrols through this point yet: draw a Patrol route in a character\'s Properties.</div>';
      wires.push(async () => {
        const lists = (await Promise.all(users.map((u) => animsOf(u.cls)))).filter(Boolean);
        const sel = $('#' + id);
        if (!sel || !document.body.contains(sel)) return;
        const seqs = [], seen = new Set();
        for (const l of lists) for (const s of l.seqs) if (!seen.has(s.name)) { seen.add(s.name); seqs.push(s); }
        const cur = String(v || 'None') === 'None' ? '' : String(v);
        sel.innerHTML = seqOptions(seqs, cur, '(none: they breathe)');
        sel.onchange = async () => {
          const s = seqs.find((x) => x.name === sel.value);
          if (s && s.custom && window.__studio) {     // a Studio animation: the characters take their model with it
            for (const u of users) await window.__studio.ensure(u.cls, s.name, (t) => status(t)).catch((err) => log('Animation Studio: ' + err.message, 'bad'));
            edits.anims = edits.anims || {};
            for (const u of users) { const q = proxyOf(u.name); edits.anims[u.name] = Object.assign({ loc: q ? UE(q.position) : u.loc }, edits.anims[u.name], { own: true }); }
          }
          pushUndo();
          putProp(a, 'PatrolAnim', sel.value || 'None');
          if (s && !(+actorProp(a, 'PauseTime') > 0)) putProp(a, 'PauseTime', Math.max(3, Math.ceil(2 * s.frames / s.rate)).toFixed(6));
          setDirty(); redraw();
        };
        $('#' + id + 'p').onclick = async () => {
          const u = users[0], q = u && proxyOf(u.name);
          if (previewing && q && previewing.g === q) { stopPreview(); return; }
          if (q && sel.value && await startPreview(q, u.cls, sel.value)) $('#' + id + 'p').textContent = '■';
        };
      });
    } else if (f.kind === 'sound') {
      // a sound of the game: its name, listen, choose another in the picker
      const cur = soundRef(v);
      html += `<div data-sndprop="${escapeHtml(f.prop)}" title="Drop a sound here from the browser (Sounds, My sounds)"><div class="row">${lab}<span style="flex:1"></span>${cur ? `<button id="${id}p" data-splay="${escapeHtml(cur)}" title="Listen">▶</button>` : ''}<button id="${id}c" title="Choose a sound: the game's or yours (or drop one here from the browser)">Choose...</button></div>
        <div class="row" style="margin-top:-2px"><span class="hint" title="${escapeHtml(cur)}" style="margin:0 0 0 8px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(cur ? cur.split('.').slice(1).join(' · ') || cur : '(none)')}</span></div></div>`;
      wires.push(() => {
        const pl = $('#' + id + 'p');
        if (pl) pl.onclick = () => playSound(cur, pl);
        $('#' + id + 'c').onclick = () => pickSound(cur, (name) => { setProp(a, f.prop, name ? `Sound'${name}'` : 'None'); showSoundRange(p); redraw(); });
      });
    } else if (f.kind === 'hidden') {
      return;
    } else if (f.kind === 'half' || f.kind === 'radius') {
      // Box dimensions and cylinder height are displayed whole; radius stays a radius.
      const factor = f.kind === 'half' ? 2 : 1, min = 2 * factor;
      html += `<div class="row">${lab}<input type="number" id="${id}" aria-label="Collision ${escapeHtml(label.toLowerCase())}" value="${Math.round((+v || 0) * factor)}" step="${4 * factor}" min="${min}" style="width:80px"${tip}></div>`;
      wires.push(() => { $('#' + id).onchange = () => { const raw = +$('#' + id).value; setProp(a, f.prop, (Math.max(min, Number.isFinite(raw) ? raw : min) / factor).toFixed(6)); refreshTriggerBox(p); wake(); redraw(); }; });
    } else if (f.kind === 'gravity') {
      const z = /Z=(-?[\d.]+)/.exec(String(v)) ? +/Z=(-?[\d.]+)/.exec(String(v))[1] : -950;
      html += `<div class="row">${lab}<input type="number" id="${id}" value="${z}" step="50" style="width:80px"${tip}><span class="hint" style="margin:0">the game: -950</span></div>`;
      wires.push(() => { $('#' + id).onchange = () => { setProp(a, f.prop, `(X=0.000000,Y=0.000000,Z=${(+$('#' + id).value || 0).toFixed(6)})`); redraw(); }; });
    } else if (f.kind === 'mesh') {
      const cur = meshOf(a);
      html += `<div class="row">${lab}<span class="hint" style="margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(cur)}">${escapeHtml(cur || '(none)')}</span><button id="${id}c" title="Click another model in the Models tab">Change...</button></div>`;
      wires.push(() => { $('#' + id + 'c').onclick = () => inspectorAction(p, () => beginModelReplacement(p)); });
    } else if (f.kind === 'item') {
      html += `<div class="row">${lab}${itemSel(id, classRef(v))}</div>`;
      wires.push(() => { $('#' + id).onchange = () => { const c = $('#' + id).value; setProp(a, f.prop, c ? `Class'${c}'` : 'None'); redraw(); }; });
    } else if (f.kind === 'faction') {
      const shown = String(v) === 'None' ? '' : String(v);
      html += `<div class="row">${lab}<input type="text" id="${id}" list="factionlist" value="${escapeHtml(shown)}" placeholder="None" style="flex:1;min-width:0"></div>`;
      wires.push(() => { $('#' + id).onchange = () => { setProp(a, f.prop, $('#' + id).value.trim().replace(/\W/g, '_') || 'None'); loadFactions(); redraw(); }; });
    } else if (f.kind === 'relations') {
      html += `<div class="row">${lab}</div>` + relationsHtml(a, id);
      wires.push(() => wireRelations(a, id, redraw));
    } else if (f.kind === 'attitude') {
      let idx = -1, level = null;
      for (let i = 0; i < f.default.length; i++) {
        const m = new Map(mergeStruct(f.default[i], propValue(a, f, i)));
        if (String(m.get('AllianceName') || '').toLowerCase() === 'player') { idx = i; level = parseFloat(m.get('AllianceLevel') || '0'); break; }
      }
      const cur = level === null ? '' : level > 0.3 ? '1' : level < -0.3 ? '-1' : '0';
      html += `<div class="row">${lab}<select id="${id}"${tip}><option value="" ${cur === '' ? 'selected' : ''}>(as its alliance says)</option><option value="1" ${cur === '1' ? 'selected' : ''}>friendly</option><option value="0" ${cur === '0' ? 'selected' : ''}>neutral</option><option value="-1" ${cur === '-1' ? 'selected' : ''}>hostile</option></select></div>`;
      wires.push(() => { $('#' + id).onchange = () => {
        const want = $('#' + id).value;
        let i = idx;
        if (i < 0) for (let j = 0; j < f.default.length && i < 0; j++) if (/AllianceName=None/i.test(structText(mergeStruct(f.default[j], propValue(a, f, j))))) i = j;
        if (i < 0) { log('No free alliance slot on this character.', 'warn'); return; }
        setProp(a, `${f.prop}(${i})`, want === '' ? '(AllianceName=None,AllianceLevel=0.000000,bPermanent=False)'
          : `(AllianceName=Player,AllianceLevel=${(+want).toFixed(6)},bPermanent=False)`);
        redraw(); }; });
    } else if (f.kind === 'inventory' || f.kind === 'users') {
      const rows = [];
      for (let i = 0; i < f.default.length; i++) {
        const pairs = mergeStruct(f.default[i], propValue(a, f, i));
        const empty = f.kind === 'inventory' ? !classRef(new Map(pairs).get('Inventory'))
          : pairs.filter(([, val]) => val.startsWith('"')).every(([, val]) => val === '""');
        if (!empty) rows.push([i, pairs]);
      }
      const free = [...Array(f.default.length).keys()].find((i) => !rows.some((r) => r[0] === i));
      html += `<div class="row">${lab}</div>`;
      for (const [i, pairs] of rows) {
        const m = new Map(pairs);
        if (f.kind === 'inventory') html += `<div class="row" style="padding-left:8px">${itemSel(`${id}_${i}`, classRef(m.get('Inventory')))} × <input type="number" id="${id}_${i}n" value="${+m.get('Count') || 1}" min="1" style="width:46px"><button id="${id}_${i}x" title="remove">✕</button></div>`;
        else html += `<div class="row" style="padding-left:8px;flex-wrap:wrap">${pairs.filter(([, val]) => val.startsWith('"') || /^-?\d/.test(val)).map(([k2, val]) => `<input type="text" data-sk="${k2}" data-row="${i}" value="${escapeHtml(unquote(val))}" placeholder="${escapeHtml(k2)}" title="${escapeHtml(k2)}" style="width:80px">`).join('')}<button id="${id}_${i}x" title="remove">✕</button></div>`;
      }
      if (free !== undefined) html += `<div class="row" style="padding-left:8px"><button id="${id}_add">+ ${f.kind === 'inventory' ? 'item' : 'account'}</button></div>`;
      const emptyOf = (i) => f.kind === 'inventory' ? '(Inventory=None,Count=1)'
        : structText(mergeStruct(f.default[f.default.length - 1], '').map(([k2, val]) => [k2, val.startsWith('"') ? '""' : val]));
      wires.push(() => {
        for (const [i, pairs] of rows) {
          const key = `${f.prop}(${i})`;
          if (f.kind === 'inventory') {
            const save = () => { const c = $(`#${id}_${i}`).value; setProp(a, key, c ? `(Inventory=Class'${c}',Count=${Math.max(1, Math.round(+$(`#${id}_${i}n`).value || 1))})` : emptyOf(i)); redraw(); };
            $(`#${id}_${i}`).onchange = save; $(`#${id}_${i}n`).onchange = save;
          } else {
            for (const inp of box.querySelectorAll(`[data-row="${i}"]`)) inp.onchange = () => {
              const m = new Map(pairs);
              for (const x of box.querySelectorAll(`[data-row="${i}"]`)) m.set(x.dataset.sk, String(m.get(x.dataset.sk) || '').startsWith('"') ? JSON.stringify(x.value) : (x.value || '0'));
              setProp(a, key, structText([...m.entries()])); redraw();
            };
          }
          $(`#${id}_${i}x`).onclick = () => { setProp(a, key, emptyOf(i)); redraw(); };
        }
        const add = $(`#${id}_add`);
        if (add) add.onclick = () => {
          setProp(a, `${f.prop}(${free})`, f.kind === 'inventory' ? `(Inventory=Class'${(propItems[0] || {}).cls || 'DeusEx.WeaponPistol'}',Count=1)`
            : structText(mergeStruct(f.default[f.default.length - 1], '').map(([k2, val]) => [k2, val.startsWith('"') ? (/name|account/i.test(k2) ? '"NEWUSER"' : '"PASSWORD"') : val])));
          redraw();
        };
      });
    }
  });
  if (group) html += '</div></details>';
  html += lk.html;
  if (isEffectPoint(a)) {
    const fx = fxPointSection(a, redraw);
    html += fx.html;
    wires.push(fx.wire);
  }
  if (lkCatOf(a) === 'object') {
    const us = usableSection(a, redraw);
    html += us.html;
    wires.push(us.wire);
  }
  if (character) {
    const mv = characterSections(behaveApi, a, p, redraw);
    html += routeHtml(a) + animHtml(a) + mv.html;
    wires.push(() => wireRoute(a, redraw), () => wireAnim(a, p, redraw), mv.wire);
  }
  if (a.cls === 'PlayerStart') {
    const pm = playerSection(behaveApi, a, p, redraw);
    html += pm.html;
    wires.push(pm.wire);
  }
  if (links.length) {
    html += inspectorSection('connections', 'Connections', links.map((l, k) => `<div class="row"><span style="color:${l.dir === 'out' ? '#ffa040' : '#40c0ff'}">${l.dir === 'out' ? '→' : '←'} ${escapeHtml(l.why)}</span><a href="#" data-link="${k}" style="color:var(--accent, #5aa2ff)">${escapeHtml(l.name)}${NAMES[l.cls] ? ' (' + escapeHtml(NAMES[l.cls]) + ')' : ''}</a></div>`).join(''));
  }
  if (!html) return;
  if (propertySlider && propertySlider.p === p) return;
  box.innerHTML = html;
  wireInspectorSections(box);
  for (const w of wires) w();
  for (const l of box.querySelectorAll('[data-link]')) l.onclick = (e) => { e.preventDefault(); const q = proxyOf(links[+l.dataset.link].name); if (q) select(q); };
}

let allMapNames = null;               // every map (Leads to of the map exits, New map)

// ---------------------------------------------------------------- Interactions: when this happens, do that
// Like Hammer's outputs and UEFN's direct event binding: no Tag or Event to write. A rule belongs to an object
// ("When JC uses it") and does things to other objects, each after a delay (edits.links, editor/links.py; in
// the game the mod's UCLink hooks itself to the object). Connect: click another object, and the rule is made
// with what the two usually do together. Logic (top bar): every rule of the map, as sentences.
const chainCache = {}, chainNow = {};
function chainOf(cls) {
  if (!chainCache[cls]) chainCache[cls] = api('/api/props?cls=' + encodeURIComponent(cls))
    .then((r) => { if (!propSchema[cls]) propSchema[cls] = r.fields || []; return (chainNow[cls] = r.chain || [cls]); })
    .catch(() => (chainNow[cls] = [cls]));
  return chainCache[cls];
}
function lkCat(chain) {
  const has = (c) => chain.includes(c);
  if (has('UCTimer')) return 'timer';
  if (has('DeusExMover')) return 'door';
  if (has('Keypad')) return 'keypad';
  if (has('Computers')) return 'computer';
  if (has('ScriptedPawn')) return 'character';
  if (has('LaserTrigger')) return 'laser';
  if (has('AlarmUnit')) return 'alarm';
  if (has('SecurityCamera') || has('AutoTurret')) return 'camera';
  if (has('UCSoundFX')) return 'soundfx';
  if (has('Trigger')) return 'zone';
  if (has('Light')) return 'light';
  if (has('Inventory')) return 'item';
  if (has('DeusExDecoration')) return 'object';
  return 'other';
}
const lkCatOf = (a) => (a && a.cls === 'UCCutscene' ? 'cutscene' : isEffectPoint(a) ? 'effectpoint' : a && chainNow[a.cls] ? lkCat(chainNow[a.cls]) : 'other');
// what can start a rule, for each kind of object (JC coming near works for most of them)
const LK_EVENTS = {
  door: ['opened', 'closed', 'destroyed'], keypad: ['code', 'wrongcode'], computer: ['option'], character: ['dies'],
  laser: ['laser'], alarm: ['alarm'], camera: [], soundfx: ['enter', 'leave'], zone: ['enter', 'leave'], light: [], item: ['picked'],
  object: ['used', 'gone'], other: ['any'], cutscene: ['cutstart', 'cutdone'],
};
// the building blocks (interaction-blocks.js): timers, characters using objects and getting somewhere
LK_EVENTS.timer = ['finished', 'stopped'];
LK_EVENTS.character.push('arrived');
for (const k of ['object', 'keypad', 'computer', 'other']) LK_EVENTS[k].push('npcused');
const lkEvents = (cat) => LK_EVENTS[cat].concat(['zone', 'soundfx', 'light', 'cutscene', 'timer'].includes(cat) ? [] : ['near']);
// what can start a rule on this object: its kind's events, and the end of its animation
const lkEventsOf = (a) => lkEvents(lkCatOf(a)).concat(a && (edits.motions || {})[a.name] ? ['animdone'] : []);
const lkTlOpen = new Set();
const LK_WHEN = {
  opened: 'it has opened', closed: 'it starts closing', destroyed: 'it is blown up', used: 'JC uses it',
  code: 'the right code is typed', wrongcode: 'a wrong code is typed', option: 'JC chooses an option of it',
  enter: 'JC walks in', laser: 'JC breaks its beam', alarm: 'it sounds the alarm', dies: 'they are killed or knocked out',
  any: 'it triggers its event', picked: 'JC picks it up', gone: 'it is destroyed', near: 'JC comes near', start: 'the map starts',
  leave: 'JC walks out', animdone: 'its animation has finished',
  cutstart: 'it starts (each action at its second of the cutscene)', cutdone: 'it has ended (or was skipped)',
};
Object.assign(LK_WHEN, BLOCK_WHEN);
// what a rule can do: [label, kind of object it acts on ('' none)]
const LK_VERBS = {
  open: ['Open', 'door'], close: ['Close', 'door'], toggle: ['Open or close', 'door'], lock: ['Lock', 'door'],
  unlock: ['Unlock', 'door'], blow: ['Blow up', 'door'], key: ['Give JC its key', 'door'],
  attack: ['Attack JC', 'character'], hostile: ['Turn hostile to JC', 'character'], friend: ['Become friendly', 'character'],
  neutral: ['Become neutral', 'character'], stand: ['Stand still', 'character'], wander: ['Wander about', 'character'],
  follow: ['Follow JC', 'character'], goto: ['Walk to a place', 'character'], run: ['Run to a place', 'character'],
  leave: ['Leave (when JC does not see)', 'character'], appear: ['Come back (when JC does not see)', 'character'],
  lighton: ['Turn on', 'light'], lightoff: ['Turn off', 'light'], lighttoggle: ['Turn on or off', 'light'],
  on: ['Switch on', 'any'], off: ['Switch off', 'any'], hide: ['Vanish', 'any'], show: ['Appear again', 'any'],
  explode: ['An explosion there', 'any'], sound: ['Play a sound', ''], message: ['A message on the screen', ''],
  anim: ['Play its animation', 'any'], animback: ['Play it backwards', 'any'], animstop: ['Stop its animation', 'any'],
  goal: ['A goal', ''], note: ['A note in the DataVault', ''], flag: ['Set a state', ''], travel: ['Take JC to another map', ''],
  cutplay: ['Play the cutscene', 'cutscene'], cutstop: ['Stop the cutscene', 'cutscene'],
};
Object.assign(LK_VERBS, BLOCK_VERBS);
const LK_FOR = {
  door: ['open', 'close', 'toggle', 'lock', 'unlock', 'blow', 'key', 'sound', 'explode'],
  character: ['attack', 'hostile', 'friend', 'neutral', 'stand', 'wander', 'follow', 'goto', 'run', 'leave', 'appear', 'sound'],
  light: ['lighton', 'lightoff', 'lighttoggle'], camera: ['off', 'on', 'sound', 'explode'], alarm: ['on', 'off', 'sound', 'explode'],
  laser: ['off', 'on', 'sound'], soundfx: ['on'], zone: ['on', 'off'], item: ['hide', 'show', 'sound', 'explode'],
  object: ['hide', 'show', 'sound', 'explode'], keypad: ['hide', 'show', 'sound', 'explode'],
  computer: ['hide', 'show', 'sound', 'explode'], other: ['on', 'off', 'sound', 'explode'], cutscene: ['cutplay', 'cutstop'],
};
LK_FOR.timer = [...TIMER_VERBS];
LK_FOR.character.push('npcuse');
for (const k of EFFECT_ON) LK_FOR[k].push('effect');
LK_FOR.effectpoint = ['effect'];                // an Effect point (effect-point.js): where effects go
LK_EVENTS.effectpoint = [];                     // (JC coming near still works)
const LK_DEFAULT = { door: 'open', character: 'attack', light: 'lighttoggle', camera: 'off', alarm: 'on', laser: 'off', soundfx: 'on', zone: 'on', cutscene: 'cutplay', timer: 'timerstart', effectpoint: 'effect' };
const LK_FREE = ['message', 'goal', 'note', 'flag', 'sound', 'travel'];
function lkVerbLabel(v, cat) {
  if (v === 'on') return { soundfx: 'Play it', zone: 'Activate it', alarm: 'Sound the alarm' }[cat] || 'Switch on';
  if (v === 'off') return { alarm: 'Stop the alarm', zone: 'Deactivate it' }[cat] || 'Switch off';
  return LK_VERBS[v] ? LK_VERBS[v][0] : v;
}

function lkList() { if (!edits.links) edits.links = []; return edits.links; }
function lkGet(id) { return lkList().find((l) => l.id === id); }
function lkNewId() { let n = 1; for (const l of lkList()) n = Math.max(n, (+String(l.id).replace(/\D/g, '') || 0) + 1); return 'L' + n; }
function lkActor(name) {
  if (!name) return null;
  const a = allActors().find((x) => x.name === name && !edits.deleted[x.name]);
  if (a) return a;
  const b = (edits.boxes || []).find((x) => x.name === name && x.mover);      // a moving block: a mover in the game
  if (!b) return null;
  if (!chainNow.DeusExMover) chainOf('DeusExMover');
  return { name: b.name, cls: 'DeusExMover', box: true, loc: [0, 1, 2].map((k) => (b.lo[k] + b.hi[k]) / 2) };
}
const LK_KIND = { door: 'door', light: 'light', zone: 'zone', soundfx: 'sound effect', keypad: 'keypad', laser: 'laser', alarm: 'alarm', timer: 'timer', effectpoint: 'effect point' };
function lkName(name) {
  const a = lkActor(name);
  if (!a) return name ? `${name} (missing)` : 'nothing';
  if (a.cls === 'UCCutscene') return `the cutscene "${((edits.cutscenes || {})[name] || {}).title || name}"`;
  const own = a.props && a.props.FamiliarName && unquote(a.props.FamiliarName);
  const l = own || (a.box ? 'moving block' : LK_KIND[lkCatOf(a)]) || hierLabel(a);
  return l.toLowerCase() === name.toLowerCase() ? name : `${l} ${name}`;
}
function lkWhere(name) { const q = proxyOf(name); if (q) return UE(q.getWorldPosition(new THREE.Vector3())); const a = lkActor(name); return a ? a.loc : [0, 0, 0]; }

// the sentence of a rule, as the Logic panel and the game's log show it
function lkOptionText(l) {
  const c = lkActor(l.src);
  return c ? unquote(new Map(lkOptions(c)[+l.option || 0].pairs).get('Text') || '') : '';
}
function lkWhenText(l) {
  const s = lkName(l.src);
  switch (l.when) {
    case 'opened': return `When ${s} has opened`;
    case 'closed': return `When ${s} starts closing`;
    case 'destroyed': return `When ${s} is blown up`;
    case 'used': return (edits.usable || {})[l.src] ? `When JC has used ${s}` : `When JC uses ${s}`;
    case 'code': return `When the right code is typed on ${s}`;
    case 'wrongcode': return `When a wrong code is typed on ${s}`;
    case 'option': return `When JC chooses "${lkOptionText(l) || 'option ' + ((+l.option || 0) + 1)}" on ${s}`;
    case 'enter': return `When JC walks into ${s}`;
    case 'laser': return `When JC breaks the beam of ${s}`;
    case 'alarm': return `When ${s} sounds the alarm`;
    case 'dies': return `When ${s} is killed or knocked out`;
    case 'picked': return `When JC picks up ${s}`;
    case 'gone': return `When ${s} is destroyed`;
    case 'near': return `When JC comes within ${+l.near || 256} units of ${s}`;
    case 'start': return 'When the map starts';
    case 'leave': return `When JC walks out of ${s}`;
    case 'animdone': return `When the animation of ${s} has finished`;
    case 'cutstart': return `When ${s} starts`;
    case 'cutdone': return `When ${s} has ended`;
    default: return blockWhenText(l.when, s) || `When ${s} triggers its event`;
  }
}
// "objects tagged MONSTER" are many: "vanish", "appear again", "attack JC" (not "vanishes")
function lkActText(x) {
  const s = lkActText1(x);
  if (!x.targetTag) return s;
  const t = `objects tagged ${x.targetTag} `;
  return s.startsWith(t) ? t + s.slice(t.length).replace(/^(\w+?)(?:(?<=(?:sh|ch|x|ss))es|s)/, '$1') : s;
}
function lkActText1(x) {
  if (x.area) return `${lkVerbLabel(x.verb, x.area.kind).toLowerCase()}: ${x.area.members.length} saved ${x.area.kind === 'character' ? 'characters' : x.area.kind === 'light' ? 'lights' : 'objects'}${x.area.dynamic ? ` + newcomers within ${x.area.radius} units` : ''}`;
  const t = x.targetTag ? `objects tagged ${x.targetTag}` : lkName(x.target), q = (s) => `"${String(s || '').slice(0, 60)}"`;
  switch (x.verb) {
    case 'open': return `open ${t}`;
    case 'close': return `close ${t}`;
    case 'toggle': return `open or close ${t}`;
    case 'lock': return `lock ${t}`;
    case 'unlock': return `unlock ${t}`;
    case 'blow': return `blow up ${t}`;
    case 'key': return `give JC the key of ${t}`;
    case 'attack': return `${t} attacks JC`;
    case 'hostile': return `${t} turns hostile to JC`;
    case 'friend': return `${t} becomes friendly`;
    case 'neutral': return `${t} becomes neutral`;
    case 'stand': return `${t} stands still`;
    case 'wander': return `${t} wanders about`;
    case 'follow': return `${t} follows JC`;
    case 'goto': return `${t} walks to a place`;
    case 'run': return `${t} runs to a place`;
    case 'leave': return `${t} leaves`;
    case 'appear': return `${t} comes back`;
    case 'lighton': return `turn on ${t}`;
    case 'lightoff': return `turn off ${t}`;
    case 'lighttoggle': return `turn ${t} on or off`;
    case 'on': return /Scripts\.\w+$/.test(lkActor(x.target)?.cls || '') ? `set off ${t}` : `${lkVerbLabel('on', lkCatOf(lkActor(x.target))).toLowerCase()}: ${t}`;
    case 'off': return `${lkVerbLabel('off', lkCatOf(lkActor(x.target))).toLowerCase()}: ${t}`;
    case 'hide': return `${t} vanishes`;
    case 'show': return `${t} appears again`;
    case 'explode': return `an explosion at ${t}`;
    case 'anim': return `play the animation of ${t}`;
    case 'animback': return `play the animation of ${t} backwards`;
    case 'animstop': return `stop the animation of ${t}`;
    case 'sound': return `play the sound ${String(x.a || '?').split('.').pop()}${+x.c > 0 ? (x.target ? ' from ' + t : '') : " in JC's head"}`;
    case 'message': return `the message ${q(x.a)}`;
    case 'goal': return x.c === 'done' ? `the goal ${q(x.b || x.a)} completed` : `a new goal ${q(x.b)}`;
    case 'note': return `the note ${q(x.a)}`;
    case 'flag': return parseFate(x.a) ? `record ${stateLabel({ flag: x.a, is: x.b !== '0' })}` : `set ${x.a || '?'} to ${x.b === '0' ? 'No' : 'Yes'}`;
    case 'travel': return `take JC to ${x.a || '?'}${x.b ? ' (' + x.b + ')' : ''}`;
    case 'cutplay': return `play ${t}`;
    case 'cutstop': return `stop ${t}`;
    default: return blockActText(x, t, lkName, { point: lkCatOf(lkActor(x.target)) === 'effectpoint' }) || x.verb;
  }
}
function lkSentence(l) {
  const acts = [...(l.do || [])].sort((x, y) => (+x.delay || 0) - (+y.delay || 0));
  const parts = acts.map((x) => (+x.delay > 0 ? `after ${+x.delay} s ` : '') + lkActText(x));
  return `${lkWhenText(l)}: ${parts.join(', ') || 'nothing yet'}${l.once ? ' (only once)' : ''}`;
}

// the special options of a computer: [{i, pairs}] for its 4 slots
function lkOptions(c) {
  const f = (propSchema[c.cls] || []).find((x) => x.prop === 'specialOptions');
  const out = [];
  for (let i = 0; i < 4; i++) out.push({ i, pairs: f ? mergeStruct(f.default[i] || '', propValue(c, f, i)) : parseStruct(actorProp(c, `specialOptions(${i})`) || '') });
  return out;
}
function lkSetOption(c, i, key, text) {
  const m = new Map(lkOptions(c)[i].pairs);
  m.set(key, JSON.stringify(String(text || '').replace(/"/g, "'")));
  if (!m.has('Text')) m.set('Text', '""');
  if (!m.has('TriggerText')) m.set('TriggerText', '""');
  putProp(c, `specialOptions(${i})`, structText([...m.entries()]));
}

// a new rule; with a target, the action the two usually do together
function lkAdd(src, when, target) {
  const l = { id: lkNewId(), src: src ? src.name : '', when, once: false, at: src ? lkWhere(src.name) : [0, 0, 0], do: [] };
  if (when === 'near') l.near = 256;
  if (when === 'option') {
    const free = lkOptions(src).find((o) => !unquote(new Map(o.pairs).get('Text') || ''));
    l.option = free ? free.i : 0;
    if (free) lkSetOption(src, free.i, 'Text', target ? `Activate ${hierLabel(target)}` : 'New option');
  }
  if (target) l.do.push(lkNewAct(target, src));
  lkList().push(l);
  l.label = lkSentence(l);
  return l;
}
function lkNewAct(target, src) {
  const cat = lkCatOf(target), verb = (edits.motions || {})[target.name] ? 'anim' : LK_DEFAULT[cat] || LK_FOR[cat][0];
  const x = { verb, target: target.name, delay: 0 };
  lkDefaults(x, src);
  return x;
}
function lkDefaults(x, src) {
  if (x.verb === 'key') x.a = x.a || 'Key to the door';
  if (x.verb === 'explode') { x.a = x.a || '50'; x.b = x.b || '256'; }
  if (x.verb === 'sound') { x.b = x.b || '1'; x.c = x.c ?? (x.target ? '1024' : '0'); }
  // a new Walk / Run to a place goes on the walkable area (rules "when the map starts" have no source: no place yet)
  if ((x.verb === 'goto' || x.verb === 'run') && !x.at) { if (src) x.at = lkWhere(src.name); if (x.nav === undefined) x.nav = true; }
  if (x.verb === 'goal' && !x.a) x.a = 'Goal' + lkList().reduce((n, l) => n + (l.do || []).filter((y) => y.verb === 'goal').length, 1);
  if (x.verb === 'flag' && x.b === undefined) x.b = '1';
  blockDefaults(x);
}
function lkChange(l, fn, redraw) {
  pushUndo();
  fn();
  if (l && lkList().includes(l)) l.label = lkSentence(l);
  setDirty();
  redraw();
}

// picking an object (or a place) in the 3D view or the Hierarchy
let lkPicking = null;
function lkStartPick(opts) {
  if (document.activeElement) document.activeElement.blur();      // Esc must reach the editor
  cancelPlacing();
  lkPicking = opts;
  canvas.style.cursor = 'crosshair';
  status(opts.hint + '  (Esc cancels)');
}
function lkEndPick() { lkPicking = null; canvas.style.cursor = ''; }
async function lkPicked(actor, point) {
  const pk = lkPicking;
  if (!pk) return;
  if (pk.point) {
    if (!point) { status('Click a floor (Esc cancels).', 'warn'); return; }
    lkEndPick();
    pk.done(null, point);
    return;
  }
  if (!actor || !actor.name) { status('Click an object of the map, or one in the Hierarchy (Esc cancels).', 'warn'); return; }
  const chain = await chainOf(actor.cls);
  const ok = pk.accept ? pk.accept(actor, chain) : true;
  if (ok !== true) { status(ok || 'Not this one: click another object.', 'warn'); return; }
  lkEndPick();
  pk.done(actor, null);
}

// Radius selects a saved group. The optional checkbox adds current entrants at execution time.
function lkAreaCategory(a) {
  const chain = chainNow[a.cls] || [];
  if (chain.includes('PlayerPawn')) return '';
  if (chain.includes('Light')) return 'light';
  if (chain.includes('ScriptedPawn')) return 'character';
  if (chain.some(c => ['Decoration', 'Inventory', 'Mover'].includes(c))) return 'object';
  return '';
}
function lkAreaAvailable(n) { return !!lkActor(n) && !edits.disabled?.[n] && !edits.deleted?.[n]; }
function lkAreaCurrent(area, source) {
  return areaMembers(area, allActors(), source, lkWhere, lkAreaCategory, n => !lkAreaAvailable(n), scriptingTagOf);
}
function lkAreaTargets(x, source) {
  return areaRecipients(x.area, lkAreaCurrent(x.area, source), n => lkAreaAvailable(n) && tagMatches(scriptingTagOf(lkActor(n)), x.area.tag));
}
async function lkAreaReady() {
  const generation = mapGeneration;
  const classes = [...new Set(allActors().filter(a => !edits.deleted?.[a.name]).map(a => a.cls))];
  // Bound schema requests on large original maps.
  for (let i = 0; i < classes.length; i += 12) {
    await Promise.all(classes.slice(i, i + 12).map(chainOf));
    if (mapGeneration !== generation) return false;
  }
  return true;
}
function lkNewArea(src) {
  const area = { kind:'light', radius:256, at:src ? lkWhere(src.name) : [0,0,0], dynamic:false, members:[] };
  area.members = lkAreaCurrent(area, src?.name);
  return { verb:'lightoff', target:'', delay:0, area };
}
async function connectAreaObject(p) {
  const a = p?.userData.actor;
  if (!a || selectionLocked(p) || !await lkAreaReady() || selected !== p || selectionLocked(p)) return;
  const events = lkEventsOf(a);
  if (!events.length) { status('Choose a button, trigger or another object that can start an interaction.', 'warn'); return; }
  lkChange(null, () => {
    const l = lkAdd(a, events[0], null); l.do.push(lkNewArea(a)); l.label = lkSentence(l);
  }, () => renderProps(p));
}
function lkAreaHtml(x, j, source) {
  const area = x.area, names = lkAreaTargets(x, source);
  return `<div class="lk-area" style="padding:6px 0 6px 12px;border-left:2px solid #ffd17b">
    <div class="row"><label>Group</label><select data-lkakind="${j}">${[['light','Lights'],['character','Characters'],['object','Objects']].map(([v,t]) => `<option value="${v}" ${v === area.kind ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="row"><label>Tag</label><input data-lkatag="${j}" value="${escapeHtml(area.tag || '')}" placeholder="All tags" maxlength="64" aria-label="Area tag filter" style="flex:1;min-width:0" list="area-tags-${escapeHtml(source || 'start')}-${j}">${tagSuggestions(`area-tags-${source || 'start'}-${j}`)}</div>
    <div class="row"><label>Radius</label><input type="number" min="1" max="65536" step="32" data-lkaradius="${j}" value="${area.radius}" style="width:80px"><span>units</span></div>
    <div class="row"><label>Center</label><span style="flex:1">${area.at.map(Math.round).join(', ')}</span><button data-lkacenter="${j}" title="Pick the center on a surface">Pick...</button></div>
    <label style="display:flex;width:auto;gap:6px;align-items:center"><input type="checkbox" data-lkadynamic="${j}" ${area.dynamic ? 'checked' : ''}> Include newcomers</label>
    <div class="hint" style="margin:4px 0">${area.dynamic ? 'Saved group + matching objects in the zone when the action runs.' : 'Saved group: moving its members does not disconnect them.'} The radius also reaches through walls.</div>
    <button data-lkacapture="${j}" title="Replace the saved group with the objects currently inside the radius">Refresh group</button>
    <details open><summary>${names.length} recipients${area.dynamic ? ' now' : ''}</summary><div style="max-height:150px;overflow:auto">${names.map(n => `<a href="#" data-lkgo="${escapeHtml(n)}" style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="color:#ffd17b;width:14px;display:inline-flex;flex:none">${ICON.connect.replace('<svg ', '<svg width="14" height="14" ')}</span>${escapeHtml(lkName(n))}</a>`).join('') || '<span class="hint">No matching objects. Change the radius, center or group.</span>'}</div></details>
  </div>`;
}
function lkWireArea(el, l, ch) {
  const capture = x => { x.area.members = lkAreaCurrent(x.area, l.src); };
  const bind = (attr, event, fn) => { for (const input of el.querySelectorAll(`[${attr}]`)) input[event] = () => fn(input, l.do[+input.getAttribute(attr)]); };
  bind('data-lkatag', 'onchange', (i,x) => { const v=i.value.trim(); if (v && !validScriptTag(v)) { i.setCustomValidity('Use 1-64 letters, digits or underscores.'); i.reportValidity(); return; } i.setCustomValidity(''); ch(() => { x.area.tag=v; capture(x); }); });
  bind('data-lkaradius', 'onchange', (i,x) => ch(() => { x.area.radius = Math.min(65536, Math.max(1, +i.value || 256)); capture(x); }));
  bind('data-lkakind', 'onchange', (i,x) => ch(() => { x.area.kind = i.value; x.verb = AREA_VERBS[i.value][0]; lkDefaults(x, lkActor(l.src)); capture(x); }));
  bind('data-lkadynamic', 'onchange', (i,x) => ch(() => { x.area.dynamic = i.checked; }));
  bind('data-lkacapture', 'onclick', (i,x) => ch(() => capture(x)));
  bind('data-lkacenter', 'onclick', (i,x) => lkStartPick({ point:true, hint:'Click the center of the connection zone', done:(o,pt) => ch(() => { x.area.at = pt; capture(x); }) }));
}
let lkAreaMarkers = [];
function lkClearArea() {
  for (const m of lkAreaMarkers) m.el.remove();
  lkAreaMarkers = [];
  for (const g of [...linkLines.children]) if (g.userData.connectArea) {
    g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); linkLines.remove(g);
  }
}
function lkDrawAreas(a) {
  lkClearArea();
  const marked = new Set();
  for (const l of lkList()) for (const x of l.do || []) {
    if (!x.area || edits.disabled?.[l.src]) continue;
    const names = lkAreaTargets(x, l.src);
    if (l.src !== a.name && !names.includes(a.name)) continue;
    const group = new THREE.Group(); group.userData.connectArea = true;
    for (let axis = 0; axis < 3; axis++) {
      const pts = Array.from({length:65}, (_,i) => {
        const v = [0,0,0], angle = i / 64 * Math.PI * 2;
        v[(axis+1)%3] = Math.cos(angle)*x.area.radius; v[(axis+2)%3] = Math.sin(angle)*x.area.radius;
        return new THREE.Vector3(...v);
      });
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:0xffd17b, transparent:true, opacity:.55})));
    }
    group.position.copy(T(x.area.at)); linkLines.add(group);
    for (const name of names) {
      if (marked.has(name)) continue; marked.add(name);
      const el = document.createElement('button'); el.type = 'button'; el.innerHTML = ICON.connect.replace('<svg ', '<svg width="15" height="15" ');
      el.title = `Connected: ${lkName(name)}`; el.setAttribute('aria-label', el.title);
      Object.assign(el.style, {position:'fixed', width:'23px', height:'23px', padding:'3px', display:'none', alignItems:'center', justifyContent:'center', pointerEvents:'auto', color:'#ffd17b', background:'#302819', border:'1px solid #c79948', borderRadius:'50%'});
      el.onclick = () => { const p = proxyOf(name); if (p) select(p); };
      edgeBox.appendChild(el); lkAreaMarkers.push({name, el});
    }
  }
}
function lkUpdateAreaMarkers() {
  if (!lkAreaMarkers.length) return;
  const r = canvas.getBoundingClientRect();
  for (const m of lkAreaMarkers) {
    const p = proxyOf(m.name);
    if (!p || !p.visible) { m.el.style.display = 'none'; continue; }
    const pos = p.getWorldPosition(new THREE.Vector3());
    const a = p.userData.actor;
    pos.y += Math.max(24, +actorProp(a, 'CollisionHeight') || 40) + 10;
    const v = pos.project(camera), visible = v.z >= -1 && v.z <= 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
    Object.assign(m.el.style, {display:visible ? 'flex' : 'none', left:`${r.left+(v.x+1)*r.width/2-11}px`, top:`${r.top+(1-v.y)*r.height/2-23}px`});
  }
}

// one rule: "When ... : then ..." with its actions
function lkRuleHtml(l, inPanel) {
  const src = lkActor(l.src), cat = lkCatOf(src);
  const evs = l.when === 'start' ? ['start'] : lkEventsOf(src).includes(l.when) ? lkEventsOf(src) : [l.when].concat(lkEventsOf(src));
  let h = `<div class="lk-rule" data-lk="${escapeHtml(l.id)}">`;
  h += `<div class="row"><b>When</b>${inPanel && l.src ? `<a href="#" data-lkgo="${escapeHtml(l.src)}" title="Go to it">${escapeHtml(lkName(l.src))}</a>` : ''}
    <select data-lkw style="flex:1 1 130px;min-width:0">${evs.map((w) => `<option value="${w}" ${w === l.when ? 'selected' : ''}>${escapeHtml(LK_WHEN[w] || w)}</option>`).join('')}</select>
    <label style="width:auto" title="Only the first time"><input type="checkbox" data-lko ${l.once ? 'checked' : ''}> once</label>
    <button data-lkx title="Delete this rule">✕</button></div>`;
  if (l.when === 'option' && src) {
    const opts = lkOptions(src), cur = opts[+l.option || 0], m = new Map(cur.pairs);
    h += `<div class="row" style="padding-left:12px"><label style="width:auto">Button</label><select data-lkopt>${opts.map((o) => `<option value="${o.i}" ${o.i === (+l.option || 0) ? 'selected' : ''}>${o.i + 1}: ${escapeHtml(unquote(new Map(o.pairs).get('Text') || '') || '(empty)')}</option>`).join('')}</select>
      <input type="text" data-lkot="Text" value="${escapeHtml(unquote(m.get('Text') || ''))}" placeholder="its text on the computer" style="flex:1;min-width:0"></div>
      <div class="row" style="padding-left:12px"><label style="width:auto">Then it says</label><input type="text" data-lkot="TriggerText" value="${escapeHtml(unquote(m.get('TriggerText') || ''))}" placeholder="e.g. Door unlocked" style="flex:1;min-width:0"></div>`;
  }
  if (l.when === 'near') h += `<div class="row" style="padding-left:12px"><label style="width:auto">within</label><input type="number" data-lkn value="${+l.near || 256}" step="32" min="32" style="width:70px"><span class="hint" style="margin:0">units (a door is 128 high)</span></div>`;
  (l.do || []).forEach((x, j) => {
    const t = lkActor(x.target), tcat = x.target ? lkCatOf(t) : '';
    const animated = x.target && ((edits.motions || {})[x.target] || tcat === 'door');
    const verbs = x.area ? AREA_VERBS[x.area.kind] : x.targetTag ? TAG_VERBS : x.target ? [...new Set((animated ? ['anim', 'animback', 'animstop'] : []).concat(LK_FOR[tcat] || LK_FOR.other))] : LK_FREE;
    const vlist = verbs.includes(x.verb) ? verbs : [x.verb].concat(verbs);
    h += `<div class="lk-act"><div class="row"><span class="hint" style="margin:0">${j ? 'and' : 'then'}</span>
      <select data-lkv="${j}" style="flex:1 1 120px;min-width:0">${vlist.map((v) => `<option value="${v}" ${v === x.verb ? 'selected' : ''}>${escapeHtml(lkVerbLabel(v, tcat))}</option>`).join('')}</select>
      <span style="white-space:nowrap"><label style="width:auto" title="Seconds after the start of the rule">after</label> <input type="number" data-lkd="${j}" value="${+x.delay || 0}" min="0" step="0.5" style="width:48px"> <span class="hint" style="margin:0">s</span></span>
      <button data-lka="${j}" title="Remove this action">✕</button></div>`;
    if (x.area) h += lkAreaHtml(x, j, l.src);
    if (x.targetTag !== undefined) h += `<div class="row"><label>Tag</label><input data-lktag="${j}" value="${escapeHtml(x.targetTag)}" maxlength="64" aria-label="Target scripting tag" list="target-tags-${escapeHtml(l.id)}-${j}" style="flex:1;min-width:0">${tagSuggestions(`target-tags-${l.id}-${j}`)}<span class="hint">${(n => `${n} ${n === 1 ? 'match' : 'matches'}`)(lkTagTargets(x,l.src).length)}</span></div>`;
    if (!x.area && x.targetTag === undefined && (x.target || LK_VERBS[x.verb] && LK_VERBS[x.verb][1])) {
      h += `<div class="row" style="padding-left:38px"><a href="#" data-lkgo="${escapeHtml(x.target || '')}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${t ? '' : ';color:var(--bad)'}" title="Go to it">${escapeHtml(lkName(x.target))}</a><button data-lkboth="${j}" title="See this object and the one it acts on together">both</button><button data-lkp="${j}" title="Click another object for this action">change</button></div>`;
    }
    const arg = (k, ph, w = 'flex:1;min-width:0') => `<input type="text" data-lkarg="${j}" data-k="${k}" value="${escapeHtml(x[k] || '')}" placeholder="${escapeHtml(ph)}" style="${w}">`;
    const row = (inner) => `<div class="row" style="padding-left:38px">${inner}</div>`;
    if (x.verb === 'key') h += row(`<label style="width:auto">called</label>${arg('a', 'Key to the vault')}`);
    if (x.verb === 'attack' || x.verb === 'hostile') h += row(`<label style="width:auto" title="Their friends do not join in (nor defend them when JC fights back)"><input type="checkbox" data-lkalone="${j}" ${x.a === 'alone' ? 'checked' : ''}> alone (their faction stays out of it)</label>`);
    if (x.verb === 'goto' || x.verb === 'run') h += row(`<span class="hint" style="margin:0;flex:1">to ${x.at ? x.at.map((v) => Math.round(v)).join(', ') : '?'}</span><button data-lkat="${j}" title="Click the floor where they go">pick</button>`)
      + row(`<label style="width:auto" title="The way a man would walk, on the walkable area (View > Walkable area), without path nodes; it goes into the map at Rebuild. Off: on the AI paths, as the game's characters go"><input type="checkbox" data-lknav="${j}" ${x.nav ? 'checked' : ''}> on the walkable area</label>`);
    if (x.verb === 'explode') h += row(`<label style="width:auto">damage</label><input type="number" data-lkarg="${j}" data-k="a" value="${+x.a || 0}" min="0" style="width:60px"><label style="width:auto">radius</label><input type="number" data-lkarg="${j}" data-k="b" value="${+x.b || 256}" min="16" step="16" style="width:64px">`);
    if (x.verb === 'sound') {
      h += row(`<span class="hint" style="margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(x.a || '')}">${escapeHtml(x.a ? x.a.split('.').slice(1).join(' · ') : '(no sound)')}</span>${x.a ? `<button data-lkplay="${j}" title="Listen">▶</button>` : ''}<button data-lksnd="${j}">Choose...</button>`);
      h += row(`<label style="width:auto" title="As loud wherever JC is (a radio, a voice); off: it comes from the object"><input type="checkbox" data-lkhead="${j}" ${+x.c > 0 ? '' : 'checked'}> in JC's head</label>${+x.c > 0 ? `<label style="width:auto">heard within</label><input type="number" data-lkarg="${j}" data-k="c" value="${+x.c}" min="64" step="64" style="width:64px">${x.target ? '' : `<button data-lkp="${j}" title="The object it comes from">from...</button>`}` : ''}<label style="width:auto">volume</label><input type="number" data-lkarg="${j}" data-k="b" value="${+x.b || 1}" min="0.1" max="4" step="0.1" style="width:52px">`);
    }
    if (x.verb === 'message' || x.verb === 'note') h += row(arg('a', x.verb === 'note' ? 'What JC notes' : 'What appears on the screen'));
    if (x.verb === 'goal') h += row(`${arg('b', 'The goal, as JC reads it')}<label style="width:auto" title="Mark it as completed (the same name as when it was given)"><input type="checkbox" data-lkdone="${j}" ${x.c === 'done' ? 'checked' : ''}> completed</label>`) + row(`<label style="width:auto" title="The same name gives and completes the same goal">name</label>${arg('a', 'Goal1', 'width:110px')}`);
    if (x.verb === 'flag') h += `<div data-lkstate="${j}" style="margin:6px 0 6px 38px;min-width:0"></div>`;
    h += blockRowsHtml(x, j, escapeHtml, lkName, { point: tcat === 'effectpoint' });
    if (x.verb === 'travel') h += row(`<select data-lkarg="${j}" data-k="a" style="flex:1;min-width:0"><option value="">(choose a map)</option>${(allMapNames || []).map((m) => `<option ${m === x.a ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}${x.a && !(allMapNames || []).includes(x.a) ? `<option selected>${escapeHtml(x.a)}</option>` : ''}</select>${arg('b', 'arriving at (Tag)', 'width:100px')}`);
    h += '</div>';
  });
  h += `<div class="row"><select data-lkadd style="flex:1;min-width:0"><option value="">+ Then...</option><option value="@pick">something to an object (click it)...</option><option value="@area">a group within a radius…</option><option value="@tag">objects with a tag…</option>
    <optgroup label="Without an object">${LK_FREE.map((v) => `<option value="${v}">${escapeHtml(LK_VERBS[v][0])}</option>`).join('')}</optgroup></select></div>`;
  // the timeline of the rule (like Unity's Timeline): each action at its time, its length (an animation's)
  if ((l.do || []).length) {
    const dur = (x) => (/^anim(back)?$/.test(x.verb) ? Math.max(0.3, motionLength((edits.motions || {})[x.target]) || 1)
      : x.verb === 'cutplay' && window.__cutscene ? window.__cutscene.lengthOf(x.target) : 0.3);
    const tmax = Math.max(4, Math.ceil(Math.max(...l.do.map((x) => (+x.delay || 0) + dur(x))) + 1));
    h += `<details class="lk-tl" data-lktl="${escapeHtml(l.id)}" ${lkTlOpen.has(l.id) ? 'open' : ''}><summary>Timeline</summary><div class="lk-tlbox" data-tlmax="${tmax}">
      <div class="lk-tlruler">${Array.from({ length: tmax + 1 }, (_, s2) => `<span style="left:${s2 / tmax * 100}%">${s2}s</span>`).join('')}</div>
      ${l.do.map((x, j) => `<div class="lk-tlrow"><span class="lk-tlname" title="${escapeHtml(lkActText(x))}">${escapeHtml(lkActText(x))}</span><div class="lk-tltrack"><div class="lk-tlbar ${/^anim/.test(x.verb) ? 'anim' : ''}" data-tlj="${j}" style="left:${(+x.delay || 0) / tmax * 100}%;width:${Math.max(1.5, dur(x) / tmax * 100)}%" title="Drag: when it happens (${+x.delay || 0} s)"></div></div></div>`).join('')}
      </div><div class="hint" style="margin:2px 0">Drag a bar to when it happens.</div></details>`;
  }
  h += `<div class="lk-say">${escapeHtml(lkSentence(l))}</div></div>`;
  return h;
}

// the actions of the rules inside a container (the Properties, the Logic panel)
function lkWire(box, redraw) {
  for (const el of box.querySelectorAll('.lk-rule')) {
    const l = lkGet(el.dataset.lk);
    if (!l) continue;
    const q = (s) => el.querySelectorAll(s);
    const src = lkActor(l.src);
    const ch = (fn) => lkChange(l, fn, redraw);
    lkWireArea(el, l, ch);
    const act = (n) => l.do[+n.dataset[Object.keys(n.dataset)[0]]];
    for (const g of q('[data-lkgo]')) g.onclick = (e) => { e.preventDefault(); const p = proxyOf(g.dataset.lkgo); if (p) { select(p); focusSelected(); } };
    // the timeline: drag a bar to change when its action happens
    const tlx = el.querySelector('[data-lktl]');
    if (tlx) tlx.addEventListener('toggle', () => { if (tlx.open) lkTlOpen.add(l.id); else lkTlOpen.delete(l.id); });
    for (const bar of q('[data-tlj]')) bar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const track = bar.parentElement, tmax = +bar.closest('.lk-tlbox').dataset.tlmax, x = l.do[+bar.dataset.tlj];
      const r = track.getBoundingClientRect(), off = e.clientX - bar.getBoundingClientRect().left;
      let d = +x.delay || 0;
      const move = (ev) => { d = Math.max(0, Math.round(((ev.clientX - off - r.left) / r.width) * tmax * 10) / 10); bar.style.left = (d / tmax * 100) + '%'; bar.title = d + ' s'; };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (d !== (+x.delay || 0)) ch(() => { x.delay = d; }); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    el.querySelector('[data-lkw]').onchange = (e) => ch(() => {
      l.when = e.target.value;
      if (l.when === 'near' && !l.near) l.near = 256;
      if (l.when === 'option' && src && l.option === undefined) l.option = 0;
    });
    el.querySelector('[data-lko]').onchange = (e) => ch(() => { l.once = e.target.checked; });
    el.querySelector('[data-lkx]').onclick = () => ch(() => { edits.links = lkList().filter((x) => x !== l); });
    const ln = el.querySelector('[data-lkn]');
    if (ln) ln.onchange = () => ch(() => { l.near = Math.max(32, +ln.value || 256); });
    const lo = el.querySelector('[data-lkopt]');
    if (lo) lo.onchange = () => ch(() => { l.option = +lo.value; });
    for (const t of q('[data-lkot]')) t.onchange = () => ch(() => lkSetOption(src, +l.option || 0, t.dataset.lkot, t.value));
    for (const s of q('[data-lkv]')) s.onchange = () => ch(() => { const x = l.do[+s.dataset.lkv]; x.verb = s.value; lkDefaults(x, src); });
    for (const input of q('[data-lktag]')) input.onchange = () => { const tag=input.value.trim(); if (!validScriptTag(tag)) { input.setCustomValidity('Use 1-64 letters, digits or underscores.'); input.reportValidity(); return; } input.setCustomValidity(''); ch(() => { l.do[+input.dataset.lktag].targetTag=tag; }); };
    for (const d of q('[data-lkd]')) d.onchange = () => ch(() => { l.do[+d.dataset.lkd].delay = Math.max(0, Math.round((+d.value || 0) * 10) / 10); });
    for (const b of q('[data-lka]')) b.onclick = () => ch(() => { l.do.splice(+b.dataset.lka, 1); });
    for (const inp of q('[data-lkarg]')) inp.onchange = () => ch(() => { l.do[+inp.dataset.lkarg][inp.dataset.k] = inp.value.trim(); });
    for (const host of q('[data-lkstate]')) {
      const x = l.do[+host.dataset.lkstate];
      mountStateField(host, { flag: x.a || '', is: x.b !== '0' }, { mode: 'set', onChange: value => ch(() => {
        x.a = value.flag; x.b = value.is === false ? '0' : '1';
      }) });
    }
    for (const c of q('[data-lkalone]')) c.onchange = () => ch(() => { act(c).a = c.checked ? 'alone' : ''; });
    for (const c of q('[data-lknav]')) c.onchange = () => ch(() => { act(c).nav = c.checked; });
    for (const c of q('[data-lkdone]')) c.onchange = () => ch(() => { act(c).c = c.checked ? 'done' : ''; });
    for (const c of q('[data-lkhead]')) c.onchange = () => ch(() => { const x = act(c); x.c = c.checked ? '0' : '1024'; if (!c.checked && !x.target && l.src) x.target = l.src; });
    for (const b of q('[data-lkplay]')) b.onclick = () => playSound(act(b).a, b);
    for (const b of q('[data-lksnd]')) b.onclick = () => { const x = act(b); pickSound(x.a || '', (name) => { if (name) ch(() => { x.a = name; }); }); };
    for (const b of q('[data-lkboth]')) b.onclick = () => { const x = act(b); if (x.target) frameBoth(l.src, x.target); };
    for (const b of q('[data-lkp]')) b.onclick = () => {
      const x = act(b);
      lkStartPick({ hint: x.verb === 'sound' ? 'Click the object the sound comes from' : `Click the object to ${lkVerbLabel(x.verb, '').toLowerCase()}`,
        accept: (o, chain) => (o.name === l.src && x.verb !== 'sound' ? 'That is the object of the rule itself: click another one.' : true),
        done: (o) => ch(() => { const cat = lkCat(chainNow[o.cls] || [o.cls]); x.target = o.name; if (x.verb !== 'sound' && !(LK_FOR[cat] || LK_FOR.other).includes(x.verb)) { x.verb = LK_DEFAULT[cat] || LK_FOR[cat][0]; lkDefaults(x, src); } }) });
    };
    // the object a character goes and uses; the colour and beep of a light effect
    for (const b of q('[data-lkuse]')) b.onclick = () => {
      const x = act(b);
      lkStartPick({ hint: 'Click the object they go and use (a bomb, a generator, a computer...)',
        accept: (o, chain) => (o.name === x.target ? 'That is the character: click the object.' : chain.includes('ScriptedPawn') ? 'A character cannot be used: click an object.' : true),
        done: (o) => ch(() => { x.a = o.name; }) });
    };
    for (const s of q('[data-lkcol]')) s.onchange = () => ch(() => { const x = act(s), o = effectOptions(x.c); x.c = effectOptionText(s.value, o.beep, o.exact); });
    for (const c of q('[data-lkbeep]')) c.onchange = () => ch(() => { const x = act(c), o = effectOptions(x.c); x.c = effectOptionText(o.colour, c.checked, o.exact); });
    // "exactly on the object", or an Effect point as the place of the effect
    for (const c of q('[data-lkexact]')) c.onchange = () => ch(() => { const x = act(c); x.c = withExact(x.c, c.checked); });
    for (const b of q('[data-lkfxpt]')) b.onclick = () => {
      const x = act(b);
      lkStartPick({ hint: 'Click an Effect point (Objects > Triggers > Effect point): the effect goes there, along its arrow',
        accept: (o) => (isEffectPoint(o) ? true : 'That is not an Effect point: place one (Objects > Triggers), then click it.'),
        done: (o) => ch(() => { x.target = o.name; x.c = withExact(x.c, false); }) });
    };
    for (const b of q('[data-lkat]')) b.onclick = () => {
      const x = act(b);
      lkStartPick({ point: true, hint: 'Click the floor where they go', done: (o, pt) => ch(() => { x.at = pt; }) });
    };
    el.querySelector('[data-lkadd]').onchange = async (e) => {
      const v = e.target.value;
      e.target.value = '';
      if (!v) return;
      if (v === '@tag') { if (await lkAreaReady() && lkList().includes(l) && document.body.contains(el)) ch(() => l.do.push({verb:'lightoff',target:'',targetTag:'green',delay:0})); return; }
      if (v === '@area') {
        if (await lkAreaReady() && lkList().includes(l) && document.body.contains(el)) ch(() => l.do.push(lkNewArea(src)));
        return;
      }
      if (v === '@pick') {
        lkStartPick({ hint: 'Click the object the rule acts on (a door, a character, a light...)',
          accept: (o) => (o.name === l.src ? 'That is the object of the rule itself: click another one.' : true),
          done: (o) => ch(() => { l.do.push(lkNewAct(o, src)); }) });
        return;
      }
      ch(() => {
        const x = { verb: v, target: '', delay: 0 };
        if (v === 'sound' && l.src) { x.target = l.src; x.c = '1024'; }
        lkDefaults(x, src);
        l.do.push(x);
        if (v === 'sound') setTimeout(() => pickSound('', (name) => { if (name) lkChange(l, () => { x.a = name; }, redraw); }), 0);
      });
      if (v === 'travel' && !allMapNames) api('/api/newmap_info').then((i) => { allMapNames = i.maps; redraw(); }).catch(() => {});
    };
  }
}

async function connectObject(p) {
  const a = p?.userData.actor;
  if (!a || selectionLocked(p)) return;
  await chainOf(a.cls);
  if (selected !== p || selectionLocked(p)) return;
  const cat = lkCatOf(a), evs = lkEventsOf(a), redraw = () => renderProps(p);
  lkStartPick({
      hint: `Click the object ${hierLabel(a)} should act on (or the one that acts on it)`,
      accept: (o) => (o.name === a.name ? 'Click another object.' : true),
      done: (o) => {
        const ocat = lkCatOf(o), oevs = lkEvents(ocat);
        // the one with an event acts on the other: a button on a door, a zone on a guard
        let from = a, to = o;
        if (!evs.length && oevs.length) { from = o; to = a; }
        if (cat === 'cutscene' && ocat !== 'cutscene' && oevs.length) { from = o; to = a; }
        if (!lkEvents(lkCatOf(from)).length) { status(`Neither ${hierLabel(a)} nor ${hierLabel(o)} can start a rule: use the Logic panel ("When the map starts") or another object.`, 'warn'); return; }
        const fevs = lkEvents(lkCatOf(from));
        let when = fevs[0];
        if (lkCatOf(from) === 'door' && lkCatOf(to) !== 'door') when = 'opened';
        let made;
        lkChange(null, () => { made = lkAdd(from, when, to); }, redraw);
        log(`${made.label}. Change what happens in the Properties of ${hierLabel(from)}; Rebuild to have it in the game.`, 'ok');
        if (from !== a) { const q2 = proxyOf(from.name); if (q2) select(q2); }
      } });
}

// the Usable section of an object's Properties (edits.usable; in the game a UCUsable, editor/links.py):
// any model JC can use, with a use text, a time, an item it needs, a number of times, hidden at the start
function usableSection(a, redraw) {
  const u = (edits.usable || {})[a.name] || null;
  const html = inspectorSection('usable', 'Usable', usableHtml(u, propItems || [], escapeHtml), !!u);
  const wire = () => {
    for (const input of $('#propsec').querySelectorAll('[data-us]')) input.onchange = () => {
      const field = input.dataset.us;
      lkChange(null, () => {
        if (!edits.usable) edits.usable = {};
        if (field === 'on') {
          if (input.checked) edits.usable[a.name] = Object.assign(usableDefault(), { at: lkWhere(a.name) });
          else delete edits.usable[a.name];
          return;
        }
        const cur = edits.usable[a.name];
        if (!cur) return;
        usableChange(cur, field, input);
        cur.at = lkWhere(a.name);
      }, redraw);
      if (field === 'on' && input.checked) log(`${hierLabel(a)} can be used by JC: ${usableSummary(edits.usable[a.name])}. Add "When JC uses it" rules in Interactions.`, 'ok');
    };
  };
  return { html, wire };
}

// the Interactions section of the Properties of an object
function lkSection(a, p, redraw) {
  const cat = lkCatOf(a), evs = lkEventsOf(a);
  const own = lkList().filter((l) => l.src === a.name);
  const incoming = lkList().filter((l) => l.src !== a.name && (l.do || []).some((x) => x.target === a.name || x.area && lkAreaTargets(x, l.src).includes(a.name)));
  let h = '';
  h += own.map((l) => lkRuleHtml(l, false)).join('');
  h += `<div class="row" style="flex-wrap:wrap;row-gap:3px">${evs.length ? `<select id="lkwhen" style="flex:1 1 130px;min-width:0"><option value="">+ When ${cat === 'character' ? 'they...' : 'it...'}</option>${evs.map((w) => `<option value="${w}">${escapeHtml(LK_WHEN[w])}</option>`).join('')}</select>` : '<span class="hint" style="margin:0;flex:1">It does nothing by itself: another object acts on it.</span>'}
    </div>`;
  if (incoming.length) h += incoming.map((l) => `<div class="row lk-in"><span style="color:#6fdc8c">←</span><a href="#" data-lkin="${escapeHtml(l.id)}" title="Go to the object of this rule">${escapeHtml(lkSentence(l))}</a></div>`).join('');
  const wire = () => {
    const box = $('#propsec');
    lkWire(box, redraw);
    for (const g of box.querySelectorAll('[data-lkin]')) g.onclick = (e) => { e.preventDefault(); const l = lkGet(g.dataset.lkin); const q = l && proxyOf(l.src); if (q) { select(q); focusSelected(); } };
    const w = $('#lkwhen');
    if (w) w.onchange = () => {
      const when = w.value;
      if (!when) return;
      lkChange(null, () => { lkAdd(a, when, null); }, redraw);
    };

  };
  return { html: inspectorSection('interactions', 'Interactions', h, own.length + incoming.length > 0), wire };
}

// arrows in the 3D view: green from the object of a rule to what it acts on
function lkDraw(a) {
  lkDrawAreas(a);
  const pairs = [];
  for (const l of lkList()) for (const x of l.do || []) {
    if (x.verb === 'travel' && l.src === a.name && x.a) lkEdgeAdd(a.name, null, `takes JC to ${x.a}`, true);
    if (!x.target || x.target === l.src) continue;
    if (l.src === a.name || x.target === a.name) pairs.push([l.src, x.target]);
  }
  // far or out of sight: a label at the edge of the view points to the other end (updateLinkEdges)
  for (const [f, t] of pairs) {
    const other = f === a.name ? t : f;
    lkEdgeAdd(other, a.name, `${f === a.name ? 'to' : 'from'} ${lkName(other)}`, false);
  }
  for (const [f, t] of pairs) {
    const pf = proxyOf(f), pt = proxyOf(t);
    if (!pf || !pt) continue;
    const dirv = pt.position.clone().sub(pf.position), len = dirv.length();
    if (len < 1) continue;
    const arrow = new THREE.ArrowHelper(dirv.normalize(), pf.position, len, 0x6fdc8c, Math.min(48, len * 0.2), Math.min(24, len * 0.1));
    arrow.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; o.renderOrder = 10; } });
    linkLines.add(arrow);
  }
}

// Logic: every rule of the map as sentences, grouped by object, editable here too (like an event sheet)
const logicBox = $('#logicbox');
async function openLogic() {
  if (!allMapNames) { try { allMapNames = (await api('/api/newmap_info')).maps; } catch (e) { allMapNames = []; } }
  await Promise.all(lkList().flatMap((l) => [l.src, ...(l.do || []).map((x) => x.target)]).map((n) => lkActor(n)).filter(Boolean).map((x) => chainOf(x.cls)));
  const comp = [...new Set(lkList().filter((l) => l.when === 'option').map((l) => lkActor(l.src)).filter(Boolean).map((c) => c.cls))];
  await Promise.all(comp.map((c) => propSchema[c] ? null : api('/api/props?cls=' + encodeURIComponent(c)).then((r) => { propSchema[c] = r.fields || []; })));
  if (!await lkAreaReady()) return;
  renderLogic();
}
function renderLogic() {
  const list = lkList();
  const groups = new Map();
  for (const l of list) { const k = l.when === 'start' ? '' : l.src; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  let h = `<div class="row"><b style="flex:1">Logic · ${escapeHtml(mapName)}</b><button id="lgstart">+ When the map starts</button><button id="lgclose">Close</button></div>
    <div class="hint" style="margin:2px 0 8px">Every interaction of the map: <i>when</i> something happens, <i>then</i> what happens, each after its seconds. Make them in the Properties of an object (<b>+ When it...</b>, or <b>🔗 Connect to...</b> and click another object); no Tag or Event to write. <b>Rebuild</b> puts them in the game.</div>`;
  if (!list.length) h += '<div class="hint">No interactions yet. Select a button, a door, a keypad, a zone, a character... and use <b>🔗 Connect to...</b> in its Properties.</div>';
  for (const [k, ls] of groups) {
    h += `<div class="lg-head">${k ? `<a href="#" data-lkgo="${escapeHtml(k)}">${escapeHtml(lkName(k))}</a>` : 'The map'}</div>`;
    h += ls.map((l) => lkRuleHtml(l, false)).join('');
  }
  logicBox.innerHTML = h;
  logicBox.style.display = 'block';
  lkWire(logicBox, () => { renderLogic(); if (selected && selected.userData.actor) renderProps(selected); });
  for (const g of logicBox.querySelectorAll('.lg-head [data-lkgo]')) g.onclick = (e) => { e.preventDefault(); const p = proxyOf(g.dataset.lkgo); if (p) { select(p); focusSelected(); } };
  $('#lgclose').onclick = () => { logicBox.style.display = 'none'; };
  $('#lgstart').onclick = () => lkChange(null, () => { lkAdd(null, 'start', null); }, renderLogic);
}
$('#logicbtn').onclick = () => (logicBox.style.display === 'block' ? (logicBox.style.display = 'none') : openLogic().catch((e) => log('Logic: ' + e.message, 'bad')));

// ---------------------------------------------------------------- packages of other mods
// The editor's engine loads the game, Revision and this mod; the packages ticked here are loaded too (kit.py:
// EditPackages of every run): their objects with a 3D model appear under Objects, with Properties, and are
// placed and rebuilt like the game's (editor/packages.py). The class lists are made again (a minute).
const pkgBox = $('#pkgbox');
async function openPackages() {
  pkgBox.style.display = 'block';
  pkgBox.innerHTML = '<div class="hint">Reading the packages...</div>';
  const r = await api('/api/packages');
  // the packages in use say which game they are made for (editor/gamecheck.py), and why one cannot load here
  const madeFor = { vanilla: 'made for Deus Ex (both games load it)', revision: 'made for Deus Ex: Revision', other: 'needs other packages' };
  const rows = r.packages.map((p, i) => `<label class="pk-i" title="${escapeHtml(p.folder)}"><input type="checkbox" data-pk="${i}" ${p.on ? 'checked' : ''}> <b>${escapeHtml(p.name)}</b>
    <span class="hint" style="margin:0">${escapeHtml(p.folder.split('\\').slice(-2).join('\\'))}${p.on ? ` · ${p.objects} object${p.objects === 1 ? '' : 's'} in the palette` : ''}${p.on && p.game ? ` · ${madeFor[p.game] || ''}` : ''}</span>
    ${p.on && p.loads === false ? `<span class="hint bad" style="margin:0;display:block">${escapeHtml(p.note || '')}</span>` : ''}</label>`).join('');
  pkgBox.innerHTML = `<div class="row"><b style="flex:1">Packages of other mods</b><button id="pkclose">Close</button></div>
    <div class="hint" style="margin:2px 0 8px">The editor loads the game and this project's packages (${r.loaded.map(escapeHtml).join(', ')}). Tick the packages (.u) of other mods to have their objects too: decorations, characters, weapons, items with a 3D model appear under <b>Objects</b> with their real models and Properties, and are placed, connected and rebuilt like the game's own.</div>
    ${rows || '<div class="hint">No other packages in the game\'s folders.</div>'}
    <div class="row" style="margin-top:8px"><label style="width:auto">Another .u file</label><input type="text" id="pkpath" placeholder="C:\\...\\MyMod.u" style="flex:1;min-width:0"></div>
    <div class="hint" style="margin:2px 0 8px">The game must find a package to play a map that uses it: one kept elsewhere should also be copied into Deus Ex\\System (or Revision\\System).</div>
    <div class="row"><button id="pkapply" class="primary">Apply</button><span id="pkmsg" class="hint" style="margin:0"></span></div>`;
  $('#pkclose').onclick = () => { pkgBox.style.display = 'none'; };
  $('#pkapply').onclick = async () => {
    const extra = r.packages.filter((p, i) => pkgBox.querySelector(`[data-pk="${i}"]`).checked).map((p) => ({ name: p.name, path: p.path || '' }));
    const path = $('#pkpath').value.trim();
    if (path) extra.push({ path });
    if (dirty && !confirm('The page is read again with the new objects: unsaved changes of this map are lost. Go on?')) return;
    try {
      await api('/api/packages', { extra });
      $('#pkmsg').textContent = 'Reading the objects of the packages (about a minute)...';
      dirty = false;
      location.reload();
    } catch (e) { $('#pkmsg').textContent = e.message; }
  };
}
$('#bpkgs').onclick = () => openPackages().catch((e) => log('Packages: ' + e.message, 'bad'));

// Check map: rules whose objects are gone, rules that do nothing
function lkCheck(add) {
  for (const l of lkList()) {
    const who = l.src || (l.do || []).map((x) => x.target).find(Boolean);
    const say = lkSentence(l);
    if (edits.disabled?.[l.src]) { add('info', `Interaction "${say}": its source is disabled in game.`, who); continue; }
    if (l.when !== 'start' && !lkActor(l.src)) add('error', `Interaction "${say}": its object ${l.src} is not in the map any more.`, null);
    if (!(l.do || []).length) add('warn', `Interaction "${say}": it does nothing yet (+ Then...).`, who);
    for (const x of l.do || []) {
      if (x.area && !lkAreaTargets(x, l.src).length) add('warn', `Interaction "${say}": the area group currently has no recipients.`, who);
      if (edits.disabled?.[x.target]) { add('warn', `Interaction "${say}": ${x.target} is disabled in game.`, x.target); continue; }
      if (x.target && !lkActor(x.target)) add('error', `Interaction "${say}": ${x.target} is not in the map any more.`, who);
      if (LK_VERBS[x.verb] && LK_VERBS[x.verb][1] && LK_VERBS[x.verb][1] !== 'any' && !x.target && !x.area) add('error', `Interaction "${say}": "${LK_VERBS[x.verb][0]}" has no object.`, who);
      if (x.verb === 'sound' && !x.a) add('warn', `Interaction "${say}": no sound chosen.`, who);
      if ((x.verb === 'message' || x.verb === 'note') && !x.a) add('warn', `Interaction "${say}": the text is empty.`, who);
      if (x.verb === 'travel' && !x.a) add('error', `Interaction "${say}": no map to go to.`, who);
      if (x.verb === 'travel' && x.a && allMapNames && allMapNames.length && !allMapNames.includes(x.a)) add('error', `Interaction "${say}": the map ${x.a} does not exist.`, who);
      if (x.verb === 'key' && x.target && lkActor(x.target) && !String(actorProp(lkActor(x.target), 'KeyIDNeeded') || '').replace(/^None$/i, '')) add('warn', `Interaction "${say}": ${x.target} needs no key (set "Key that opens it" in its Properties).`, who);
    }
    if (l.when === 'option' && lkActor(l.src) && propSchema[lkActor(l.src).cls] && !lkOptionText(l)) add('warn', `Interaction "${say}": the computer has no button for it (write its text).`, who);
  }
  if (window.__cutscene) window.__cutscene.check(add);
}

// ---------------------------------------------------------------- New map
// An empty room to build in (a map script made from a template, built now) or a copy of any map under a
// new name; it belongs to a mission of the campaign (its number and script in the map's DeusExLevelInfo).
const newBox = $('#newbox');
async function openNewMap() {
  if (!projectContext) { projectHub?.show(); return; }
  const info = await api('/api/newmap_info');
  allMapNames = info.maps;
  const independent = isCustomProject(projectContext);
  let sourceLoading = false;
  const t = info.textures;
  newBox.innerHTML = `<div class="row"><b style="flex:1">New map</b><button id="nmclose">Close</button></div>
    <div class="row"><label>Name</label><input type="text" id="nmname" placeholder="e.g. Warehouse 9" title="letters and numbers; the file becomes <mission>_<name>.dx"></div>
    <div class="row"><label>${independent ? 'Chapter' : 'Mission'}</label>${independent ? '<input type="number" id="nmmission" min="1" max="99" step="1" value="1">' : `<select id="nmmission">${info.missions.map(([n, label]) => `<option value="${n}" ${n === 6 ? 'selected' : ''}>${String(n).padStart(2, '0')} · ${escapeHtml(label)}</option>`).join('')}</select>`}</div>
    <div class="hint" style="margin:0 0 8px">${independent ? 'Group the maps of your campaign into chapters. Your project supplies the story.' : 'The map belongs to that part of the campaign: the mission’s goals, flags and InfoLinks work in it.'}</div>
    <div class="row"><label>Place name</label><input type="text" id="nmloc" placeholder="shown in the game (optional)"></div>
    <div class="row"><label>Start from</label><label style="width:auto"><input type="radio" name="nmfrom" value="empty" checked> an empty room</label>
      <label style="width:auto"><input type="radio" name="nmfrom" value="copy"> a copy of a map</label></div>
    <div id="nmempty"><div class="row"><label>Room (W D H)</label><input type="number" id="nmw" value="2048" step="64"><input type="number" id="nmd" value="2048" step="64"><input type="number" id="nmh" value="384" step="32"></div>
      <div class="row"><label>Floor</label><input type="text" id="nmfloor" value="${escapeHtml(t.floor)}" list="texlist2"></div>
      <div class="row"><label>Walls</label><input type="text" id="nmwalls" value="${escapeHtml(t.walls)}" list="texlist2"></div>
      <div class="row"><label>Ceiling</label><input type="text" id="nmceil" value="${escapeHtml(t.ceiling)}" list="texlist2"></div>
      <div class="row"><label title="The room's lights: one every 512 units or so, of this colour">Mood</label><select id="nmmood" style="flex:1;min-width:0">
        <option value="normal">Normal</option><option value="dark">Dark (horror): dim red, some lights flicker</option><option value="warm">Warm: lamps, wood, evening</option><option value="cold">Cold: blue, metal, night</option></select></div>
      <datalist id="texlist2">${texList.map((x) => `<option value="${escapeHtml(x)}">`).join('')}</datalist>
      <div class="hint" style="margin:0 0 6px">A room with lights, a start and an arrival point "Start". Then build in it with Pieces, Objects and blocks (a door is 64 x 128 units).</div></div>
    <div id="nmcopy" style="display:none">${independent ? '<div class="row"><label>Source</label><select id="nmcopy-kind"><option value="project">Project maps</option><option value="game">Original game</option></select></div>' : ''}<div class="row"><label>Map</label><select id="nmsrc">${info.maps.map((m) => `<option ${m === mapName ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}</select></div>
      <div class="hint" style="margin:0 0 6px">${independent ? 'Copies use this project’s story; original mission scripts, conversations and map exits are disconnected.' : 'The whole map under the new name, as a map of the mod: change it as you like, the original stays as it is.'}</div></div>
    <div class="row" style="margin-top:8px"><button id="nmgo" class="primary">Create</button><span id="nmmsg" class="hint" style="margin:0"></span></div>`;
  newBox.style.display = 'block';
  $('#nmclose').onclick = () => { newBox.style.display = 'none'; };
  if (independent) $('#nmcopy-kind').onchange = async () => {
    sourceLoading = true; $('#nmsrc').disabled = true; $('#nmgo').disabled = true; $('#nmcopy-kind').disabled = true;
    $('#nmmsg').textContent = 'Loading map sources…';
    try {
      const names = $('#nmcopy-kind').value === 'game' ? (await api('/api/project_sources')).maps : info.maps;
      $('#nmsrc').innerHTML = names.map(m => `<option>${escapeHtml(m)}</option>`).join('');
      $('#nmmsg').textContent = names.length ? '' : 'This project has no maps to copy yet.';
    } catch (e) { $('#nmsrc').innerHTML = ''; $('#nmmsg').textContent = e.message; }
    finally { sourceLoading = false; $('#nmsrc').disabled = false; $('#nmgo').disabled = false; $('#nmcopy-kind').disabled = false; }
  };
  for (const r of newBox.querySelectorAll('[name=nmfrom]')) r.onchange = () => {
    const copy = newBox.querySelector('[name=nmfrom]:checked').value === 'copy';
    $('#nmempty').style.display = copy ? 'none' : ''; $('#nmcopy').style.display = copy ? '' : 'none';
  };
  $('#nmgo').onclick = async () => {
    if (sourceLoading) return;
    if (!(await startScreen.confirmLeave())) return;
    const from = newBox.querySelector('[name=nmfrom]:checked').value;
    const body = { name: $('#nmname').value.trim(), mission: +$('#nmmission').value, location: $('#nmloc').value.trim(), from,
                   source: $('#nmsrc').value, size: [+$('#nmw').value, +$('#nmd').value, +$('#nmh').value],
                   textures: { floor: $('#nmfloor').value.trim(), walls: $('#nmwalls').value.trim(), ceiling: $('#nmceil').value.trim() },
                   mood: $('#nmmood') ? $('#nmmood').value : 'normal' };
    if (!body.name) { $('#nmmsg').textContent = 'Give it a name.'; return; }
    if (from === 'copy' && !body.source) { $('#nmmsg').textContent = 'Choose a map to copy.'; return; }
    if (independent && (!Number.isInteger(body.mission) || body.mission < 1 || body.mission > 99)) { $('#nmmsg').textContent = 'Choose a chapter from 1 to 99.'; return; }
    busy(from === 'copy' ? 'Copying the map...' : 'Building the new map (about half a minute)...');
    try {
      const r = await api('/api/newmap', body);
      for (const l of r.lines || []) log(l);
      // no map is open yet (no Messages panel): say why here, with the build's last error line
      if (!r.ok) throw new Error('the build failed: ' + ((r.lines || []).filter((l) => /error|unknown|fail|not found/i.test(l)).pop() || 'see Messages'));
      newBox.style.display = 'none';
      dirty = false;
      allMapNames = null;
      await loadMaps(r.script);
      log(`New map ${r.map}: build it with Pieces, Objects and blocks, then Rebuild. ${independent ? 'Use map exits to connect it to the other maps in this project.' : 'Links shows how to reach it from the campaign.'}`, 'ok');
    } catch (e) { $('#nmmsg').textContent = e.message; log('New map: ' + e.message, 'bad'); } finally { busy(''); }
  };
}
$('#newmap').onclick = () => openNewMap().catch((e) => log(e.message, 'bad'));

// ---------------------------------------------------------------- Links: the ways in and out of the map
const linkBox = $('#linkbox');
async function openLinks() {
  linkBox.style.display = 'block';
  linkBox.innerHTML = '<div class="hint">Reading the maps (the first time, a few seconds)...</div>';
  const L = await api('/api/links?map=' + encodeURIComponent(mapName));
  // exits and arrival points placed in the editor and not built yet
  const pending = edits.added.filter((a) => a.cls === 'Teleporter').map((a) => ({ name: a.name, url: unquote(actorProp(a, 'URL') || ''), tag: String(actorProp(a, 'Tag') || '') }));
  const go = (n) => `<a href="#" data-sel="${escapeHtml(n)}">${escapeHtml(n)}</a>`;
  const exits = L.exits.map((e) => `<tr><td>${go(e.name)}</td><td>${escapeHtml(e.to_map)}</td><td>${escapeHtml(e.to_tag || 'the start')}</td><td></td></tr>`)
    .concat(pending.filter((p) => p.url).map((p) => `<tr><td>${go(p.name)}</td><td>${escapeHtml(p.url.split('#')[0])}</td><td>${escapeHtml(p.url.split('#')[1] || 'the start')}</td><td class="warn">not built yet</td></tr>`));
  const arr = L.arrivals.map((t) => `<tr><td>${escapeHtml(t)}</td><td>${escapeHtml(mapName)}#${escapeHtml(t)}</td><td></td></tr>`)
    .concat(pending.filter((p) => !p.url && p.tag).map((p) => `<tr><td>${go(p.name)} (${escapeHtml(p.tag)})</td><td>${escapeHtml(mapName)}#${escapeHtml(p.tag)}</td><td class="warn">not built yet</td></tr>`));
  const inc = L.incoming.map((i) => `<tr><td>${escapeHtml(i.from_map)}</td><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.tag || 'the start')}</td></tr>`);
  linkBox.innerHTML = `<div class="row"><b style="flex:1">Links of ${escapeHtml(mapName)}</b><button id="lkexit">+ Map exit</button><button id="lkarr">+ Arrival point</button><button id="lkclose">Close</button></div>
    <div class="hint" style="margin:4px 0 8px">JC leaves a map through a <b>map exit</b> (he walks into it: the next map loads) and appears at an <b>arrival point</b> of the other map (or at its start). Set where an exit leads in its Properties (<i>Leads to</i>). A dialogue or an event of the Story can also take JC to another map (action <i>Take JC to another map</i>).</div>
    <b>Ways out</b><table><tr><th>Exit</th><th>Leads to the map</th><th>arriving at</th><th></th></tr>${exits.join('') || '<tr><td colspan="4" class="hint">No exits: JC cannot leave this map by walking.</td></tr>'}</table>
    <b>Ways in</b> <span class="hint" style="margin:0">${L.start ? 'the start of the map (PlayerStart), and' : 'no PlayerStart!'} these arrival points</span><table><tr><th>Arrival point</th><th>other maps use</th><th></th></tr>${arr.join('') || '<tr><td colspan="3" class="hint">No arrival points.</td></tr>'}</table>
    <b>Maps that lead here</b><table><tr><th>Map</th><th>its exit</th><th>arriving at</th></tr>${inc.join('') || '<tr><td colspan="3" class="hint">None: no map of the game or of the mod leads here yet.</td></tr>'}</table>
    <details><summary><b>Put a new map in the campaign</b></summary><ol class="hint" style="margin:6px 0">
      <li>Your map belongs to a mission (New map): its goals, flags and InfoLinks work in it.</li>
      <li>Open the map of the campaign JC should come from (for example 06_HongKong_WanChai_Market): the editor makes the mod's copy, the original stays as it is.</li>
      <li>There, place a <b>Map exit</b> where it makes sense (a door that is shut in the game, the end of an alley) and set <i>Leads to</i> = your map, arriving at <i>Start</i> (or another arrival point of yours).</li>
      <li>In your map, place a <b>Map exit</b> back: <i>Leads to</i> = that map, arriving at one of its arrival points (the list shows the game's own), or place a new <b>Arrival point</b> in that map next to its exit.</li>
      <li>Rebuild both maps and Install: the game has them. <b>Play from here</b> lets you try the way in.</li></ol></details>`;
  $('#lkclose').onclick = () => { linkBox.style.display = 'none'; };
  $('#lkexit').onclick = () => { linkBox.style.display = 'none'; startPlacing({ cls: 'Teleporter', radius: 40, height: 64, name: 'Map exit', preset: { URL: '""', CollisionRadius: '40.000000', CollisionHeight: '64.000000' } }); };
  $('#lkarr').onclick = () => { linkBox.style.display = 'none'; startPlacing({ cls: 'Teleporter', radius: 16, height: 40, name: 'Arrival point', preset: { bEnabled: 'False', Tag: 'Arrival' } }); };
  for (const l of linkBox.querySelectorAll('[data-sel]')) l.onclick = (e) => { e.preventDefault(); const q = proxyOf(l.dataset.sel); if (q) { select(q); focusSelected(); } };
}
$('#linksbtn').onclick = () => openLinks().catch((e) => { linkBox.innerHTML = `<div class="hint bad">${escapeHtml(e.message)}</div>`; });

// ---------------------------------------------------------------- Check map
// The problems UnrealEd's Map Check finds, and the ones of a mission: links that lead nowhere, patrols
// without a route, exits to maps that do not exist, no start, no light; objects inside walls (the engine,
// on the map as last rebuilt). What you added or changed is checked fully; the original objects of a
// map of the game only for what breaks the map.
const checkBox = $('#checkbox');
async function checkMap() {
  checkBox.style.display = 'block';
  checkBox.innerHTML = '<div class="hint">Checking...</div>';
  const out = [];
  const acts = allActors().filter((a) => !edits.deleted[a.name] && !edits.disabled?.[a.name]);
  const mine = new Set([...(edits.added || []).map((a) => a.name), ...Object.keys(edits.props || {}), ...Object.keys(edits.moved || {})]);
  const tags = new Set(acts.map((a) => tagOf(a).toLowerCase()).filter((t) => t && t !== 'none'));
  const label = (a) => `${hierLabel(a)} (${a.name})`;
  const add = (level, text, who) => out.push({ level, text, who });
  if (!acts.some((a) => a.cls === 'PlayerStart')) add('error', 'No enabled Player start: enable or place one so JC can enter this map.');
  if (!acts.some((a) => /^(Light|Spotlight|TriggerLight)$/.test(a.cls) || /Light/.test(a.cls) && a.kind === 'light')) add('warn', 'No light in the map: everything is as dark as its ambient light.');
  for (const a of acts) {
    if (!mine.has(a.name)) continue;
    const ev = eventOf(a);
    if (ev && ev.toLowerCase() !== 'none' && !tags.has(ev.toLowerCase())) add('warn', `${label(a)} triggers "${ev}", but nothing in the map has that Tag (the story or a script may still use it).`, a.name);
    for (const k of ['FailEvent', 'doorTag', 'cameraTag', 'turretTag']) {
      const v = String(actorProp(a, k) || '');
      if (v && v.toLowerCase() !== 'none' && !tags.has(v.toLowerCase())) add('warn', `${label(a)}: ${k} "${v}" is the Tag of nothing in the map.`, a.name);
    }
    const key = String(actorProp(a, 'KeyIDNeeded') || '');
    if (key && key.toLowerCase() !== 'none' && !acts.some((b) => String(actorProp(b, 'KeyID') || '').toLowerCase() === key.toLowerCase()))
      add('info', `${label(a)} opens with the key "${key}": no key with that ID is in this map (JC must bring it from another map or get it in a dialogue).`, a.name);
    const url = unquote(actorProp(a, 'URL') || '');
    if (a.cls === 'Teleporter' && url) {
      if (!allMapNames) { try { allMapNames = (await api('/api/newmap_info')).maps; } catch (e) { allMapNames = []; } }
      const to = url.split('#')[0];
      if (to && allMapNames.length && !allMapNames.some((m) => m.toLowerCase() === to.toLowerCase())) add('error', `${label(a)} leads to the map "${to}", which does not exist.`, a.name);
    }
  }
  // patrols
  for (const a of acts) {
    if (!isCharacter(a)) continue;
    const orders = String(actorProp(a, 'Orders') ?? '');
    if (orders === 'Patrolling' && !routeOf(a).points.length) add(mine.has(a.name) ? 'error' : 'warn', `${label(a)} patrols, but its first patrol point ("${actorProp(a, 'OrderTag') || 'None'}") is not in the map: they will stand still.`, a.name);
  }
  for (const p of acts.filter((x) => x.cls === 'PatrolPoint' && mine.has(x.name))) {
    const nx = String(actorProp(p, 'Nextpatrol') || '');
    if (nx && nx.toLowerCase() !== 'none' && !tags.has(nx.toLowerCase())) add('warn', `${label(p)}: its next point "${nx}" is not in the map (the patrol stops there).`, p.name);
  }
  const ptags = {};
  for (const p of acts.filter((x) => x.cls === 'PatrolPoint')) { const t = tagOf(p).toLowerCase(); if (t && t !== 'none') (ptags[t] = ptags[t] || []).push(p); }
  for (const [t, list] of Object.entries(ptags)) if (list.length > 1 && list.some((p) => mine.has(p.name))) add('warn', `${list.length} patrol points have the same Tag "${t}": a route through it can take either.`, list[0].name);
  // AI paths, as the last rebuild made them
  if (pathData && acts.some((a) => isCharacter(a) && mine.has(a.name)) && !(pathData.links || []).length)
    add('warn', 'Characters but no AI paths: they cannot find their way round corners. Place path nodes (Objects > AI) and Rebuild.');
  // models: a model of a package the editor does not load (another mod's, unticked), or an imported one deleted
  const placed = acts.filter((a) => a.cls === 'UCMeshDeco' && mine.has(a.name));
  if (placed.length) {
    const ml = modelList || await api('/api/models').catch(() => null);
    if (ml) for (const a of placed) {
      const m = meshOf(a);
      if (m && !ml.meshes.some((x) => x.mesh === m)) add('error', `${label(a)} shows the model ${m}, which is not there any more (an imported model deleted, or the package of another mod not loaded): it is invisible in the game.`, a.name);
    }
  }
  // zones: a zone of the palette needs a closed area (zone portals in the doorways)
  const zoneActs = acts.filter((a) => mine.has(a.name) && /^(ZoneInfo|PrecipitationZone|SnowZone|RevSoundZone|RevZoneInfo)$/.test(a.cls));
  if (zoneActs.length && !(edits.boxes || []).some((b) => b.portal))
    add('info', `${zoneActs.length === 1 ? label(zoneActs[0]) + ' needs' : zoneActs.length + ' zones need'} a closed area: put a zone portal (+ Portal) in every doorway of its room, or it takes the zone it is in (Messages say it after Rebuild).`, zoneActs[0].name);
  // objects inside a block not built yet (Crypt Test, 20 Oct 2026: candlesticks placed before the platform over
  // them "fell out of the world" in the game): found at once, and put on top in one click
  const solidBoxes = (edits.boxes || []).filter((b) => ['solid', 'detail', 'mover'].includes(boxKind(b)) && !(b.rot && b.rot.some((v) => v)));
  for (const a of acts) {
    if (!mine.has(a.name) || /^(Light|Spotlight|PathNode|PatrolPoint|PlayerStart|Teleporter|AmbientSound|ZoneInfo)$/.test(a.cls) || !a.loc) continue;
    const box = solidBoxes.find((b) => [0, 1, 2].every((k) => a.loc[k] > b.lo[k] + 0.5 && a.loc[k] < b.hi[k] - 0.5));
    if (box) out.push({ level: 'error', text: `${label(a)} is inside the block ${box.name}: in the game it falls out of the world or stays stuck.`, who: a.name, fix: { label: 'put it on top', box: box.name } });
  }
  // interactions
  lkCheck(add);
  // where things stand
  if (dirty) add('info', 'There are unsaved changes: Check map looks at them, the game has them after Save and Rebuild.');
  const render = (solid) => {
    const order = { error: 0, warn: 1, info: 2 }, all = out.concat(solid || []).sort((x, y) => order[x.level] - order[y.level]);
    const icon = { error: '<span style="color:var(--bad)">✖</span>', warn: '<span style="color:var(--warn)">▲</span>', info: '<span style="color:var(--acc)">ℹ</span>' };
    checkBox.innerHTML = `<div class="row"><b style="flex:1">Check map · ${escapeHtml(mapName)}</b><button id="ckagain">Check again</button><button id="ckclose">Close</button></div>
      ${all.length ? all.map((c, i) => `<div class="ck-i">${icon[c.level]}<span>${escapeHtml(c.text)}</span>${c.who && proxyOf(c.who) ? `<a href="#" data-ck="${i}">go to</a>` : ''}${c.fix ? ` <a href="#" data-ckfix="${i}">${escapeHtml(c.fix.label)}</a>` : ''}</div>`).join('')
        : '<div class="hint" style="color:var(--ok)">No problems found.</div>'}
      <div class="hint" id="cksolid">${solid ? '' : 'Looking for objects inside walls (the map as last rebuilt)...'}</div>`;
    $('#ckclose').onclick = () => { checkBox.style.display = 'none'; };
    $('#ckagain').onclick = () => checkMap();
    for (const l of checkBox.querySelectorAll('[data-ck]')) l.onclick = (e) => { e.preventDefault(); const q = proxyOf(all[+l.dataset.ck].who); if (q) { select(q); focusSelected(); } };
    for (const l of checkBox.querySelectorAll('[data-ckfix]')) l.onclick = (e) => {
      e.preventDefault();
      const c = all[+l.dataset.ckfix], a = edits.added.find((x) => x.name === c.who), b = (edits.boxes || []).find((x) => x.name === c.fix.box);
      if (!a || !b) return;
      pushUndo();
      a.loc = [a.loc[0], a.loc[1], Math.round((b.hi[2] + (a.height || 16) + 0.5) * 10) / 10];
      setDirty(); rebuildProxies();
      log(`${c.who} is now on top of ${b.name}.`, 'ok');
      checkMap();
    };
  };
  render(null);
  try {
    const r = await api('/api/check?script=' + encodeURIComponent(script));
    const solid = [];
    const lights = r.solid.filter((x) => /Light/.test(x.cls)), others = r.solid.filter((x) => !/Light/.test(x.cls));
    for (const x of others) if (mine.has(x.name) || proxyOf(x.name)?.userData.source === 'added') solid.push({ level: 'error', text: `${x.cls} ${x.name} is inside a wall or a floor (as last rebuilt): it is stuck or invisible. Move it out (End drops it on the floor).`, who: x.name });
    for (const x of lights) if (mine.has(x.name)) solid.push({ level: 'error', text: `The light ${x.name} is inside a wall: it lights nothing. Move it into the room.`, who: x.name });
    const theirs = r.solid.length - solid.length;
    if (theirs) solid.push({ level: 'info', text: `${theirs} objects of the original map are inside walls (they were so in the game: hidden triggers, markers).` });
    if (!r.built) solid.push({ level: 'info', text: 'The map has not been built yet: Rebuild, then Check map again for objects inside walls.' });
    render(solid);
  } catch (e) { render([{ level: 'warn', text: 'The geometry check failed: ' + e.message }]); }
}
$('#checkbtn').onclick = () => checkMap();

// ---------------------------------------------------------------- Map settings: music, information, ambient light
// edits.level (editor/mapsettings.py): Revision's music (an OGG per moment: exploring, combat, conversations,
// leaving, death; the PS2 soundtrack option gets the same unless a map's set is copied), the name of the
// place and the lines shown when the map starts, the ambient light of the map. Applied by Rebuild.
const mapBox = $('#mapbox');
let musicAudio = null;
function playMusic(file, btn) {
  if (musicAudio) { musicAudio.pause(); const was = musicAudio.dataset.file; musicAudio = null; for (const b of document.querySelectorAll('[data-mplay]')) b.textContent = '▶'; if (was === file) return; }
  if (!file) return;
  musicAudio = new Audio('/music/' + encodeURIComponent(file));
  musicAudio.dataset.file = file;
  musicAudio.volume = 0.6;
  window.__tutorialMusic?.hushWhile(musicAudio);
  musicAudio.play().catch(() => {});
  if (btn) btn.textContent = '■';
  musicAudio.onended = () => { if (btn) btn.textContent = '▶'; musicAudio = null; };
}
async function openMapSettings() {
  const settingsScript = script;
  mapBox.style.display = 'block';
  mapBox.innerHTML = '<div class="hint">Reading the map...</div>';
  const S = await api('/api/mapsettings?script=' + encodeURIComponent(script));
  const playerCatalog = await api('/api/player_profiles');
  if (script !== settingsScript) { mapBox.style.display = 'none'; return; }
  const lv = edits.level || {};
  const music = Object.assign({}, S.current.music, lv.music || {});
  const info = Object.assign({}, S.current.info, lv.info || {});
  const amb = Object.assign({}, S.current.ambient, lv.ambient || {});
  const byRole = (key) => S.files.filter((f) => f.role === key).map((f) => f.file);
  const fileOpts = (key, cur) => {
    const mine = byRole(key), rest = S.files.map((f) => f.file).filter((f) => !mine.includes(f));
    const o = (f) => `<option ${f.toLowerCase() === String(cur).toLowerCase() ? 'selected' : ''}>${escapeHtml(f)}</option>`;
    return `<option value="">(none)</option><optgroup label="for this">${mine.map(o).join('')}</optgroup><optgroup label="every track">${rest.map(o).join('')}</optgroup>`;
  };
  const presetOpts = Object.keys(S.presets).sort().map((m) => `<option>${escapeHtml(m)}</option>`).join('');
  const hex = '#' + ueLightRGB(amb.AmbientHue, amb.AmbientSaturation).map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
  mapBox.innerHTML = `<div class="row"><b style="flex:1">Map settings · ${escapeHtml(mapName)}</b><button id="msapply" class="primary">Apply</button><button id="msclose">Close</button></div>
    <div class="hint" style="margin:2px 0 8px">Rebuild puts them in the game.</div>
    ${mapPlayerFields(playerCatalog, lv.player)}
    <b>Music</b> <span class="hint" style="margin:0">${escapeHtml(S.hint || 'Revision plays a track for each moment; ▶ listens to it')}</span>
    <div class="row"><label style="width:auto;min-width:120px">Same as the map</label><select id="mspreset" style="flex:1;min-width:0"><option value="">(choose a map of the game: its whole set)</option>${presetOpts}</select></div>
    <table>${S.roles.map(([key, label]) => `<tr><td style="width:140px">${escapeHtml(label)}</td><td><select data-music="${key}" style="width:100%">${fileOpts(key, music[key] || '')}</select></td>
      <td style="width:40px">${S.preview === false ? '' : `<button data-mplay="${key}" title="Listen">▶</button>`}</td></tr>`).join('')}</table>
    ${S.current.names.music ? '' : '<div class="hint" style="margin:0 0 6px">This map has no music of its own yet: Apply gives it one.</div>'}
    <b>Information</b>
    <div class="row"><label style="width:120px">Place</label><input id="msloc" value="${escapeHtml(info.MissionLocation || '')}" placeholder="Hong Kong - Wan Chai" style="flex:1;min-width:0" title="The name of the place (the save list, the DataVault)"></div>
    <div class="row"><label style="width:120px">Author</label><input id="msauthor" value="${escapeHtml(info.MapAuthor || '')}" style="flex:1;min-width:0"></div>
    <div class="row"><label style="width:120px" title="Up to 4 lines written on the screen when JC arrives (like 'Liberty Island, New York')">Opening lines</label><div style="flex:1;min-width:0">${[0, 1, 2, 3].map((i) => `<input data-msline="${i}" value="${escapeHtml((info.startupMessage || [])[i] || '')}" style="width:100%;margin-bottom:3px">`).join('')}</div></div>
    ${S.current.names.dx ? '' : '<div class="hint warn">This map has no DeusExLevelInfo: its information cannot be set.</div>'}
    <b>Ambient light</b> <span class="hint" style="margin:0">the light everything has where no lamp reaches${S.current.zones ? ` (this map has ${S.current.zones} zones with their own: this is the light of the rest)` : ''}</span>
    <div class="row"><label style="width:120px">Brightness</label><input type="range" id="msamb" min="0" max="64" value="${Math.min(64, amb.AmbientBrightness)}" style="flex:1;padding:0"><span id="msambv" style="width:28px">${amb.AmbientBrightness}</span></div>
    <div class="row"><label style="width:120px">Colour</label><input type="color" id="mscol" value="${hex}" style="width:46px;height:28px;padding:1px"><span class="hint" style="margin:0 0 0 8px">0 = dark; Deus Ex maps use 0-20</span></div>
    <b>Characters</b>
    <div class="row"><label style="width:auto" title="The walkable area (View > Walkable area) goes into the map at every Rebuild, for Tools > Scripts (class'UCNavRoute'.static.Send, UCNavMesh.Route). Walk / Run to a place 'on the walkable area' puts it there anyway"><input type="checkbox" id="msnav" ${lv.navmesh ? 'checked' : ''}> walkable area in the game (for scripts)</label></div>`;
  $('#msclose').onclick = () => { playMusic(null); mapBox.style.display = 'none'; };
  wireProjectPlayer(mapBox, playerCatalog, api);
  $('#msamb').oninput = () => { $('#msambv').textContent = $('#msamb').value; };
  let presetPs2 = null;
  $('#mspreset').onchange = () => {
    const pr = S.presets[$('#mspreset').value];
    if (!pr) return;
    for (const sel of mapBox.querySelectorAll('[data-music]')) sel.innerHTML = fileOpts(sel.dataset.music, pr[sel.dataset.music] || '');
    presetPs2 = pr;
  };
  for (const b of mapBox.querySelectorAll('[data-mplay]')) b.onclick = () => playMusic(mapBox.querySelector(`[data-music="${b.dataset.mplay}"]`).value, b);
  $('#msapply').onclick = () => {
    if (script !== settingsScript) { mapBox.style.display = 'none'; return; }
    pushUndo();
    const m = {};
    for (const sel of mapBox.querySelectorAll('[data-music]')) if (sel.value) m[sel.dataset.music] = sel.value;
    // the PS2 soundtrack option: the copied map's own PS2 tracks, else the same tracks
    const PS2 = { AmbientOggFile: 'PS2AmbientOggFile', CombatOggFile: 'PS2CombatOggFile', ConversationOggFile: 'PS2ConversationOggFile', OutroOggFile: 'PS2OutroOggFile', DeathOggFile: 'PS2DeathOggFile' };
    for (const [k, k2] of Object.entries(PS2)) if (m[k]) m[k2] = presetPs2 && presetPs2[k2] && presetPs2[k] === m[k] ? presetPs2[k2] : m[k];
    // what was set before stays (a map is built again from its source every time); what changed in
    // the panel now is set too. The panel showed the map as last built, with the settings in it.
    const playerBefore = (edits.level || {}).player;
    const level = applyMapPlayer(edits.level || {}, $('#msplayer').value);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(m, music)) level.music = m;
    const inf = { MissionLocation: $('#msloc').value.trim(), MapAuthor: $('#msauthor').value.trim(), startupMessage: [0, 1, 2, 3].map((i) => mapBox.querySelector(`[data-msline="${i}"]`).value.trim()) };
    if (!same(inf, info)) level.info = inf;
    const [hue, sat] = ueHueSat($('#mscol').value);
    const am = { AmbientBrightness: +$('#msamb').value, AmbientHue: hue, AmbientSaturation: sat };
    if (!same(am, amb) && !(am.AmbientBrightness === amb.AmbientBrightness && $('#mscol').value === hex)) level.ambient = am;
    if ($('#msnav').checked) level.navmesh = true; else delete level.navmesh;
    if (Object.keys(level).length) edits.level = level; else delete edits.level;
    if (JSON.stringify((edits.level || {}).player) !== JSON.stringify(playerBefore)) rebuildProxies();     // its look on the Player Start
    setDirty();
    playMusic(null);
    mapBox.style.display = 'none';
    log(Object.keys(level).length ? `Map settings: ${Object.keys(level).join(', ')} changed. Rebuild puts them in the game.` : 'Map settings: as the map has them.', 'ok');
  };
}
$('#mapsetbtn').onclick = () => openMapSettings().catch((e) => { mapBox.innerHTML = `<div class="hint bad">${escapeHtml(e.message)}</div>`; });

// UnrealEd's light colour: hue 0 red, 85 green, 170 blue; saturation 255 = white (the engine's FGetHSV)
function ueLightRGB(hue, sat) {
  const h = hue < 86 ? [(85 - hue) / 85, hue / 85, 0] : hue < 171 ? [0, (170 - hue) / 85, (hue - 85) / 85] : [(hue - 170) / 85, 0, (255 - hue) / 85];
  const s = sat / 255, c = h.map((x) => x + (1 - x) * s), m = Math.max(...c) || 1;
  return c.map((x) => x / m);
}
function ueHueSat(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), m = Math.max(...v) || 1;
  const c = v.map((x) => x / m), s = Math.min(...c);
  if (s > 0.995) return [0, 255];
  const h = c.map((x) => (x - s) / (1 - s));
  let hue;
  if (h[2] <= h[0] && h[2] <= h[1]) hue = 85 * h[1] / Math.max(1e-6, h[0] + h[1]);            // red - green
  else if (h[0] <= h[1] && h[0] <= h[2]) hue = 85 + 85 * h[2] / Math.max(1e-6, h[1] + h[2]); // green - blue
  else hue = 170 + 85 * h[0] / Math.max(1e-6, h[2] + h[0]);                                // blue - red
  return [Math.round(Math.min(255, hue)), Math.round(s * 255)];
}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeoff: svg('<path d="m3 3 18 18M9 5.5A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-4 4M6 6a18 18 0 0 0-4 6s3.5 7 10 7a11 11 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/>'),
  lock: svg('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>'),
  unlock: svg('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0M12 14v3"/>'),
  anim: svg('<path d="M12 3l7 9-7 9-7-9z"/><path d="M3 12h3M18 12h3"/>'),
  cut: svg('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
  drop: svg('<path d="M12 2v9"/><path d="M8 7l4 4 4-4"/><rect x="4" y="15" width="16" height="6" rx="1"/>'),
  dup: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>'),
  copy: svg('<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  connect: svg('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>'),
  talk: svg('<path d="M21 12a8 8 0 0 1-11.8 7L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  map: svg('<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16"/>'),
  exp: svg('<path d="M12 15V3"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  imp: svg('<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 21h14"/>'),
  edit: svg('<path d="M4 20c3 0 5-2 5-5l9-9-3-3-9 9c-3 0-5 2-5 5z"/>'),
  nest: svg('<rect x="3" y="8" width="13" height="13" rx="2"/><path d="M8 8V4h12v12h-4"/>'),
  unnest: svg('<rect x="3" y="11" width="10" height="10" rx="2"/><path d="M13 3h8v8M21 3l-8 8"/>'),
  stick: svg('<path d="M21 3v18"/><rect x="12" y="8" width="6" height="8" rx="1"/><path d="M3 12h6"/><path d="m6 9 3 3-3 3"/>'),
  chev: svg('<path d="m6 9 6 6 6-6"/>'),
};
// a button with an icon: the label hides in a narrow panel (the title keeps the full name)
const ib = (id, icon, label, title, cls = '') => `<button class="ib${cls ? ' ' + cls : ''}" id="${id}" title="${escapeHtml(title)}">${ICON[icon]}<span>${label}</span></button>`;
function inspectorPrimaryActions(p) {
  const d = p.userData, a = d.actor;
  if (!a) return '';
  const button = (id, icon, label, description) => `<button type="button" id="${id}" class="inspector-primary ${icon}" aria-label="${label}" title="${description}">${ICON[icon]}</button>`;
  const dialogue = a.talker !== false && (d.kind === 'pawn' || d.kind === 'prop')
    ? button('bstory', 'talk', 'Dialogue', 'Dialogue — write or edit this object’s conversations') : '';
  const connect = button('lkconnect', 'connect', 'Connect', 'Connect — choose another object to create an interaction') + `<button type="button" id="lkconnectarea" class="inspector-primary connect" aria-label="Connect within radius" title="Connect within radius — select a group" style="width:18px;min-width:18px">⌄</button>`;
  return `<div class="inspector-primary-actions" role="group" aria-label="Object actions">${isCharacter(a) ? dialogue + connect : connect + dialogue}</div>`;
}
function num(id, v, label = '') { return `<input type="number" id="${id}" value="${v}" step="1"${label ? ` aria-label="${label}" title="${label}"` : ''}>`; }
function positionRows(c) {
  // Display viewport axes (Y up); field IDs and values retain the game's XYZ
  // contract so typed edits, scrubbing, tutorial hooks and saved maps agree.
  return '<div class="position-fields" role="group" aria-label="Position">' + [['X', 'px', 0], ['Y', 'pz', 2], ['Z', 'py', 1]].map(([axis, id, k]) => `<div class="row"><label class="scrub" for="${id}" title="${axis === 'Y' ? 'Height. ' : ''}Drag left or right: 1 unit per pixel. Shift: finer. Esc: cancel.">${axis}</label>${num(id, c[k], axis + (axis === 'Y' ? ' position (height)' : ' position'))}</div>`).join('') + '</div>';
}

// Keep the fields and the preview alive while scrubbing. Write edits only on release,
// through the same commit path as the gizmo; a cancelled drag never enters the undo stack.
const details = $('#details');
function finishInspectorDrag(cancel = false) {
  const d = inspectorDrag;
  if (!d) return;
  inspectorDrag = null;
  document.body.classList.remove('inspector-scrubbing');
  if (details.hasPointerCapture(d.pointer)) details.releasePointerCapture(d.pointer);
  if (cancel || d.p.position.equals(d.pos)) {
    d.p.position.copy(d.pos);
    if (d.structureStarted) { followStructure(d.structureMove); if (moveStart === d.structureMove) moveStart = null; }
    showLightRange(d.p); showSoundRange(d.p);
    showDetails(true);
    return;
  }
  pushUndo();
  if (d.p.userData.kind === 'box') {
    // Translation must not snap or resize a block just because the gizmo's grid is on.
    const b = d.p.userData.box, offset = UE(d.p.position.clone().sub(d.pos));
    b.lo = b.lo.map((v, k) => v + offset[k]);
    b.hi = b.hi.map((v, k) => v + offset[k]);
    setDirty(); showDetails();
  } else if (d.structureStarted) commitStructure(d.structureMove);
  else commit(d.p);
}
details.addEventListener('pointerdown', (e) => {
  const label = e.target.closest('label.scrub');
  const inspected = inspectedObject();
  if (!label || e.button !== 0 || inspectorDrag || !inspected || !requireUnlocked(inspected)) return;
  e.preventDefault();
  // Finish any typed number first: its change handler may replace all the labels.
  const id = label.htmlFor;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const input = document.getElementById(id);
  if (!input || !details.contains(input) || input.disabled || input.readOnly || !Number.isFinite(input.valueAsNumber)) return;
  inspectorDrag = { p: inspected, pos: inspected.position.clone(), axis: { px: 'x', py: 'z', pz: 'y' }[id],
    pointer: e.pointerId, x: e.clientX, delta: 0, structureStarted: false };
  details.setPointerCapture(e.pointerId);
  document.body.classList.add('inspector-scrubbing');
});
details.addEventListener('pointermove', (e) => {
  const d = inspectorDrag;
  if (!d || e.pointerId !== d.pointer) return;
  if (!(e.buttons & 1)) { finishInspectorDrag(); return; }
  e.preventDefault();
  d.delta += (e.clientX - d.x) * (e.shiftKey ? 0.1 : 1);
  d.x = e.clientX;
  const value = r1(d.pos[d.axis] + d.delta);
  if (value === d.p.position[d.axis]) return;
  if (isStruct(d.p) && !d.structureStarted) { d.structureMove = beginStructMove(d.p); d.structureStarted = true; }
  d.p.position[d.axis] = value;
  if (d.structureStarted) followStructure(d.structureMove);
  showLightRange(d.p); showSoundRange(d.p);
  showDetails(true);
});
details.addEventListener('pointerup', (e) => { if (inspectorDrag && e.pointerId === inspectorDrag.pointer) finishInspectorDrag(); });
details.addEventListener('pointercancel', (e) => { if (inspectorDrag && e.pointerId === inspectorDrag.pointer) finishInspectorDrag(true); });
details.addEventListener('lostpointercapture', () => finishInspectorDrag(true));
details.addEventListener('click', (e) => { if (e.target.closest('label.scrub')) e.preventDefault(); });
window.addEventListener('blur', () => finishInspectorDrag(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) finishInspectorDrag(true); });
// Every number of the Inspector, like Unity and PlayCanvas: drag its label left or right to change it, a step
// every 4 pixels (Shift: finer), Esc puts it back. The field's own change handler saves it when the button is let go.
{
  let numDrag = null;
  const numberOf = (label) => {
    if (!label || label.classList.contains('scrub') || label.parentElement?.classList.contains('row') !== true) return null;
    const input = label.parentElement.querySelector('input[type=number]');
    return input && !input.disabled && !input.readOnly ? input : null;
  };
  const decimals = (step) => (String(step).split('.')[1] || '').length;
  const endNumDrag = (cancel) => {
    const d = numDrag;
    if (!d) return;
    numDrag = null;
    document.body.classList.remove('inspector-scrubbing');
    window.removeEventListener('keydown', d.esc, true);
    if (cancel) { d.input.value = d.text; return; }
    if (d.input.value !== d.text) d.input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  details.addEventListener('pointerover', (e) => { const l = e.target.closest?.('label'); if (l && numberOf(l)) l.classList.add('num-scrub'); });
  details.addEventListener('pointerdown', (e) => {
    const label = e.target.closest('label'), input = numberOf(label);
    if (!input || e.button !== 0 || inspectorDrag || numDrag) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const step = parseFloat(input.step) || 1;
    numDrag = { input, label, step, start: Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0, text: input.value,
      x: e.clientX, travel: 0, pointer: e.pointerId,
      esc: (k) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); endNumDrag(true); } } };
    label.setPointerCapture(e.pointerId);
    window.addEventListener('keydown', numDrag.esc, true);
    document.body.classList.add('inspector-scrubbing');
  });
  details.addEventListener('pointermove', (e) => {
    const d = numDrag;
    if (!d || e.pointerId !== d.pointer) return;
    if (!(e.buttons & 1)) { endNumDrag(false); return; }
    d.travel += (e.clientX - d.x) * (e.shiftKey ? 0.25 : 1);
    d.x = e.clientX;
    let v = d.start + Math.round(d.travel / 4) * d.step;
    if (d.input.min !== '') v = Math.max(+d.input.min, v);
    if (d.input.max !== '') v = Math.min(+d.input.max, v);
    const text = String(+v.toFixed(decimals(d.step)));
    if (text !== d.input.value) { d.input.value = text; d.input.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  details.addEventListener('pointerup', (e) => { if (numDrag && e.pointerId === numDrag.pointer) endNumDrag(false); });
  details.addEventListener('pointercancel', (e) => { if (numDrag && e.pointerId === numDrag.pointer) endNumDrag(true); });
}

// A pinned Inspector is a view preference, not an object lock or a map edit.
// Resolve by stable key so rebuilding proxies never leaves event handlers on a dead object.
function inspectedObject() {
  if (inspectorPin) {
    const target = inspectorPin.generation === mapGeneration ? objOf(inspectorPin.key) : null;
    if (target && target.parent) return target;
    inspectorPin = null;
  }
  return selected;
}
function inspectorIsPinned() { inspectedObject(); return !!inspectorPin; }
function unlockInspector() { inspectorPin = null; showDetails(); }
function inspectorAction(p, run) {
  // Legacy scene actions intentionally operate on selection. Explicit Inspector
  // buttons first select their displayed object, never an unrelated scene object.
  if (inspectedObject() !== p || !p?.parent) return;
  if (selected !== p) select(p, true);
  return run();
}
function refreshInspectorPin() {
  const target = inspectedObject(), pinned = !!inspectorPin;
  if (!inspectorPinBar) {
    inspectorPinBar = document.createElement('div');
    inspectorPinBar.className = 'inspector-pin-toolbar';
    inspectorPinBar.setAttribute('role', 'group'); inspectorPinBar.setAttribute('aria-label', 'Inspector view');
    // a small padlock on the right, as in Unity (theme.css); the held object's name beside it while locked
    inspectorPinBar.innerHTML = `<small data-inspector-pinned-label></small><button type="button" id="inspector-pin" aria-pressed="false"></button><button type="button" id="missiongraph-open" title="Mission graph — inspect story dependencies without editing" aria-label="Open mission graph">${ICON.map}</button>`;
    $('#details').before(inspectorPinBar);
    inspectorPinBar.querySelector('#missiongraph-open').onclick = () => { resetInput(); const a = inspectedObject()?.userData.actor; window.__missionGraph?.open({ map: mapName, actor: a?.name }); }; 
    inspectorPinBar.querySelector('#inspector-pin').onclick = () => {
      if (inspectorPin) { unlockInspector(); return; }
      const p = inspectedObject(), key = p && p !== groupPivot && keyOf(p);
      if (!script || !key) { status('Select one object or structure to lock the Inspector.', 'warn'); return; }
      inspectorPin = { key, generation: mapGeneration };
      showDetails();
    };
  }
  const button = inspectorPinBar.querySelector('#inspector-pin'), label = inspectorPinBar.querySelector('[data-inspector-pinned-label]');
  button.innerHTML = ICON[pinned ? 'lock' : 'unlock'];
  button.setAttribute('aria-label', pinned ? 'Unlock Inspector' : 'Lock Inspector');
  button.setAttribute('aria-pressed', String(pinned));
  button.disabled = !pinned && (!script || !target || target === groupPivot || !keyOf(target));
  button.title = pinned ? 'Unlock Inspector: follow the selection again' : 'Lock Inspector: keep this object shown while you select others';
  label.textContent = pinned ? (isStruct(target) ? structures[target.userData.name]?.label : target.userData.actor ? hierLabel(target.userData.actor) : target.userData.box?.name) || '' : '';
  inspectorPinBar.querySelector('#missiongraph-open').disabled = !script;
  label.title = label.textContent;
}

function showDetails(live) {
  refreshInspectorPin();
  if (!live && bottomTab === 'prefabs') void prefabBrowser.render();
  if (!inspectorIsPinned() && soundBrowser?.selection()) { soundBrowser.renderInspector(); return; }
  if (!inspectorIsPinned() && surfaceTools.hasSelection) { surfaceTools.panel(); return; }
  if (!live && propertySlider) finishPropertySlider(true);
  if (!live && inspectorDrag) finishInspectorDrag(true);
  const p = inspectedObject(), el = $('#details');
  if (!live) { clearLinks(); disposeGroup(routeLines); }
  if (!p) { el.innerHTML = '<div class="hint inspector-empty">Select an object to edit it.<br>Right-click for actions.<br>RMB + WASD: fly · Ctrl+click: multiselect</div>'; return; }
  if (p === groupPivot) {
    if (live) return;
    const ms = members(), nest = groupPivot.userData.nest && nestById(groupPivot.userData.nest);
    const what = (m) => isStruct(m) ? [structures[m.userData.name].label, 'structure'] : m.userData.actor ? [hierLabel(m.userData.actor), m.userData.actor.name] : ['Block', m.userData.box.name];
    const up = nest && parentNest('n:' + nest.id);
    const head = nest
      ? `<div class="row"><label>Nest</label><input type="text" id="nlabel" value="${escapeHtml(nest.label)}" style="flex:1;min-width:0" title="Its name in the Hierarchy"></div>
        <div class="hint" style="margin:4px 0">${ms.length} objects · Move and rotate together. Double-click to select a member.${up ? ` In <a href="#" id="nup">${escapeHtml(up.label)}</a>.` : ''}</div>`
      : `<b>${ms.length} selected</b><div class="hint" style="margin:4px 0">Move or rotate together. Nest (Ctrl+G) to keep this group.</div>`;
    el.innerHTML = `<div class="box">${head}
      <div style="max-height:200px;overflow:auto;margin:4px 0">${ms.map((m, i) => { const [l, n] = what(m); return `<div class="row" style="margin:1px 0"><a href="#" data-gm="${i}" style="color:var(--acc)">${escapeHtml(l)}</a><small class="hint" style="margin:0 0 0 6px">${escapeHtml(n)}</small></div>`; }).join('')}</div>
      <div class="row actions">${nest ? ib('gunnest', 'unnest', 'Un-nest', `Un-nest (${menuKey('unnest')}): take them out of the nest`) : ib('gnest', 'nest', 'Nest', `Nest them (${menuKey('nest')}): one thing in the Hierarchy, moved as one`)}${placeButtons('gdrop')}${ib('gdup', 'dup', 'Duplicate', 'Duplicate them (Ctrl+D)')}${ib('gcopy', 'copy', 'Copy', 'Copy them (Ctrl+C): paste here or in another map (Ctrl+V)')}${ib('gdel', 'trash', '', 'Delete them (Del)', 'danger')}</div></div>`;
    for (const l of el.querySelectorAll('[data-gm]')) l.onclick = (ev) => { ev.preventDefault(); select(ms[+l.dataset.gm]); focusSelected(); };
    $('#gdrop').onclick = () => placeSelected(); $('#gdropmode').onclick = (ev) => openPlaceMenu(ev.currentTarget); $('#gdup').onclick = duplicateSelected; $('#gcopy').onclick = copySelected; $('#gdel').onclick = deleteSelected;
    const prefabSave = document.createElement('button');
    prefabSave.textContent = 'Save as prefab…'; prefabSave.id = 'gsaveprefab'; prefabSave.title = 'Save this built group in the project Prefabs library for reuse in other levels';
    prefabSave.onclick = () => prefabBrowser.save(); el.querySelector('.row.actions').appendChild(prefabSave);
    if ($('#gnest')) $('#gnest').onclick = nestSelection;
    if ($('#gunnest')) $('#gunnest').onclick = () => unnestNest(nest.id);
    if ($('#nup')) $('#nup').onclick = (ev) => { ev.preventDefault(); selectNest(up.id); };
    if ($('#nlabel')) $('#nlabel').onchange = () => {
      const v = $('#nlabel').value.trim();
      if (!v || v === nest.label) return;
      pushUndo(); nest.label = v.slice(0, 80); setDirty();
    };
    inspectorObjectControls(p);
    return;
  }
  const d = p.userData;
  if (d.kind === 'drawn') {                   // a drawn wall, road, floor or roof (draw-tools.js)
    if (live) return;
    drawTools.inspector(el, d.drawn, { change: (fn) => { pushUndo(); fn(); setDirty(); drawTools.refresh(p); showDetails(); },
      remove: () => inspectorAction(p, deleteSelected) });
    return;
  }
  if (live) {                                 // while dragging: only the numbers
    const c = UE(p.position);
    for (const [k, v] of [['px', c[0]], ['py', c[1]], ['pz', c[2]]]) { const i = $('#' + k); if (i) i.value = v; }
    const y = $('#pyaw');
    const r = objectRotation(p);
    if (y) y.value = Math.round(r[1] * 360 / YAW);
    for (const [id, v] of [['spitch', r[0]], ['sroll', r[2]]]) if ($('#' + id)) $('#' + id).value = Math.round(v * 360 / YAW);
    return;
  }
  const c = UE(p.position);
  let html = '<div class="box inspector-object">';
  if (d.kind === 'structure') {
    const st = structures[d.name], pose = poseOf(st);
    const movingEntry = st.paste && pasteEntry(st.name)?.mover ? pasteEntry(st.name) : null;
    const nativeMover = movingEntry && proxyOf('UCPf' + movingEntry.pid.replace(/\W/g, '') + 'A0');
    const deg = Math.round(((pose.yaw || 0) % YAW) * 360 / YAW);
    const nestIn = parentNest('s:' + st.name), from = st.pendingPiece && structures[st.piece_of];
    const lone = piecesInside(st).length <= 1 && !Object.values(actorStruct).includes(st.name);     // a single piece (as the Hierarchy shows it)
    html += `<b>${escapeHtml(st.label)}</b><div class="hint" style="margin:2px 0">${movingEntry ? 'DeusExMover · ' + (movingEntry.mover.kind === 'elevator' ? 'Elevator' : 'Door') : (lone ? 'piece' : 'structure') + ' · ' + escapeHtml(st.category || '')}${st.pendingCopy ? ' · copy, not built yet' : ''}</div>
      ${from ? `<div class="hint">Taken out of <a href="#" id="bfrom">${escapeHtml(from.label)}</a>: on its own now, a structure of the map at the next Rebuild.</div>` : ''}
      ${nestIn ? `<div class="hint">In the nest <a href="#" id="bnest">${escapeHtml(nestIn.label)}</a> · <a href="#" id="bnestout">take it out</a></div>` : ''}
      ${inspectorSectionStart('transform', 'Transform', true)}${positionRows(c)}
      <div class="row"><label>Rotation °</label>${num('pyaw', deg)}</div>
      <div class="row"><label>Pitch °</label>${num('spitch', Math.round((pose.pitch || 0) * 360 / YAW))}</div>
      <div class="row"><label>Roll °</label>${num('sroll', Math.round((pose.roll || 0) * 360 / YAW))}</div>`;
    if (st.scalable !== false) {
      const sc = pose.scale || ONE;
      html += `<div class="row"><label>Scale %</label>${num('ssx', Math.round(sc[0] * 100), 'X scale %')}${num('ssz', Math.round(sc[2] * 100), 'Y scale % (height)')}${num('ssy', Math.round(sc[1] * 100), 'Z scale %')}</div>
        <div class="row"><label style="width:auto" title="On: textures grow with the object (signs, pictures). Off: textures repeat at their original size (walls). Pieces default to On when resized; your choice is kept."><input type="checkbox" id="sstretch" ${pose.stretch ? 'checked' : ''}> Stretch textures</label></div>`;
    }
    html += '</div></details>';
    html += moverPanel(movingEntry, { escapeHtml, section: inspectorSectionStart, built: !!nativeMover });
    if (st.scalable === false) html += '<div class="hint">Doors and elevators keep their size; position and rotation remain editable.</div>';
    if (st.gameplay) html += '<div class="warn">Contains mission objects: they move together with the structure.</div>';
    if (mapKind !== 'script') html += '<div class="warn">Existing map: moving its pieces makes the rebuild recalculate geometry and lighting. Check the result with "View in game".</div>';
    html += '<div class="hint">Rebuild applies geometry and lighting in game.</div>';
    html += texSection(p);
    if (canTakeApart(st)) {
      const n = piecesInside(st).length, o = objectsInside(st).length;
      html += `<div class="row">${ib('bunnest', 'unnest', 'Un-nest', `Take it apart (${menuKey('unnest')}): its ${n} pieces become structures of their own, its ${o} objects free. Ctrl+Z puts it back.`)}<span class="hint" style="margin:0">${n} piece${n === 1 ? '' : 's'}${o ? `, ${o} object${o === 1 ? '' : 's'}` : ''} inside</span></div>`;
    }
    html += `<div class="row actions">${placeButtons('sdrop')}${ib('bcopy', 'copy', 'Copy', 'Copy (Ctrl+C), then paste it here or in another map (Ctrl+V)')}${st.copyable ? ib('bdup', 'dup', 'Duplicate', 'Duplicate (Ctrl+D)') : ''}${!st.copy_of && (pose.deleted || movedPose(pose)) ? ib('breset', 'reset', 'Reset', 'Reset: put it back as it was') : ''}${ib('bdel', 'trash', '', 'Delete (Del)', 'danger')}</div></div>`;
    el.innerHTML = html;
    wireInspectorSections(el);
    wireTexSection(p);
    surfaceTools.structurePanel(d.name);
    $('#sdrop').onclick = () => inspectorAction(p, () => placeSelected());
    $('#sdropmode').onclick = ev => inspectorAction(p, () => openPlaceMenu(ev.currentTarget));
    const apply = (ev) => {
      // Capture the checkbox before commit redraws the Inspector. Explicit Off
      // must survive future scale/rotate/move operations and save/reload.
      const textureChoice = ev?.target?.id === 'sstretch' ? $('#sstretch').checked : undefined;
      pushUndo();
      const structureMove = beginStructMove(p);
      p.position.copy(T([+$('#px').value, +$('#py').value, +$('#pz').value]));
      if (st.rotatable) {
        p.quaternion.copy(rotations.quat([+$('#spitch').value, +$('#pyaw').value, +$('#sroll').value].map(v => Math.round(v * YAW / 360))));
        const sc = ['ssx', 'ssy', 'ssz'].map((id, i) => $('#' + id) ? Math.max(5, +$('#' + id).value || 100) / 100 : scaleOf(pose)[i]);
        const k = relScale(st, { scale: sc });
        p.scale.set(k[0], k[2], k[1]);
      }
      followStructure(structureMove);
      commitStructure(structureMove, false, textureChoice);
    };
    // its position, turn and size (not the texture section's inputs: a picture chosen to import moves nothing)
    for (const i of el.querySelectorAll('input:not([type=file]):not([type=checkbox][data-tex])')) if (!i.closest('.texrow, [data-mover-settings]')) i.addEventListener('change', apply);
    wireMoverPanel(el, { getEntry: () => pasteEntry(st.name), change: update => {
      if (!requireUnlocked(p)) return;
      const entry = pasteEntry(st.name); if (!entry) return;
      pushUndo(); update(entry); setDirty();
    } });
    if ($('#mover-details')) $('#mover-details').onclick = () => { if (nativeMover) { inspectorPin = null; select(nativeMover); } };
    if ($('#bdup')) $('#bdup').onclick = () => inspectorAction(p, duplicateSelected);
    $('#bcopy').onclick = () => inspectorAction(p, copySelected);
    if (st.copyable) {
      const prefabSave = document.createElement('button');
      prefabSave.textContent = 'Save as prefab…'; prefabSave.id = 'bsaveprefab'; prefabSave.title = 'Save this built structure for reuse in other levels of this project';
      prefabSave.onclick = () => inspectorAction(p, () => prefabBrowser.save()); $('#bcopy').parentElement.appendChild(prefabSave);
    }
    $('#bdel').onclick = () => inspectorAction(p, deleteSelected);
    if ($('#breset')) $('#breset').onclick = () => restoreStructure(st.name);
    if ($('#bunnest')) $('#bunnest').onclick = () => takeApart(st);
    if ($('#bfrom')) $('#bfrom').onclick = (ev) => { ev.preventDefault(); const f = structures[st.piece_of]; if (f && !f.dissolved) select(f.obj); };
    if ($('#bnest')) $('#bnest').onclick = (ev) => { ev.preventDefault(); selectNest(nestIn.id); };
    if ($('#bnestout')) $('#bnestout').onclick = (ev) => { ev.preventDefault(); takeOut('s:' + st.name); };
    inspectorObjectControls(p);
    return;
  }
  if (d.kind === 'box') {
    const b = d.box;
    html += `<b>${blockLabel(b)}</b> <small>${escapeHtml(b.name)}</small>${inspectorSectionStart('transform', 'Transform', true)}${positionRows(c)}
      <div class="row"><label>Rotation °</label>${num('byaw', Math.round((b.rot?.[1] || 0)*360/YAW))}</div>
      <div class="row"><label>Pitch °</label>${num('bpitch', Math.round((b.rot?.[0] || 0)*360/YAW))}</div>
      <div class="row"><label>Roll °</label>${num('broll', Math.round((b.rot?.[2] || 0)*360/YAW))}</div>
      <div class="row"><label>Width</label>${num('sx', b.hi[0] - b.lo[0])}</div><div class="row"><label>Depth</label>${num('sy', b.hi[1] - b.lo[1])}</div><div class="row"><label>Height</label>${num('sz', b.hi[2] - b.lo[2])}</div>
      </div></details>${inspectorSectionStart('block', 'Block settings', true)}
      <div class="row"><label>Texture</label><input id="btex" list="texlist" value="${b.tex}"></div>
      ${b.water || b.portal || b.mover || b.sign ? '' : `<div class="row"><label>Shape</label><select id="bshape" style="flex:1;min-width:0" title="A wedge is a ramp, high at its +X side: turn it with E. Resize a round one with R: an elliptic cylinder, an egg, a low dome">${BLOCK_SHAPES.map(([k, l]) => `<option value="${k}" ${k === blockShape(b) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`}
      ${ROUND_SHAPES.includes(blockShape(b)) ? (() => { const o = blockOptions(b), s = blockShape(b); return `
      <div class="row"><label title="How many sides round (UnrealEd's Sides): more is rounder and heavier">Sides</label><input type="number" id="bsides" value="${o.sides}" min="3" max="64" step="1" style="width:70px"></div>
      <div class="row"><label title="Hollow: the wall's thickness (a pipe, a tower, a shell); 0 is solid. Made of convex pieces by itself">Hollow</label><input type="number" id="bhollow" value="${o.hollow}" min="0" step="4" style="width:70px"><span class="hint" style="margin:0">${o.hollow ? 'wall thickness' : 'solid'}</span></div>
      ${s === 'cone' ? `<div class="row"><label title="The top's radius, a share of the bottom's: 0 a point, more a cut cone (UnrealEd's cap)">Top %</label><input type="number" id="btop" value="${Math.round(o.top * 100)}" min="0" max="95" step="5" style="width:70px"></div>` : ''}
      ${s === 'cylinder' || s === 'cone' ? `<div class="row"><label title="A flat side facing +X instead of a corner (UnrealEd's Align to side)">Align to side</label><input type="checkbox" id="balign" ${o.align ? 'checked' : ''}></div>` : ''}`; })() : ''}
      <div class="row"><label>Kind</label><select id="bkind" style="flex:1;min-width:0" title="Solid: a wall, a floor, a platform. Detail: also blocks, but does not cut the world (lighter for big maps: trim, crates of blocks). Hole: cuts away walls, floors and ceilings it touches (doorways, windows, pits, rooms)">
        <option value="solid" ${!b.hole && !b.mover && b.solid ? 'selected' : ''}>Solid block</option><option value="detail" ${!b.hole && !b.mover && !b.solid ? 'selected' : ''}>Detail block</option>
        <option value="hole" ${b.hole && !b.water ? 'selected' : ''}>Hole</option>
        <option value="mover" ${b.mover ? 'selected' : ''}>Moving block</option>
        <option value="water" ${b.water ? 'selected' : ''}>Water</option><option value="portal" ${b.portal ? 'selected' : ''}>Zone portal</option></select></div>
      ${b.water ? `<div class="row"><label>Liquid</label><select id="bliquid" style="flex:1;min-width:0">${Object.entries(LIQUIDS).map(([k, l]) => `<option value="${k}" ${k === (b.water.kind || 'water') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="row"><label title="Units under the top of the block">Surface</label><input type="number" id="bbelow" value="${b.water.below ?? 16}" step="4" style="width:70px"><span class="hint" style="margin:0">under the top</span></div>
        <div class="row"><label style="width:auto" title="Off: the water fills a basin the map already has (its block shows where)"><input type="checkbox" id="bcarve" ${b.hole ? 'checked' : ''}> cut a pool into the floor</label></div>
        <div class="row"><label>Place name</label><input type="text" id="bzname" value="${escapeHtml(b.water.name || '')}" placeholder="(optional)" style="flex:1;min-width:0"></div>
        <div class="hint" style="margin:0 0 4px">At Rebuild the water becomes a zone of its own (its surface is a zone portal): JC swims and dives; toxic water hurts (radiation), the burning liquid burns.</div>` : ''}
      ${b.portal ? '<div class="hint" style="margin:0 0 4px">An invisible sheet that separates two zones (a doorway, a corridor). Close a room with portals in all its openings, then put a Zone of Objects &gt; Zones inside it: its light, fog, sound, damage and gravity are only there. Messages say after Rebuild if a zone leaks.</div>' : ''}
      ${b.hole && !b.water ? `<div class="row"><label style="width:auto" title="Its top shows the sky (the map gets a sky box if it has none)"><input type="checkbox" id="bsky" ${b.sky ? 'checked' : ''}> open to the sky</label>
        ${b.sky ? `<select id="bskyp" style="flex:1;min-width:0" title="The sky of the map (when it has no sky of its own); Map > Sky &amp; time of day makes one of yours">${(edits.level || {}).skyLook ? `<option value="mine" ${(edits.level || {}).sky === 'mine' ? 'selected' : ''}>Your sky (Map &gt; Sky &amp; time of day)</option>` : ''}${Object.entries(SKIES).map(([k, l]) => `<option value="${k}" ${k === ((edits.level || {}).sky || 'hongkong') ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</div>` : ''}
      ${b.hole ? '<div class="hint" style="margin:0 0 4px">A hole cuts the walls, floors and ceilings it touches at Rebuild; its sides take its texture. To make a room, a hole the size of the room next to an existing one, then a doorway between them.</div>' : ''}
      ${b.hole && Math.min(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1]) >= 160 && b.hi[2] - b.lo[2] >= 128 ? '<div class="row"><button id="blight" title="A new room is dark: a light in the middle, under its ceiling, as wide as the room">Light it</button><span class="hint" style="margin:0">a room made by a hole is dark until it has a light</span></div>' : ''}
      <datalist id="texlist">${texList.map((t) => `<option value="${t}">`).join('')}</datalist></div></details>`;
    if (b.sign) {
      const [sw, sh] = signSize(b);
      const L = signLook(b.sign), sizes = [20, 30, 40, 50, 60, 70, 80];
      html += `<div class="sg-panel"><div class="hint" style="margin:8px 0 2px;font-weight:600">Sign</div>
        <textarea id="sgtext" class="sg" rows="3" placeholder="The text of the sign (Enter: a new line)">${escapeHtml(b.sign.text)}</textarea>
        <div class="row"><label>Preset</label><select id="sgstyle" class="sg" title="A starting point: colours and effects; change anything below after it">${Object.entries(SIGN_STYLES).map(([k, s]) => `<option value="${k}" ${k === b.sign.style ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
        <div class="row"><label>Font</label><select id="sgfont" class="sg">${fontOptions(L.font)}</select>
          <button id="sgfontimp" class="sg-btn" title="Import a font file of yours (.ttf, .otf, .woff): it stays in the list">Import…</button><input type="file" id="sgfontfile" class="sg" accept=".ttf,.otf,.woff,.woff2" hidden></div>
        <div class="row"><label>Text</label>
          <button id="sgbold" class="sg-btn sg-tg ${L.bold ? 'on' : ''}" title="Bold" aria-pressed="${L.bold}"><b>B</b></button>
          <button id="sgitalic" class="sg-btn sg-tg ${L.italic ? 'on' : ''}" title="Italic" aria-pressed="${L.italic}"><i>I</i></button>
          <select id="sgalign" class="sg" title="Alignment">${['left', 'center', 'right'].map((a) => `<option value="${a}" ${a === L.align ? 'selected' : ''}>${a[0].toUpperCase() + a.slice(1)}</option>`).join('')}</select>
          <input type="color" id="sgfg" class="sg" value="${L.fg}" title="Colour of the text"></div>
        <div class="row"><label>Letters</label><select id="sgsize" class="sg" title="How big the letters are"><option value="auto" ${L.size === 'auto' ? 'selected' : ''}>As big as fits</option>${sizes.map((s) => `<option value="${s}" ${+L.size === s ? 'selected' : ''}>${s}% of the height</option>`).join('')}</select></div>
        <div class="row"><label>Outline</label><input type="color" id="sgoutc" class="sg" value="${L.outline || '#000000'}" title="Colour of the outline">
          <input type="range" id="sgoutw" class="sg" min="0" max="20" value="${+L.outlineWidth || 0}" title="Thickness of the outline (0: none)"></div>
        <div class="row"><label>Effects</label><label class="sg-check"><input type="checkbox" id="sgglow" class="sg" ${L.glow ? 'checked' : ''}>Glow</label>
          <label class="sg-check"><input type="checkbox" id="sgshadow" class="sg" ${L.shadow ? 'checked' : ''}>Shadow</label></div>
        <div class="row"><label>Background</label><input type="color" id="sgbg" class="sg" value="${L.bg}" title="Colour of the background">
          <label class="sg-check"><input type="checkbox" id="sgborder" class="sg" ${L.border ? 'checked' : ''}>Border</label>
          <input type="color" id="sgborderc" class="sg" value="${L.border || '#ffffff'}" title="Colour of the border">
          <label class="sg-check"><input type="checkbox" id="sgstripes" class="sg" ${L.stripes ? 'checked' : ''}>Stripes</label></div>
        <div class="row"><label>Plate</label><select id="sgheader" class="sg" title="A band on top, like the game's DANGER and CAUTION signs"><option value="">No band</option>${Object.entries(SIGN_HEADERS).map(([k, h]) => `<option value="${k}" ${k === L.header ? 'selected' : ''}>${h.label} band</option>`).join('')}</select>
          <label class="sg-check"><input type="checkbox" id="sgscrews" class="sg" ${L.screws ? 'checked' : ''}>Screws</label></div>
        <div class="row"><label>Wear</label><input type="range" id="sgwear" class="sg" min="0" max="100" value="${+L.wear || 0}" title="How old the sign looks: grime, scratches, chipped edges (0: new)"></div>
        <div class="row"><label>Picture</label><input id="sgbgtex" class="sg" list="texlist" value="${escapeHtml(L.bgTex || '')}" placeholder="none, or a texture of the game" title="A picture behind the text: a texture of the game (its name), or one of yours (Picture…)">
          <button id="sgbgpic" class="sg-btn" title="A picture of yours as the background">Picture…</button><input type="file" id="sgbgfile" class="sg" accept="image/*" hidden></div>
        <div class="row"><label>Size</label><input type="number" class="sg" id="sgw" value="${Math.round(sw)}" step="8" style="width:72px"> × <input type="number" class="sg" id="sgh" value="${Math.round(sh)}" step="8" style="width:72px"></div>
        <canvas id="sgprev" class="sg-prev" title="The sign as the game will show it"></canvas></div>`;
    }
  } else {
    const a = d.actor;
    const st = d.source === 'map' && structures[actorStruct[a.name]];
    html += `<div class="inspector-object-heading"><b>${escapeHtml(hierLabel(a))}</b>${inspectorPrimaryActions(p)}</div><div class="hint inspector-object-meta" style="margin:2px 0">${escapeHtml(a.name)} · ${escapeHtml(clsShown(a.cls))}${a.tag && a.tag !== a.name ? ' · tag ' + escapeHtml(a.tag) : ''}</div>
      ${inspectorSectionStart('transform', 'Transform', true)}${positionRows(c)}
      <div class="row"><label>Rotation °</label>${num('pyaw', Math.round(radToYaw(p.rotation.y) * 360 / YAW))}</div>`;
    if (isEffectPoint(a) || d.tilt || canTilt(p)) html += `<div class="row"><label title="Up and down: 90 points its front straight up, -90 straight down">Pitch °</label>${num('ppitch', Math.round((d.tilt || 0) * 360 / YAW))}</div>`;
    if (d.roll || canTilt(p)) html += `<div class="row"><label title="Sideways: turns it about its front">Roll °</label>${num('proll', Math.round((d.roll || 0) * 360 / YAW))}</div>`;
    if (canScale(p)) {
      const s = Math.round(p.scale.x * (d.source === 'map' ? (builtScale[a.name] || 1) : 1) * 100);
      html += `<div class="row"><label title="Deus Ex objects scale uniformly">Scale %</label>${num('psc', s)}</div>`;
    }
    html += '</div></details>';
    if (st) html += `<div class="hint">Part of: <a href="#" id="bparent">${escapeHtml(st.label)}</a> · <a href="#" id="bout" title="Out of the structure: it stays where it is and no longer moves with it">take it out</a></div>`;
    if (d.kind === 'mover') html += '<div class="hint">Door or elevator: its motion keys follow its position and rotation. Rebuild to test.</div>';
    else if (a.name.startsWith('UC') && d.source === 'map') html += '<div class="warn">Used by the story: feel free to move it, but keep it in its room.</div>';
    if (d.kind === 'light') html += '<div class="hint">Rebuild to update light on walls and in game.</div>';
  }
  if (d.actor) html += '<div id="propsec"></div>';
  if (d.actor?.cls === 'PlayerStart') html += `<div class="player-inspector"><span title="The player character belongs to this map; all starts use the same one.">Player: ${escapeHtml(edits.level?.player || 'project default')}</span><button id="bplayerprofile" type="button" title="Choose the playable character for this map">Change…</button></div>`;
  if (d.actor) html += texSection(p);
  if (d.actor && d.actor.cls === 'UCCutscene')
    html += `<div class="row">${ib('bcut', 'cut', 'Edit cutscene...', 'Its camera keys, shots, subtitles and events on a timeline')}</div>`;
  else if (d.actor || (d.kind === 'box' && !d.box.hole && !d.box.water && !d.box.portal))
    html += `<div class="row">${ib('banim', 'anim', 'Animate...', 'Animate it: keys of its position, rotation and scale on a timeline (doors and elevators too)')}${(edits.motions || {})[d.actor ? d.actor.name : d.box.name] ? '<span class="hint" style="margin:0">has an animation</span>' : ''}</div>`;
    // a moving block as a door in one choice: it slides its own size away in 2 s (the keys are made, Animate changes them)
    if (d.box && d.box.mover) html += `<div class="row"><label title="Makes its animation at once: it moves its own size that way in 2 seconds. Then play it from an interaction (a lever, a button), or Animate to change it">Quick door</label><select id="bquick" style="flex:1;min-width:0"><option value="">choose how it opens...</option>
      <option value="up">slides up</option><option value="down">slides down</option><option value="+x">slides along +X</option><option value="-x">slides along −X</option><option value="+y">slides along +Y</option><option value="-y">slides along −Y</option></select></div>`;
  const nestOf = parentNest(keyOf(p));
  if (nestOf) html += `<div class="hint">In the nest <a href="#" id="bnest">${escapeHtml(nestOf.label)}</a> · <a href="#" id="bnestout">take it out</a></div>`;
  html += `<div class="row actions">${placeButtons('bdrop')}${ib('bdup', 'dup', 'Duplicate', 'Duplicate (Ctrl+D)')}${ib('bcopy', 'copy', 'Copy', 'Copy (Ctrl+C), then paste it here or in another map (Ctrl+V)')}${ib('bdel', 'trash', '', 'Delete (Del)', 'danger')}</div></div>`;
  el.innerHTML = html;
  wireInspectorSections(el);
  if (d.actor) wireTexSection(p);
  if ($('#bplayerprofile')) $('#bplayerprofile').onclick = () => openMapSettings().catch(e => log(e.message, 'bad'));
  if ($('#lkconnect')) $('#lkconnect').onclick = () => inspectorAction(p, () => connectObject(p));
  if ($('#lkconnectarea')) $('#lkconnectarea').onclick = () => inspectorAction(p, () => connectAreaObject(p));
  if ($('#bstory')) $('#bstory').onclick = () => inspectorAction(p, () => window.__story && window.__story.openFor(d.actor.name));
  if ($('#banim')) $('#banim').onclick = () => inspectorAction(p, () => openAnim(p));
  if ($('#bquick')) $('#bquick').onchange = () => {
    const how = $('#bquick').value, b = d.box;
    if (!how || !b) return;
    const size = [0, 1, 2].map((k) => b.hi[k] - b.lo[k]);
    const off = { up: [0, 0, size[2]], down: [0, 0, -size[2]], '+x': [size[0], 0, 0], '-x': [-size[0], 0, 0], '+y': [0, size[1], 0], '-y': [0, -size[1], 0] }[how];
    pushUndo();
    edits.motions = edits.motions || {};
    edits.motions[b.name] = { pos: [{ t: 0, v: [0, 0, 0], e: 1 }, { t: 2, v: off, e: 1 }], rot: [], scale: [], mode: 'once', autoplay: false };
    setDirty(); showDetails();
    log(`${blockLabel(b)} ${b.name} opens by sliding ${how === 'up' || how === 'down' ? how : 'along ' + how.toUpperCase()} in 2 s. Connect a lever or a button to it (🔗 Connect to...), then Rebuild.`, 'ok');
  };
  if ($('#bcut')) $('#bcut').onclick = () => inspectorAction(p, () => window.__cutscene && window.__cutscene.open(d.actor.name));
  const apply = () => {
    pushUndo();
    if (d.kind === 'box') {
      const b = d.box, cx = +$('#px').value, cy = +$('#py').value, cz = +$('#pz').value;
      const sx = Math.max(4, +$('#sx').value), sy = Math.max(4, +$('#sy').value), sz = Math.max(4, +$('#sz').value);
      b.lo = [cx - sx / 2, cy - sy / 2, cz - sz / 2]; b.hi = [cx + sx / 2, cy + sy / 2, cz + sz / 2];
      b.rot = ['bpitch','byaw','broll'].map(id => Math.round((+$('#'+id).value || 0)*YAW/360));
      p.quaternion.copy(rotations.quat(b.rot));
      b.tex = $('#btex').value.trim() || b.tex;
      lastBlockTex = b.tex;
      const wasShape = blockShape(b), wasRound = JSON.stringify(blockOptions(b));
      if ($('#bshape')) b.shape = $('#bshape').value;
      // a round block's own settings (UnrealEd's builders): kept only when not the defaults
      for (const [id, k, f, d] of [['#bsides', 'sides', (v) => Math.round(Math.max(3, Math.min(64, v))), 16], ['#bhollow', 'hollow', (v) => Math.max(0, v), 0],
        ['#btop', 'top', (v) => Math.max(0, Math.min(95, v)) / 100, 0]]) {
        if (!$(id)) continue;
        const v = f(+$(id).value || 0);
        if (v === d) delete b[k]; else b[k] = v;
      }
      if ($('#balign')) { if ($('#balign').checked) b.align = true; else delete b.align; }
      const kind = $('#bkind').value, wasKind = boxKind(b), wasHole = !!b.hole;
      b.solid = kind !== 'detail';
      if (kind === 'mover') { b.mover = true; b.solid = true; } else delete b.mover;
      if (kind === 'mover') {
        delete b.water; delete b.portal; delete b.hole; delete b.sky;
      } else if (kind === 'water') {
        b.water = b.water || { kind: 'water', below: b.hole ? 16 : 0 };
        if ($('#bliquid')) b.water.kind = $('#bliquid').value;
        if ($('#bbelow')) b.water.below = Math.max(0, +$('#bbelow').value || 0);
        if ($('#bzname')) { const zn = $('#bzname').value.trim(); if (zn) b.water.name = zn; else delete b.water.name; }
        if ($('#bcarve')) { if ($('#bcarve').checked) b.hole = true; else delete b.hole; } else if (wasKind !== 'water') b.hole = true;
        delete b.portal; delete b.sky;
      } else if (kind === 'portal') {
        b.portal = true; delete b.water; delete b.hole; delete b.sky;
      } else {
        delete b.water; delete b.portal;
        if (kind === 'hole') b.hole = true; else delete b.hole;
        if (b.hole && $('#bsky')) { if ($('#bsky').checked) b.sky = true; else delete b.sky; } else if (!b.hole) delete b.sky;
        if (b.sky && $('#bskyp')) { edits.level = edits.level || {}; edits.level.sky = $('#bskyp').value; }
      }
      if (wasKind !== boxKind(b) || wasHole !== !!b.hole || b.water || b.sky !== undefined || wasShape !== blockShape(b) || wasRound !== JSON.stringify(blockOptions(b))) { setDirty(); rebuildProxies(); select(proxies.children.find((q) => q.userData.box === b) || null); return; }
      p.position.copy(T([cx, cy, cz])); p.scale.set(sx, sz, sy);
      setDirty();
      dressBlock(p);
    } else {
      p.position.copy(T([+$('#px').value, +$('#py').value, +$('#pz').value]));
      p.rotation.y = yawToRad(Math.round(+$('#pyaw').value * YAW / 360));
      if ($('#ppitch')) { d.tilt = signedRot((+$('#ppitch').value || 0) * YAW / 360); applyTilt(p); }
      if ($('#proll')) { d.roll = signedRot((+$('#proll').value || 0) * YAW / 360); applyTilt(p); }
      if ($('#psc')) p.scale.setScalar(Math.max(5, +$('#psc').value || 100) / 100 / (d.source === 'map' ? (builtScale[d.actor.name] || 1) : 1));
      commit(p);
    }
  };
  for (const i of el.querySelectorAll('input:not(.sg)')) i.addEventListener('change', apply);
  // a block's menus apply at once too (Kind, Liquid, Sky were only read when a number changed)
  for (const id of ['#bshape', '#bkind', '#bliquid', '#bskyp']) if ($(id)) $(id).addEventListener('change', apply);
  if (d.kind === 'box' && d.box.sign) {
    // the sign's text, style and size: drawn again and imported again (the back stays on its wall)
    const b = d.box;
    // the look in the form (the preview follows every key and click; the texture is made when a change is done)
    const form = () => ({ font: $('#sgfont').value, bold: $('#sgbold').classList.contains('on'), italic: $('#sgitalic').classList.contains('on'),
      align: $('#sgalign').value, fg: $('#sgfg').value, size: $('#sgsize').value === 'auto' ? 'auto' : +$('#sgsize').value,
      outline: $('#sgoutc').value, outlineWidth: +$('#sgoutw').value, glow: $('#sgglow').checked, shadow: $('#sgshadow').checked,
      bg: $('#sgbg').value, bgTex: $('#sgbgtex').value.trim(), border: $('#sgborder').checked ? $('#sgborderc').value : '', stripes: $('#sgstripes').checked,
      header: $('#sgheader').value, wear: +$('#sgwear').value, screws: $('#sgscrews').checked });
    let previewTurn = 0;
    const preview = async () => {
      const turn = ++previewTurn, cv = $('#sgprev');
      if (!cv) return;
      const [w, h] = [Math.max(8, +$('#sgw').value || 128), Math.max(8, +$('#sgh').value || 64)];
      const tw = 512, th = Math.max(64, Math.min(512, 2 ** Math.round(Math.log2(512 * h / Math.max(1, w)))));
      const drawn = await signCanvas({ ...b.sign, text: $('#sgtext').value || ' ', look: form() }, tw, th);
      if (turn !== previewTurn || !document.body.contains(cv)) return;
      cv.width = tw; cv.height = th; cv.getContext('2d').drawImage(drawn, 0, 0);
    };
    const sgChange = () => {
      pushUndo();
      b.sign.text = $('#sgtext').value.replace(/\s+$/, '') || ' ';     // a picture: any letters (Chinese too)
      b.sign.look = form();
      const c = [0, 1, 2].map((k) => (b.lo[k] + b.hi[k]) / 2), k = 'xy'.indexOf(b.sign.face[1]);
      signShape(b, c, Math.max(8, +$('#sgw').value || 128), Math.max(8, +$('#sgh').value || 64), b.hi[k] - b.lo[k]);
      setDirty();
      updateSignTexture(b).catch((e) => log('Sign: ' + e.message, 'bad'));
    };
    const panel = el.querySelector('.sg-panel');
    panel.addEventListener('input', () => preview());
    for (const x of panel.querySelectorAll('textarea.sg, input.sg:not([type=file]), select.sg:not(#sgstyle)')) x.addEventListener('change', sgChange);
    $('#sgstyle').addEventListener('change', () => {                     // a preset: its colours and effects, the font kept
      pushUndo();
      b.sign.style = $('#sgstyle').value;
      const keep = b.sign.look ? { font: b.sign.look.font, align: b.sign.look.align, size: b.sign.look.size } : {};
      b.sign.look = Object.assign(signLook({ style: b.sign.style }), keep);
      setDirty();
      updateSignTexture(b).catch((e) => log('Sign: ' + e.message, 'bad'));
    });
    for (const id of ['#sgbold', '#sgitalic']) $(id).onclick = (e) => {
      e.preventDefault();
      const on = !e.currentTarget.classList.contains('on');
      e.currentTarget.classList.toggle('on', on); e.currentTarget.setAttribute('aria-pressed', String(on));
      preview(); sgChange();
    };
    $('#sgfontimp').onclick = (e) => { e.preventDefault(); $('#sgfontfile').click(); };
    $('#sgfontfile').onchange = async () => {
      const f = $('#sgfontfile').files[0];
      $('#sgfontfile').value = '';
      if (!f) return;
      try {
        const family = await importFont(f);
        $('#sgfont').innerHTML = fontOptions(family);
        log(`Font "${family}" added: it is in every font list from now on.`, 'ok');
        preview(); sgChange();
      } catch (err) { log('Font: ' + err.message, 'bad'); }
    };
    $('#sgbgpic').onclick = (e) => { e.preventDefault(); $('#sgbgfile').click(); };
    $('#sgbgfile').onchange = async () => {                             // a picture of yours, kept as a texture of the map
      const f = $('#sgbgfile').files[0];
      $('#sgbgfile').value = '';
      if (!f) return;
      try {
        const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That picture could not be read.')); i.src = URL.createObjectURL(f); });
        const k = Math.min(1, 512 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const info = await api('/api/texture_import?script=' + encodeURIComponent(script),
          { png: cv.toDataURL('image/png'), base: 'SignPicture', world: null, existing: Object.keys(edits.textures || {}) });
        edits.textures = edits.textures || {};
        edits.textures[info.name] = { pcx: info.pcx, png: info.png, w: info.w, h: info.h, masked: false, scale: 1, from: 'sign-picture' };
        $('#sgbgtex').value = info.name;
        preview(); sgChange();
      } catch (err) { log('Picture: ' + err.message, 'bad'); }
    };
    fontFamilies().then(() => {                                          // the font list, once it is known
      const s = $('#sgfont');
      if (s && document.body.contains(s)) { const v = s.value; s.innerHTML = fontOptions(v); }
    });
    preview();
  }
  if ($('#blight')) $('#blight').onclick = () => {          // a light for the room a hole makes
    const b = d.box, c = [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, b.hi[2] - 24];
    const reach = Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]) * 0.6;
    pushUndo();
    const e = { name: nextName('UCEdit'), cls: 'Light', loc: c.map(r1), rot: [0, 0, 0], radius: 8, height: 8,
                props: Object.assign(lightProps({}), { LightRadius: Math.max(8, Math.min(255, Math.round(reach / 25) - 1)) }) };
    edits.added.push(e);
    setDirty();
    select(makeProxy(Object.assign({ kind: 'light' }, e, { light: { hue: 32, sat: 160 } }), 'added'));
    log('A light in the room: change its colour and brightness in its Properties; Rebuild lights the room.', 'ok');
  };
  $('#bdrop').onclick = () => inspectorAction(p, () => placeSelected()); $('#bdropmode').onclick = (ev) => inspectorAction(p, () => openPlaceMenu(ev.currentTarget)); $('#bdup').onclick = () => inspectorAction(p, duplicateSelected); $('#bdel').onclick = () => inspectorAction(p, deleteSelected); $('#bcopy').onclick = () => inspectorAction(p, copySelected);
  if ($('#bparent')) $('#bparent').onclick = (e) => { e.preventDefault(); select(structures[actorStruct[d.actor.name]].obj); };
  if ($('#bout')) $('#bout').onclick = (e) => { e.preventDefault(); takeOut(keyOf(p)); };
  if ($('#bnest')) $('#bnest').onclick = (e) => { e.preventDefault(); selectNest(nestOf.id); };
  if ($('#bnestout')) $('#bnestout').onclick = (e) => { e.preventDefault(); takeOut(keyOf(p)); };
  if (d.actor) renderProps(p);           // after the position fields are wired: its own inputs save properties only
  inspectorObjectControls(p);
}

function showChanges() {
  $('#save').disabled = temporaryTutorial();
  $('#save').title = temporaryTutorial() ? 'Temporary tutorial: Play/Rebuild use scratch data; closing discards all map changes.' : 'Save map changes';
  const changes = exerciseOnly(edits, publishedLayout);
  const m = Object.keys(changes.moved).length, d = Object.keys(changes.deleted).length, a = changes.added.length, b = changes.boxes.length;
  const sm = Object.values(changes.groups).filter((g) => !g.deleted).length, sd = Object.values(changes.groups).filter((g) => g.deleted).length;
  const sc = changes.copies.length + changes.prefabs.length;
  const pr = Object.values(changes.props || {}).filter((o) => Object.keys(o).length).length;
  const sf = (changes.surfaces || []).length;
  const dc = Object.keys(changes.documents || {}).length;
  const inactive = Object.values(changes.disabled || {}).filter(Boolean).length;
  const ns = (changes.nests || []).length, un = (changes.unnest || []).length;
  const tags = Object.keys(changes.objectTags || {}).length;
  const any = m + d + a + b + sm + sd + sc + pr + sf + ns + un + dc + inactive + tags;
  const parts = [];
  if (tags) parts.push(`Scripting tags: ${tags} objects`);
  if (inactive) parts.push(`Disabled in game: ${inactive} object${inactive === 1 ? '' : 's'}`);
  if (dc) parts.push(`Documents: ${dc} text${dc === 1 ? '' : 's'}`);
  if (ns + un) parts.push(`Nests: ${ns} · taken out of their structures: ${un}`);
  if (sf) parts.push(`Surfaces: ${sf} operation${sf === 1 ? '' : 's'} · Rebuild applies textures and shadows`);
  if (pr) parts.push(`Properties: ${pr} object${pr === 1 ? '' : 's'}`);
  if (sm + sd + sc) parts.push(`Structures: moved ${sm} · deleted ${sd} · copies ${sc}`);
  if (m + d + a + b) parts.push(`Objects: moved ${m} · deleted ${d} · added ${a} · blocks ${b}`);
  $('#changes').innerHTML = any ? `${parts.join('<br>')}${dirty ? ' <span class="warn">(unsaved)</span>' : ''}
    <div class="row"><button id="resetall">Revert all changes</button></div>` : 'No changes.';
  const r = $('#resetall');
  if (r) r.onclick = () => { if (confirm('Revert all the changes made with the editor on this map?')) { pushUndo(); edits = Object.assign(EMPTY(), withPublishedLayout({}, publishedLayout)); rebuildProxies(); setDirty(); } };
}

// ---------------------------------------------------------------- toolbar
function autosaveKey() { return script ? `${projectContext?.id || 'legacy'}:${script}:${mapGeneration}` : null; }
function autosaveState() {
  const preferences = normalizeAutosaveSettings(window.__menubar?.prefs || {});
  return { ...preferences, key: autosaveKey(), dirty: dirty || !!window.__story?.dirty,
    tutorial: temporaryTutorial(), busy: !!(gameView?.active || mapLoading || mapSaveQueue.pending || window.__story?.saving ||
      $('#busy')?.style.display === 'flex' || window.__projectNavigation || projectHub?.visible ||
      tc.dragging || inspectorDrag || propertySlider || moveStart || placing ||
      document.querySelector('dialog[open]') || Date.now() - lastEditingInput < 1500) };
}
function save({ automatic = false } = {}) {
  if (!script || (automatic && temporaryTutorial())) return Promise.resolve(false);
  const savingScript = script, savingEdits = edits, savingSession = tutorialSession.revision;
  const current = () => script === savingScript && edits === savingEdits && tutorialSession.revision === savingSession;
  return mapSaveQueue.run(async () => {
    if (!current() || (automatic && (mapLoading || temporaryTutorial()))) return false;
    if (automatic && !dirty) return true;
    const revision = editRevision, snapshot = exerciseOnly(edits, publishedLayout);
    await api('/api/edits?script=' + encodeURIComponent(savingScript) + (automatic ? '&automatic=1' : ''), snapshot);
    if (!current()) return false;
    if (revision === editRevision) { dirty = false; showChanges(); }
    if (!automatic && !dirty) status(temporaryTutorial() ? `${mapName}: updated for this temporary training session. Close map discards it.` : `${mapName}: saved`, 'ok');
    if (!automatic && !dirty && !window.__story?.dirty) autosave?.saved(autosaveKey());
    return true;
  });
}
$('#save').onclick = () => {
  if (temporaryTutorial()) { status('The tutorial cannot be saved. Rebuild/Play use a temporary copy; Close map discards it.'); return; }
  save().catch((e) => log(e.message, 'bad'));
};
let openingExperimentalBsp = false;
async function openExperimentalBsp() {
  if (!script || mapLoading || gameView?.active || temporaryTutorial() || openingExperimentalBsp ||
      window.__menubar?.prefs?.experimentalLocalGeometry !== true) return;
  const openingScript = script, openingGeneration = mapGeneration;
  const st = selected?.userData?.kind === 'structure' ? structures[selected.userData.name] : null;
  const brush = st && !st.copy_of && !st.pendingCopy && !st.pendingPaste
    ? (st.brush_names || []).find(name => typeof name === 'string' && /^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) : undefined;
  openingExperimentalBsp = true;
  try {
    busy('Saving changes before opening Local geometry…');
    const saved = await save();
    if (!saved || script !== openingScript || mapGeneration !== openingGeneration || gameView?.active || temporaryTutorial()) return;
    busy('Opening Local geometry (Experimental)…');
    const request = { script: openingScript };
    if (brush) request.brush = brush;
    const result = await api('/api/experimental_bsp', request);
    if (result.started !== true) throw new Error(result.error || 'Local geometry could not be opened.');
    log(result.message || 'Local geometry opened on a private copy of the last built map. Rebuild first to include pending edits.', 'warn');
    status('Local geometry (Experimental) opened', 'ok');
  } catch (e) {
    log(e.message, 'bad'); status('Local geometry could not be opened: see Messages', 'bad');
  } finally { openingExperimentalBsp = false; busy(''); }
}
async function rebuildMap(mode = 'auto') {
  if (!script || gameView?.active) return;
  const rebuildingScript = script;
  try {
    busy('Saving changes before Rebuild...');
    await save();
    if (script !== rebuildingScript) return;
    await navBakeIfNeeded();
    if (script !== rebuildingScript) return;
    busy('Rebuilding the map (about a minute)...');
    const camPos = camera.position.clone(), yaw = cam.yaw, pitch = cam.pitch;
    const r = await api('/api/build?script=' + encodeURIComponent(script), { mode });
    log(r.lines, r.ok ? '' : 'bad');
    if (r.ok) { await loadScene(script, false); camera.position.copy(camPos); cam.yaw = yaw; cam.pitch = pitch; status(`${mapName}: rebuilt`, 'ok'); }
    else status('rebuild failed: see Messages', 'bad');
  } catch (e) { log(e.message, 'bad'); } finally { busy(''); }
}
$('#build').onclick = () => rebuildMap();
$('#play').onclick = async () => {
  if (gameView?.active) return;
  if (dirty) log('Some changes are not rebuilt yet: the game shows the last rebuilt map.', 'warn');
  busy('Taking a screenshot in the game (the first time the game starts up: about 30 seconds)...');
  try {
    const f = forward();
    const look = camera.position.clone().addScaledVector(f, 200);
    const r = await api('/api/view?script=' + encodeURIComponent(script), { pos: UE(camera.position), look: UE(look) });
    if (r.url) { $('#shotimg').src = r.url + '?t=' + Date.now(); $('#shotinfo').textContent = 'in game'; $('#shot').style.display = 'block'; }
    else log('No screenshot: ' + r.answer, 'warn');
  } catch (e) { log(e.message, 'bad'); } finally { busy(''); }
};
$('#stopgame').onclick = async () => {
  if (gameView?.active) return gameView.stop();
  try { const result = await api('/api/live_stop', {}); status(result.answer); } catch (e) { log(e.message, 'bad'); }
};
$('#install').onclick = async () => {
  const msg = mapKind === 'script' ? 'Install the last rebuilt map into the game?'
    : mapKind === 'dx-mod' ? 'Install the rebuilt map? It replaces the copy in maps\\ (the previous one goes to maps\\backup) and the changes become part of the map.'
    : 'Install the rebuilt map? The original game map stays untouched: the edited copy goes to maps\\ and the game loads it instead.';
  if (!confirm(msg)) return;
  busy('Installing...');
  try { const r = await api('/api/install?script=' + encodeURIComponent(script), {}); log(r.lines, r.ok ? 'ok' : 'bad'); } catch (e) { log(e.message, 'bad'); } finally { busy(''); }
};
$('#helpbtn').onclick = () => { const h = $('#help'); h.style.display = h.style.display === 'block' ? 'none' : 'block'; };
$('#shotclose').onclick = (e) => { e.preventDefault(); $('#shot').style.display = 'none'; };
$('#shotimg').onclick = () => $('#shot').classList.toggle('big');
$('#map').onchange = () => openMap($('#map').value).catch(e => { log(e.message,'bad'); startScreen.error(e); $('#map').value = script || ''; });
window.addEventListener('beforeunload', (e) => { if (!window.__projectNavigation && (gameView?.active || (!temporaryTutorial() && (dirty || window.__story?.dirty || unsavedProjectTools().length)))) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- keyboard
// flying keys by position on the keyboard (Shift, Caps Lock or a text field do not change them)
const MOVE = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyQ: 'q', KeyE: 'e' };
window.addEventListener('keydown', (e) => {
  if (!script || gameView?.active || projectHub?.visible || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape' && textureTransfer?.engaged) { e.preventDefault(); textureTransfer.cancel(); status('Texture placement cancelled.'); return; }
  if (propertySlider && (e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); finishPropertySlider(true); return; }
  if (inspectorDrag) {
    e.preventDefault();
    if (e.key === 'Escape') finishInspectorDrag(true);
    return;
  }
  if (cam.look) {                      // right button held: the keys fly the camera, wherever the focus is
    const m = MOVE[e.code];
    if (m) { cam.keys[m] = true; e.preventDefault(); }
    cam.keys.shift = e.shiftKey;
    return;
  }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && !(e.target.type === 'range' && e.ctrlKey && e.key.toLowerCase() === 'z')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 's') { e.preventDefault(); save(); return; }
  if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) {
    e.preventDefault();
    if (redoStack.length) { undo.push(JSON.stringify(edits)); edits = JSON.parse(redoStack.pop()); afterHistory(); status('Redone.'); }
    return;
  }
  if (e.ctrlKey && k === 'z') { e.preventDefault(); if (undo.length) { redoStack.push(JSON.stringify(edits)); edits = JSON.parse(undo.pop()); afterHistory(); } return; }
  if (e.ctrlKey && k === 'g') { e.preventDefault(); if (e.shiftKey) unnestSelection(); else nestSelection(); return; }
  if (e.ctrlKey && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (e.ctrlKey && k === 'c') { e.preventDefault(); copySelected(); return; }
  if (e.ctrlKey && k === 'v') { e.preventDefault(); pasteClipboard(); return; }
  if (placing && placing.draw && drawTools.key(e.key)) { e.preventDefault(); return; }   // stairs, roof: [ ] , .
  // R while placing an object: a quarter turn more (it keeps the turn for the next ones of the same kind)
  if (k === 'r' && !e.ctrlKey && placing && !placing.draw && !placing.route && !placing.box && !placing.hole) {
    e.preventDefault();
    placing.turn = ((placing.turn || 0) + YAW / 4) % YAW;
    if (lastPlacingMove) movePlacing(lastPlacingMove);
    status(`Turned ${Math.round((placing.turn / YAW) * 360)}° (R turns it again). Click where it goes.`);
    return;
  }
  if (k === 'w') setMode('translate');
  else if (k === 'e') setMode('rotate');
  else if (k === 'r') setMode('scale');
  else if (k === 'g') { snap = !snap; applySnap(); vpBar?.refresh(); status('grid snap ' + (snap ? 'on' : 'off')); }
  else if (k === 'end') placeSelected();
  else if (k === 'delete') { if (!selected && currentFolder()) deleteFolder(currentFolder()); else deleteSelected(); }
  else if (k === 'enter' && placing && placing.draw) finishDraw();
  else if (k === 'backspace' && placing && placing.draw) drawTools.undoPoint();
  else if ((k === 'escape' || k === 'enter') && placing && placing.route) endRoute();
  else if ((k === 'f2' || (k === 'enter' && !placing)) && currentFolder()) { e.preventDefault(); renameFolder(currentFolder()); }
  else if (k === 'escape' && lkPicking) { lkEndPick(); status('Cancelled.'); }
  else if (k === 'escape' && modelReplace) { cancelModelReplacement(); }
  else if (k === 'escape') { cancelPlacing(); select(null); }
  else if (k === 'p') togglePaths();
  else if (k === 'q') surfaceTools.toggle();
  else if (k === 'b') startPlacing({ box: true, size: [128, 128, 16], tex: 'ClenGreyCncrt_A' }, $('#addbox'));
  else if (k === 'f') focusSelected();
  else if (k === 'h') $('#helpbtn').click();
  else if (k === 'l') setLightMode({ shaded: 'lit', lit: 'unlit', unlit: 'shaded' }[lightMode] || 'shaded');
});
$('#lightmode').onchange = () => setLightMode($('#lightmode').value);
// the texture picker: a picture next to every texture field, a grid of the map's and the game's textures
createTexturePicker({ api, getMapTextures: () => {
  if (!mapName) return [];
  const base = `/cache/${mapName}/`;
  const out = texList.map((name) => {
    const t = mapTex && mapTex[texFull[name]];
    return { name, url: t && t.png ? base + t.png : '', size: t && t.w ? `${t.w}×${t.h}` : '' };
  });
  for (const n of Object.keys((edits && edits.textures) || {})) out.unshift({ name: n, url: texUrl(n), size: '' });
  return out;
} });
vpBar = createViewportToolbar({
  getLightMode: () => lightMode, setLightMode,
  getMode: () => tc.mode, setMode: (m) => setMode(m),
  getSnap: () => snap, setSnap: (on) => { snap = on; applySnap(); status('grid snap ' + (snap ? 'on' : 'off')); },
  getSteps: () => SNAP,
  setStep: (kind, v) => {
    if (window.__menubar?.setPref) window.__menubar.setPref(kind === 'move' ? 'gridMove' : 'gridRotate', v);
    else { SNAP[kind] = v; applySnap(); }
    status(kind === 'move' ? `Grid step ${v} units` : `Rotation step ${v}°`);
  },
  getNav: () => ({ paths: showPaths, walk: navView.on }),
  setNavLayer: (k) => (k === 'paths' ? togglePaths() : toggleNav()),
  testRoute: () => { if (!showPaths && !navView.on) togglePaths(true); $('#routebtn').click(); },
  fillPaths: () => fillPaths(),
  getIcons: () => showIcons,
  setIcons: (on) => {
    showIcons = on;
    try { localStorage.setItem('deusedix.viewIcons', on ? '1' : '0'); } catch { /* no storage */ }
    applyObjectVisibility();
    status(on ? 'Icons shown' : 'Icons hidden: lights, AI paths and logic points stay in the Hierarchy');
  },
});
let lightGainFrame = 0;
function flushLightGain() {
  cancelAnimationFrame(lightGainFrame);
  lightGainFrame = 0;
  applyLighting();
}
$('#lightgain').oninput = () => {
  lightGain = +$('#lightgain').value || 1;
  try { localStorage.setItem('ucmap.lightgain', String(lightGain)); } catch (e) { /* no storage */ }
  if (!lightGainFrame) lightGainFrame = requestAnimationFrame(flushLightGain);
};
$('#lightgain').onchange = flushLightGain;
window.addEventListener('keyup', (e) => { const m = MOVE[e.code]; if (m) cam.keys[m] = false; cam.keys.shift = e.shiftKey; });

// for debugging from the browser console
window.__editor = { standForIdle, scene, camera, cam, world, proxies, wake, renderer, SNAP, applySnap, placeSelected, mapPose,
  modelImport: { readModelFiles, modelPayload, bakeClips, isAnimatedRoot, clipFrames, skinSpread, simplifyModel, modelTris, modelParts },   // for tests: Import model's steps
  async usePlayerCharacter(id) {
    if (!mapName) throw new Error('Open a map first, then choose its player character.');
    const chosenScript = script;
    const catalog = await api('/api/player_profiles');
    const character = catalog.characters.find(c => c.id === id);
    if (!character?.supported) throw new Error(character?.reason || 'This character is not available as a player.');
    if (script !== chosenScript) throw new Error('The map changed. Choose the player again.');
    pushUndo(); edits.level = applyMapPlayer(edits.level || {}, id); setDirty(); rebuildProxies(); showDetails();
    log(`Player character: ${character.name}. Save and Rebuild to apply. Inventory and progress stay shared.`, 'ok');
  },
  startDraw: (kind) => startDraw(kind),         // Map > Draw wall / road / floor / roof
  openSky: () => skyTool.open(),                // Map > Sky & time of day
  fillPaths: () => fillPaths(),                 // Map > Fill AI paths
  // a script of Tools > Scripts, a weapon or ammunition of Tools > Weapons (preset: its properties, e.g. its model)
  placeClass: (cls, name, preset = null, size = null) => startPlacing(Object.assign({ cls, name, radius: 16, height: 16 }, size || {}, preset ? { preset } : {})),
  get placeMode() { return placeMode; }, get standalone() { return STANDALONE; }, get structures() { return structures; }, get edits() { return edits; },
  rebuild: rebuildMap, openExperimentalBsp, play: (mode = 'embedded') => gameView?.start(mode), playSettings: openPlay,
  stopGame: () => gameView?.stop(), get playing() { return !!gameView?.active; },
  configureAutosave: () => autosave?.check(),
  revealInspector, showAllObjects, unlockAllObjects, setObjectView, setGameEnabled,
  surfaceTools, loadMaps, openMap, openNewMap, openMapPicker: () => startScreen.openPicker(),
  closeMap: () => !mapLoading && startScreen.closeMap(), confirmLeave: () => startScreen.confirmLeave(),
  endTutorialSession, resetTutorialView, get temporaryTutorial() { return temporaryTutorial(); },
  get project() { return projectContext; }, confirmProjectLeave,
  get pickingInteraction() { return !!lkPicking; },
  get dirty() { return dirty; },   // loadMaps, dirty: the tutorial (tutorial.js)
  get selected() { return selected; }, select, setMode, commit, beginStructMove, followStructure, commitStructure, showDetails, tc,
  get inspected() { return inspectedObject(); }, get inspectorPinned() { return inspectorIsPinned(); }, unlockInspector,
  get script() { return script; }, get mapName() { return mapName; }, get baseActors() { return baseActors; },
  get added() { return edits.added; },
  selectActor(name) {
    const p = proxies.children.find((c) => c.userData.actor && c.userData.actor.name === name);
    if (p) { select(p); focusSelected(); } else log(`${name}: not in the scene.`, 'warn');
  },
  selectedLoc() { return selected && selected.userData.actor ? UE(selected.position) : null; },
  cameraPoint(dist) { const v = camera.position.clone().add(forward().multiplyScalar(dist)); return UE(v); },
  setLightGain(g) { lightGain = g; flushLightGain(); },
  startPlacing(item) { startPlacing(item); }, refreshPalette() { buildPalette(); }, log, loadFactions, updateCustom, renderThumb,
  get palette() { return palette; }, animsChanged, applyTexture,
  useStudioAnim(name, anim) {                // the Studio gives one of its animations to a character of this map
    const a = allActors().find((x) => x.name === name), q = proxyOf(name);
    if (!a || (q && !requireUnlocked(q))) return;
    pushUndo();
    edits.anims = edits.anims || {};
    edits.anims[name] = Object.assign({}, edits.anims[name], { idle: anim, rate: 1, own: true, loc: q ? UE(q.position) : a.loc });
    setDirty();
    animsChanged();
  } };
// the cutscene cameras (cutscene.js) use these
window.__editor.cutKit = { T, UE, canvas, proxyOf, select, focusSelected, pushUndo, undoPop: () => undo.pop(), setDirty, allActors,
  hierLabel, isCharacter, status, log, lkList, lkStartPick, lkNewAct, lkSentence, lkActText, showDetails: () => showDetails(),
  pickSound, playSound, makeProxy, nextName };
window.__closeAnim = () => closeAnim();
window.addEventListener('deusedix:original-conversations', () => { buildHierarchy(); showDetails(); });
$('#storybtn').onclick = () => window.__story && window.__story.open();
$('#studiobtn').onclick = () => {
  const a = selected && selected.userData.actor;
  window.__studio && window.__studio.open(a && isCharacter(a) ? a.cls : null);
};

resize();
animate();
function requirePlayerStart() {
  if (usablePlayerStarts(allActors(), edits, chainNow).length) return true;
  const box = $('#playbox');
  box.innerHTML = `<b>Player start required</b><p class="warn" role="alert">${PLAYER_START_REQUIRED}</p>
    <div class="row" style="justify-content:flex-end"><button id="ps-close">Close</button><button id="ps-find" class="primary">Find Player start</button></div>`;
  box.style.display = 'block';
  $('#ps-close').onclick = () => { box.style.display = 'none'; };
  $('#ps-find').onclick = () => {
    box.style.display = 'none'; window.__workspace?.show('browser');
    $('.btab[data-tab="objects"]')?.click();
    $('#search').value = 'Player start'; $('#search').dispatchEvent(new Event('input',{bubbles:true}));
    $('#search').focus();
  };
  return false;
}
gameView = createGameView({ api, getScript: () => script, getSession: () => window.__projectContext?.session,
  getStart: () => ({ ...playStart(), route: !STANDALONE }), save: saveWorkspace,
  validate: () => { if (!requirePlayerStart()) throw new Error(PLAYER_START_REQUIRED); },
  resetInput, log, status, viewport: canvas });
if (projectContext?.id) void gameView.resume();
startScreen = createStartScreen({ open: openMap, create: openNewMap, refresh: loadMaps, save: saveWorkspace,
  clear: clearMap, hasChanges: () => !temporaryTutorial() && (dirty || !!window.__story?.dirty), project: projectContext,
  openProjects: () => projectHub?.show(), exitTutorial: () => projectHub?.leaveTraining() });
projectHub = createProjectHub({ confirmLeave: confirmProjectLeave, onVisibility(open) {
  if (open) { resetInput(); closeMenu(); if (!gameView?.active) status('Choose a project to begin.'); }
  else if (!gameView?.active) status(script ? mapName : 'Choose a map to begin.');
}, onCurrent(project) {
  projectContext = project; startScreen.setProject(project);
  window.dispatchEvent(new CustomEvent('deusedix:project-state', { detail: { project } }));
} });
autosave = createAutosave({ getState: autosaveState,
  async save(key) {
    if (key !== autosaveKey() || temporaryTutorial()) return false;
    const saved = await saveWorkspace({ automatic: true, key });
    if (saved && key === autosaveKey() && !dirty && !window.__story?.dirty) {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      status(`${mapName}: autosaved at ${time}`, 'ok');
    }
    return saved;
  },
  onError(error, key) {
    if (key !== autosaveKey()) return;
    status('Autosave failed; some changes are still unsaved.', 'warn');
    log('Autosave: ' + error.message, 'bad');
  } });
document.addEventListener('input', () => { lastEditingInput = Date.now(); }, true);
window.addEventListener('deusedix:map-state', () => autosave.check());
window.addEventListener('pagehide', () => autosave.stop());
window.addEventListener('pageshow', () => autosave.start());
autosave.start();

projectHub.init().then(() => loadMaps()).then(() => {
  if (!projectContext) return;
  if (isTrainingProject(projectContext)) return projectHub.startTutorialHere();
  const prefs = window.__menubar?.prefs || {};
  const projectPrefs = readProjectMapPrefs(projectContext);
  if (prefs.startup === 'last' && mapList.some(m => m.script === projectPrefs.lastMap)) return openMap(projectPrefs.lastMap);
}).catch(e => {
  startScreen.error(e); log(e.message,'bad');
  if (isTrainingProject(projectContext)) window.__tutorialLoading?.fail(e);
});
