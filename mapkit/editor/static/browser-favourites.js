// The Browser's favourites and the size of its tiles, as Unity's Project window has them (its Favorites, its size
// slider down to a list, Ctrl+wheel over the grid). Without the page: app.js keeps the favourites in the project's
// storage (projectStorageKey) and gives each browser (Objects, Models, Pieces, Prefabs, Sounds, the texture picker's
// Textures) its stars through browser-tiles.js.

// the browsers with stars, each with its own list: the id its browser gives a tile (a class, a model, a piece...)
export const FAVOURITE_KINDS = ['objects', 'models', 'pieces', 'prefabs', 'sounds', 'textures'];
// the group at the top of each browser
export const FAVOURITES_GROUP = 'Favourites';
const MAX_LABEL = 200;

// what is kept, read back: {kind: [{id, label}]} in the order they were starred; anything else (another version,
// a hand-edited value, a kind no browser has) is left out
export function readFavourites(text) {
  let data = null;
  try { data = JSON.parse(text || 'null'); } catch { /* unreadable: none */ }
  const out = {};
  for (const kind of FAVOURITE_KINDS) {
    const seen = new Set();
    out[kind] = (Array.isArray(data?.[kind]) ? data[kind] : []).filter((f) => {
      if (!f || typeof f.id !== 'string' || !f.id || seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    }).map((f) => ({ id: f.id, label: typeof f.label === 'string' && f.label ? f.label.slice(0, MAX_LABEL) : f.id }));
  }
  return out;
}

// The favourites of the open project. storage(): the browser's storage (null: none, they last until the page
// closes); key(): where the open project keeps them (read again when the project changes).
export function createFavourites({ storage = () => null, key = () => 'favourites' } = {}) {
  let at = null, data = null, ids = {};            // the key read, its favourites, a Set of the ids of each kind
  const listeners = new Set();
  function current() {
    const k = key();
    if (k !== at) {
      let text = null;
      try { text = storage()?.getItem(k) ?? null; } catch { /* no storage */ }
      at = k; data = readFavourites(text);
      ids = Object.fromEntries(FAVOURITE_KINDS.map((kind) => [kind, new Set(data[kind].map((f) => f.id))]));
    }
    return data;
  }
  function save(kind) {
    ids[kind] = new Set(data[kind].map((f) => f.id));
    try { storage()?.setItem(at, JSON.stringify(data)); } catch { /* full or blocked: kept until the page closes */ }
    for (const fn of listeners) fn(kind);
  }
  const known = (kind) => FAVOURITE_KINDS.includes(kind);
  const list = (kind) => (known(kind) ? current()[kind].slice() : []);
  return {
    has(kind, id) { current(); return !!ids[kind]?.has(id); },
    list,
    // starred or unstarred: true when it is a favourite now (fav: {id, label}, the label shown once it is gone)
    toggle(kind, fav) {
      if (!known(kind) || !fav?.id) return false;
      const list = current()[kind], i = list.findIndex((f) => f.id === fav.id);
      if (i >= 0) list.splice(i, 1);
      else list.push({ id: fav.id, label: String(fav.label || fav.id).slice(0, MAX_LABEL) });
      save(kind);
      return i < 0;
    },
    // each favourite with what its browser has for it (find(id)); item null: gone from the game or the project
    entries(kind, find) {
      return list(kind).map((fav) => ({ fav, item: find(fav.id) ?? null }));
    },
    // fn(kind) after each change; returns how to stop
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// ---------------------------------------------------------------- the size of the tiles
// smallest first: a list (one line each), then small, medium and large tiles; medium is the size they always had
export const TILE_SIZES = ['list', 'small', 'medium', 'large'];
export const DEFAULT_TILE_SIZE = 'medium';
export const TILE_SIZE_LABELS = { list: 'List', small: 'Small tiles', medium: 'Medium tiles', large: 'Large tiles' };
export const tileSize = (value) => (TILE_SIZES.includes(value) ? value : DEFAULT_TILE_SIZE);
// steps sizes bigger (+) or smaller (-), no further than the ends
export function stepTileSize(size, steps) {
  const i = TILE_SIZES.indexOf(tileSize(size)) + Math.trunc(steps || 0);
  return TILE_SIZES[Math.max(0, Math.min(TILE_SIZES.length - 1, i))];
}

// Ctrl+wheel: how many sizes one wheel event goes (+ bigger: the wheel turned away, as Unity's zoom) and what is left
// over for the next. A mouse's notch is one size; a touchpad's (or a pinch's) small movements add up to one.
const NOTCH = 50;                                  // pixels of a touchpad's scroll worth one size
const PIXELS = [1, 33, 100];                       // a deltaMode's unit (pixels, lines, pages) in pixels
export function wheelSteps(left, deltaY, deltaMode = 0) {
  const moved = -(+deltaY || 0) * (PIXELS[deltaMode] ?? 1);
  if (Math.abs(moved) >= NOTCH) return { steps: Math.sign(moved), left: 0 };
  const sum = Math.sign(moved) && Math.sign(left) === -Math.sign(moved) ? moved : (left || 0) + moved;   // turned back: start again
  return Math.abs(sum) >= NOTCH ? { steps: Math.sign(sum), left: 0 } : { steps: 0, left: sum };
}
