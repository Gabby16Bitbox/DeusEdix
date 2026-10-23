// Texture editor of the map editor: paint and adjust a texture of the game (or a picture of yours), then
// put it on one object, on every object (or face) wearing that texture in the map, or keep it in
// "My textures". The picture becomes a texture of the map at Rebuild (editor/textures.py: PCX, 256
// colours, sides a power of two; transparent pixels make it a masked texture, like fences).
//
// Opened from the Inspector (Textures: Edit, or Import a picture), with a context from app.js:
// {tex, label, kind: 'actor'|'structure', slot, size: [w, h] in the world, preview3d(canvas) -> object}.
import { editorIcon } from './editor-icons.js';
import { attachToolWindow } from './tool-window.js';
import { TextureLayers } from './texture-layers.js';
import { createTexturePaint3D } from './texture-paint-3d.js';
import { mountTextureLayers } from './texture-layer-panel.js';
import { drawText, fontFamilies, fontOptions, importFont } from './text-style.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
}
const TOOLS = [
  ['brush', 'B', 'Brush', 'Paint with the selected colour'],
  ['eraser', 'E', 'Eraser', 'Erase pixels to transparency (a masked texture, like a fence)'],
  ['fill', 'G', 'Fill', 'Fill an area of similar colours'],
  ['picker', 'I', 'Colour picker', 'Sample a colour; Alt with any brush'],
  ['clone', 'S', 'Clone stamp', 'Alt+click to set a source, then paint to copy it'],
  ['soften', 'U', 'Blur', 'Soften seams and hard edges where you paint'],
  ['lighten', 'O', 'Lighten', 'Lighten worn edges or highlights where you paint'],
  ['darken', 'Shift+O', 'Darken', 'Paint dirt or shadows by darkening the texture'],
  ['text', 'T', 'Text', 'Click where the text goes and type there; drag its edge (or Ctrl+drag) to move it, its handles to size it; Ctrl+Enter or a click elsewhere paints it, Esc drops it'],
  ['select', 'M', 'Select', 'Drag a rectangle to limit edits to that area; Esc clears it'],
];

const TE = { open: false, ctx: null, doc: null, w: 0, h: 0, tool: 'brush', color: '#a03030', size: 16, hard: 0.6, opacity: 1,
  tol: 32, contiguous: true, font: 24, zoom: 1, ox: 0, oy: 0, sel: null, undo: [], redo: [], recent: [], cloneSrc: null,
  cloneOff: null, gamePreview: false, dirty: false, layers: null, mode: '2d', showUV: false,
  loading: false, alphaLock: false, pixelBrush: false,
  // the Text tool: its settings (kept between texts) and the text being placed (draft: x, y on the texture)
  text: { text: '', font: 'Bahnschrift', bold: true, italic: false, align: 'left', outline: '#000000', outlineWidth: 0, shadow: false, glow: false },
  draft: null, draftDrag: null,
  // Photoshop's habits (Gabby, 17 Oct 2026): a background colour beside the colour (X swaps them), the text's
  // handles to make it bigger or smaller, Ctrl+T to move, scale and turn a selection, a right-click menu
  bg: '#ffffff', textScale: null,
  // Crop (17 Oct 2026, like Photoshop / GIMP / Krita): a preview first (the rest dimmed, handles, its size in
  // the game), Enter crops, Esc leaves it. focus: the view framed on a part of the texture (nothing cut)
  cropping: null, focus: null, rectDrag: null,
  // Copy and paste (Gabby, 17 Oct 2026): Ctrl+C copies the selection as it is seen (all layers), Ctrl+V puts
  // it down as a floating piece (on the selection made elsewhere, else where it came from) that is dragged
  // or nudged; Enter or a click outside paints it on the active layer, Esc drops it
  clip: null, float: null, floatDrag: null,
  // Photoshop's keys (Gabby, 18 Oct 2026): Alt (the picker), a tool held only while its key is (spring), Alt+right
  // drag sizes the brush, Shift+click paints a straight line from the last point, O / Shift+O lighten / darken
  alt: false, spring: null, brushDrag: null, lastDab: null, dodge: 'lighten' };
const BRUSH_TOOLS = ['brush', 'eraser', 'clone', 'soften', 'lighten', 'darken'];
let view, vctx, pv = null;
let layerPanel = null;
let openRevision = 0;
let documentRevision = 0;
const islandPaths = new Map();
let adjustFrame = 0, adjustLive = null;
function cancelAdjustPreview() {
  cancelAnimationFrame(adjustFrame);
  adjustFrame = 0; adjustLive = null;
}
function flushAdjustPreview() {
  if (!adjustFrame) return;
  const live = adjustLive;
  cancelAdjustPreview();
  if (TE.open && live) live();
}

// ---------------------------------------------------------------- the window
function ensureDom() {
  if ($('#texedit')) return;
  const el = document.createElement('div');
  el.id = 'texedit';
  el.innerHTML = `
  <div class="te-top"><b>Texture Editor</b><span id="te-name" class="hint"></span><span style="flex:1"></span>
    <button id="te-import" title="Open a picture or an editable DeusEdix texture project">Open…</button>
    <input type="file" id="te-file" accept="image/*,.json" style="display:none">
    <button id="te-lib" title="My textures: the pictures you kept">My textures</button>
    <button id="te-down" title="Download the picture as PNG">Download PNG</button>
    <button id="te-project" title="Download all layers as an editable texture project">Save layers</button>
    <button id="te-undo" title="Undo (Ctrl+Z)">Undo</button><button id="te-redo" title="Redo (Ctrl+Y)">Redo</button>
    <button id="te-close">Cancel</button></div>
  <div class="te-tools" id="te-tools"></div>
  <div class="te-opts" id="te-opts"></div>
  <div class="te-stage" id="te-stage">
    <section class="te-pane te-main" id="te-flat"><header><b>Texture · 2D</b><button id="te-uv" title="Show the model's UV edges" aria-pressed="false">UV</button><button id="te-flat-enlarge" title="Paint on the 2D texture">Enlarge 2D</button></header><canvas id="te-view" aria-label="2D texture painting canvas"></canvas><textarea id="te-intext" class="te-intext" wrap="off" spellcheck="false" aria-label="Text" hidden></textarea></section>
    <section class="te-pane te-mini" id="te-model"><header><b>Model · 3D</b><button id="te-frame" title="Frame the model">Frame</button><button id="te-model-enlarge" title="Paint on the 3D model">Enlarge 3D</button></header><canvas id="te-model-view" aria-label="3D model painting canvas"></canvas><div class="te-model-hint">Paint: left · Orbit: right · Pan: middle · Zoom: wheel</div></section>
  </div>
  <div class="te-right" id="te-right"></div>
  <div class="te-status hint" id="te-status"></div>
  <div class="te-lib" id="te-libbox"></div>`;
  document.body.appendChild(el);
  // Let layer controls handle Enter/arrows, then stop map shortcuts behind the modal.
  el.addEventListener('keydown', e => e.stopPropagation());
  attachToolWindow(el, $('.te-top', el), $('#te-close', el));
  view = $('#te-view');
  vctx = view.getContext('2d');
  bindInlineText();
  $('#te-tools').innerHTML = TOOLS.map(([id, key, label, hint]) => `<button data-tool="${id}" aria-label="${esc(label)} (${key})" aria-pressed="false" title="${esc(label)} (${key}): ${esc(hint)}">${editorIcon(id)}</button>`).join('')
    + `<div class="te-colors"><input type="color" id="te-color" value="${TE.color}" title="Colour: painting, text, fill (click to choose)" aria-label="Colour">`
    + `<input type="color" id="te-bgcolor" value="${TE.bg}" title="Background colour: Ctrl+Backspace fills with it (click to choose)" aria-label="Background colour">`
    + `<button type="button" id="te-swapc" title="Swap the two colours (X)" aria-label="Swap the colours">⇄</button></div><div id="te-recent"></div>`;
  for (const b of el.querySelectorAll('[data-tool]')) b.onclick = () => setTool(b.dataset.tool);
  $('#te-color').oninput = () => { TE.color = $('#te-color').value; markRecent(); draw(); };
  $('#te-color').onchange = () => addRecent(TE.color);
  $('#te-bgcolor').oninput = () => { TE.bg = $('#te-bgcolor').value; };
  $('#te-swapc').onclick = () => swapColors();
  const css = document.createElement('style');
  css.textContent = TE_CSS;
  document.head.appendChild(css);
  $('#te-close').onclick = () => close();
  $('#te-undo').onclick = () => undo();
  $('#te-redo').onclick = () => redo();
  $('#te-down').onclick = () => { if (TE.loading) return; commitAdjust(); compose(); download(TE.doc.toDataURL('image/png'), (TE.base || 'texture') + '.png'); };
  $('#te-project').onclick = () => {
    if (TE.loading) return;
    commitAdjust(); compose();
    const url = URL.createObjectURL(new Blob([JSON.stringify(TE.layers.serialize())], { type: 'application/json' }));
    download(url, (TE.base || 'texture') + '.dxtx.json');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('#te-import').onclick = () => $('#te-file').click();
  $('#te-file').onchange = () => { const f = $('#te-file').files[0]; $('#te-file').value = ''; if (f) openFile(f); };
  $('#te-lib').onclick = () => toggleLibrary();
  $('#te-flat-enlarge').onclick = () => setViewMode('2d');
  $('#te-model-enlarge').onclick = () => setViewMode('3d');
  $('#te-frame').onclick = () => pv?.fit();
  $('#te-uv').onclick = () => { TE.showUV = !TE.showUV; $('#te-uv').setAttribute('aria-pressed', String(TE.showUV)); pv?.setWireframe(TE.showUV); draw(); };
  view.addEventListener('pointerdown', onDown);
  view.addEventListener('pointermove', onMove);
  view.addEventListener('pointerup', onUp);
  view.addEventListener('pointerleave', () => { TE.hover = null; draw(); });
  view.addEventListener('wheel', onWheel, { passive: false });
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', resizeViews);
  new ResizeObserver(resizeViews).observe($('#te-stage'));
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', () => { TE.alt = false; TE.space = false; TE.spring = null; });
  window.addEventListener('paste', onPaste, true);
}
function status(t, cls = '') { const s = $('#te-status'); if (s) { s.textContent = t; s.className = 'te-status hint ' + cls; } }
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }

// ctx: what the texture is and where it goes (see the top of the file); src: the picture to start from
async function open(ctx, src) {
  ensureDom();
  if (TE.saving) return false;
  if (TE.open && (TE.dirty || TE.adjBase || TE.draft || TE.float || TE.cropping)
      && !confirm('Open another texture? Unapplied changes to the current texture will be discarded. Apply or save its layers first to keep them.')) return false;
  const revision = ++openRevision;
  ++documentRevision;
  if (pv) { pv.stop(); pv = null; }
  TE.loading = true;
  TE.dirty = false; TE.draft = null; TE.draftDrag = null; TE.textScale = null;
  TE.float = null; TE.cropping = null; TE.hover = null;
  cancelAdjustPreview(); TE.adjBase = null;
  TE.layers = null; TE.doc = null;
  $('#te-right').replaceChildren(); layerPanel = null;
  TE.ctx = ctx || {};
  TE.open = true;
  $('#texedit').style.display = 'grid';
  TE.base = (ctx && ctx.tex ? ctx.tex.split('.').pop() : 'MyTexture').replace(/^UCT_/, '');
  $('#te-name').textContent = ctx && ctx.label ? ctx.label : '';
  $('#te-name').title = ctx?.label || '';
  setTool(TE.tool);
  renderOpts();
  status('loading the texture...');
  try {
    let img, project;
    if (src instanceof File) img = await fileImage(src);
    else if (src) img = await loadImage(src);
    else if (ctx && ctx.tex) {
      const info = await api('/api/texture_source?tex=' + encodeURIComponent(ctx.tex) + '&script=' + encodeURIComponent(ctx.script || ''));
      if (info.document) project = await TextureLayers.fromProject(info.document);
      else img = await loadImage(info.url);
    }
    if (revision !== openRevision || !TE.open) return;
    newDoc(img ? img.width : 256, img ? img.height : 256, img);
    if (project) adoptLayers(project);
    TE.loading = false;
    setupPreview();
    if (src instanceof File) {
      TE.base = src.name.replace(/\.[^.]+$/, '').replace(/\W+/g, '_');
      TE.dirty = true;
      renderRight();
    }
    const game = pow2(TE.w) !== TE.w || pow2(TE.h) !== TE.h ? ` (in the game ${pow2(TE.w)} x ${pow2(TE.h)}: sides a power of two; Resize to choose)` : '';
    status(`${TE.w} × ${TE.h}${game}. ${pv ? 'Paint on the model or enlarge the texture. Shared UVs paint together.' : 'Paint on the texture. Middle drag to pan; wheel to zoom.'}`);
  } catch (e) {
    if (revision !== openRevision || !TE.open) return;
    TE.loading = false;
    newDoc(256, 256, null);
    setupPreview();
    status('Could not read the texture: ' + e.message + ' (a blank picture instead)', 'bad');
  }
}
function close(force) {
  if (TE.saving && force !== true) return;
  if (!force && (TE.dirty || TE.adjBase) && !confirm('Close the texture editor? Your changes are not applied.')) return;
  ++openRevision;
  TE.saving = false;
  if ($('#te-apply')) $('#te-apply').disabled = false;
  cancelAdjustPreview();
  TE.open = false;
  TE.adjBase = null;
  TE.dirty = false;
  TE.loading = false; TE.stroke = null; TE.pan = null;
  if ($('#texedit')) $('#texedit').style.display = 'none';
  if (pv) { pv.stop(); pv = null; }
}
function loadImage(url) {
  return new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('picture not readable')); im.src = url; });
}
function fileImage(f) {
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => loadImage(r.result).then(ok, bad); r.onerror = bad; r.readAsDataURL(f); });
}
function newDoc(w, h, img) {
  cancelAdjustPreview();
  TE.adjBase = null;
  const layers = new TextureLayers(w, h, { source: img });
  layers.add('Paint layer');
  adoptLayers(layers);
  TE.undo = []; TE.redo = []; TE.sel = null; TE.cloneSrc = null; TE.dirty = false; TE.lastDab = null;
  TE.cropping = null; TE.focus = null; TE.rectDrag = null; TE.float = null; TE.floatDrag = null;
  fitView();
  changed(false);
  renderRight();
}
function compose(force = false) {
  if (TE.layers && TE.doc && (force || TE.needsComposite)) {
    TE.layers.flatten(TE.doc); TE.needsComposite = false; pv?.update(); drawTiles();
  }
}
function syncLayer() {
  TE.w = TE.layers.width; TE.h = TE.layers.height;
  TE.dc = TE.layers.active.canvas.getContext('2d', { willReadFrequently: true });
  if (!TE.doc) TE.doc = document.createElement('canvas');
  compose(true); islandPaths.clear(); TE.quant = null;
}
function adoptLayers(layers) {
  TE.layers = layers; syncLayer();
  TE.sel = null; TE.cloneSrc = null; TE.cloneOff = null; TE.stroke = null;
  TE.cropping = null; TE.focus = null; TE.rectDrag = null; TE.float = null; TE.floatDrag = null;
  const name = $('#te-keepname'); if (name) name.value = TE.base || 'MyTexture';
  renderRight(); resizeViews();
}
function editable() {
  if (TE.loading || TE.saving || !TE.layers) return false;
  const layer = TE.layers.active;
  if (layer.locked || !layer.visible) { status(layer.locked ? 'Unlock this layer to paint.' : 'Show this layer to paint.', 'warn'); return false; }
  return true;
}
function mutateLayers(fn) {
  if (TE.loading || TE.saving) return;
  commitAdjust();
  const before = snapshot();
  try { fn(TE.layers); remember(TE.undo, before); TE.redo = []; syncLayer(); layerPanel?.refresh(); changed(); }
  catch (e) { status(e.message, 'warn'); }
}
function commitAdjust() { flushAdjustPreview(); if (TE.adjBase) $('#a-apply')?.onclick(); }
async function importLayer() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0], revision = openRevision, request = ++documentRevision;
    if (!file) return;
    try { const img = await fileImage(file); if (TE.open && !TE.saving && revision === openRevision && request === documentRevision) mutateLayers(model => model.add(file.name.slice(0, 80), { source: img })); }
    catch (e) { status(e.message, 'bad'); }
  };
  input.click();
}
async function openFile(f) {
  if (TE.loading || TE.saving) return;
  const revision = openRevision, request = ++documentRevision;
  try {
    let layers;
    if (/\.json$/i.test(f.name)) {
      if (f.size > 192 * 1024 * 1024) throw new Error('Texture project is too large.');
      layers = await TextureLayers.fromProject(JSON.parse(await f.text()));
    } else {
      const img = await fileImage(f);
      layers = new TextureLayers(img.width, img.height, { source: img }); layers.add('Paint layer');
    }
    if (revision !== openRevision || request !== documentRevision || !TE.open || TE.saving) return;
    if (TE.doc && TE.dirty && !confirm('Open this picture in place of the texture you are editing?')) return;
    commitAdjust();
    pushUndo();
    TE.base = f.name.replace(/\.[^.]+$/, '').replace(/\W+/g, '_');
    adoptLayers(layers);
    changed();
    status(`${f.name}: ${TE.w} × ${TE.h}. Game texture: ${pow2(TE.w)} × ${pow2(TE.h)}.`);
  } catch (e) { status('Open picture: ' + e.message, 'bad'); }
}
let pasteTimer = 0;
function onPaste(e) {                       // Ctrl+V: a piece copied here, or a picture of another program
  if (!TE.open) return;
  clearTimeout(pasteTimer);
  if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;      // text into a text field
  const item = [...(e.clipboardData || {}).items || []].find((i) => i.type.startsWith('image/'));
  if (!item) {
    if (TE.clip) { e.preventDefault(); e.stopPropagation(); pasteFloat(TE.clip.canvas, TE.clip); }
    return;
  }
  e.preventDefault(); e.stopPropagation();
  const file = item.getAsFile();
  fileImage(file).then((img) => {
    if (!TE.open || TE.loading || TE.saving) return;
    const own = TE.clip && img.width === TE.clip.canvas.width && img.height === TE.clip.canvas.height;
    if (own) return pasteFloat(TE.clip.canvas, TE.clip);             // our own copy, back from the clipboard
    if (TE.doc) {                                                     // a piece inside the texture, smaller if it is bigger
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return pastePicture(c);
    }
    openFile(file);
  }, (err) => status('Paste: ' + err.message, 'bad'));
}
const pow2 = (n) => { let p = 8; while (p < 1024 && Math.abs(p * 2 - n) <= Math.abs(p - n)) p *= 2; return p; };

