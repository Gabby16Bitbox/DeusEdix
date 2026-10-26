// The shortcut helper (Settings > General > Shortcut helper, off at first), as Unity's Shortcut Helper Bar: at the right
// of the status bar, the keys of what the 3D view is doing now (shortcut-help.js: the modes and their keys), changing
// while Shift, Ctrl or Alt are held to what they do then. A click on a key opens Settings > Keyboard shortcuts on it: a
// command on its row, any other key looked up (what it does in each context). Off, it listens to nothing. On, it looks
// at the editor's mode a few times a second (a few flags, never the map's objects) and draws the strip again only when
// the mode, the modifiers held or the keys changed.
// api (menubar.js): keymap (shortcut-help.js), state() (app.js shortcutState, null before the editor), blocked() (a
// window holds the keys: the 3D view's do not work under it), typing(target), open({ action } or { key })
import { modeOf, modsOf, stripFor } from './shortcut-help.js';

const LOOK_MS = 250;            // how often the mode is looked at (a menu, a button or a panel can change it too)
const EVENTS = ['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup'];
export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createShortcutBar(api) {
  const el = document.createElement('span');
  el.id = 'keyhelp';
  el.hidden = true;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Shortcut helper');
  let on = false, mods = '', drawn = '', items = [], timer = 0, soon = 0, version = 0;

  function update() {
    soon = 0;
    const mode = api.blocked() ? '' : modeOf(api.state());
    const now = `${mode}|${mods}|${version}`;
    if (now === drawn) return;
    drawn = now;
    const strip = mode ? stripFor(mode, mods, api.keymap) : null;
    items = strip ? strip.items : [];
    el.hidden = !strip;
    // the mode's name only for the pointer and screen readers: the status says what is going on, the room is the keys'
    el.setAttribute('aria-label', strip ? `Shortcut helper: ${strip.label}${strip.mods ? ` with ${strip.mods}` : ''}` : 'Shortcut helper');
    el.innerHTML = !strip ? '' : items.map((it, i) => `<button type="button" data-i="${i}"`
      + ` title="${escapeHtml(`${strip.label}: ${it.does} (${it.show}). Click: Keyboard shortcuts`)}"><kbd>${escapeHtml(it.show)}</kbd>${escapeHtml(it.label)}</button>`).join('');
  }
  // the modifiers held (not those of typing in a field); after a key or a click the mode is looked at once the editor's
  // own listeners have run (this one runs before them)
  function held(e) {
    const now = e.type.startsWith('key') && api.typing(e.target) ? '' : modsOf(e);
    if (now !== mods) { mods = now; update(); }
    if ((e.type === 'keydown' || e.type === 'pointerup') && !soon) soon = setTimeout(update, 0);
  }
  const rebound = () => { version++; update(); };          // Settings gave a command another key
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'), it = b && items[+b.dataset.i];
    if (it) api.open(it.action ? { action: it.action } : { key: it.keys[0] });
  });

  function show(v) {
    if (v === on) return;
    on = v;
    if (on) {
      for (const type of EVENTS) window.addEventListener(type, held, { capture: true, passive: true });
      window.addEventListener('blur', held);
      window.addEventListener('deusedix:shortcuts', rebound);
      timer = setInterval(update, LOOK_MS);
      drawn = '';
      update();
      return;
    }
    for (const type of EVENTS) window.removeEventListener(type, held, true);
    window.removeEventListener('blur', held);
    window.removeEventListener('deusedix:shortcuts', rebound);
    clearInterval(timer);
    clearTimeout(soon);
    soon = 0; mods = ''; items = [];
    el.hidden = true;
    el.innerHTML = '';
  }
  return { el, show, get on() { return on; } };
}
