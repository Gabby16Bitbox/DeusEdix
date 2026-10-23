// A focused curve editor for the current character's joint or root motion.
// Frame values remain zero based internally; the UI uses the Studio's 1-based frames.
import { sampleCurve, upsertKey, moveKeys, deleteKeys, duplicateKeys } from './studio-curves.js';

const AXES = ['x', 'y', 'z'];
const COLORS = { x: '#e69a95', y: '#96cca7', z: '#96b9ed' };
const EYE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2.3"/><path class="stg-eye-slash" d="m3 3 14 14"/></svg>';
const MAXIMIZE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>';
const RESTORE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4"/></svg>';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const copy = (group) => Object.fromEntries(AXES.map((axis) => [axis, (group?.[axis] || []).map((key) => ({ ...key }))]));
const number = (n) => Number(n.toFixed(3)).toString();
function tickStep(span, pixels, spacing) {
  const raw = Math.max(0.000001, span / Math.max(1, pixels / spacing));
  const power = 10 ** Math.floor(Math.log10(raw)), ratio = raw / power;
  return power * (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10);
}

export function createCurveEditor(container, callbacks) {
  const root = document.createElement('section');
  root.className = 'st-graph';
  root.setAttribute('aria-label', 'Animation curve editor');
  root.innerHTML = `
    <div class="stg-heading">
      <strong>Curves</strong><span class="stg-label"></span>
      <div class="stg-target" role="group" aria-label="Curve target">
        <button type="button" data-target="rotation" title="Edit the selected joint's rotation">Rotation</button>
        <button type="button" data-target="position" title="Edit the character's position">Body position</button>
        <button type="button" data-target="pole" title="Edit the elbow or knee's pole position" hidden>Pole</button>
      </div>
      <div class="stg-axes" role="group" aria-label="Active channel">
        ${AXES.map((a) => `<span class="stg-axis-pair" data-color="${a}"><button type="button" data-axis="${a}" title="Select ${a.toUpperCase()} channel">${a.toUpperCase()}</button><button type="button" class="stg-eye" data-visible-axis="${a}" aria-label="Hide ${a.toUpperCase()} curve" title="Hide ${a.toUpperCase()} curve (display only)">${EYE}</button></span>`).join('')}
      </div>
      <button type="button" data-action="fit" title="Fit visible channels (Home)">Fit all</button>
      <button type="button" data-action="fit-selected" title="Fit selected keys (F, Numpad .)">Fit selected</button>
      <button type="button" class="stg-icon" data-action="maximize" aria-pressed="false" aria-label="Maximize the Graph editor" title="Maximize the Graph editor (Ctrl+Space)">${MAXIMIZE}</button>
    </div>
    <div class="stg-notice"><span>Edit curves to adjust timing and easing for this animation.</span><button type="button" data-action="enable">Edit curves</button></div>
    <div class="stg-plot"><canvas tabindex="0" aria-label="Animation curves. Click a key to select it, drag to move it, or drag empty space to select keys. Use the top ruler to seek." role="img"></canvas></div>
    <div class="stg-edit">
      <label>Frame <input class="stg-key-frame" type="number" min="1" step="1" aria-label="Selected key frame"></label>
      <label><span class="stg-unit">Value</span> <input class="stg-key-value" type="number" step="0.1" aria-label="Selected key value"></label>
      <label class="stg-interpolation">Easing <select aria-label="Interpolation after selected keys" title="How the motion leaves each selected key"><option value="smooth">Smooth</option><option value="linear">Linear</option><option value="hold">Hold</option><option value="mixed" disabled>Mixed</option></select></label>
      <button type="button" data-action="add" title="Add a key on the active channel at the playhead">+ Key</button>
      <button type="button" data-action="duplicate" title="Duplicate selected keys at the playhead (Ctrl+D)">Duplicate</button>
      <button type="button" data-action="delete" title="Delete selected keys (Delete)">Delete</button>
      <div class="stg-history"><button type="button" data-action="undo" title="Undo the last animation change (Ctrl+Z)" aria-label="Undo animation change">↶</button><button type="button" data-action="redo" title="Redo the last animation change (Ctrl+Shift+Z)" aria-label="Redo animation change">↷</button></div>
    </div>
    <div class="stg-footer"><span class="stg-status" role="status" aria-live="polite"></span><span class="stg-help">Click a curve to edit · G move · X delete · T easing · Wheel zoom · Alt-drag pan</span></div>`;
  container.append(root);
  const $ = (selector) => root.querySelector(selector);
  const canvas = $('canvas'), ctx = canvas.getContext('2d');
  const frameInput = $('.stg-key-frame'), valueInput = $('.stg-key-value'), modeInput = $('select');
  let axis = 'x', selected = new Set(), state, identity, drag = null, disposed = false, paint = 0, mouse = null;
  // Visibility is view state only. Never write it to animation channels or bake data.
  const hiddenAxes = new Set();
  let width = 600, height = 220, view = { f0: -1, f1: 30, v0: -10, v1: 10 };
  let error = '', normalStatus = '', curveCacheSignature = '', curveCache = {};
  const plot = () => ({ l: 58, t: 20, r: width - 14, b: height - 28 });
  const xOf = (f) => { const p = plot(); return p.l + (f - view.f0) / (view.f1 - view.f0) * (p.r - p.l); };
  const yOf = (v) => { const p = plot(); return p.b - (v - view.v0) / (view.v1 - view.v0) * (p.b - p.t); };
  const frameAt = (x) => { const p = plot(); return view.f0 + (x - p.l) / (p.r - p.l) * (view.f1 - view.f0); };
  const valueAt = (y) => { const p = plot(); return view.v1 - (y - p.t) / (p.b - p.t) * (view.v1 - view.v0); };
  const editable = () => !!state?.group;
  const group = () => state?.group || state?.displayGroup || {};
  const keys = () => group()[axis] || [];
  const visibleKeys = () => hiddenAxes.has(axis) ? [] : keys();
  const selectedKeys = () => keys().filter((key) => selected.has(key.f));
  const button = (name) => $(`[data-action="${name}"]`);
  function requestPaint() { if (!paint && !disposed) paint = requestAnimationFrame(() => { paint = 0; draw(); }); }
  function status(message = '') {
    error = message;
    const el = $('.stg-status'), text = error || normalStatus;
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('stg-error', !!error);
  }
  function fit(onlySelected = false) {
    const fitKeys = onlySelected ? selectedKeys() : AXES.filter((a) => !hiddenAxes.has(a)).flatMap((a) => group()[a] || []);
    if (onlySelected && !fitKeys.length) return;
    let lo = 0, hi = Math.max(1, (state?.frames || 2) - 1);
    if (onlySelected) { lo = Math.min(...fitKeys.map((k) => k.f)); hi = Math.max(...fitKeys.map((k) => k.f)); }
    const span = Math.max(4, hi - lo), center = (hi + lo) / 2;
    view.f0 = center - span * 0.56; view.f1 = center + span * 0.56;
    let v0 = fitKeys.length ? Math.min(...fitKeys.map((k) => k.v)) : 0;
    let v1 = fitKeys.length ? Math.max(...fitKeys.map((k) => k.v)) : 0;
    const vspan = Math.max(v1 - v0, state?.unit === 'degrees' ? 10 : 2), vc = (v0 + v1) / 2;
    view.v0 = vc - vspan * 0.65; view.v1 = vc + vspan * 0.65;
    requestPaint();
  }
  function updateControls() {
    const picked = selectedKeys(), enabled = editable() && !hiddenAxes.has(axis);
    $('.stg-label').textContent = state?.label || 'Select a joint';
    $('.stg-label').title = state?.label || '';
    $('.stg-notice').hidden = editable();
    $('.stg-notice > span').textContent = state?.active ? 'Click a curve to edit its timing and easing.' : 'Select an editable animation to work with its curves.';
    button('enable').hidden = !state?.active;
    button('enable').disabled = !state?.active;
    for (const el of root.querySelectorAll('[data-axis]')) {
      const active = el.dataset.axis === axis;
      el.classList.toggle('on', active); el.setAttribute('aria-pressed', String(active));
    }
    for (const el of root.querySelectorAll('[data-visible-axis]')) {
      const a = el.dataset.visibleAxis, visible = !hiddenAxes.has(a);
      el.classList.toggle('stg-hidden-axis', !visible);
      el.setAttribute('aria-pressed', String(visible));
      el.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${a.toUpperCase()} curve`);
      el.title = `${visible ? 'Hide' : 'Show'} ${a.toUpperCase()} curve (display only)`;
    }
    for (const el of root.querySelectorAll('[data-target]')) {
      const active = el.dataset.target === (state?.target || 'rotation');
      el.classList.toggle('on', active); el.setAttribute('aria-pressed', String(active));
      if (el.dataset.target === 'position') { el.textContent = state?.ik ? 'Position' : 'Body position'; el.title = state?.ik ? 'Edit the selected IK controller position' : 'Edit the character position'; }
      if (el.dataset.target === 'pole') el.hidden = !state?.ik;
    }
    const one = enabled && picked.length === 1;
    frameInput.disabled = valueInput.disabled = !one;
    frameInput.max = String(state?.frames || 1);
    if (document.activeElement !== frameInput) frameInput.value = one ? String(picked[0].f + 1) : '';
    if (document.activeElement !== valueInput) valueInput.value = one ? number(picked[0].v) : '';
    $('.stg-unit').textContent = state?.unit === 'degrees' ? 'Degrees' : 'Units';
    modeInput.disabled = !enabled || !picked.length;
    modeInput.value = !picked.length ? 'smooth' : picked.every((k) => (k.mode || 'smooth') === (picked[0].mode || 'smooth')) ? (picked[0].mode || 'smooth') : 'mixed';
    button('add').disabled = !enabled;
    button('duplicate').disabled = button('delete').disabled = !enabled || !picked.length;
    button('fit-selected').disabled = !picked.length;
    button('undo').disabled = !state?.canUndo;
    button('redo').disabled = !state?.canRedo;
    normalStatus = `${axis.toUpperCase()} · ${keys().length} ${keys().length === 1 ? 'key' : 'keys'}${picked.length ? ` · ${picked.length} selected` : ''}${hiddenAxes.has(axis) ? ' · curve hidden' : editable() ? '' : ' · preview'}`;
    status(error);
  }
  function refresh() {
    if (disposed) return;
    state = callbacks.getState();
    const nextIdentity = JSON.stringify([state?.animationId, state?.groupKey, state?.target]);
    if (identity !== nextIdentity) {
      const canceled = drag; drag = null; identity = nextIdentity;
      if (canceled && canvas.hasPointerCapture(canceled.id)) canvas.releasePointerCapture(canceled.id);
      canvas.classList.remove('stg-grabbing');
      if (canceled?.begun) callbacks.onCancel();
      selected.clear(); error = ''; fit();
    }
    if (!drag) selected = new Set([...selected].filter((f) => keys().some((k) => k.f === f)));
    updateControls(); requestPaint();
  }
  function change(transform) {
    if (!editable() || hiddenAxes.has(axis)) return;
    let begun = false;
    const previousSelection = new Set(selected);
    try {
      const result = transform(copy(state.group));
      if (!result) return;
      callbacks.onBegin(); begun = true;
      if (result.selected) selected = new Set(result.selected);
      callbacks.onPreview(result.group); callbacks.onCommit();
      status(); refresh();
    } catch (e) {
      if (begun) callbacks.onCancel();
      selected = previousSelection;
      status(e.message || 'The keys could not be changed.'); refresh();
      const picked = selectedKeys();
      frameInput.value = picked.length === 1 ? String(picked[0].f + 1) : '';
      valueInput.value = picked.length === 1 ? number(picked[0].v) : '';
    }
  }
  function addKey() {
    change((next) => {
      const f = clamp(Math.round(state.frame || 0), 0, Math.max(0, state.frames - 1));
      const v = sampleCurve(next[axis], f, { loop: state.loop, frames: state.frames });
      next[axis] = upsertKey(next[axis], { f, v });
      return { group: next, selected: [f] };
    });
  }
  function duplicate() {
    if (!selected.size) return;
    change((next) => {
      const first = Math.min(...selected), target = clamp(Math.round(state.frame || 0), 0, Math.max(0, state.frames - 1));
      next[axis] = duplicateKeys(next[axis], [...selected], target, state.frames);
      return { group: next, selected: [...selected].map((f) => f + target - first) };
    });
  }
  function remove() {
    if (!selected.size) return;
    change((next) => { next[axis] = deleteKeys(next[axis], [...selected]); return { group: next, selected: [] }; });
  }
  function setAxis(nextAxis) {
    if (disposed || !AXES.includes(nextAxis)) return;
    if (drag) release({}, true);
    const changed = axis !== nextAxis;
    axis = nextAxis;
    hiddenAxes.delete(axis);
    if (changed) selected.clear();
    status();
    if (changed) callbacks.onAxis?.(axis);
    refresh();
  }
  function toggleVisibility(a) {
    if (!AXES.includes(a)) return;
    if (drag) release({}, true);
    if (hiddenAxes.has(a)) hiddenAxes.delete(a); else hiddenAxes.add(a);
    if (a === axis) selected.clear();
    status(); updateControls(); requestPaint();
  }
  root.addEventListener('click', (e) => {
    const el = e.target.closest('button'); if (!el || !root.contains(el) || el.disabled) return;
    if (el.dataset.axis) { setAxis(el.dataset.axis); return; }
    if (el.dataset.visibleAxis) { toggleVisibility(el.dataset.visibleAxis); return; }
    if (el.dataset.target) { callbacks.onTarget(el.dataset.target); refresh(); return; }
    switch (el.dataset.action) {
      case 'fit': fit(); break;
      case 'fit-selected': fit(true); break;
      case 'enable': callbacks.onEnable(); refresh(); break;
      case 'maximize': callbacks.onMaximize?.(); break;
      case 'add': addKey(); break;
      case 'duplicate': duplicate(); break;
      case 'delete': remove(); break;
      case 'undo': callbacks.onUndo(); refresh(); break;
      case 'redo': callbacks.onRedo(); refresh(); break;
    }
  });
  frameInput.addEventListener('change', () => {
    const picked = selectedKeys(); if (picked.length !== 1) return;
    const entered = Number(frameInput.value);
    if (!frameInput.value || !Number.isFinite(entered) || !Number.isInteger(entered) || entered < 1 || entered > state.frames) {
      status(`Choose a whole frame from 1 to ${state.frames}.`); frameInput.value = String(picked[0].f + 1); return;
    }
    change((next) => { next[axis] = moveKeys(next[axis], [...selected], entered - 1 - picked[0].f, 0, state.frames); return { group: next, selected: [entered - 1] }; });
  });
  valueInput.addEventListener('change', () => {
    const picked = selectedKeys(); if (picked.length !== 1) return;
    const entered = Number(valueInput.value);
    if (!valueInput.value || !Number.isFinite(entered)) { status('Enter a finite value.'); valueInput.value = number(picked[0].v); return; }
    change((next) => { next[axis] = moveKeys(next[axis], [...selected], 0, entered - picked[0].v, state.frames); return { group: next }; });
  });
  modeInput.addEventListener('change', () => {
    const mode = modeInput.value;
    if (!['smooth', 'linear', 'hold'].includes(mode)) return;
    change((next) => { next[axis] = next[axis].map((k) => selected.has(k.f) ? { ...k, mode } : k); return { group: next }; });
  });
  function position(e) { const rect = canvas.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }
  function seek(x) { callbacks.onSeek(clamp(Math.round(frameAt(x)), 0, Math.max(0, (state?.frames || 1) - 1))); requestPaint(); }
  function release(e, cancel = false) {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const ended = drag; drag = null;
    if (canvas.hasPointerCapture(ended.id)) canvas.releasePointerCapture(ended.id);
    canvas.classList.remove('stg-grabbing');
    if (ended.begun) {
      if (cancel) { callbacks.onCancel(); selected = new Set(ended.selection); }
      else callbacks.onCommit();
    }
    if (!cancel && ended.kind === 'box') {
      if (!ended.moved) { if (!ended.add) selected.clear(); seek(ended.x); }
      else {
        const left = Math.min(ended.x, ended.cx), right = Math.max(ended.x, ended.cx), top = Math.min(ended.y, ended.cy), bottom = Math.max(ended.y, ended.cy);
        selected = new Set(ended.add ? ended.selection : []);
        for (const key of visibleKeys()) if (xOf(key.f) >= left && xOf(key.f) <= right && yOf(key.v) >= top && yOf(key.v) <= bottom) selected.add(key.f);
      }
    }
    refresh();
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (drag?.modal) { e.preventDefault(); release({}, e.button !== 0); return; }     // G: a click places, right click cancels
    if (drag || (e.button !== 0 && e.button !== 1)) return;
    e.preventDefault(); canvas.focus({ preventScroll: true });
    const { x, y } = position(e), p = plot();
    const base = { id: e.pointerId, x, y, cx: x, cy: y, moved: false, selection: [...selected], view: { ...view } };
    if (e.button === 1 || e.altKey) { drag = { ...base, kind: 'pan' }; canvas.classList.add('stg-grabbing'); }
    else if (y < p.t || y > p.b) { drag = { ...base, kind: 'seek' }; seek(x); }
    else {
      if (!editable() && state?.active && e.button === 0 && !e.altKey) { callbacks.onEnable(); refresh(); }
      const hit = visibleKeys().map((key) => ({ key, d: Math.hypot(xOf(key.f) - x, yOf(key.v) - y) })).filter((k) => k.d <= 10).sort((a, b) => a.d - b.d)[0]?.key;
      if (hit) {
        if (e.shiftKey) { if (selected.has(hit.f)) selected.delete(hit.f); else selected.add(hit.f); }
        else if (!selected.has(hit.f)) selected = new Set([hit.f]);
        if (editable() && selected.has(hit.f)) drag = { ...base, kind: 'keys', original: copy(state.group), selection: [...selected], df: 0, dv: 0 };
      } else drag = { ...base, kind: 'box', add: e.shiftKey };
      status(); updateControls(); requestPaint();
    }
    if (drag) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) { mouse = position(e); return; }
    if (!drag.modal && e.pointerId !== drag.id) return;
    const { x, y } = position(e); drag.cx = x; drag.cy = y;
    const dx = x - drag.x, dy = y - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.kind === 'pan') {
      const p = plot(), df = dx / (p.r - p.l) * (drag.view.f1 - drag.view.f0), dv = dy / (p.b - p.t) * (drag.view.v1 - drag.view.v0);
      view = { f0: drag.view.f0 - df, f1: drag.view.f1 - df, v0: drag.view.v0 + dv, v1: drag.view.v1 + dv }; requestPaint();
    } else if (drag.kind === 'seek') seek(x);
    else if (drag.kind === 'keys' && drag.moved) {
      let df = Math.round(frameAt(x) - frameAt(drag.x)), dv = valueAt(y) - valueAt(drag.y);
      if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dv = 0; else df = 0; }
      df = clamp(df, -Math.min(...drag.selection), state.frames - 1 - Math.max(...drag.selection));
      dv = Math.round(dv * 1000) / 1000;
      if (df === drag.df && dv === drag.dv) return;
      try {
        const next = copy(drag.original);
        next[axis] = moveKeys(next[axis], drag.selection, df, dv, state.frames);
        if (!drag.begun) { callbacks.onBegin(); drag.begun = true; }
        drag.df = df; drag.dv = dv; selected = new Set(drag.selection.map((f) => f + df));
        callbacks.onPreview(next); status(); refresh();
      } catch (err) { status(err.message || 'That frame already has a key.'); }
    } else if (drag.kind === 'box') requestPaint();
  });
  canvas.addEventListener('pointerup', (e) => release(e));
  canvas.addEventListener('pointercancel', (e) => release(e, true));
  canvas.addEventListener('lostpointercapture', (e) => { if (drag?.id === e.pointerId) release(e, true); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); if (drag) return;
    const { x, y } = position(e), f = frameAt(x), v = valueAt(y), factor = Math.exp(clamp(e.deltaY, -200, 200) * 0.0025);
    const fspan = clamp((view.f1 - view.f0) * factor, 2, Math.max(200, (state?.frames || 30) * 20));
    const vspan = clamp((view.v1 - view.v0) * factor, 0.001, 1e8);
    if (!e.ctrlKey && !e.metaKey) {
      const ratio = (f - view.f0) / (view.f1 - view.f0); view.f0 = f - fspan * ratio; view.f1 = view.f0 + fspan;
    }
    if (!e.shiftKey) {
      const ratio = (v - view.v0) / (view.v1 - view.v0); view.v0 = v - vspan * ratio; view.v1 = view.v0 + vspan;
    }
    requestPaint();
  }, { passive: false });
  function draw() {
    if (!state || !ctx) return;
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1, pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(root), css = (key, fallback) => style.getPropertyValue(key).trim() || fallback;
    const bg = css('--field', '#0b1625'), grid = css('--line', '#2b415a'), dim = css('--dim', '#9badc3'), ink = css('--text', '#dce6f1'), accent = css('--acc', '#89b9e8');
    const p = plot(); ctx.clearRect(0, 0, width, height); ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    ctx.font = '10px "Segoe UI",sans-serif'; ctx.lineWidth = 1;
    const frameStep = Math.max(1, tickStep(view.f1 - view.f0, p.r - p.l, 64)), valueStep = tickStep(view.v1 - view.v0, p.b - p.t, 36);
    const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    ctx.save(); ctx.beginPath(); ctx.rect(p.l, p.t, p.r - p.l, p.b - p.t); ctx.clip();
    ctx.fillStyle = '#0002'; ctx.fillRect(p.l, p.t, Math.max(0, xOf(0) - p.l), p.b - p.t); ctx.fillRect(xOf(state.frames - 1), p.t, Math.max(0, p.r - xOf(state.frames - 1)), p.b - p.t);
    ctx.strokeStyle = grid; ctx.globalAlpha = 0.5;
    for (let f = Math.ceil((view.f0 + 1) / frameStep) * frameStep - 1; f <= view.f1; f += frameStep) line(xOf(f), p.t, xOf(f), p.b);
    for (let v = Math.ceil(view.v0 / valueStep) * valueStep; v <= view.v1 + valueStep * 0.0001; v += valueStep) line(p.l, yOf(v), p.r, yOf(v));
    ctx.globalAlpha = 0.9; line(p.l, yOf(0), p.r, yOf(0));
    const start = Math.max(0, view.f0), end = Math.min(Math.max(0, state.frames - 1), view.f1);
    // Playback changes only the playhead. Reuse the sampled curve geometry until
    // its keys or view change, rather than re-evaluating every key on every frame.
    const signature = JSON.stringify([group(), state.frames, state.loop, view, width, height]);
    if (signature !== curveCacheSignature) {
      curveCacheSignature = signature; curveCache = {};
      for (const a of AXES) {
        const values = group()[a] || []; if (!values.length || end < start) continue;
        const steps = Math.max(2, Math.ceil(p.r - p.l)), samples = [start, end];
        for (let i = 1; i < steps; i++) samples.push(start + (end - start) * i / steps);
        for (const key of values) if (key.f > start && key.f <= end) samples.push(Math.max(start, key.f - 0.000001), key.f);
        samples.sort((a, b) => a - b);
        curveCache[a] = samples.map((f) => [xOf(f), yOf(sampleCurve(values, f, { loop: state.loop, frames: state.frames }))]);
      }
    }
    for (const a of [...AXES.filter((a) => a !== axis), axis]) {
      if (hiddenAxes.has(a)) continue;
      const values = group()[a] || []; if (!values.length || end < start) continue;
      ctx.strokeStyle = COLORS[a]; ctx.globalAlpha = a === axis ? 1 : 0.28; ctx.lineWidth = a === axis ? 1.8 : 1.2;
      ctx.beginPath();
      (curveCache[a] || []).forEach(([x, y], i) => { if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
      if (a !== axis) continue;
      for (const key of values) {
        const x = xOf(key.f), y = yOf(key.v), picked = selected.has(key.f), r = picked ? 5.2 : 4.1;
        ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
        ctx.fillStyle = picked ? ink : bg; ctx.fill(); ctx.strokeStyle = picked ? ink : COLORS[a]; ctx.lineWidth = 1.2; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeStyle = accent; line(xOf(state.frame || 0), p.t, xOf(state.frame || 0), p.b);
    if (drag?.kind === 'box' && drag.moved) {
      ctx.fillStyle = `${accent}20`; ctx.fillRect(drag.x, drag.y, drag.cx - drag.x, drag.cy - drag.y);
      ctx.setLineDash([4, 3]); ctx.strokeRect(drag.x, drag.y, drag.cx - drag.x, drag.cy - drag.y); ctx.setLineDash([]);
    }
    ctx.restore(); ctx.fillStyle = dim; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(view.v0 / valueStep) * valueStep; v <= view.v1 + valueStep * 0.0001; v += valueStep) ctx.fillText(number(v), p.l - 9, yOf(v));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let f = Math.ceil((view.f0 + 1) / frameStep) * frameStep - 1; f <= view.f1; f += frameStep) ctx.fillText(String(Math.round(f + 1)), xOf(f), p.b + 9);
    ctx.textAlign = 'left'; ctx.fillStyle = dim; ctx.fillText(state.unit === 'degrees' ? 'degrees' : 'units', 7, 4);
    const px = xOf(state.frame || 0);
    if (px >= p.l && px <= p.r) {
      ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(px - 4, p.t - 7); ctx.lineTo(px + 4, p.t - 7); ctx.lineTo(px, p.t); ctx.closePath(); ctx.fill();
      ctx.textAlign = 'center'; ctx.fillText(String(Math.round(state.frame || 0) + 1), px, 2);
    }
  }
  function keyDown(e) {
    // One pointer gesture owns one undo transaction. Do not let Delete, Duplicate,
    // playback, Save or focus navigation start a second action halfway through it.
    if (drag) {
      e.preventDefault();
      if (e.key === 'Escape') release({}, true);
      else if (e.key === 'Enter' && drag.modal) release({});
      return true;
    }
    if (!root.contains(document.activeElement)) return false;
    if (e.target instanceof HTMLElement && e.target.matches('input,textarea,select')) return false;
    const modified = e.ctrlKey || e.metaKey;
    let handled = true;
    const key = e.key.toLowerCase();
    if (e.key === 'Delete' || e.key === 'Backspace' || (key === 'x' && !modified)) remove();
    else if ((modified || e.shiftKey) && key === 'd') duplicate();
    else if (e.key === 'Home') fit();
    else if ((key === 'f' && !modified) || e.code === 'NumpadDecimal') fit(selected.size > 0);
    else if (key === 'i' && !modified) addKey();
    else if (key === 't' && !modified && !modeInput.disabled) { modeInput.focus(); modeInput.showPicker?.(); }
    else if (key === 'g' && !modified && !e.altKey) grab();
    else if (key === 'a' && e.altKey) { selected.clear(); updateControls(); requestPaint(); }
    else if (key === 'a' && !modified) { selected = new Set(visibleKeys().map((k) => k.f)); updateControls(); requestPaint(); }
    else if (e.key === 'Escape' && selected.size) { selected.clear(); updateControls(); requestPaint(); }
    else handled = false;
    if (handled) e.preventDefault();
    return handled;
  }
  // G (Blender's grab): the selected keys follow the mouse until a click or Enter; Esc or a right click puts them back
  function grab() {
    if (!editable() || hiddenAxes.has(axis) || !selected.size || !mouse) return;
    drag = { id: -1, modal: true, kind: 'keys', x: mouse.x, y: mouse.y, cx: mouse.x, cy: mouse.y, moved: true,
      selection: [...selected], original: copy(state.group), df: 0, dv: 0, view: { ...view } };
    canvas.classList.add('stg-grabbing');
    status('Move the mouse: a click or Enter places the keys, Esc or a right click puts them back (Shift: one direction).');
  }
  const resize = new ResizeObserver(requestPaint); resize.observe(canvas);
  refresh();
  return {
    refresh, keyDown, setAxis, fit,
    setMaximized(on) {
      const b = button('maximize'), label = on ? 'Give the Studio back its view' : 'Maximize the Graph editor';
      b.setAttribute('aria-pressed', String(!!on)); b.innerHTML = on ? RESTORE : MAXIMIZE;
      b.setAttribute('aria-label', label); b.title = label + ' (Ctrl+Space)';
    },
    destroy() {
      if (disposed) return;
      if (drag) release({}, true);
      disposed = true; resize.disconnect(); if (paint) cancelAnimationFrame(paint);
      root.remove();
    },
  };
}
