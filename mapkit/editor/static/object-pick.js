// The eyedropper of a field that names an object of the map (14 Nov 2026, Gabby: "a dropper so you select the object
// you want it to interact with", then "do all the points"): a button beside the field, and the objects a Tag names in
// words under it. The picking is the page's (app.js pickMapObject: the 3D view, the Hierarchy, or the list with it);
// this module only draws. The same pipette as the colour eyedropper (screen-color-picker.js).
export const PICK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 5 5 5M4 15l9-9 5 5-9 9H4v-5Z"/><path d="m15 5 2-2a2.8 2.8 0 0 1 4 4l-2 2M4 20l-2 2"/></svg>';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// the button: `attrs` are its data- attributes (the page finds it by them)
export function pickButton(attrs = '', title = 'Pick it in the 3D view (eyedropper)') {
  return `<button type="button" class="object-pick" ${attrs} title="${esc(title)}" aria-label="${esc(title)}">${PICK_SVG}</button>`;
}

// "→ Door · Comn Offc Door B, Light 2 and 3 more" under a field: what its Tag reaches; a warning when nothing has it
export function saidHtml(names, { arrow = '→', none = 'no object has this Tag', max = 3 } = {}) {
  if (!names) return '';
  if (!names.length) return `<div class="object-pick-said none">${esc(none)}</div>`;
  const shown = names.slice(0, max).join(', ') + (names.length > max ? ` and ${names.length - max} more` : '');
  return `<div class="object-pick-said" title="${esc(names.join(', '))}">${esc(arrow)} ${esc(shown)}</div>`;
}

// its look, once per page (a test's stand-in document may have no head: nothing to style)
try {
  if (typeof document !== 'undefined' && typeof document.querySelector === 'function' && document.head && !document.querySelector('link[data-object-pick]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('./object-pick.css', import.meta.url).href; css.dataset.objectPick = '';
    document.head.append(css);
  }
} catch { /* no page */ }
