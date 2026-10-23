// Tutorial annotations live outside the scene: they never become map objects or enter a film.
import { Vector3 } from 'three';
import { createTutorialRevealer } from './tutorial-reveal.js';
import { createTutorialSelect } from './tutorial-select.js';

export { lessonCues } from './tutorial-cues.js';
const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

const css = document.createElement('style');
css.textContent = `
#tut-focus { position:fixed; inset:0; width:100%; height:100%; pointer-events:none; z-index:10000; overflow:hidden; }
#tut-focus .tut-ring { fill:none; stroke:#ffe196; stroke-width:3; filter:drop-shadow(0 1px 2px #000); animation:tut-pulse 1.5s ease-in-out infinite; }
#tut-focus .tut-echo { fill:none; stroke:#ffe196; stroke-width:2; transform-box:fill-box; transform-origin:center; animation:tut-ripple 1.5s ease-out infinite; }
#tut-focus .tut-surface { fill:#ffe196; fill-opacity:.12; stroke:#ffe196; stroke-width:2; }
#tut-focus text { fill:#fff0bc; stroke:#171917; stroke-width:4px; paint-order:stroke; font:600 12px system-ui,sans-serif; text-anchor:middle; }
@keyframes tut-pulse { 50% { opacity:.5; stroke-width:5; } }
@keyframes tut-ripple { from { opacity:.65; transform:scale(1); } to { opacity:0; transform:scale(1.16); } }
@media (prefers-reduced-motion:reduce) { #tut-focus .tut-ring, #tut-focus .tut-echo { animation:none; } #tut-focus .tut-echo { display:none; } }
`;
document.head.appendChild(css);
const ns = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  parent?.appendChild(el);
  return el;
}
const layer = svg('svg', { id: 'tut-focus', 'aria-hidden': 'true' }, document.body);
const clip = svg('clipPath', { id: 'tut-viewport-clip' }, svg('defs', {}, layer));
const clipRect = svg('rect', {}, clip);
const worldLayer = svg('g', { 'clip-path': 'url(#tut-viewport-clip)' }, layer);
const polygon = svg('polygon', { class: 'tut-surface' }, worldLayer);
function ring(parent) {
  const group = svg('g', {}, parent);
  return { group, main: svg('ellipse', { class: 'tut-ring' }, group), echo: null };
}
const worldRing = ring(worldLayer);
const label = svg('text', {}, worldLayer);
const controls = svg('g', {}, layer), rings = new Map();
let cues = null, editor = null, enabled = () => false, frame = 0;
const revealer = createTutorialRevealer();
const choiceGuide = createTutorialSelect();
let revealKey = '';
let worldAvoidRect = null;

function ellipse(ring, rect) {
  for (const el of [ring.main]) {
    el.setAttribute('cx', rect.x + rect.width / 2);
    el.setAttribute('cy', rect.y + rect.height / 2);
    el.setAttribute('rx', Math.max(14, rect.width / 2 + 7));
    el.setAttribute('ry', Math.max(14, rect.height / 2 + 7));
  }
}

