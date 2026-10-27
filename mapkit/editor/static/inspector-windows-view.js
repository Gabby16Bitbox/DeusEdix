// Properties… windows: a tool window each (tool-window.js, not modal: the editor stays usable around it) with the
// Inspector of one object, drawn in its own #details by app.js's showDetails, the panel's code: the same sections, the
// same styles, the same ids (app.js looks in the window at work first, see its inspectorView). They follow every change
// made anywhere (undo, the gizmo, the panel, another window): drawn again in the next frame, and the numbers at once
// while something is dragged; a window whose field is being typed in waits until it is left. A window whose object is
// gone (deleted, or its map closed) closes. Dragged by its title, resized by its corner, at most MAX_WINDOWS.
//
// object(view): its object now, or null (app.js heldObject of view.key and view.generation); title(p): its name;
// render(view, live): its Inspector drawn (app.js showDetails); wire(el): the Inspector's own drags, maths and right
// click on its #details (app.js wireInspectorBody); status(text, kind): the status bar.
import { attachToolWindow } from './tool-window.js';
import { MAX_WINDOWS, windowFor, toFront, cascade } from './inspector-windows.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./inspector-windows.css', import.meta.url).href;
document.head.appendChild(css);
const $ = (s, el = document) => el.querySelector(s);
// a field being typed in: drawing its window again now would take the text away
const TYPING = 'textarea, select, [contenteditable], input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=button], [type=file])';
const px = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;

export function createInspectorWindows({ object, title, render, wire, status }) {
  let list = [], frame = 0;            // the windows, the one used longest ago first; the next frame's drawing
  // their layer (inspector-windows.css): over the panels and the 3D view's boxes, under the menu bar's menus
  const host = Object.assign(document.createElement('div'), { className: 'inspector-windows' });
  // the window an element is in (an event's target may be the page or the window itself)
  const viewAt = (target) => (target instanceof Node ? list.find((w) => w.root.contains(target)) || null : null);
  const typing = (w) => w.root.contains(document.activeElement) && document.activeElement.matches(TYPING);

  // the window of this object (key, in the map of that generation): its own if it is open, else a new one
  function open(key, generation) {
    const { open: shown, close: oldest } = windowFor(list, key, generation);
    if (shown) { front(shown); return shown; }
    if (oldest) { close(oldest); status(`At most ${MAX_WINDOWS} Properties windows: the one of ${oldest.name} is closed.`, 'warn'); }
    const root = document.createElement('section');
    root.className = 'inspector-window';
    root.innerHTML = '<div class="iw-head"><b></b><button type="button" class="iw-close" aria-label="Close" title="Close">×</button></div><div class="iw-body"><div id="details"></div></div>';
    if (!host.isConnected) document.body.appendChild(host);
    host.appendChild(root);
    const view = { key, generation, root, body: $('.iw-body', root), name: '', stale: false,
      // a lookup of its Inspector: in it, else in the page, but never in another Inspector (the panel's, another window's)
      find: (s) => {
        const own = view.body.querySelector(s), hit = own || document.querySelector(s);
        return own || (hit && !hit.closest('#details') ? hit : null);
      } };
    attachToolWindow(root, $('.iw-head', root), $('.iw-close', root), { modal: false });
    $('.iw-close', root).onclick = () => close(view);
    const at = cascade(list.length, { width: innerWidth, height: innerHeight, panel: px('--rw'), top: px('--top-h') });
    place(view, at.x, at.y);
    root.addEventListener('pointerdown', () => front(view), true);
    // left with a change waiting (it was typed in): drawn now
    root.addEventListener('focusout', (e) => { if (view.stale && !root.contains(e.relatedTarget)) follow(false); });
    drag(view);
    list = [...list, view];
    front(view);
    wire($('#details', root));
    draw(view);
    return view;
  }
  function close(view) {
    view.root.remove();
    list = list.filter((w) => w !== view);
  }
  function closeAll() { for (const w of list) close(w); }
  // used last: on top of the others, and the last to close for a new one
  function front(view) {
    list = toFront(list, view);
    list.forEach((w, i) => { w.root.style.zIndex = String(1 + i); });
  }
  function place(view, x, y) {
    const r = view.root.getBoundingClientRect();
    view.root.style.left = Math.round(Math.max(0, Math.min(x, innerWidth - r.width))) + 'px';
    view.root.style.top = Math.round(Math.max(0, Math.min(y, innerHeight - 32))) + 'px';
  }
  // its title held down and dragged moves it (not while maximized)
  function drag(view) {
    const head = $('.iw-head', view.root);
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || view.root.classList.contains('tool-maximized')) return;
      e.preventDefault();
      const r = view.root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = (m) => place(view, m.clientX - dx, m.clientY - dy);
      const end = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', end); head.removeEventListener('pointercancel', end); };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', end);
      head.addEventListener('pointercancel', end);
    });
  }
  // its object's Inspector drawn, with its name in the title; its object gone: it closes
  function draw(view) {
    const p = object(view);
    if (!p) { close(view); return; }
    view.stale = false;
    view.name = title(p);
    $('b', view.root).textContent = `Properties: ${view.name}`;
    view.root.setAttribute('aria-label', `Properties of ${view.name}`);
    render(view, false);
  }
  // after any change: live (something dragged), the numbers of each at once; else each drawn in the next frame, once
  function follow(live) {
    if (!list.length) return;
    if (live) { for (const w of list) if (object(w)) render(w, true); return; }
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      for (const w of list) if (typing(w)) w.stale = true; else draw(w);
    });
  }
  window.addEventListener('deusedix:edits', () => follow(false));
  window.addEventListener('deusedix:map-state', (e) => { if (!e.detail?.open) closeAll(); });
  return { open, follow, viewAt, closeAll, get count() { return list.length; } };
}
