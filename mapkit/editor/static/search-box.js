// The Hierarchy's search box: the tokens of the search (scene-search.js) offered under it as small chips while you
// type (the keys, then the values the map has for a key), Up / Down to choose one, Tab or Enter (or a click) to put
// it in; Esc clears the box (and, empty, gives the keys back to the 3D view). changed(): the query is new.
import { searchSuggestions, applySuggestion } from './scene-search.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// input: the search box; list: the element under it for the chips; values(key): what the map has for a key
export function mountSearchBox(input, list, { values = () => [], changed = () => {} } = {}) {
  let offer = null, at = -1;                 // what is offered now (searchSuggestions), the chip chosen with the arrows
  list.setAttribute('role', 'listbox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  function hide() {
    offer = null; at = -1;
    list.hidden = true;
    list.innerHTML = '';
    input.removeAttribute('aria-activedescendant');
  }
  function show() {
    if (document.activeElement !== input) return hide();
    offer = searchSuggestions(input.value, input.selectionStart ?? input.value.length, values);
    at = Math.min(at, offer.items.length - 1);
    if (!offer.items.length) return hide();
    list.hidden = false;
    list.innerHTML = offer.items.map((it, i) => `<button type="button" role="option" id="${list.id}-${i}" data-si="${i}" tabindex="-1"
      class="${i === at ? 'on' : ''}" aria-selected="${i === at}" title="${esc(it.hint || it.label)}">${esc(it.label)}</button>`).join('');
    if (at >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${at}`); else input.removeAttribute('aria-activedescendant');
  }
  function put(item) {
    const next = applySuggestion(input.value, offer, item);
    input.value = next.text;
    input.setSelectionRange(next.caret, next.caret);
    at = -1;
    changed();
    show();                                  // a key put in: its values next
  }
  function set(text) {                       // Find references, Find in map: the box gets a whole query
    input.value = text;
    hide();
    changed(true);
  }
  function clear() {                         // another map: the box empty, with no search of its own (the page draws anew)
    input.value = '';
    hide();
  }
  input.addEventListener('input', () => { at = -1; show(); });
  input.addEventListener('focus', show);
  input.addEventListener('blur', hide);
  input.addEventListener('click', show);     // the caret moved into another piece
  input.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) show(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (input.value) set(''); else input.blur();
    } else if (offer && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = offer.items.length;
      at = e.key === 'ArrowDown' ? (at + 1) % n : (at <= 0 ? n : at) - 1;
      show();
    } else if (offer && ((e.key === 'Enter' && at >= 0) || (e.key === 'Tab' && !e.shiftKey && offer.to > offer.from))) {
      e.preventDefault();
      put(offer.items[Math.max(0, at)]);
    }
  });
  list.addEventListener('pointerdown', (e) => e.preventDefault());       // the box keeps the focus
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-si]'); if (b && offer) put(offer.items[+b.dataset.si]); });
  hide();
  return { set, clear };
}