function worldFocus() {
  worldAvoidRect = null;
  const focus = cues.placement || cues.world, camera = editor?.camera, canvas = editor?.renderer?.domElement;
  worldLayer.style.display = 'none';
  if (!focus || !camera || !canvas) return;
  const view = canvas.getBoundingClientRect();
  if (!view.width || !view.height) return;
  for (const key of ['x', 'y', 'width', 'height']) clipRect.setAttribute(key, view[key]);
  let points;
  if (focus.bounds) {
    const [x0, y0, x1, y1, z = 2] = focus.bounds;
    // Project a real floor-plane circle, so it stays attached to the floor as the view moves.
    points = focus.shape === 'circle' ? Array.from({length:48}, (_, i) => {
      const angle = i * Math.PI * 2 / 48;
      return [(x0+x1)/2 + Math.cos(angle)*(x1-x0)/2, z, (y0+y1)/2 + Math.sin(angle)*(y1-y0)/2];
    }) : [[x0, z, y0], [x1, z, y0], [x1, z, y1], [x0, z, y1]];
  } else {
    const proxy = editor.proxies?.children.find(p => p.userData.actor?.name === focus.actor);
    if (!proxy || !proxy.visible) return;
    const actor = proxy.userData.actor, p = proxy.getWorldPosition(new Vector3());
    const scale = proxy.getWorldScale(new Vector3());
    const r = Math.max(8, actor.radius || 16) * Math.abs(scale.x);
    const h = Math.max(8, actor.height || 16) * Math.abs(scale.y);
    points = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [p.x + x*r, p.y + y*h, p.z + z*r])));
  }
  const projected = points.map(p => new Vector3(...p).project(camera));
  // Do not draw a marker across the screen when its target is behind the camera/near plane.
  if (projected.some(p => p.z < -1 || p.z > 1 || !Number.isFinite(p.x))) return;
  const screen = projected.map(p => [view.x + (p.x + 1)*view.width/2, view.y + (1-p.y)*view.height/2]);
  const xs = screen.map(p => p[0]), ys = screen.map(p => p[1]);
  const rect = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs)-Math.min(...xs), height: Math.max(...ys)-Math.min(...ys) };
  const cx = rect.x + rect.width/2, cy = rect.y + rect.height/2;
  if (cx < view.left || cx > view.right || cy < view.top || cy > view.bottom) return;
  worldAvoidRect = { left:Math.max(view.left, rect.x), top:Math.max(view.top, rect.y),
    right:Math.min(view.right, rect.x + rect.width), bottom:Math.min(view.bottom, rect.y + rect.height) };
  if (document.elementFromPoint(cx, cy) !== canvas) return;
  worldLayer.style.display = '';
  worldRing.group.style.display = focus.shape === 'circle' ? 'none' : '';
  if (focus.shape !== 'circle') ellipse(worldRing, rect);
  polygon.style.display = focus.bounds ? '' : 'none';
  if (focus.bounds) polygon.setAttribute('points', screen.map(p => p.join(',')).join(' '));
  label.textContent = focus.label || '';
  label.setAttribute('x', Math.max(view.left + 100, Math.min(view.right - 100, cx)));
  label.setAttribute('y', Math.max(view.top + 20, rect.y - 18));
}

function draw() {
  frame = 0;
  if (!cues) return;
  const show = enabled() && !document.hidden;
  if (!show) choiceGuide.close();
  layer.style.display = show ? '' : 'none';
  if (show) {
    const wanted = new Set();
    const avoidRects = [];
    targets: for (const selector of cues.selectors) for (const el of document.querySelectorAll(selector)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect(), at = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
      if (el.matches(':disabled')) continue;
      avoidRects.push(r);
      if (!at || !el.contains(at)) continue;
      wanted.add(el);
      if (!rings.has(el)) rings.set(el, ring(controls));
      ellipse(rings.get(el), r);
      break targets; // One actionable target, even when a selector matches many items.
    }
    for (const [el, r] of rings) if (!wanted.has(el)) { r.group.remove(); rings.delete(el); }
    if (!cues.selectors.length || cues.placement) worldFocus();
    else { worldLayer.style.display = 'none'; worldAvoidRect = null; }
    if (worldAvoidRect) avoidRects.push(worldAvoidRect);
    window.__tutorial?.avoid?.(avoidRects);
  }
  frame = requestAnimationFrame(draw);
}

export function focusLesson(next, ed, isEnabled, revealAgain = false) {
  choiceGuide.update(next?.choice || null, isEnabled);
  const key = next ? JSON.stringify([next.selectors, next.hint, next.world]) : '';
  if (revealAgain || next?.lesson !== cues?.lesson || key !== revealKey) revealer.reset();
  revealKey = key;
  cues = next;
  editor = ed;
  enabled = isEnabled;
  if (next && enabled() && !document.hidden) revealer.reveal(next.selectors, el => {
    if (el.closest('#details')) {
      // showMe selects asynchronously; never consume the cue on the previous object's fields.
      const actor = next.lesson?.show?.startsWith('select:') ? next.lesson.show.slice(7) : null;
      if (actor && editor?.selected?.userData.actor?.name !== actor) return false;
      editor?.revealInspector?.(el);
    } else {
      const panel = el.closest('#right') ? 'inspector' : el.closest('#left') ? 'hierarchy' : el.closest('#bottom') ? 'browser' : null;
      if (panel) window.__workspace?.show(panel); // Also activates an inactive dock tab.
    }
    return true;
  });
  if (!next) {
    revealer.reset();
    cancelAnimationFrame(frame);
    frame = 0;
    layer.style.display = 'none';
    for (const r of rings.values()) r.group.remove();
    rings.clear();
  } else if (!frame) frame = requestAnimationFrame(draw);
}
layer.style.display = 'none';
