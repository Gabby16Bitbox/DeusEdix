// The Browser's favourites and tile sizes on the page (the rules are browser-favourites.js): the star of a tile, the
// tile of a favourite whose asset is gone, the clicks on the stars, the size slider and Ctrl+wheel over a grid
// (browser-tiles.css draws them). Each browser gets a shelf of its kind and draws its Favourites group with it.
import { FAVOURITES_GROUP, TILE_SIZES, TILE_SIZE_LABELS, DEFAULT_TILE_SIZE, tileSize, stepTileSize, wheelSteps } from './browser-favourites.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>';

// the star of a tile: a span, as the tiles are buttons (a button holds no button); its click is installStars'
function starHtml(kind, id, label, on) {
  return `<span class="fav-star${on ? ' on' : ''}" data-fav-kind="${esc(kind)}" data-fav="${esc(id)}" data-fav-label="${esc(label)}"
    title="${on ? 'Remove from Favourites' : 'Add to Favourites (the group at the top)'}">${STAR}</span>`;
}
// what the tile of a favourite that is gone says
const goneTitle = (fav) => `${fav.label}: no longer in the game or in this project. Its star takes it out of Favourites.`;

// What a browser draws its favourites with (store: browser-favourites.js createFavourites, kind: its list)
export function favouriteShelf(store, kind) {
  return {
    group: FAVOURITES_GROUP,
    list: () => store.list(kind),
    entries: (find) => store.entries(kind, find),               // [{fav, item}], item null when it is gone
    star: (id, label) => starHtml(kind, id, label, store.has(kind, id)),
    goneTitle,
    // the tile of a favourite that is gone, in the Browser's grids: nothing to place, its star unstars it
    missing: (fav) => `<div class="item fav-missing" title="${esc(goneTitle(fav))}"><span class="th fav-gone" aria-hidden="true">?</span>
      <span class="tl">${esc(fav.label)}</span><small>Missing</small>${starHtml(kind, fav.id, fav.label, true)}</div>`,
    subscribe: (fn) => store.subscribe((changed) => { if (changed === kind) fn(); }),
  };
}

// A star clicked anywhere in the page stars or unstars its tile, before the tile's own click (which would place it,
// play it or choose it). Its browser then draws the tiles again: a double click on a star reaches only the star that
// was there and its old tile, so a tile with a double click of its own leaves the stars alone (the texture picker's).
export function installStars(store) {
  const starOf = (e) => e.target.closest?.('.fav-star[data-fav]');
  document.addEventListener('click', (e) => {
    const star = starOf(e);
    if (!star) return;
    e.preventDefault(); e.stopPropagation();
    store.toggle(star.dataset.favKind, { id: star.dataset.fav, label: star.dataset.favLabel });
  }, true);
  // a press on a star leaves the focus where it was (the picker's search box keeps Esc and the typing)
  document.addEventListener('mousedown', (e) => { if (starOf(e)) e.preventDefault(); }, true);
}

// The size of the tiles under root (its data-tiles, which the CSS sizes them by): the slider shows and sets it, Ctrl+wheel
// over a grid (an element matching grid, which scrolls) steps it, and then neither the page nor the 3D view zooms; the
// tile under the pointer (matching tile) stays under it. Kept in this browser under key, through storage() (the editor's
// accessor, app.js safeStorage: null when there is none); changed(size) after a change.
export function mountTileSize({ root, slider, grid, tile, key, storage, changed = () => {} }) {
  let size = DEFAULT_TILE_SIZE, left = 0;     // left: a touchpad's scroll not yet worth a size
  function show(next) {
    size = tileSize(next);
    root.dataset.tiles = size;
    if (!slider) return;
    slider.value = String(TILE_SIZES.indexOf(size));
    slider.setAttribute('aria-valuetext', TILE_SIZE_LABELS[size]);
    slider.title = `Tile size: ${TILE_SIZE_LABELS[size]} (Ctrl+wheel over the tiles)`;
  }
  function set(next) {
    show(next);
    try { storage()?.setItem(key, size); } catch { /* not kept: this page only */ }
    changed(size);
  }
  let kept = null;
  try { kept = storage()?.getItem(key); } catch { /* no storage */ }
  if (slider) { slider.min = '0'; slider.max = String(TILE_SIZES.length - 1); slider.step = '1'; }
  show(kept);
  slider?.addEventListener('input', () => set(TILE_SIZES[+slider.value]));
  root.addEventListener('wheel', (e) => {
    const pane = e.ctrlKey && e.target.closest?.(grid);
    if (!pane) return;
    e.preventDefault(); e.stopPropagation();
    const r = wheelSteps(left, e.deltaY, e.deltaMode), next = stepTileSize(size, r.steps);
    left = r.left;
    if (next === size) return;
    const anchor = e.target.closest?.(tile), before = anchor?.getBoundingClientRect().top;
    set(next);
    if (anchor?.isConnected) pane.scrollTop += anchor.getBoundingClientRect().top - before;
  }, { passive: false });
}