// ---------------------------------------------------------------- the view
function resizeViews() { if (!TE.open || !TE.doc) return; fitView(); pv?.resize(); draw(); }
function setViewMode(mode) {
  endStroke(); TE.mode = mode === '3d' && pv ? '3d' : '2d';
  for (const [id, main] of [['te-flat', TE.mode === '2d'], ['te-model', TE.mode === '3d']]) {
    $('#' + id).classList.toggle('te-main', main); $('#' + id).classList.toggle('te-mini', !main);
  }
  $('#te-model').hidden = !pv;
  $('#te-flat-enlarge').hidden = TE.mode === '2d';
  $('#te-model-enlarge').hidden = TE.mode === '3d';
  pv?.setPaintingEnabled(TE.mode === '3d');
  resizeViews();
}
function islandPath(hit) {
  const key = `${hit.objectId}:${hit.islandId}:${TE.w}:${TE.h}`;
  if (!islandPaths.has(key)) {
    const path = new Path2D();
    for (const polygon of pv.getIslandTriangles(hit)) {
      polygon.forEach(([x, y], i) => i ? path.lineTo(x * TE.w, y * TE.h) : path.moveTo(x * TE.w, y * TE.h));
      path.closePath();
    }
    islandPaths.set(key, path);
  }
  return islandPaths.get(key);
}
function paintStart(p, e, path = null) {
  if (TE.loading || TE.saving || !TE.doc) return;
  const t = TE.tool;
  commitAdjust();
  if (e.altKey && t === 'clone') { TE.cloneSrc = p; TE.cloneOff = null; renderOpts(); status('Clone source set. Paint where it goes.'); return; }
  if (e.altKey || t === 'picker') { pick(p); return; }
  if (t === 'select') { if (path) { setViewMode('2d'); return; } TE.dragSel = { x0: p.x, y0: p.y, x: Math.floor(p.x), y: Math.floor(p.y), w: 0, h: 0 }; return; }
  if (!editable()) return;
  if (t === 'eraser' && TE.alphaLock) { status('Disable Lock alpha to erase.', 'warn'); return; }
  if (t === 'fill') return fill(p, path);
  if (t === 'text') return text(p, path);
  if (t === 'clone' && !TE.cloneSrc) { status('Alt+click first where to copy from.', 'warn'); return; }
  beginStroke(p, path, e.shiftKey && !path && TE.lastDab ? TE.lastDab : null);   // Shift+click: a line from the last point
}
function setupPreview() {
  pv?.stop(); pv = null; islandPaths.clear();
  textureHoverHint(null);
  if (TE.ctx.preview3d) try {
    pv = createTexturePaint3D($('#te-model-view'), {
      makeObject: TE.ctx.preview3d, getCanvas: () => TE.doc, getBrushSize: () => TE.size,
      onStrokeStart(hit, e) { paintStart(hit, e, islandPath(hit)); return !!TE.stroke; },
      onStrokeMove(hit) {
        if (!TE.stroke) return;
        if (!hit.continuous) { TE.stroke.last = hit; TE.stroke.started = false; }
        TE.stroke.path = islandPath(hit); dab(hit);
      },
      onStrokeEnd: endStroke,
      onHover(hit, blocked) { TE.hover = hit; textureHoverHint(blocked); if (TE.stroke) render(); else draw(); },
    });
  } catch (e) { status('3D view unavailable: ' + e.message, 'warn'); }
  $('#te-uv').disabled = !pv;
  pv?.setWireframe(TE.showUV);
  setViewMode(pv ? '3d' : '2d');
}
function textureHoverHint(blocked) {
  const hint = $('#te-model .te-model-hint');
  if (!hint) return;
  const choice = blocked && TE.ctx.materials?.find(m => TE.ctx.kind === 'actor' ? m.slot === blocked.slot : m.tex === blocked.tex);
  const text = blocked?.reason === 'material'
    ? (choice ? `This face uses ${choice.label}. Choose it in Texture.` : 'This face uses another texture. Choose its texture in the Inspector.')
    : blocked ? 'This face has no paintable UVs.' : 'Paint: left · Orbit: right · Pan: middle · Zoom: wheel';
  hint.textContent = text; hint.title = text;
  $('#te-model-view').title = blocked ? text : '';
}
function fitView() {
  const r = view.getBoundingClientRect();
  view.width = Math.max(1, Math.round(r.width * devicePixelRatio)); view.height = Math.max(1, Math.round(r.height * devicePixelRatio));
  if (!TE.doc) return;
  const f = TE.focus && TE.focus.x + TE.focus.w <= TE.w && TE.focus.y + TE.focus.h <= TE.h ? TE.focus : { x: 0, y: 0, w: TE.w, h: TE.h };
  const k = Math.min(view.width / f.w, view.height / f.h) * 0.9;
  TE.zoom = Math.min(64, k >= 1 ? Math.floor(k) || 1 : k);
  TE.ox = (view.width - f.w * TE.zoom) / 2 - f.x * TE.zoom; TE.oy = (view.height - f.h * TE.zoom) / 2 - f.y * TE.zoom;
}
// Focus: the view on the selection, to paint a part closely without cutting anything (F; F or 0: all of it)
function setFocus(on) {
  TE.focus = on && TE.sel ? { ...TE.sel } : null;
  fitView(); renderOpts(); draw();
  status(TE.focus ? `Focused on ${TE.focus.w} × ${TE.focus.h}: nothing is cut. F or 0: the whole texture.` : 'The whole texture.');
}
let checker = null;
function draw() {
  if (!TE.doc) return;
  compose();
  const g = vctx, z = TE.zoom;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#101319'; g.fillRect(0, 0, view.width, view.height);
  if (!checker) {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const cg = c.getContext('2d'); cg.fillStyle = '#5a5f6a'; cg.fillRect(0, 0, 16, 16); cg.fillStyle = '#3c4049'; cg.fillRect(0, 0, 8, 8); cg.fillRect(8, 8, 8, 8);
    checker = g.createPattern(c, 'repeat');
  }
  g.fillStyle = checker;
  g.fillRect(TE.ox, TE.oy, TE.w * z, TE.h * z);
  g.imageSmoothingEnabled = z < 1;
  g.drawImage(TE.gamePreview && TE.quant ? TE.quant : TE.doc, TE.ox, TE.oy, TE.w * z, TE.h * z);
  if (TE.showUV && pv) {
    g.save(); g.strokeStyle = 'rgba(112,218,255,.75)'; g.lineWidth = 1; g.beginPath();
    for (const [x1,y1,x2,y2] of pv.getUVWireframe()) { g.moveTo(TE.ox+x1*TE.w*z,TE.oy+y1*TE.h*z); g.lineTo(TE.ox+x2*TE.w*z,TE.oy+y2*TE.h*z); }
    g.stroke(); g.restore();
  }
  if (z >= 8) {                             // the pixel grid
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x <= TE.w; x++) { const sx = Math.round(TE.ox + x * z) + 0.5; g.moveTo(sx, TE.oy); g.lineTo(sx, TE.oy + TE.h * z); }
    for (let y = 0; y <= TE.h; y++) { const sy = Math.round(TE.oy + y * z) + 0.5; g.moveTo(TE.ox, sy); g.lineTo(TE.ox + TE.w * z, sy); }
    g.stroke();
  }
  g.strokeStyle = '#2c313b'; g.strokeRect(TE.ox - 0.5, TE.oy - 0.5, TE.w * z + 1, TE.h * z + 1);
  if (TE.draft && TE.tool === 'text') {      // the text being placed: as it will be painted, with its box
    g.save(); g.setTransform(z, 0, 0, z, TE.ox, TE.oy); g.globalAlpha = TE.opacity;
    drawText(g, textOptions(), { x: TE.draft.x, y: TE.draft.y, w: 0, h: 0 });
    g.restore();
    const b = textBox();
    if (b) {
      g.setLineDash([4, 3]); g.strokeStyle = '#7fc3ff'; g.strokeRect(TE.ox + (b.x - 3) * z, TE.oy + (b.y - 3) * z, (b.w + 6) * z, (b.h + 6) * z); g.setLineDash([]);
      drawHandles(g, textFrame(b));                 // drag one: the text bigger or smaller
    }
  }
  const sel = TE.cropping ? null : (TE.dragSel || TE.sel);
  if (sel) {
    g.setLineDash([5, 4]); g.strokeStyle = '#fff'; g.strokeRect(TE.ox + sel.x * z + 0.5, TE.oy + sel.y * z + 0.5, sel.w * z, sel.h * z);
    g.strokeStyle = '#000'; g.lineDashOffset = 4; g.strokeRect(TE.ox + sel.x * z + 0.5, TE.oy + sel.y * z + 0.5, sel.w * z, sel.h * z);
    g.setLineDash([]); g.lineDashOffset = 0;
    if (TE.tool === 'select' && !TE.dragSel) drawHandles(g, sel);
  }
  if (TE.cropping) drawCrop(g, TE.cropping);
  if (TE.float) {                            // a pasted or transformed piece, turned about its middle
    const f = TE.float, c = floatCenter(f), k = Math.round(7 * devicePixelRatio);
    g.save();
    g.translate(TE.ox + c.x * z, TE.oy + c.y * z); g.rotate(f.angle);
    g.imageSmoothingEnabled = z < 1 || !floatPlain(f);
    g.save(); g.scale(f.flipX ? -1 : 1, f.flipY ? -1 : 1); g.drawImage(f.canvas, -f.w * z / 2, -f.h * z / 2, f.w * z, f.h * z); g.restore();
    g.setLineDash([5, 4]); g.strokeStyle = '#7fc3ff'; g.lineWidth = 1;
    g.strokeRect(-f.w * z / 2, -f.h * z / 2, f.w * z, f.h * z); g.setLineDash([]);
    g.fillStyle = '#fff'; g.strokeStyle = '#000';
    for (const [hx, hy] of HANDLE_SPOTS) { const x = (hx - 0.5) * f.w * z - k / 2, y = (hy - 0.5) * f.h * z - k / 2; g.fillRect(x, y, k, k); g.strokeRect(x, y, k, k); }
    g.restore();
  }
  if (TE.hover && BRUSH_TOOLS.includes(TE.tool) && !TE.alt) {
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.beginPath();
    g.arc(TE.ox + TE.hover.x * z, TE.oy + TE.hover.y * z, Math.max(1, TE.size / 2 * z), 0, 7); g.stroke();
    if (TE.brushDrag) {                       // Alt+right drag: the hard middle of the brush too
      g.setLineDash([3, 3]); g.beginPath();
      g.arc(TE.ox + TE.hover.x * z, TE.oy + TE.hover.y * z, Math.max(0.5, TE.size / 2 * z * TE.hard), 0, 7); g.stroke(); g.setLineDash([]);
    }
    if (TE.tool === 'clone' && TE.cloneSrc) {
      const sx = TE.cloneOff ? TE.hover.x + TE.cloneOff.x : TE.cloneSrc.x, sy = TE.cloneOff ? TE.hover.y + TE.cloneOff.y : TE.cloneSrc.y;
      g.strokeStyle = 'rgba(90,162,255,0.9)'; g.beginPath(); g.arc(TE.ox + sx * z, TE.oy + sy * z, Math.max(2, TE.size / 2 * z), 0, 7); g.stroke();
    }
  }
  placeInline();
}
function rectOnScreen(r) { const z = TE.zoom; return { x: TE.ox + r.x * z, y: TE.oy + r.y * z, w: r.w * z, h: r.h * z }; }
const HANDLE_SPOTS = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]];
const textFrame = (b) => ({ x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 });
function drawHandles(g, r) {
  const s = rectOnScreen(r), k = Math.round(7 * devicePixelRatio);
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1;
  for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) {
    const x = Math.round(s.x + s.w * hx - k / 2) + 0.5, y = Math.round(s.y + s.h * hy - k / 2) + 0.5;
    g.fillRect(x, y, k, k); g.strokeRect(x, y, k, k);
  }
}
function drawCrop(g, r) {
  const s = rectOnScreen(r), t = rectOnScreen({ x: 0, y: 0, w: TE.w, h: TE.h });
  g.fillStyle = 'rgba(8,10,14,0.66)';                 // the shield: what the crop cuts away
  g.fillRect(t.x, t.y, t.w, s.y - t.y);
  g.fillRect(t.x, s.y + s.h, t.w, t.y + t.h - s.y - s.h);
  g.fillRect(t.x, s.y, s.x - t.x, s.h);
  g.fillRect(s.x + s.w, s.y, t.x + t.w - s.x - s.w, s.h);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.beginPath();      // thirds
  for (const f of [1 / 3, 2 / 3]) {
    g.moveTo(Math.round(s.x + s.w * f) + 0.5, s.y); g.lineTo(Math.round(s.x + s.w * f) + 0.5, s.y + s.h);
    g.moveTo(s.x, Math.round(s.y + s.h * f) + 0.5); g.lineTo(s.x + s.w, Math.round(s.y + s.h * f) + 0.5);
  }
  g.stroke();
  g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, Math.round(devicePixelRatio));
  g.strokeRect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.w), Math.round(s.h));
  drawHandles(g, r);
}
// which handle of a rectangle is under the pointer: 'n', 'se'... 'move' inside, or null
function rectHandle(p, r) {
  const t = 7 * (view.width / view.getBoundingClientRect().width) / TE.zoom;
  if (p.x < r.x - t || p.x > r.x + r.w + t || p.y < r.y - t || p.y > r.y + r.h + t) return null;
  const v = Math.abs(p.y - r.y) <= t ? 'n' : Math.abs(p.y - r.y - r.h) <= t ? 's' : '';
  const h = Math.abs(p.x - r.x) <= t ? 'w' : Math.abs(p.x - r.x - r.w) <= t ? 'e' : '';
  if (v || h) return v + h;
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h ? 'move' : null;
}
const HANDLE_CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', move: 'move' };
// the largest power of two that is near n and fits in max (the game's sides: editor/textures.py)
function fitPow2(n, max) { let p = pow2(n); while (p > max && p > 1) p /= 2; return Math.max(1, Math.min(p, max)); }
function snapRect(r, handle = 'move') {
  const w = fitPow2(r.w, TE.w), h = fitPow2(r.h, TE.h);
  let x = handle.includes('w') ? r.x + r.w - w : handle.includes('e') ? r.x : Math.round(r.x + (r.w - w) / 2);
  let y = handle.includes('n') ? r.y + r.h - h : handle.includes('s') ? r.y : Math.round(r.y + (r.h - h) / 2);
  x = Math.max(0, Math.min(TE.w - w, x)); y = Math.max(0, Math.min(TE.h - h, y));
  return { x, y, w, h };
}
// a rectangle dragged by one of its handles (or moved, or drawn again from p0)
function dragRect(d, p) {
  const s = d.start, cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let r;
  if (d.handle === 'move') {
    r = { x: cl(s.x + Math.round(p.x - d.p0.x), 0, TE.w - s.w), y: cl(s.y + Math.round(p.y - d.p0.y), 0, TE.h - s.h), w: s.w, h: s.h };
  } else if (d.handle === 'new') {
    const x1 = cl(Math.round(Math.min(d.p0.x, p.x)), 0, TE.w), y1 = cl(Math.round(Math.min(d.p0.y, p.y)), 0, TE.h);
    const x2 = cl(Math.round(Math.max(d.p0.x, p.x)), 0, TE.w), y2 = cl(Math.round(Math.max(d.p0.y, p.y)), 0, TE.h);
    r = { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
  } else {
    let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
    if (d.handle.includes('w')) x1 = cl(Math.round(p.x), 0, x2 - 1);
    if (d.handle.includes('e')) x2 = cl(Math.round(p.x), x1 + 1, TE.w);
    if (d.handle.includes('n')) y1 = cl(Math.round(p.y), 0, y2 - 1);
    if (d.handle.includes('s')) y2 = cl(Math.round(p.y), y1 + 1, TE.h);
    r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  return d.crop && TE.cropping.snap && d.handle !== 'move' ? snapRect(r, d.handle === 'new' ? 'se' : d.handle) : r;
}
const gameSize = (w, h) => (pow2(w) !== w || pow2(h) !== h ? `${pow2(w)} × ${pow2(h)}` : 'the same');
// the line under the tool options while cropping: its size, its size in the game, what it does to the object
function cropInfo() {
  const r = TE.cropping;
  const game = pow2(r.w) !== r.w || pow2(r.h) !== r.h
    ? ` → in the game <b>${pow2(r.w)} × ${pow2(r.h)}</b> (stretched to a power of two)` : ' · fits the game as it is';
  return `<b>${r.w} × ${r.h}</b><span class="hint">${game}</span>`;
}
function cropWarning() {
  if (TE.ctx && TE.ctx.kind === 'actor' && TE.ctx.preview3d)
    return 'This texture is the skin of a 3D model: cropped, the piece is stretched over the whole model. To paint a part closely, use Focus (F) instead.';
  if (TE.ctx && TE.ctx.kind === 'structure')
    return 'On walls and floors the cropped piece fills the same tile as the whole texture did: it looks bigger.';
  return '';
}
function refreshRectInfo() {
  const c = $('#te-cropinfo'); if (c && TE.cropping) c.innerHTML = cropInfo();
  const s = $('#te-selsize'); if (s) s.textContent = TE.sel ? `${TE.sel.w} × ${TE.sel.h}` : 'drag a rectangle';
}
const toImg = (e) => {
  const r = view.getBoundingClientRect(), k = view.width / r.width;
  return { x: ((e.clientX - r.left) * k - TE.ox) / TE.zoom, y: ((e.clientY - r.top) * k - TE.oy) / TE.zoom };
};
function onWheel(e) {
  e.preventDefault();
  const r = view.getBoundingClientRect(), k = view.width / r.width, mx = (e.clientX - r.left) * k, my = (e.clientY - r.top) * k;
  const f = e.deltaY < 0 ? 1.25 : 0.8, z0 = TE.zoom;
  let z = z0 * f;
  if (z > 1) z = Math.round(z); else z = Math.max(0.05, z);
  if (z === z0) z = z0 + (e.deltaY < 0 ? 1 : -1) * (z0 >= 1 ? 1 : 0.05);
  z = Math.max(0.05, Math.min(64, z));
  TE.ox = mx - (mx - TE.ox) * z / z0; TE.oy = my - (my - TE.oy) * z / z0;
  TE.zoom = z;
  draw();
}

// ---------------------------------------------------------------- history
function snapshot() {
  // Evict before copying pixels. Large documents keep one full undo state;
  // both history stacks share the same budget instead of each retaining it.
  const bytes = TE.layers.byteLength, budget = Math.max(64 * 1024 * 1024, bytes);
  const used = () => [...TE.undo, ...TE.redo].reduce((n, s) => n + s.layers.byteLength, 0);
  while (used() + bytes > budget && (TE.undo.length || TE.redo.length)) {
    if (TE.undo.length) TE.undo.shift(); else TE.redo.shift();
  }
  return { layers: TE.layers.snapshot(), sel: TE.sel && { ...TE.sel }, base: TE.base };
}
function remember(list, state) {
  list.push(state);
  while (list.length > 1 && (list.length > 30 || list.reduce((n, s) => n + s.layers.byteLength, 0) > 64 * 1024 * 1024)) list.shift();
}
function pushUndo() {
  remember(TE.undo, snapshot());
  TE.redo = [];
}
function restore(s) {
  TE.cropping = null; TE.rectDrag = null; TE.float = null; TE.floatDrag = null;
  TE.layers.restore(s.layers); TE.base = s.base; TE.sel = s.sel; syncLayer();
  if (TE.focus && (TE.focus.x + TE.focus.w > TE.w || TE.focus.y + TE.focus.h > TE.h)) TE.focus = null;
  resizeViews(); renderRight(); renderOpts();
}
function undo() { if (TE.loading || TE.saving) return; endStroke(); commitAdjust(); if (!TE.undo.length) return; const target = TE.undo.pop(); remember(TE.redo, snapshot()); restore(target); changed(); }
function redo() { if (TE.loading || TE.saving) return; endStroke(); commitAdjust(); if (!TE.redo.length) return; const target = TE.redo.pop(); remember(TE.undo, snapshot()); restore(target); changed(); }
let quantTimer = 0;
function changed(dirty = true) {            // after every change: the view, the previews, the game colours
  if (dirty) TE.dirty = true;
  TE.quant = null;
  TE.needsComposite = true;
  draw();
  layerPanel?.refresh();
  clearTimeout(quantTimer);
  if (TE.gamePreview) quantTimer = setTimeout(() => { TE.quant = quantize(TE.doc); draw(); }, 250);
  const info = $('#te-size');
  if (info) info.textContent = `${TE.w} x ${TE.h}` + (pow2(TE.w) !== TE.w || pow2(TE.h) !== TE.h ? ` (the game: ${pow2(TE.w)} x ${pow2(TE.h)})` : '');
}

// ---------------------------------------------------------------- tools
function setTool(t) {
  endStroke(); commitAdjust();
  if (TE.draft && t !== 'text') applyText();
  if (TE.cropping && t !== TE.tool) { TE.cropping = null; TE.rectDrag = null; }
  if (TE.float) placeFloat();
  TE.tool = t;
  if (t === 'lighten' || t === 'darken') TE.dodge = t;
  if (t === 'select' && TE.mode === '3d') setViewMode('2d');
  if (t === 'text' && TE.mode === '3d') setViewMode('2d');
  if (view) view.style.cursor = toolCursor();
  if (t === 'text' && !TE.draft) status('Click the texture where the text goes and type. Ctrl+Enter or a click elsewhere paints it, Esc drops it.');
  for (const b of document.querySelectorAll('#te-tools [data-tool]')) {
    b.classList.toggle('on', b.dataset.tool === t);
    b.setAttribute('aria-pressed', String(b.dataset.tool === t));
  }
  renderOpts();
  draw();
}
function renderOpts() {
  const el = $('#te-opts');
  if (!el) return;
  const t = TE.tool, brushLike = ['brush', 'eraser', 'clone', 'soften', 'lighten', 'darken'].includes(t);
  const tool = TOOLS.find((x) => x[0] === t) || [];
  if (TE.float) {
    const f = TE.float;
    el.innerHTML = `<b>${f.lifted ? 'Free transform' : 'Pasted piece'}</b><span class="hint" id="te-floatinfo">${esc(floatInfo())}</span>
      <button id="te-fflipx" title="Flip horizontally">Flip ↔</button><button id="te-fflipy" title="Flip vertically">Flip ↕</button>
      <button id="te-frot" title="Turn 90° clockwise">Turn 90°</button><button id="te-freset" title="Back to its own size and angle">Reset</button>
      <span style="flex:1"></span>
      <button id="te-floatok" class="primary" title="Paint it on the active layer (Enter)">Put down</button><button id="te-floatno" title="${f.lifted ? 'Put it back as it was (Esc)' : 'Drop it (Esc)'}">Cancel</button>`;
    $('#te-fflipx').onclick = () => flipFloat('x');
    $('#te-fflipy').onclick = () => flipFloat('y');
    $('#te-frot').onclick = () => turnFloat(1);
    $('#te-freset').onclick = () => resetFloat();
    $('#te-floatok').onclick = () => placeFloat();
    $('#te-floatno').onclick = () => dropFloat();
    return;
  }
  if (TE.cropping) {
    const warn = cropWarning();
    el.innerHTML = `<b title="Drag the handles or the inside; drag outside for a new rectangle">Crop</b><span id="te-cropinfo">${cropInfo()}</span>
      <label title="Sides of 8, 16, 32... 1024 pixels: the game uses those, so the texture is not stretched"><input type="checkbox" id="te-cropsnap" ${TE.cropping.snap ? 'checked' : ''}> Snap to power of two</label>
      <span style="flex:1"></span>
      <button id="te-cropok" class="primary" title="Crop the texture (Enter)">Crop</button><button id="te-cropno" title="Leave the texture as it is (Esc)">Cancel</button>
      ${warn ? `<span class="hint warn te-cropwarn">${esc(warn)}</span>` : ''}`;
    $('#te-cropsnap').onchange = (e) => { TE.cropping.snap = e.target.checked; if (TE.cropping.snap) Object.assign(TE.cropping, snapRect(TE.cropping)); refreshRectInfo(); draw(); };
    $('#te-cropok').onclick = () => applyCrop();
    $('#te-cropno').onclick = () => cancelCrop();
    return;
  }
  let h = `<b title="${esc(tool[3] || '')}">${esc(tool[2] || '')}</b>`;
  if (brushLike) h += `<label>Size <input type="range" id="te-size-r" min="1" max="256" value="${TE.size}"><span id="te-size-v">${TE.size}</span></label>
      <label>Hardness <input type="range" id="te-hard" min="0" max="100" value="${Math.round(TE.hard * 100)}"></label>
      <label>${t === 'lighten' || t === 'darken' || t === 'soften' ? 'Strength' : 'Opacity'} <input type="range" id="te-op" min="1" max="100" value="${Math.round(TE.opacity * 100)}"></label>`;
  if (t === 'fill') h += `<label>Tolerance <input type="range" id="te-tol" min="0" max="255" value="${TE.tol}"><span id="te-tol-v">${TE.tol}</span></label>
      <label><input type="checkbox" id="te-cont" ${TE.contiguous ? 'checked' : ''}> only the touching area</label>
      <label>Opacity <input type="range" id="te-op" min="1" max="100" value="${Math.round(TE.opacity * 100)}"></label>`;
  if (t === 'text') {
    const x = TE.text;
    h += `<select id="te-fface" title="Font">${fontOptions(x.font)}</select>
      <button id="te-fimp" title="Import a font file of yours (.ttf, .otf, .woff)">Font…</button><input type="file" id="te-ffile" accept=".ttf,.otf,.woff,.woff2" hidden>
      <label>Size <input type="number" id="te-font" min="4" max="400" value="${TE.font}" style="width:56px"></label>
      <button id="te-fbold" class="te-tg ${x.bold ? 'on' : ''}" title="Bold"><b>B</b></button><button id="te-fital" class="te-tg ${x.italic ? 'on' : ''}" title="Italic"><i>I</i></button>
      <select id="te-falign" title="Alignment">${['left', 'center', 'right'].map((a) => `<option value="${a}" ${a === x.align ? 'selected' : ''}>${a[0].toUpperCase() + a.slice(1)}</option>`).join('')}</select>
      <label title="Outline: colour and thickness">Outline <input type="color" id="te-foutc" value="${x.outline}"><input type="range" id="te-foutw" min="0" max="20" value="${x.outlineWidth}" style="width:60px"></label>
      <label><input type="checkbox" id="te-fshadow" ${x.shadow ? 'checked' : ''}>Shadow</label><label><input type="checkbox" id="te-fglow" ${x.glow ? 'checked' : ''}>Glow</label>
      <label>Opacity <input type="range" id="te-op" min="1" max="100" value="${Math.round(TE.opacity * 100)}" style="width:60px"></label>
      <button id="te-tapply" class="primary" ${TE.draft ? '' : 'disabled'} title="Paint the text on the layer (Ctrl+Enter)">Apply</button>
      <button id="te-tdrop" ${TE.draft ? '' : 'disabled'} title="Drop this text (Esc)">Cancel</button>`;
  }
  if (t === 'clone') h += `<span class="hint">${TE.cloneSrc ? 'source set: paint' : 'Alt+click where to copy from'}</span>`;
  if (t === 'select') h += `<span class="hint" id="te-selsize">${TE.sel ? `${TE.sel.w} × ${TE.sel.h}` : 'drag a rectangle'}</span>
      <button id="te-selall">All</button><button id="te-selnone">None</button>
      <button id="te-focus" ${TE.sel || TE.focus ? '' : 'disabled'} aria-pressed="${!!TE.focus}" title="${TE.focus ? 'Back to the whole texture (F or 0)' : 'Zoom the view on the selection to paint it closely: nothing is cut (F)'}">${TE.focus ? 'Whole texture' : 'Focus'}</button>
      <button id="te-crop" ${TE.sel ? '' : 'disabled'} title="Cut the texture down to the selection: a preview first (Enter crops, Esc leaves it)">Crop…</button>
      <button id="te-clear" ${TE.sel ? '' : 'disabled'} title="Delete: see-through">Clear</button>`;
  if (t === 'picker') h += '<span class="hint">click a pixel: its colour becomes the brush colour</span>';
  if (brushLike) h += `<label><input id="te-pixel" type="checkbox" ${TE.pixelBrush ? 'checked' : ''}>Pixel</label>`;
  if (brushLike || t === 'fill' || t === 'text') h += `<label title="Keep the active layer's transparency"><input id="te-alpha" type="checkbox" ${TE.alphaLock ? 'checked' : ''}>Lock alpha</label>`;
  el.innerHTML = h;
  if ($('#te-pixel')) $('#te-pixel').onchange = e => { TE.pixelBrush = e.target.checked; };
  if ($('#te-alpha')) $('#te-alpha').onchange = e => { TE.alphaLock = e.target.checked; };
  const bind = (id, fn) => { const x = $('#' + id); if (x) x.oninput = fn; };
  bind('te-size-r', () => { TE.size = +$('#te-size-r').value; $('#te-size-v').textContent = TE.size; });
  bind('te-hard', () => { TE.hard = +$('#te-hard').value / 100; });
  bind('te-op', () => { TE.opacity = +$('#te-op').value / 100; draw(); });      // the text's preview follows it
  bind('te-tol', () => { TE.tol = +$('#te-tol').value; $('#te-tol-v').textContent = TE.tol; });
  const c = $('#te-cont'); if (c) c.onchange = () => { TE.contiguous = c.checked; };
  const f = $('#te-font'); if (f) f.oninput = () => { TE.font = Math.max(4, +f.value || 24); draw(); };
  if (t === 'text') bindTextOptions();
  const sa = $('#te-selall'); if (sa) sa.onclick = () => { TE.sel = { x: 0, y: 0, w: TE.w, h: TE.h }; renderOpts(); draw(); };
  const sn = $('#te-selnone'); if (sn) sn.onclick = () => { TE.sel = null; renderOpts(); draw(); };
  const cr = $('#te-crop'); if (cr) cr.onclick = () => beginCrop();
  const fo = $('#te-focus'); if (fo) fo.onclick = () => setFocus(!TE.focus);
  const cl = $('#te-clear'); if (cl) cl.onclick = () => clearSel();
}
function addRecent(c) {
  TE.recent = [c].concat(TE.recent.filter((x) => x !== c)).slice(0, 12);
  const el = $('#te-recent');
  if (el) {
    el.innerHTML = TE.recent.map((x) => `<span class="te-chip" style="background:${x}" data-c="${x}" title="${x} · click: the colour · right-click: the background colour"></span>`).join('');
    for (const s of el.querySelectorAll('[data-c]')) {
      s.onclick = () => setColor(s.dataset.c);
      s.oncontextmenu = (e) => { e.preventDefault(); TE.bg = s.dataset.c; $('#te-bgcolor').value = TE.bg; status(`Background colour ${TE.bg}`); };
    }
  }
  markRecent();
}
function setColor(c) { TE.color = c; $('#te-color').value = c; markRecent(); draw(); }
function markRecent() { for (const s of document.querySelectorAll('#te-recent [data-c]')) s.classList.toggle('on', s.dataset.c.toLowerCase() === TE.color.toLowerCase()); }
function swapColors() {
  [TE.color, TE.bg] = [TE.bg, TE.color];
  $('#te-color').value = TE.color; $('#te-bgcolor').value = TE.bg;
  markRecent(); draw(); status(`Colour ${TE.color}, background ${TE.bg}`);
}
const TE_CSS = `
#texedit .te-material { display:flex; flex-direction:column; gap:4px; padding-bottom:8px; }
#texedit .te-material > span { font-size:13px; line-height:18px; font-weight:600; color:var(--heading); }
body #texedit .te-material select { width:100%; min-width:0; height:22px; padding:0 6px; line-height:20px; background:var(--field); color:var(--text); border:1px solid var(--line); border-radius:var(--radius-control); }
body #texedit .te-model-hint { font-size:11px; padding:4px 6px; color:var(--text); background:var(--panel); }
#texedit .te-colors { position:relative; flex:none; width:40px; height:40px; margin-top:4px; }
#texedit .te-colors input[type=color] { position:absolute; width:26px; height:26px; min-height:26px; padding:1px; border:1px solid var(--line);
  border-radius:var(--radius-control); background:var(--field); cursor:pointer; }
#texedit #te-color { left:0; top:0; z-index:2; box-shadow:0 0 0 2px var(--panel); }
#texedit #te-bgcolor { right:0; bottom:0; z-index:1; }
#texedit #te-swapc { position:absolute; right:-3px; top:-3px; width:16px; height:16px; min-height:16px; padding:0; border:0; background:transparent;
  color:var(--dim); font-size:11px; line-height:16px; }
#texedit #te-swapc:hover { color:var(--text); }
#texedit .te-chip.on { outline:2px solid var(--acc); outline-offset:1px; }
#texedit .te-ctx { position:fixed; z-index:40; min-width:220px; padding:4px 0; background:var(--panel); border:1px solid var(--line);
  border-radius:var(--radius-control); box-shadow:0 14px 30px #0009; font-size:12px; color:var(--text); }
#texedit .te-ctx div[data-i] { height:22px; line-height:22px; padding:0 10px; display:flex; gap:16px; cursor:pointer; white-space:nowrap; }
#texedit .te-ctx div[data-i]:hover { background:var(--hover); }
#texedit .te-ctx div[data-i].off { color:var(--dim); opacity:.5; pointer-events:none; }
#texedit .te-ctx div[data-i] span { flex:1; }
#texedit .te-ctx div[data-i] small { color:var(--dim); font-size:11px; }
#texedit .te-ctx hr { border:0; border-top:1px solid var(--line); margin:4px 0; }
#texedit .te-intext { position:absolute; z-index:3; margin:0; padding:0; border:0; outline:none; resize:none; overflow:hidden;
  background:transparent; color:transparent; caret-color:var(--acc); white-space:pre; min-width:2px; box-sizing:content-box; }
#texedit .te-intext::selection { background:var(--accent-soft); color:transparent; }
#texedit .te-keys { position:fixed; z-index:45; left:50%; top:50%; transform:translate(-50%, -50%); width:min(560px, calc(100% - 32px)); max-height:calc(100% - 48px);
  overflow:auto; box-sizing:border-box; padding:8px 12px 12px; background:var(--panel); border:1px solid var(--line);
  border-radius:var(--radius-window); box-shadow:0 14px 30px #0009; color:var(--text); font-size:12px; }
#texedit .te-keys-title { font-size:13px; font-weight:600; line-height:18px; color:var(--heading); margin:2px 0 4px; }
#texedit .te-keys-h { font-size:12px; font-weight:600; color:var(--heading); margin:8px 0 2px; }
#texedit .te-keys-row { display:flex; gap:12px; align-items:center; min-height:22px; border-bottom:1px solid var(--line); }
#texedit .te-keys-row b { flex:none; width:210px; font-weight:400; color:var(--heading); }
#texedit .te-keys-row span { flex:1; color:var(--dim); }
#texedit .te-keys-foot { display:flex; justify-content:flex-end; margin-top:8px; }
`;
function selRect() { return TE.sel || { x: 0, y: 0, w: TE.w, h: TE.h }; }
function clipSel(g) { if (TE.sel) { g.beginPath(); g.rect(TE.sel.x, TE.sel.y, TE.sel.w, TE.sel.h); g.clip(); } }
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

// the brush: a round stamp, soft by its hardness
let stampCache = {};
function stamp(size, hard) {
  const key = size + '|' + hard + '|' + TE.pixelBrush;
  if (stampCache[key]) return stampCache[key];
  const d = Math.max(1, Math.ceil(size)), c = document.createElement('canvas');
  c.width = c.height = d;
  const g = c.getContext('2d');
  if (d <= 2 || TE.pixelBrush) { g.fillStyle = '#fff'; g.fillRect(0, 0, d, d); }
  else {
    const gr = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(Math.min(0.99, Math.max(0, hard)), 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(d / 2, d / 2, d / 2, 0, 7); g.fill();
  }
  if (Object.keys(stampCache).length > 64) stampCache = {};
  return (stampCache[key] = c);
}
// a stroke: the mask of the brush along the path (stroke canvas), drawn over the picture as it was
// when the stroke began, through the tool's source (a colour, the picture moved, blurred, lighter...)
function beginStroke(p, path = null, from = null) {
  compose();
  pushUndo();
  const S = TE.stroke = { last: from || p, path, base: document.createElement('canvas'), mask: document.createElement('canvas'), src: null };
  S.base.width = S.mask.width = TE.w; S.base.height = S.mask.height = TE.h;
  S.base.getContext('2d').drawImage(TE.layers.active.canvas, 0, 0);
  const t = TE.tool;
  if (t !== 'brush' && t !== 'eraser') {
    S.src = document.createElement('canvas'); S.src.width = TE.w; S.src.height = TE.h;
    const g = S.src.getContext('2d');
    if (t === 'clone') { if (!TE.cloneOff) TE.cloneOff = { x: TE.cloneSrc.x - p.x, y: TE.cloneSrc.y - p.y }; compose(); g.drawImage(TE.doc, -TE.cloneOff.x, -TE.cloneOff.y); }
    else {
      g.filter = t === 'soften' ? `blur(${Math.max(1, TE.size / 10)}px)` : t === 'lighten' ? 'brightness(1.35)' : 'brightness(0.65)';
      if (t === 'soften') { // wrap around: blur a 3x3 tiling so the edges blend with the other side
        const big = document.createElement('canvas'); big.width = TE.w * 3; big.height = TE.h * 3;
        const bg = big.getContext('2d'); bg.filter = g.filter;
        const tile = document.createElement('canvas'); tile.width = TE.w * 3; tile.height = TE.h * 3;
        const tg = tile.getContext('2d');
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tg.drawImage(TE.doc, i * TE.w, j * TE.h);
        bg.drawImage(tile, 0, 0);
        g.filter = 'none';
        g.drawImage(big, TE.w, TE.h, TE.w, TE.h, 0, 0, TE.w, TE.h);
      } else g.drawImage(TE.doc, 0, 0);
    }
  }
  dab(p);
  render();
}
function dab(p) {
  const S = TE.stroke, g = S.mask.getContext('2d'), st = stamp(TE.size, TE.hard);
  g.save(); if (S.path) g.clip(S.path);
  const a = S.last, dx = p.x - a.x, dy = p.y - a.y, dist = Math.hypot(dx, dy), step = Math.max(0.5, TE.size * 0.15);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = S.started ? 1 : 0; i <= n; i++) {
    const x = a.x + dx * i / n, y = a.y + dy * i / n, r = st.width / 2;
    if (TE.size <= 2) g.drawImage(st, Math.floor(x), Math.floor(y));
    else g.drawImage(st, TE.pixelBrush ? Math.floor(x-r) : x-r, TE.pixelBrush ? Math.floor(y-r) : y-r);
  }
  g.restore();
  S.started = true;
  S.last = p;
}
function render() {                         // the stroke so far over the picture as it was
  const S = TE.stroke, g = TE.dc;
  g.save();
  g.globalCompositeOperation = 'copy';
  g.drawImage(S.base, 0, 0);
  g.restore();
  g.save();
  clipSel(g);
  const tmp = TE.tmp || (TE.tmp = document.createElement('canvas'));
  tmp.width = TE.w; tmp.height = TE.h;
  const tg = tmp.getContext('2d');
  if (TE.tool === 'eraser') {
    g.globalAlpha = TE.opacity; g.globalCompositeOperation = 'destination-out'; g.drawImage(S.mask, 0, 0);
  } else {
    if (S.src) tg.drawImage(S.src, 0, 0); else { tg.fillStyle = TE.color; tg.fillRect(0, 0, TE.w, TE.h); }
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(S.mask, 0, 0);
    g.globalAlpha = TE.opacity;
    // Retouch tools sample the visible result, so a new layer can hold only the
    // retouch while the original pixels remain untouched underneath.
    g.globalCompositeOperation = TE.alphaLock ? 'source-atop' : 'source-over';
    g.drawImage(tmp, 0, 0);
  }
  g.restore();
  TE.needsComposite = true; TE.quant = null;
  draw();
}
function endStroke() {
  if (!TE.stroke) return;
  render();
  if (!TE.stroke.path) TE.lastDab = TE.stroke.last;
  TE.stroke = null;
  if (TE.tool === 'brush') addRecent(TE.color);
  changed();
}
function pick(p) {
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= TE.w || y >= TE.h) return;
  compose();
  const d = TE.doc.getContext('2d').getImageData(x, y, 1, 1).data;
  setColor('#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''));
  addRecent(TE.color);
  status(`colour ${TE.color}${d[3] < 128 ? ' (a see-through pixel)' : ''}`);
}
function fill(p, path = null) {
  const x0 = Math.floor(p.x), y0 = Math.floor(p.y);
  if (x0 < 0 || y0 < 0 || x0 >= TE.w || y0 >= TE.h) return;
  pushUndo();
  const W = TE.w, H = TE.h, img = TE.dc.getImageData(0, 0, W, H), d = img.data, s = selRect();
  const i0 = (y0 * W + x0) * 4, ref = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]], tol = TE.tol;
  const near = (i) => Math.abs(d[i] - ref[0]) <= tol && Math.abs(d[i + 1] - ref[1]) <= tol && Math.abs(d[i + 2] - ref[2]) <= tol && Math.abs(d[i + 3] - ref[3]) <= tol;
  const inSel = (x, y) => x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h;
  const mark = new Uint8Array(W * H);
  if (TE.contiguous) {
    const stack = [x0, y0];
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      if (x < 0 || y < 0 || x >= W || y >= H || mark[y * W + x] || !inSel(x, y) || !near((y * W + x) * 4)) continue;
      mark[y * W + x] = 1;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
  } else for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inSel(x, y) && near((y * W + x) * 4)) mark[y * W + x] = 1;
  const [r, g, b] = hex(TE.color), a = TE.opacity;
  for (let k = 0; k < W * H; k++) {
    if (!mark[k]) continue;
    const i = k * 4;
    if (TE.alphaLock) {
      d[i] += (r - d[i]) * a; d[i + 1] += (g - d[i + 1]) * a; d[i + 2] += (b - d[i + 2]) * a;
    } else {
      const before = d[i + 3] / 255, after = a + before * (1-a);
      for (const [channel, value] of [[0,r],[1,g],[2,b]]) d[i+channel] = after ? (value*a + d[i+channel]*before*(1-a))/after : 0;
      d[i + 3] = after * 255;
    }
  }
  if (path) {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; canvas.getContext('2d').putImageData(img, 0, 0);
    TE.dc.save(); TE.dc.clip(path); TE.dc.clearRect(0, 0, W, H); TE.dc.drawImage(canvas, 0, 0); TE.dc.restore();
  } else TE.dc.putImageData(img, 0, 0);
  addRecent(TE.color);
  changed();
}
// The Text tool: a click places the text (or grabs it to move it), the options bar edits it, and it is drawn
// over the texture until Apply paints it on the active layer (text-style.js draws it, as on the signs).
function textOptions() {
  return { ...TE.text, size: TE.font, color: TE.color, valign: 'top', lineHeight: 1.15 };
}
function textBox() {                       // where the draft text is, on the texture (for grabbing it)
  if (!TE.draft) return null;
  const g = document.createElement('canvas').getContext('2d');
  const m = drawText(g, { ...textOptions(), color: 'rgba(0,0,0,0)' }, { x: 0, y: 0, w: 0, h: 0 });
  const left = TE.text.align === 'center' ? TE.draft.x - m.width / 2 : TE.text.align === 'right' ? TE.draft.x - m.width : TE.draft.x;
  return { x: left, y: TE.draft.y, w: m.width, h: m.height };
}
function text(p, path = null) {
  if (path) { setViewMode('2d'); return; }
  const b = textBox();
  if (b && p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4) {
    TE.draftDrag = { dx: p.x - TE.draft.x, dy: p.y - TE.draft.y };
    return;
  }
  if (TE.draft && TE.text.text.trim()) applyText();           // a click elsewhere: this text painted, a new one there
  TE.text.text = '';
  TE.draft = { x: Math.round(p.x), y: Math.round(p.y - TE.font * 1.15 / 2) };   // its first line on the click
  TE.draftDrag = { dx: p.x - TE.draft.x, dy: p.y - TE.draft.y };
  renderOpts();
  draw();
  focusInline();
}
// The text is typed where it goes: a see-through text field over the texture, in the text's font and size at the
// view's zoom, shows the caret and the selection; the canvas draws the letters as they will be painted.
function bindInlineText() {
  const area = $('#te-intext');
  area.oninput = () => { TE.text.text = area.value; draw(); };
  // its edge and handles (or Ctrl anywhere) move and size the text, as on the canvas; the right button pans
  area.addEventListener('pointerdown', (e) => {
    const b = textBox(), h = b && rectHandle(toImg(e), textFrame(b));
    if (e.button !== 0 || e.ctrlKey || (h && h !== 'move')) { e.preventDefault(); onDown(e); }
  });
  area.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const b = textBox(), h = b && rectHandle(toImg(e), textFrame(b));
    area.style.cursor = e.ctrlKey ? 'move' : h && h !== 'move' ? HANDLE_CURSOR[h] : 'text';
  });
  area.addEventListener('wheel', onWheel, { passive: false });
  area.addEventListener('contextmenu', (e) => e.preventDefault());
}
function placeInline() {
  const area = $('#te-intext');
  if (!area) return;
  const on = !!(TE.open && TE.draft && TE.tool === 'text' && TE.mode === '2d');
  if (area.hidden === on) area.hidden = !on;
  if (!on) return;
  const x = TE.text, b = textBox(), r = view.getBoundingClientRect(), host = view.parentElement.getBoundingClientRect();
  const k = view.width / r.width, z = TE.zoom / k, size = TE.font * z, lh = size * 1.15;
  const w = b.w * z + size, anchor = (TE.ox + TE.draft.x * TE.zoom) / k;           // room for the next letter
  const left = x.align === 'center' ? anchor - w / 2 : x.align === 'right' ? anchor - w : anchor;
  Object.assign(area.style, {
    left: `${r.left - host.left + left}px`, top: `${r.top - host.top + (TE.oy + TE.draft.y * TE.zoom) / k}px`,
    width: `${w}px`, height: `${Math.max(1, x.text.split('\n').length) * lh}px`, fontSize: `${size}px`, lineHeight: `${lh}px`,
    textAlign: x.align, fontFamily: `"${x.font || 'Bahnschrift'}", Bahnschrift, Arial, sans-serif`,
    fontWeight: x.bold ? 'bold' : 'normal', fontStyle: x.italic ? 'italic' : 'normal' });
  if (area.value !== x.text) area.value = x.text;
}
function focusInline() {                   // now (after the click: on its pointerup) and on the next frame
  const go = () => {
    placeInline();
    const area = $('#te-intext');
    if (!area || area.hidden || document.activeElement === area) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
  };
  go(); requestAnimationFrame(go);
}
function applyText() {
  if (!TE.draft || !TE.text.text.trim()) { dropText(); return; }
  if (!editable()) return;
  pushUndo();
  const g = TE.dc;
  g.save(); clipSel(g);
  if (TE.alphaLock) g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = TE.opacity;
  drawText(g, textOptions(), { x: TE.draft.x, y: TE.draft.y, w: 0, h: 0 });
  g.restore();
  addRecent(TE.color);
  TE.draft = null; TE.draftDrag = null;
  renderOpts();
  changed();
  status('Text painted. Click again for another one.');
}
function dropText() { TE.draft = null; TE.draftDrag = null; renderOpts(); draw(); }
function bindTextOptions() {
  const x = TE.text;
  const set = (k, v) => { x[k] = v; draw(); };
  $('#te-fface').onchange = (e) => set('font', e.target.value);
  $('#te-falign').onchange = (e) => set('align', e.target.value);
  $('#te-foutc').oninput = (e) => set('outline', e.target.value);
  $('#te-foutw').oninput = (e) => set('outlineWidth', +e.target.value);
  $('#te-fshadow').onchange = (e) => set('shadow', e.target.checked);
  $('#te-fglow').onchange = (e) => set('glow', e.target.checked);
  for (const [id, k] of [['#te-fbold', 'bold'], ['#te-fital', 'italic']]) $(id).onclick = (e) => { x[k] = !x[k]; e.currentTarget.classList.toggle('on', x[k]); draw(); focusInline(); };
  $('#te-tapply').onclick = () => applyText();
  $('#te-tdrop').onclick = () => dropText();
  $('#te-fimp').onclick = () => $('#te-ffile').click();
  $('#te-ffile').onchange = async () => {
    const file = $('#te-ffile').files[0];
    $('#te-ffile').value = '';
    if (!file) return;
    try { x.font = await importFont(file); renderOpts(); draw(); status(`Font "${x.font}" added.`); } catch (err) { status(err.message, 'warn'); }
  };
  fontFamilies().then(() => { const s = $('#te-fface'); if (s && TE.tool === 'text') s.innerHTML = fontOptions(x.font); });
}
// ---------------------------------------------------------------- copy and paste
function copySel(cut = false) {
  if (!TE.doc || TE.loading || TE.saving) return;
  commitAdjust(); placeFloat();
  compose(true);
  const r = selRect(), c = document.createElement('canvas');
  c.width = r.w; c.height = r.h;
  c.getContext('2d').drawImage(TE.doc, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  TE.clip = { canvas: c, x: r.x, y: r.y };
  // the system clipboard too, for other programs (PNG; not everywhere allowed: the copy here is enough)
  try { c.toBlob((blob) => { if (blob && window.ClipboardItem) navigator.clipboard?.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {}); }); } catch (e) { /* no clipboard */ }
  if (cut) {
    if (!editable() || TE.alphaLock) { status(`Copied ${r.w} × ${r.h}; the active layer was not cut (locked or Lock alpha).`, 'warn'); return; }
    pushUndo(); TE.dc.clearRect(r.x, r.y, r.w, r.h); changed();
  }
  status(`${cut ? 'Cut' : 'Copied'} ${r.w} × ${r.h}. Select where it goes, then Ctrl+V.`, 'ok');
}
// place: {x, y, w, h} where the piece goes and its size there (its pixels kept, so it can grow back sharp)
function pasteFloat(canvas, from, place = null) {
  if (!TE.doc || TE.loading || TE.saving || !editable()) return;
  commitAdjust(); placeFloat();
  if (TE.cropping) cancelCrop();
  if (TE.mode !== '2d') setViewMode('2d');
  const w = place ? place.w : canvas.width, h = place ? place.h : canvas.height, cl = (v, max) => Math.max(0, Math.min(max, Math.max(0, v)));
  let x, y;
  if (place) { x = Math.round(place.x); y = Math.round(place.y); }
  else if (TE.sel && !(from && TE.sel.x === from.x && TE.sel.y === from.y)) { x = TE.sel.x; y = TE.sel.y; }  // the selection made elsewhere
  else if (from) { x = from.x; y = from.y; }                                                         // where it came from
  else { x = Math.round((TE.w - w) / 2); y = Math.round((TE.h - h) / 2); }
  TE.float = { canvas, x: cl(x, TE.w - w), y: cl(y, TE.h - h), w, h, angle: 0, flipX: false, flipY: false, lifted: false };
  renderOpts(); draw();
  status('Pasted: drag it into place (arrows: 1 pixel, Shift: 10), its handles scale it, just outside a corner turns it. Enter or a click outside puts it down, Esc drops it.');
}
// a picture of another program (a photo copied, a screenshot): a floating piece inside the texture, in the
// middle of the selection (or of the texture), made smaller to fit when it is bigger; its handles size it as
// Ctrl+T does. Open… is the way to make a picture the whole texture.
function pastePicture(c) {
  const box = TE.sel || { x: 0, y: 0, w: TE.w, h: TE.h }, k = Math.min(1, box.w / c.width, box.h / c.height);
  const w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
  pasteFloat(c, null, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h });
  if (TE.float) status(`Pasted the picture${k < 1 ? ` (${c.width} × ${c.height}) at ${w} × ${h}, to fit ${TE.sel ? 'the selection' : 'the texture'}` : ''}: drag it into place, its handles size it (Shift: in proportion), just outside a corner turns it. Enter puts it down, Esc drops it. Open… makes a picture the whole texture.`);
}
// Ctrl+T, as in Photoshop: the selection (or the whole layer) is lifted off the active layer as a floating
// piece: drag it, its handles scale it (Shift: in proportion), just outside a corner turns it (Shift: 15°
// steps). Enter or a click outside puts it down (one Ctrl+Z for all of it), Esc puts it back as it was.
function freeTransform() {
  if (TE.float) { status('Transforming: drag the handles, or just outside a corner to turn it. Enter keeps it, Esc cancels.'); return; }
  if (!TE.doc || TE.loading || TE.saving) return;
  if (TE.draft) { status('Apply the text first (Ctrl+Enter), then Ctrl+T.', 'warn'); return; }
  if (!editable()) return;
  commitAdjust();
  if (TE.cropping) cancelCrop();
  if (TE.mode !== '2d') setViewMode('2d');
  const r = TE.sel || { x: 0, y: 0, w: TE.w, h: TE.h };
  // nothing there on the active layer (a fresh "Paint layer" over the picture): the first visible layer below
  // with pixels there is the one transformed, as the eye expects
  const hasPixels = (cv) => { const d = cv.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; };
  let switched = '';
  if (!hasPixels(TE.dc.canvas)) {
    const list = TE.layers.layers, at = list.findIndex((l) => l.id === TE.layers.activeId);
    for (let i = at - 1; i >= 0; i--) {
      const l = list[i];
      if (l.visible && !l.locked && hasPixels(l.canvas)) { TE.layers.select(l.id); syncLayer(); layerPanel?.refresh(); switched = l.name; break; }
    }
  }
  pushUndo();
  const c = document.createElement('canvas');
  c.width = r.w; c.height = r.h;
  c.getContext('2d').drawImage(TE.dc.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  TE.dc.clearRect(r.x, r.y, r.w, r.h);
  TE.float = { canvas: c, x: r.x, y: r.y, w: r.w, h: r.h, angle: 0, flipX: false, flipY: false, lifted: true };
  renderOpts(); changed();
  status(`${switched ? `Layer "${switched}" (the active one is empty there). ` : ''}Free transform: drag to move, the handles scale (Shift: in proportion), just outside a corner turns (Shift: 15°). Enter keeps it, Esc cancels.`);
}
const floatCenter = (f) => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 });
const floatPlain = (f) => !f.angle && !f.flipX && !f.flipY && f.w === f.canvas.width && f.h === f.canvas.height;
// a point in the piece's own frame (before its turn about c)
function unturn(p, c, a) {
  const dx = p.x - c.x, dy = p.y - c.y, cs = Math.cos(-a), sn = Math.sin(-a);
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}
function floatHandle(f, p) {
  const q = unturn(p, floatCenter(f), f.angle);
  const h = rectHandle(q, f);
  if (h) return h;
  const t = 22 * (view.width / view.getBoundingClientRect().width) / TE.zoom;      // just outside a corner: turn it
  for (const [cx, cy] of [[f.x, f.y], [f.x + f.w, f.y], [f.x, f.y + f.h], [f.x + f.w, f.y + f.h]]) if (Math.hypot(q.x - cx, q.y - cy) < t) return 'rotate';
  return null;
}
function dragFloat(d, p, shift) {
  const f = TE.float, s = d.start, c0 = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  if (d.handle === 'move') { f.x = s.x + Math.round(p.x - d.p0.x); f.y = s.y + Math.round(p.y - d.p0.y); return; }
  if (d.handle === 'rotate') {
    let a = s.angle + Math.atan2(p.y - c0.y, p.x - c0.x) - Math.atan2(d.p0.y - c0.y, d.p0.x - c0.x);
    if (shift) a = Math.round(a / (Math.PI / 12)) * Math.PI / 12;
    f.angle = a;
    return;
  }
  const q = unturn(p, c0, s.angle), hd = d.handle;
  let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
  if (hd.includes('w')) x1 = Math.min(q.x, x2 - 1);
  if (hd.includes('e')) x2 = Math.max(q.x, x1 + 1);
  if (hd.includes('n')) y1 = Math.min(q.y, y2 - 1);
  if (hd.includes('s')) y2 = Math.max(q.y, y1 + 1);
  let w = x2 - x1, h = y2 - y1;
  if (shift && hd.length === 2) {                // a corner with Shift: in proportion
    const k = Math.max(w / s.w, h / s.h);
    w = s.w * k; h = s.h * k;
    if (hd.includes('w')) x1 = x2 - w; else x2 = x1 + w;
    if (hd.includes('n')) y1 = y2 - h; else y2 = y1 + h;
  }
  const lx = (x1 + x2) / 2 - c0.x, ly = (y1 + y2) / 2 - c0.y, cs = Math.cos(s.angle), sn = Math.sin(s.angle);
  const cx = c0.x + lx * cs - ly * sn, cy = c0.y + lx * sn + ly * cs;      // the new middle, turned back
  f.w = w; f.h = h; f.x = cx - w / 2; f.y = cy - h / 2;
}
function floatInfo() {
  const f = TE.float;
  if (!f) return '';
  const deg = Math.round(((f.angle * 180 / Math.PI) % 360 + 540) % 360 - 180);
  return `${Math.round(f.w)} × ${Math.round(f.h)}${deg ? ` · ${deg}°` : ''} · drag: move · handles: scale (Shift: in proportion) · outside a corner: turn`;
}
function flipFloat(axis) { const f = TE.float; if (!f) return; if (axis === 'x') f.flipX = !f.flipX; else f.flipY = !f.flipY; draw(); }
function turnFloat(dir) { const f = TE.float; if (!f) return; f.angle += dir * Math.PI / 2; refreshFloatInfo(); draw(); }
function resetFloat() {
  const f = TE.float;
  if (!f) return;
  const c = floatCenter(f);
  f.w = f.canvas.width; f.h = f.canvas.height; f.angle = 0; f.flipX = f.flipY = false;
  f.x = Math.round(c.x - f.w / 2); f.y = Math.round(c.y - f.h / 2);
  refreshFloatInfo(); draw();
}
function refreshFloatInfo() { const i = $('#te-floatinfo'); if (i) i.textContent = floatInfo(); }
function floatBounds(f) {
  const c = floatCenter(f), cs = Math.abs(Math.cos(f.angle)), sn = Math.abs(Math.sin(f.angle));
  const w = f.w * cs + f.h * sn, h = f.w * sn + f.h * cs;
  const x0 = Math.max(0, Math.floor(c.x - w / 2)), y0 = Math.max(0, Math.floor(c.y - h / 2));
  const x1 = Math.min(TE.w, Math.ceil(c.x + w / 2)), y1 = Math.min(TE.h, Math.ceil(c.y + h / 2));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
function placeFloat() {
  const f = TE.float;
  if (!f) return;
  TE.float = null; TE.floatDrag = null;
  if (!editable()) { renderOpts(); draw(); return; }
  if (!f.lifted) pushUndo();                    // a lifted piece: its undo state was kept when it was lifted
  const g = TE.dc, c = floatCenter(f);
  g.save();
  if (floatPlain(f)) g.drawImage(f.canvas, Math.round(f.x), Math.round(f.y));
  else {
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.translate(c.x, c.y); g.rotate(f.angle); g.scale(f.flipX ? -1 : 1, f.flipY ? -1 : 1);
    g.drawImage(f.canvas, -f.w / 2, -f.h / 2, f.w, f.h);
  }
  g.restore();
  TE.sel = floatBounds(f);
  renderOpts(); changed();
  status(f.lifted ? 'Transformed. Ctrl+Z puts it back as it was.' : `Put down at ${Math.round(f.x)}, ${Math.round(f.y)}. Ctrl+V pastes it again; Ctrl+Z takes it back.`, 'ok');
}
function dropFloat() {
  const f = TE.float;
  if (!f) return;
  TE.float = null; TE.floatDrag = null;
  if (f.lifted) {                               // Esc on a transform: the pixels back where they were
    undo(); TE.redo.pop();
    status('Transform cancelled: as it was.');
    return;
  }
  renderOpts(); draw(); status('Paste dropped.');
}
// flip or turn the selection's pixels: lifted, changed, put down (one Ctrl+Z)
function flipSel(axis) { freeTransform(); if (TE.float && TE.float.lifted) { flipFloat(axis); placeFloat(); } }
function turnSel(dir) { freeTransform(); if (TE.float && TE.float.lifted) { turnFloat(dir); placeFloat(); } }
function fillSel(color) {
  if (!TE.doc || !editable()) return;
  commitAdjust(); placeFloat();
  pushUndo();
  const r = selRect(), g = TE.dc;
  g.save();
  if (TE.alphaLock) g.globalCompositeOperation = 'source-atop';
  g.fillStyle = color; g.fillRect(r.x, r.y, r.w, r.h);
  g.restore();
  addRecent(color);
  changed();
}
function selectAll() { TE.sel = { x: 0, y: 0, w: TE.w, h: TE.h }; renderOpts(); draw(); }
function deselect() { TE.sel = null; renderOpts(); draw(); }
// the text's handles: the font bigger or smaller, the opposite side staying where it is
function scaleText(p) {
  const s = TE.textScale, b = s.box, hd = s.handle, right = b.x + b.w, bottom = b.y + b.h;
  let fx = null, fy = null;
  if (hd.includes('e')) fx = (p.x - b.x) / Math.max(1, b.w);
  if (hd.includes('w')) fx = (right - p.x) / Math.max(1, b.w);
  if (hd.includes('s')) fy = (p.y - b.y) / Math.max(1, b.h);
  if (hd.includes('n')) fy = (bottom - p.y) / Math.max(1, b.h);
  const f = Math.max(0.05, fx !== null && fy !== null ? Math.max(fx, fy) : (fx ?? fy));
  TE.font = Math.max(4, Math.min(400, Math.round(s.font * f)));
  const nb = textBox();
  if (hd.includes('w')) TE.draft.x += right - (nb.x + nb.w); else if (hd.includes('e')) TE.draft.x += b.x - nb.x;
  if (hd.includes('n')) TE.draft.y += bottom - (nb.y + nb.h); else if (hd.includes('s')) TE.draft.y += b.y - nb.y;
  const fi = $('#te-font'); if (fi) fi.value = TE.font;
}

// ---------------------------------------------------------------- the right-click menu (as in Photoshop)
let ctxMenu = null;
function closeMenu() { if (ctxMenu) ctxMenu.remove(); ctxMenu = null; }
function menuItems(p) {
  const L = [], sep = () => { if (L.length && L[L.length - 1] !== '-') L.push('-'); };
  if (TE.float) {
    L.push(['Put down', 'Enter', placeFloat], ['Cancel', 'Esc', dropFloat]); sep();
    L.push(['Flip horizontally', '', () => flipFloat('x')], ['Flip vertically', '', () => flipFloat('y')],
      ['Turn 90° clockwise', '', () => turnFloat(1)], ['Turn 90° counter-clockwise', '', () => turnFloat(-1)], ['Reset size and angle', '', resetFloat]);
    return L;
  }
  if (TE.draft && TE.tool === 'text') { L.push(['Apply the text', 'Ctrl+Enter', applyText], ['Cancel the text', 'Esc', dropText]); sep(); }
  L.push([TE.sel ? 'Free transform' : 'Free transform (whole layer)', 'Ctrl+T', freeTransform]);
  if (TE.sel) L.push(['Flip horizontally', '', () => flipSel('x')], ['Flip vertically', '', () => flipSel('y')], ['Turn 180°', '', () => turnSel(2)]);
  sep();
  L.push(['Copy', 'Ctrl+C', () => copySel(false)], ['Cut', 'Ctrl+X', () => copySel(true)],
    ['Paste', 'Ctrl+V', () => TE.clip && pasteFloat(TE.clip.canvas, TE.clip), !TE.clip]);
  sep();
  L.push(['Fill with the colour', 'Alt+Backspace', () => fillSel(TE.color)], ['Fill with the background colour', 'Ctrl+Backspace', () => fillSel(TE.bg)],
    ['Clear (see-through)', 'Delete', clearSel, !TE.sel]);
  sep();
  if (TE.sel) L.push(['Focus on it', 'F', () => setFocus(true)], ['Crop…', '', beginCrop], ['Deselect', 'Ctrl+D', deselect]);
  L.push(['Select all', 'Ctrl+A', selectAll]);
  sep();
  L.push(['Take this colour', 'Alt+click', () => pick(p)], ['Swap the colours', 'X', swapColors]);
  sep();
  L.push(['Undo', 'Ctrl+Z', undo, !TE.undo.length], ['Redo', 'Ctrl+Y', redo, !TE.redo.length]);
  sep();
  L.push(['Keyboard shortcuts', 'F1', openKeys]);
  return L;
}
function openMenu(cx, cy, p) {
  closeMenu();
  const items = menuItems(p);
  ctxMenu = document.createElement('div');
  ctxMenu.className = 'te-ctx';
  ctxMenu.setAttribute('role', 'menu');
  ctxMenu.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<div data-i="${i}" role="menuitem" class="${it[3] ? 'off' : ''}"><span>${esc(it[0])}</span><small>${esc(it[1])}</small></div>`).join('');
  $('#texedit').appendChild(ctxMenu);
  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.min(cx, window.innerWidth - w - 8) + 'px';
  ctxMenu.style.top = Math.min(cy, window.innerHeight - h - 8) + 'px';
  ctxMenu.onclick = (e) => {
    const d = e.target.closest('[data-i]');
    if (!d) return;
    const it = items[+d.dataset.i];
    closeMenu();
    if (it && !it[3]) it[2]();
  };
  setTimeout(() => document.addEventListener('pointerdown', function away(e) {
    if (ctxMenu && ctxMenu.contains(e.target)) return;
    closeMenu(); document.removeEventListener('pointerdown', away, true);
  }, true));
}
function nudgeFloat(dx, dy) {
  const f = TE.float;
  f.x = Math.max(-f.w + 1, Math.min(TE.w - 1, f.x + dx)); f.y = Math.max(-f.h + 1, Math.min(TE.h - 1, f.y + dy));
  draw();
}

function beginCrop() {
  if (!TE.sel || TE.loading || TE.saving) return;
  commitAdjust(); placeFloat();
  if (TE.mode !== '2d') setViewMode('2d');
  TE.cropping = { ...TE.sel, snap: false };
  renderOpts(); draw();
  status('Crop preview: drag the handles, Enter crops, Esc leaves the texture as it is.');
}
function cancelCrop() {
  if (!TE.cropping) return;
  TE.cropping = null; TE.rectDrag = null;
  renderOpts(); draw();
  status('Crop cancelled: the texture is as it was.');
}
function applyCrop() {
  const r = TE.cropping;
  if (!r || TE.loading || TE.saving) return;
  commitAdjust();
  pushUndo();
  TE.layers.crop(r.x, r.y, r.w, r.h); syncLayer();
  TE.cropping = null; TE.sel = null; TE.focus = null; TE.rectDrag = null;
  fitView(); renderOpts(); changed();
  status(`Cropped to ${TE.w} × ${TE.h}${pow2(TE.w) !== TE.w || pow2(TE.h) !== TE.h ? ` (in the game ${gameSize(TE.w, TE.h)})` : ''}. Ctrl+Z puts the whole texture back.`, 'ok');
}
function clearSel() {
  if (!TE.sel || !editable() || TE.alphaLock) return;
  commitAdjust();
  pushUndo();
  TE.dc.clearRect(TE.sel.x, TE.sel.y, TE.sel.w, TE.sel.h);
  changed();
}

// ---------------------------------------------------------------- the mouse and the keys
function onDown(e) {
  if (!TE.doc || TE.loading || TE.saving) return;
  if (TE.mode !== '2d') { setViewMode('2d'); return; }
  view.setPointerCapture(e.pointerId);
  const p = toImg(e);
  closeMenu();
  // Alt+right drag, as in Photoshop: the brush's size (left, right) and hardness (up, down)
  if (e.button === 2 && e.altKey && BRUSH_TOOLS.includes(TE.tool)) {
    TE.brushDrag = { x: e.clientX, y: e.clientY, size: TE.size, hard: TE.hard, at: p };
    TE.alt = false; TE.hover = p; draw();
    return;
  }
  // the right button drags the view; a right click without moving opens the menu (onUp)
  if (e.button === 1 || TE.space || e.button === 2) { TE.pan = { x: e.clientX, y: e.clientY, ox: TE.ox, oy: TE.oy, right: e.button === 2 && !TE.space, moved: false }; return; }
  if (e.button !== 0) return;
  if (TE.float) {                          // a floating piece: move, scale, turn it; a click outside puts it down
    const f = TE.float, handle = floatHandle(f, p);
    if (!handle) { placeFloat(); return; }
    TE.floatDrag = { handle, p0: p, start: { x: f.x, y: f.y, w: f.w, h: f.h, angle: f.angle } };
    return;
  }
  if (TE.tool === 'text' && TE.draft) {    // the text's handles: bigger or smaller
    const b = textBox(), handle = b && rectHandle(p, textFrame(b));
    if (handle && handle !== 'move') { TE.textScale = { handle, box: b, font: TE.font }; return; }
  }
  if (TE.cropping) {                       // the crop: its handles, its inside, or a new rectangle
    const handle = rectHandle(p, TE.cropping) || 'new';
    TE.rectDrag = { crop: true, handle, start: { ...TE.cropping }, p0: p };
    return;
  }
  if (TE.tool === 'select' && TE.sel && !e.altKey) {
    const handle = rectHandle(p, TE.sel);
    if (handle) { TE.rectDrag = { crop: false, handle, start: { ...TE.sel }, p0: p }; return; }
  }
  paintStart(p, e);
}
function onMove(e) {
  if (TE.loading || !TE.doc || TE.mode !== '2d') return;
  const p = toImg(e);
  TE.hover = p;
  if (TE.brushDrag) {
    const d = TE.brushDrag, k = view.width / view.getBoundingClientRect().width;
    TE.size = Math.max(1, Math.min(256, Math.round(d.size + (e.clientX - d.x) * k / TE.zoom * 2)));
    TE.hard = Math.max(0, Math.min(1, d.hard - (e.clientY - d.y) / 150));
    TE.hover = d.at; syncBrushBar();
    status(`Size ${TE.size} px · hardness ${Math.round(TE.hard * 100)}%`);
    return draw();
  }
  if (!TE.stroke) TE.alt = e.altKey;
  if (TE.pan) {
    const k = view.width / view.getBoundingClientRect().width;
    if (Math.hypot(e.clientX - TE.pan.x, e.clientY - TE.pan.y) > 4) TE.pan.moved = true;
    TE.ox = TE.pan.ox + (e.clientX - TE.pan.x) * k; TE.oy = TE.pan.oy + (e.clientY - TE.pan.y) * k;
    return draw();
  }
  if (TE.floatDrag) { dragFloat(TE.floatDrag, p, e.shiftKey); refreshFloatInfo(); return draw(); }
  if (TE.float) {
    const h = floatHandle(TE.float, p);
    view.style.cursor = TE.space ? 'grab' : (h === 'rotate' ? 'alias' : HANDLE_CURSOR[h] || 'default');
    return draw();
  }
  if (TE.textScale) { scaleText(p); return draw(); }
  if (TE.tool === 'text' && TE.draft && !TE.draftDrag) {
    const b = textBox(), h = b && rectHandle(p, textFrame(b));
    view.style.cursor = TE.space ? 'grab' : (HANDLE_CURSOR[h] || toolCursor());
  }
  if (TE.rectDrag) {
    const r = dragRect(TE.rectDrag, p);
    if (TE.rectDrag.crop) Object.assign(TE.cropping, r); else TE.sel = r;
    refreshRectInfo();
    return draw();
  }
  if (TE.cropping || (TE.tool === 'select' && TE.sel && !TE.dragSel)) {
    const handle = rectHandle(p, TE.cropping || TE.sel);
    view.style.cursor = TE.space ? 'grab' : (HANDLE_CURSOR[handle] || 'crosshair');
  } else if (!(TE.tool === 'text' && TE.draft)) view.style.cursor = toolCursor();
  if (TE.dragSel) {
    const a = TE.dragSel, x1 = Math.max(0, Math.min(TE.w, Math.round(Math.min(a.x0, p.x)))), y1 = Math.max(0, Math.min(TE.h, Math.round(Math.min(a.y0, p.y))));
    const x2 = Math.max(0, Math.min(TE.w, Math.round(Math.max(a.x0, p.x)))), y2 = Math.max(0, Math.min(TE.h, Math.round(Math.max(a.y0, p.y))));
    Object.assign(a, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    return draw();
  }
  if (TE.draftDrag && TE.draft) { TE.draft.x = Math.round(p.x - TE.draftDrag.dx); TE.draft.y = Math.round(p.y - TE.draftDrag.dy); return draw(); }
  if (TE.stroke) { dab(p); render(); return; }
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (x >= 0 && y >= 0 && x < TE.w && y < TE.h) {
    const s = $('#te-pos');
    if (s) s.textContent = `${x}, ${y}`;
  }
  draw();
}
function onUp(e) {
  if (TE.brushDrag) { TE.brushDrag = null; renderOpts(); draw(); return; }
  if (TE.pan) {
    const pan = TE.pan;
    TE.pan = null;
    if (pan.right && !pan.moved && e) openMenu(e.clientX, e.clientY, toImg(e));
    return;
  }
  if (TE.floatDrag) { TE.floatDrag = null; return; }
  if (TE.textScale) { TE.textScale = null; draw(); focusInline(); return; }
  if (TE.rectDrag) { TE.rectDrag = null; renderOpts(); draw(); return; }
  if (TE.draftDrag) { TE.draftDrag = null; focusInline(); return; }
  if (TE.dragSel) { const a = TE.dragSel; TE.dragSel = null; TE.sel = a.w > 0 && a.h > 0 ? { x: a.x, y: a.y, w: a.w, h: a.h } : null; renderOpts(); draw(); return; }
  endStroke();
}
function onKey(e) {
  if (!TE.open) return;
  if (TE.loading || TE.saving) { e.stopPropagation(); return; }
  if (e.target.id === 'te-intext') {          // typing the text where it goes: Ctrl+Enter paints it, Esc drops it
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyText(); }
    else if (e.key === 'Escape') { e.preventDefault(); dropText(); }
    e.stopPropagation(); return;
  }
  if (e.target.closest?.('.te-layer-panel') && (!(e.ctrlKey && ['z','y'].includes(e.key.toLowerCase())) || e.target.type === 'text')) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'range') { e.stopPropagation(); return; }
  const k = e.key.toLowerCase();
  let used = true;
  if (keysBox && (k === 'escape' || k === 'f1' || k === '?')) { closeKeys(); e.preventDefault(); e.stopPropagation(); return; }
  if (e.ctrlKey && (k === 'y' || (e.shiftKey && k === 'z'))) redo();
  else if (e.ctrlKey && k === 'z') undo();
  else if (e.ctrlKey && k === 'c') copySel(false);
  else if (e.ctrlKey && k === 'x') copySel(true);
  else if (e.ctrlKey && k === 'v') {
    // the paste event brings the picture (of another program, or ours back); when none comes (an empty
    // system clipboard, a webview that keeps it), the piece copied here is pasted anyway
    clearTimeout(pasteTimer);
    if (TE.clip) pasteTimer = setTimeout(() => { if (TE.open) pasteFloat(TE.clip.canvas, TE.clip); }, 120);
    e.stopPropagation(); return;
  }
  else if (e.ctrlKey && k === 'a') selectAll();
  else if (e.ctrlKey && k === 't') freeTransform();
  else if (e.ctrlKey && k === 'd') deselect();
  else if (e.ctrlKey && k === 'backspace') fillSel(TE.bg);
  else if (e.ctrlKey && e.shiftKey && k === 'n') newLayer();
  else if (e.ctrlKey && k === 'j') layerViaCopy();
  else if (e.ctrlKey && k === 'e') mergeLayerDown();
  else if (e.ctrlKey && k === 'i') invertColours();
  else if (e.ctrlKey && k === '0') { if (TE.focus) setFocus(false); else { fitView(); draw(); } }
  else if (e.ctrlKey && k === '1') zoomTo(1);
  else if (e.ctrlKey && (k === '+' || k === '=')) zoomTo(TE.zoom >= 1 ? Math.round(TE.zoom) * 2 : Math.min(1, TE.zoom * 2));
  else if (e.ctrlKey && k === '-') zoomTo(TE.zoom > 1 ? Math.max(1, Math.round(TE.zoom / 2)) : TE.zoom / 2);
  else if (e.ctrlKey) used = false;
  else if (k === 'escape' && ctxMenu) closeMenu();
  else if (k === 'f1' || k === '?') openKeys();
  else if (e.altKey && k === 'backspace') fillSel(TE.color);
  else if (k === 'alt') { TE.alt = true; if (!TE.float && !TE.cropping && !TE.draft) view.style.cursor = toolCursor(); }
  else if (k === 'x' && !e.altKey) swapColors();
  else if (k === 'd' && !e.altKey) defaultColours();
  else if (e.code === 'Space') { TE.space = true; view.style.cursor = 'grab'; }
  else if (TE.float && k.startsWith('arrow')) { const n = e.shiftKey ? 10 : 1; nudgeFloat(k === 'arrowleft' ? -n : k === 'arrowright' ? n : 0, k === 'arrowup' ? -n : k === 'arrowdown' ? n : 0); }
  else if (k === 'escape' && TE.float) dropFloat();
  else if (k === 'enter' && TE.float) placeFloat();
  else if (k === 'escape') { if (TE.cropping) cancelCrop(); else if (TE.draft) dropText(); else if (TE.sel) { TE.sel = null; renderOpts(); draw(); } else close(); }
  else if (k === 'enter' && TE.cropping) applyCrop();
  else if (k === 'enter' && TE.draft) applyText();
  else if (k === 'f' && !TE.cropping) { if (TE.focus) setFocus(false); else if (TE.sel) setFocus(true); else status('Select a part first (M), then F frames it.', 'warn'); }
  else if (k === 'delete' || k === 'backspace') clearSel();
  // [ and ] (the two keys right of P, on any keyboard): the brush smaller, bigger; with Shift softer, harder
  else if (e.code === 'BracketLeft' || e.code === 'BracketRight' || k === '[' || k === ']' || k === '{' || k === '}') {
    const up = e.code === 'BracketRight' || k === ']' || k === '}';
    if (e.shiftKey) { TE.hard = Math.max(0, Math.min(1, Math.round(TE.hard * 4 + (up ? 1 : -1)) / 4)); status(`Hardness ${Math.round(TE.hard * 100)}%`); }
    else { TE.size = up ? Math.min(256, Math.round(TE.size * 1.25) + 1) : Math.max(1, Math.round(TE.size / 1.25)); status(`Size ${TE.size} px`); }
    renderOpts(); draw();
  }
  else if (/^[0-9]$/.test(k) && !e.altKey && (BRUSH_TOOLS.includes(TE.tool) || TE.tool === 'fill' || TE.tool === 'text')) opacityDigit(+k);
  else if (k === '0') { if (TE.focus) setFocus(false); else { fitView(); draw(); } }
  else if (k === 'v') freeTransform();       // Move, as in Photoshop: the selection (or the layer) lifted to drag
  else if (k === 'o') { const now = ['lighten', 'darken'].includes(TE.tool) ? TE.tool : TE.dodge; if (!e.repeat) setTool(e.shiftKey ? (now === 'lighten' ? 'darken' : 'lighten') : now); }
  else {
    const t = TOOLS.find((x) => x[1].toLowerCase() === k);
    if (!t) used = false;
    else if (!e.repeat) {                     // held a while, a tool is used only until its key is let go
      const before = TE.tool;
      setTool(t[0]);
      TE.spring = before !== t[0] ? { code: e.code, prev: before, at: performance.now() } : null;
    }
  }
  if (used) e.preventDefault();
  e.stopPropagation();                      // nothing reaches the map editor behind
}
function onKeyUp(e) {
  if (!TE.open) return;
  if (e.code === 'Space') TE.space = false;
  if (e.key === 'Alt') { TE.alt = false; e.preventDefault(); }
  const s = TE.spring;
  if (s && e.code === s.code) { TE.spring = null; if (performance.now() - s.at > 350 && TE.tool !== s.prev) setTool(s.prev); }
  if (view && !TE.float && !TE.cropping && !(TE.tool === 'text' && TE.draft) && !TE.pan) view.style.cursor = toolCursor();
  if (e.key === 'Alt') draw();
}

// ---------------------------------------------------------------- Photoshop's shortcuts and pointers
// the pointer of each tool: a symbol with its point where the tool acts (white over black, seen on any texture)
function svgCursor(body, hx, hy, fallback) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<g stroke="#000" stroke-width="3.5" stroke-opacity=".8">${body}</g><g stroke="#fff" stroke-width="1.5">${body}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
}
const CURSORS = {
  cross: svgCursor('<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>', 12, 12, 'crosshair'),
  picker: svgCursor('<path transform="translate(2 2)" d="m5 12 7-7 3 3-7 7H6l-3 2 1-3zM11 4l5 5M13 5l2-2a1.5 1.5 0 0 1 2 2l-2 2"/>', 5, 19, 'crosshair'),
  fill: svgCursor('<path transform="translate(2 2)" d="m3 10 7-7 6 7-6 6zM6 2l6 6M3 10h13M17 12s-2 2.5-2 3.5a2 2 0 0 0 4 0C19 14.5 17 12 17 12"/>', 19, 19, 'crosshair'),
  text: svgCursor('<path d="M8 4h6M11 4v16M8 20h6M16 3.5h6M19 3.5v6"/>', 11, 12, 'text'),
  target: svgCursor('<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>', 12, 12, 'crosshair'),
};
function toolCursor() {
  if (TE.space) return 'grab';
  const t = TE.tool;
  if (TE.alt && t === 'clone') return CURSORS.target;            // Alt+click: where to copy from
  if (TE.alt && BRUSH_TOOLS.includes(t)) return CURSORS.picker;  // Alt+click: take the colour
  return t === 'picker' ? CURSORS.picker : t === 'fill' ? CURSORS.fill : t === 'text' ? CURSORS.text : t === 'select' ? 'crosshair' : CURSORS.cross;
}
function syncBrushBar() {
  const s = $('#te-size-r'), v = $('#te-size-v'), h = $('#te-hard');
  if (s) s.value = TE.size; if (v) v.textContent = TE.size; if (h) h.value = Math.round(TE.hard * 100);
}
// 1 … 9, 0: the opacity 10% … 90%, 100%; two digits typed quickly: that value (4, 5: 45%)
let digitAt = 0, digitFirst = null;
function opacityDigit(d) {
  const now = performance.now(), pair = digitFirst !== null && now - digitAt < 600;
  const v = Math.max(1, Math.min(100, pair ? digitFirst * 10 + d || 100 : d === 0 ? 100 : d * 10));
  digitFirst = pair ? null : d; digitAt = now;
  TE.opacity = v / 100;
  renderOpts(); draw();
  status(`${['lighten', 'darken', 'soften'].includes(TE.tool) ? 'Strength' : 'Opacity'} ${v}%`);
}
function defaultColours() {
  TE.color = '#000000'; TE.bg = '#ffffff';
  $('#te-color').value = TE.color; $('#te-bgcolor').value = TE.bg;
  markRecent(); draw(); status('Colours: black, background white.');
}
function zoomTo(z) {
  const z0 = TE.zoom, cx = view.width / 2, cy = view.height / 2;
  z = Math.max(0.05, Math.min(64, z));
  TE.ox = cx - (cx - TE.ox) * z / z0; TE.oy = cy - (cy - TE.oy) * z / z0; TE.zoom = z;
  draw(); status(`Zoom ${Math.round(z * 100)}%`);
}
function newLayer() { placeFloat(); mutateLayers((m) => m.add('Paint layer')); status('New layer.'); }
// Ctrl+J: the selection of the active layer on a layer of its own (no selection: the layer duplicated)
function layerViaCopy() {
  if (TE.loading || TE.saving || !TE.layers) return;
  placeFloat();
  const s = TE.sel;
  mutateLayers((m) => {
    if (!s) return m.duplicate();
    const src = m.active.canvas, layer = m.add(m.active.name.slice(0, 70) + ' piece');
    layer.canvas.getContext('2d').drawImage(src, s.x, s.y, s.w, s.h, s.x, s.y, s.w, s.h);
  });
  status(s ? 'The selection is on a layer of its own.' : 'Layer duplicated.');
}
function mergeLayerDown() { placeFloat(); mutateLayers((m) => m.mergeDown()); }
function invertColours() { placeFloat(); adjust((d) => { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } }); }
// F1 or ?: the list of the keys
const KEYS = [
  ['Tools', [['B', 'Brush'], ['E', 'Eraser'], ['G', 'Fill'], ['I', 'Colour picker (Alt with a brush)'], ['S', 'Clone stamp (Alt+click: the source)'],
    ['U', 'Blur'], ['O / Shift+O', 'Lighten / Darken'], ['T', 'Text'], ['M', 'Select'], ['V, Ctrl+T', 'Move / free transform'],
    ['Hold a tool key', 'That tool until the key is let go']]],
  ['Brush', [['[ ]  (the keys right of P)', 'Smaller / bigger'], ['Shift+[  Shift+]', 'Softer / harder'], ['Alt+right drag', 'Size (left, right) and hardness (up, down)'],
    ['1 … 9, 0', 'Opacity 10% … 90%, 100% (4 then 5: 45%)'], ['Shift+click', 'A straight line from the last point'], ['X / D', 'Swap the colours / black and white']]],
  ['Edit', [['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste (a picture goes inside the texture)'], ['Ctrl+A / Ctrl+D', 'Select all / deselect'],
    ['Delete', 'Clear the selection'], ['Alt+Backspace / Ctrl+Backspace', 'Fill with the colour / the background'], ['Ctrl+I', 'Invert the colours'],
    ['Enter / Esc', 'Put down, crop, paint the text / cancel'], ['Ctrl+Enter', 'Paint the text while typing']]],
  ['Layers', [['Ctrl+Shift+N', 'New layer'], ['Ctrl+J', 'The selection on a new layer (or the layer duplicated)'], ['Ctrl+E', 'Merge down']]],
  ['View', [['Space+drag, right drag', 'Pan'], ['Wheel, Ctrl++ / Ctrl+-', 'Zoom'], ['Ctrl+0 / Ctrl+1', 'Fit / actual pixels'], ['F', 'Focus on the selection (F or 0: all)']]],
];
let keysBox = null;
function openKeys() {
  if (keysBox) return closeKeys();
  closeMenu();
  keysBox = document.createElement('div');
  keysBox.className = 'te-keys';
  keysBox.setAttribute('role', 'dialog'); keysBox.setAttribute('aria-label', 'Keyboard shortcuts');
  keysBox.innerHTML = '<div class="te-keys-title">Keyboard shortcuts</div>'
    + KEYS.map(([group, rows]) => `<div class="te-keys-h">${group}</div>` + rows.map(([key, what]) => `<div class="te-keys-row"><b>${esc(key)}</b><span>${esc(what)}</span></div>`).join('')).join('')
    + '<div class="te-keys-foot"><button type="button">Close</button></div>';
  $('#texedit').appendChild(keysBox);
  keysBox.querySelector('button').onclick = closeKeys;
  setTimeout(() => document.addEventListener('pointerdown', function away(e) {
    if (keysBox && keysBox.contains(e.target)) return;
    closeKeys(); document.removeEventListener('pointerdown', away, true);
  }, true));
}
function closeKeys() { if (keysBox) keysBox.remove(); keysBox = null; }

// ---------------------------------------------------------------- adjustments (the selection, or all)
function adjust(fn) {
  if (!editable()) return;
  commitAdjust(); pushUndo();
  const s = selRect(), img = TE.dc.getImageData(s.x, s.y, s.w, s.h);
  fn(img.data, s.w, s.h);
  TE.dc.putImageData(img, s.x, s.y);
  changed();
}
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hsl2rgb(h, s, l) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
function levels(d, bri, con, hue, sat, lig) {   // brightness, contrast (-100..100), hue (deg), saturation, lightness (-100..100)
  const c = (100 + con) / 100, b = bri * 2.55;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], bl = d[i + 2];
    if (hue || sat || lig) {
      let [h, s, l] = rgb2hsl(r, g, bl);
      h = (h + hue / 360 + 1) % 1;
      s = Math.max(0, Math.min(1, s * (1 + sat / 100)));
      l = Math.max(0, Math.min(1, lig > 0 ? l + (1 - l) * lig / 100 : l * (1 + lig / 100)));
      [r, g, bl] = hsl2rgb(h, s, l);
    }
    d[i] = (r - 128) * c + 128 + b; d[i + 1] = (g - 128) * c + 128 + b; d[i + 2] = (bl - 128) * c + 128 + b;
  }
}
function colorize(d, color, amount) {
  const [cr, cg, cb] = hex(color), [ch, cs] = rgb2hsl(cr, cg, cb);
  for (let i = 0; i < d.length; i += 4) {
    const [, , l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
    const [r, g, b] = hsl2rgb(ch, cs, l);
    d[i] += (r - d[i]) * amount; d[i + 1] += (g - d[i + 1]) * amount; d[i + 2] += (b - d[i + 2]) * amount;
  }
}
function convolve(d, w, h, k) {               // 3x3, wrapping round the edges (textures tile)
  const src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const q = (((y + j + h) % h) * w + ((x + i + w) % w)) * 4, f = k[(j + 1) * 3 + i + 1];
      r += src[q] * f; g += src[q + 1] * f; b += src[q + 2] * f;
    }
    const o = (y * w + x) * 4;
    d[o] = r; d[o + 1] = g; d[o + 2] = b;
  }
}
function valueNoise(w, h, cell, seed) {      // smooth noise that tiles (for grime)
  const gw = Math.max(1, Math.round(w / cell)), gh = Math.max(1, Math.round(h / cell)), grid = new Float32Array(gw * gh);
  let s = seed;
  for (let i = 0; i < grid.length; i++) { s = (s * 16807) % 2147483647; grid[i] = s / 2147483647; }
  const out = new Float32Array(w * h), sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = x / w * gw, gy = y / h * gh, x0 = Math.floor(gx), y0 = Math.floor(gy), tx = sm(gx - x0), ty = sm(gy - y0);
    const v = (a, b) => grid[((b % gh) * gw) + (a % gw)];
    const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx, bot = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
    out[y * w + x] = top + (bot - top) * ty;
  }
  return out;
}
function grime(d, w, h, amount) {
  const n1 = valueNoise(w, h, Math.max(4, w / 6), 7 + Math.floor(Math.random() * 1e6)), n2 = valueNoise(w, h, Math.max(2, w / 24), 3 + Math.floor(Math.random() * 1e6));
  for (let k = 0; k < w * h; k++) {
    const dirt = Math.max(0, (n1[k] * 0.7 + n2[k] * 0.3) - 0.35) * 1.6, f = 1 - amount * dirt, i = k * 4;
    d[i] *= f; d[i + 1] *= f * 0.97; d[i + 2] *= f * 0.92;
  }
}
function noise(d, amount) {
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 2.55 * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
}
function whole(fn) {
  if (!editable()) return;
  commitAdjust(); pushUndo();
  const c = document.createElement('canvas'); fn(c);
  TE.layers.replaceCanvas(TE.layers.activeId, c); syncLayer(); changed();
}
function transformLayers(w, h, fn) {
  mutateLayers(model => model.transformAll(w, h, fn));
  TE.sel = null; resizeViews(); renderOpts();
}
function offsetHalf() {
  whole((c) => { c.width = TE.w; c.height = TE.h; const g = c.getContext('2d'), w2 = Math.floor(TE.w / 2), h2 = Math.floor(TE.h / 2);
    for (const [x, y] of [[-w2, -h2], [TE.w - w2, -h2], [-w2, TE.h - h2], [TE.w - w2, TE.h - h2]]) g.drawImage(TE.layers.active.canvas, x, y); });
  status('Moved by half: the edges are now in the middle. Paint over the seams (Soften, Clone), then Offset again.');
}
function seamless() {                       // the edges blend with the other side: it tiles without a line
  whole((c) => {
    const W = TE.w, H = TE.h; c.width = W; c.height = H;
    const g = c.getContext('2d'), sh = document.createElement('canvas'); sh.width = W; sh.height = H;
    const sg = sh.getContext('2d'), w2 = Math.floor(W / 2), h2 = Math.floor(H / 2);
    for (const [x, y] of [[-w2, -h2], [W - w2, -h2], [-w2, H - h2], [W - w2, H - h2]]) sg.drawImage(TE.layers.active.canvas, x, y);
    const a = TE.dc.getImageData(0, 0, W, H).data, b = sg.getImageData(0, 0, W, H).data, out = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      // 1 in the middle (the picture), 0 at the edges (the moved copy, whose edges meet)
      const fx = Math.min(x, W - 1 - x) / (W / 2), fy = Math.min(y, H - 1 - y) / (H / 2);
      const m = Math.min(1, Math.min(fx, fy) * 2.2), t = m * m * (3 - 2 * m), i = (y * W + x) * 4;
      for (let k = 0; k < 4; k++) out.data[i + k] = b[i + k] + (a[i + k] - b[i + k]) * t;
    }
    g.putImageData(out, 0, 0);
  });
  status('Made seamless: it repeats without a visible line (see the tiled preview).');
}
function flip(h) { whole((c) => { c.width = TE.w; c.height = TE.h; const g = c.getContext('2d'); g.translate(h ? TE.w : 0, h ? 0 : TE.h); g.scale(h ? -1 : 1, h ? 1 : -1); g.drawImage(TE.layers.active.canvas, 0, 0); }); }
function rotate() {
  transformLayers(TE.h, TE.w, (source, c) => { const g = c.getContext('2d'); g.translate(source.height, 0); g.rotate(Math.PI / 2); g.drawImage(source, 0, 0); });
}
function resizeTo(w, h) {
  mutateLayers(model => model.resize(w, h, { smooth: !$('#a-nearest').checked }));
  TE.sel = null; resizeViews(); renderOpts();
}
// the 256 colours the game keeps (median cut, as the import does), for "Game colours"
function quantize(src) {
  const W = src.width, H = src.height, d = src.getContext('2d').getImageData(0, 0, W, H).data;
  const px = [];
  const step = Math.max(1, Math.floor((W * H) / 60000));
  for (let k = 0; k < W * H; k += step) if (d[k * 4 + 3] >= 128) px.push([d[k * 4], d[k * 4 + 1], d[k * 4 + 2]]);
  let boxes = [px];
  while (boxes.length < 255) {
    let bi = -1, bw = -1, bc = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) { let lo = 255, hi = 0; for (const p of b) { lo = Math.min(lo, p[c]); hi = Math.max(hi, p[c]); } if (hi - lo > bw) { bw = hi - lo; bi = i; bc = c; } }
    });
    if (bi < 0 || bw <= 0) break;
    const b = boxes[bi].sort((x, y) => x[bc] - y[bc]), m = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
  }
  const pal = boxes.filter((b) => b.length).map((b) => [0, 1, 2].map((c) => b.reduce((s, p) => s + p[c], 0) / b.length));
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const og = out.getContext('2d'), img = og.createImageData(W, H), memo = new Map();
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    if (d[i + 3] < 128) { img.data[i + 3] = 0; continue; }
    const key = (d[i] >> 2) << 12 | (d[i + 1] >> 2) << 6 | (d[i + 2] >> 2);
    let c = memo.get(key);
    if (!c) { let best = 1e9; for (const p of pal) { const e = (p[0] - d[i]) ** 2 + (p[1] - d[i + 1]) ** 2 + (p[2] - d[i + 2]) ** 2; if (e < best) { best = e; c = p; } } memo.set(key, c); }
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return out;
}

// ---------------------------------------------------------------- the right panel
function renderRight() {
  cancelAdjustPreview();
  const el = $('#te-right');
  if (!el) return;
  const output = { to: el.querySelector('input[name="te-to"]:checked')?.value, keep: $('#te-keep')?.checked, name: $('#te-keepname')?.value,
    expanded: [...el.querySelectorAll('details')].map(x => x.open) };
  const ctx = TE.ctx || {}, actor = ctx.kind === 'actor', can = !!ctx.kind;
  el.innerHTML = `
    ${ctx.materials?.length > 1 && ctx.selectMaterial ? `<label class="te-material"><span>Texture</span><select id="te-material" aria-label="Texture to paint" title="Only faces using this texture can be painted. Choose another texture to edit its faces.">${ctx.materials.map((m, i) => `<option value="${i}" ${i === ctx.materialIndex ? 'selected' : ''} title="${esc(m.tex)}">${esc(m.label)}</option>`).join('')}</select></label>` : ''}
    <div id="te-layers"></div>
    <details class="te-section"><summary>Tile preview</summary><div class="te-prev"><canvas id="te-tiles" width="240" height="240" title="The texture repeated 3 x 3, as on a wall"></canvas>
      </div></details>
    <label class="te-row"><input type="checkbox" id="te-game" ${TE.gamePreview ? 'checked' : ''}> Game colours (256, as in Deus Ex)</label>
    <div class="te-row hint"><span id="te-size"></span> · <span id="te-pos"></span></div>
    <details class="te-section"><summary>Adjust layer</summary>
    <div class="te-sl"><label>Brightness</label><input type="range" id="a-bri" min="-100" max="100" value="0"></div>
    <div class="te-sl"><label>Contrast</label><input type="range" id="a-con" min="-80" max="100" value="0"></div>
    <div class="te-sl"><label>Hue</label><input type="range" id="a-hue" min="-180" max="180" value="0"></div>
    <div class="te-sl"><label>Saturation</label><input type="range" id="a-sat" min="-100" max="100" value="0"></div>
    <div class="te-sl"><label>Lightness</label><input type="range" id="a-lig" min="-100" max="100" value="0"></div>
    <div class="te-row"><button id="a-apply" class="primary">Apply</button><button id="a-reset">Reset</button></div>
    <div class="te-row">
      <button id="a-colorize" title="The colour of the brush over the picture, keeping its light and dark">Colorize</button>
      <button id="a-gray">Grey</button><button id="a-invert">Invert</button>
      <button id="a-blur">Blur</button><button id="a-sharp">Sharpen</button>
      <button id="a-noise" title="Fine grain">Noise</button><button id="a-grime" title="Patches of dirt, as on worn walls">Grime</button>
    </div>
    </details><details class="te-section"><summary>Tile and canvas</summary>
    <div class="te-row">
      <button id="a-seam" title="The edges blend with the other side: it repeats without a line">Make seamless</button>
      <button id="a-offset" title="Move by half (wrapping round): the seams come to the middle">Offset ½</button>
      <button id="a-fliph">Flip ↔</button><button id="a-flipv">Flip ↕</button><button id="a-rot">Turn 90°</button>
    </div>
    <div class="te-row"><label style="width:auto">Size</label><select id="a-size">${[32, 64, 128, 256, 512, 1024, 2048].map((n) => `<option ${n === TE.w ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span class="hint">x</span><select id="a-sizeh">${[32, 64, 128, 256, 512, 1024, 2048].map((n) => `<option ${n === TE.h ? 'selected' : ''}>${n}</option>`).join('')}</select><button id="a-resize">Resize</button></div>
    <label class="te-row"><input id="a-nearest" type="checkbox" checked>Keep sharp pixels when resizing</label></details>
    <div class="te-h">Apply texture</div>
    ${can ? `<label class="te-row te-opt"><input type="radio" name="te-to" value="one" checked><span>${actor ? 'This object' : 'This structure'}</span></label>
    <label class="te-row te-opt"><input type="radio" name="te-to" value="all"><span>All uses in this map</span></label>` : ''}
    <label class="te-row te-opt"><input type="radio" name="te-to" value="lib" ${can ? '' : 'checked'}><span>My textures only</span></label>
    <label class="te-row te-opt"><input type="checkbox" id="te-keep"><span>Also save to My textures</span></label>
    <div class="te-row" style="padding-left:22px"><input id="te-keepname" value="${esc(TE.base || 'MyTexture')}" style="flex:1;min-width:0"></div>
    <div class="te-row"><button id="te-apply" class="primary">Apply</button></div>
    <div class="hint" style="margin:4px 0">Layers stay editable. Rebuild exports 256 colours, up to 1024 px. Transparency becomes a cutout mask.</div>`;
  const materialChoice = $('#te-material');
  if (materialChoice) materialChoice.onchange = async () => {
    const index = Number(materialChoice.value);
    // Restore the displayed choice until open() accepts the change. Cancelling
    // keeps the current document, its layers, and pending text/adjustments intact.
    materialChoice.value = String(ctx.materialIndex);
    if (TE.loading || TE.saving || index === ctx.materialIndex) return;
    try { await open(ctx.selectMaterial(index)); }
    catch (e) { status(e.message, 'bad'); }
  };
  layerPanel = mountTextureLayers($('#te-layers'), {
    getModel: () => TE.layers,
    onSelect(id) { if (TE.loading || TE.saving) return; endStroke(); commitAdjust(); TE.layers.select(id); syncLayer(); layerPanel.refresh(); draw(); },
    onMutation: mutateLayers, onImport: importLayer,
  });
  const sl = ['bri', 'con', 'hue', 'sat', 'lig'];
  const vals = () => sl.map((k) => +$('#a-' + k).value);
  const live = () => {
    if (!editable()) { for (const k of sl) $('#a-' + k).value = 0; return; }
    if (!TE.adjBase) { TE.adjBase = TE.dc.getImageData(0, 0, TE.w, TE.h); }
    const s = selRect(), img = new ImageData(new Uint8ClampedArray(TE.adjBase.data), TE.w, TE.h);
    const sub = TE.dc.createImageData(s.w, s.h);
    for (let y = 0; y < s.h; y++) sub.data.set(img.data.subarray(((s.y + y) * TE.w + s.x) * 4, ((s.y + y) * TE.w + s.x + s.w) * 4), y * s.w * 4);
    levels(sub.data, ...vals());
    TE.dc.putImageData(img, 0, 0);
    TE.dc.putImageData(sub, s.x, s.y);
    TE.needsComposite = true; TE.quant = null;
    draw();
  };
  for (const k of sl) {
    $('#a-' + k).oninput = () => {
      adjustLive = live;
      if (!adjustFrame) adjustFrame = requestAnimationFrame(flushAdjustPreview);
    };
    $('#a-' + k).onchange = flushAdjustPreview;
  }
  $('#a-apply').onclick = () => {
    flushAdjustPreview();
    if (!TE.adjBase) return;
    const now = TE.dc.getImageData(0, 0, TE.w, TE.h);
    TE.dc.putImageData(TE.adjBase, 0, 0);
    TE.adjBase = null;
    pushUndo();
    TE.dc.putImageData(now, 0, 0);
    for (const k of sl) $('#a-' + k).value = 0;
    changed();
  };
  $('#a-reset').onclick = () => { cancelAdjustPreview(); if (TE.adjBase) { TE.dc.putImageData(TE.adjBase, 0, 0); TE.adjBase = null; } for (const k of sl) $('#a-' + k).value = 0; TE.needsComposite = true; TE.quant = null; draw(); };
  const commitLive = () => { flushAdjustPreview(); if (TE.adjBase) $('#a-apply').onclick(); };
  $('#a-colorize').onclick = () => { commitLive(); adjust((d) => colorize(d, TE.color, 0.85)); };
  $('#a-gray').onclick = () => { commitLive(); adjust((d) => { for (let i = 0; i < d.length; i += 4) { const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = l; } }); };
  $('#a-invert').onclick = () => { commitLive(); adjust((d) => { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } }); };
  $('#a-blur').onclick = () => { commitLive(); adjust((d, w, h) => convolve(d, w, h, [1 / 16, 2 / 16, 1 / 16, 2 / 16, 4 / 16, 2 / 16, 1 / 16, 2 / 16, 1 / 16])); };
  $('#a-sharp').onclick = () => { commitLive(); adjust((d, w, h) => convolve(d, w, h, [0, -0.5, 0, -0.5, 3, -0.5, 0, -0.5, 0])); };
  $('#a-noise').onclick = () => { commitLive(); adjust((d) => noise(d, 12)); };
  $('#a-grime').onclick = () => { commitLive(); adjust((d, w, h) => grime(d, w, h, 0.45)); };
  $('#a-seam').onclick = () => { commitLive(); seamless(); };
  $('#a-offset').onclick = () => { commitLive(); offsetHalf(); };
  $('#a-fliph').onclick = () => { commitLive(); flip(true); };
  $('#a-flipv').onclick = () => { commitLive(); flip(false); };
  $('#a-rot').onclick = () => { commitLive(); rotate(); };
  $('#a-resize').onclick = () => { commitLive(); resizeTo(+$('#a-size').value, +$('#a-sizeh').value); };
  $('#te-game').onchange = () => { TE.gamePreview = $('#te-game').checked; TE.quant = TE.gamePreview ? quantize(TE.doc) : null; draw(); };
  $('#te-apply').onclick = () => { commitLive(); apply(); };
  if (output.to) { const radio = el.querySelector(`input[name="te-to"][value="${output.to}"]`); if (radio) radio.checked = true; }
  if (output.keep !== undefined) $('#te-keep').checked = output.keep;
  if (output.name !== undefined) $('#te-keepname').value = output.name;
  [...el.querySelectorAll('details')].forEach((x, i) => { x.open = !!output.expanded[i]; });

  if (TE.doc) changed(false);
}
function drawTiles() {
  const c = $('#te-tiles');
  if (!c || !TE.doc) return;
  const g = c.getContext('2d'), k = c.width / 3;
  g.clearRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = true;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) g.drawImage(TE.doc, i * k, j * k, k, k * TE.h / TE.w);
}
// ---------------------------------------------------------------- apply / library
async function apply() {
  if (TE.loading || TE.saving) return;
  endStroke(); commitAdjust(); compose();
  TE.saving = true; $('#te-apply').disabled = true;
  const revision = openRevision, context = TE.ctx;
  ++documentRevision;
  const to = (document.querySelector('input[name="te-to"]:checked') || {}).value || 'lib';
  const keep = $('#te-keep') && $('#te-keep').checked, png = TE.doc.toDataURL('image/png');
  try {
    const document = TE.layers.serialize();
    if (to === 'lib' || keep) {
      const r = await api('/api/texture_library', { name: $('#te-keepname').value || TE.base, png, document });
      if (revision !== openRevision || !TE.open) return;
      status(`Kept in My textures as ${r.name}.`, 'ok');
    }
    if (to !== 'lib') {
      status('making it a texture of the map...');
      await window.__editor.applyTexture(context, png, to, document);
    }
    if (revision !== openRevision || !TE.open) return;
    TE.saving = false; close(true);
  } catch (e) { if (revision === openRevision && TE.open) status('Apply: ' + e.message, 'bad'); }
  finally { if (revision === openRevision) { TE.saving = false; $('#te-apply').disabled = false; } }
}
async function toggleLibrary() {
  const box = $('#te-libbox');
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  const r = await api('/api/texture_library');
  box.innerHTML = `<div class="te-h">My textures <small class="hint">click to open one</small><button id="te-libx" style="float:right">✕</button></div>`
    + (r.textures.length ? r.textures.map((t) => `<div class="te-libitem" data-lib="${esc(t.url)}" data-name="${esc(t.name)}" data-project="${esc(t.documentUrl || '')}"><img src="${esc(t.url)}"><span>${esc(t.name)}<br><small>${t.w} × ${t.h}${t.editable ? ' · layers' : ''}</small></span><button data-libdel="${esc(t.name)}" title="Delete">✕</button></div>`).join('')
      : '<div class="hint">Empty: Apply with "keep it in My textures" to put one here.</div>');
  box.style.display = 'block';
  $('#te-libx').onclick = () => { box.style.display = 'none'; };
  for (const it of box.querySelectorAll('[data-lib]')) it.onclick = async (e) => {
    if (e.target.dataset.libdel) return;
    if (TE.dirty && !confirm('Open this texture in place of the one you are editing?')) return;
    if (TE.loading || TE.saving) return;
    const revision = openRevision, request = ++documentRevision;
    try {
      let model;
      if (it.dataset.project) model = await TextureLayers.fromProject((await api(it.dataset.project)).document);
      else { const img = await loadImage(it.dataset.lib); model = new TextureLayers(img.width, img.height, { source: img }); model.add('Paint layer'); }
      if (!TE.open || TE.saving || revision !== openRevision || request !== documentRevision) return;
      commitAdjust(); pushUndo(); TE.base = it.dataset.name; adoptLayers(model); changed();
    } catch (error) { status('Open texture: ' + error.message, 'bad'); return; }
    box.style.display = 'none';
  };
  for (const b of box.querySelectorAll('[data-libdel]')) b.onclick = async () => {
    if (!confirm(`Delete "${b.dataset.libdel}" from My textures?`)) return;
    await api('/api/texture_library_delete', { name: b.dataset.libdel });
    box.style.display = 'none'; toggleLibrary();
  };
}

window.__texedit = { open, close, get state() { return TE; } };
