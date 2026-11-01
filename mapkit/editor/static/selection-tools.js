// The selection's own logic, without the page (app.js turns the 3D view's hits into keys, s:/a:/b:/d:/n:):
// what is under the pointer and which of it a click picks (Unity's click again on the same spot), Invert
// selection, and the history of the selections (Edit > Previous / Next selection).

// an object's icon or box a little behind a wall still counts as in front of it, as a plain click has it
export const PROXY_LEAD = 4;
// Real model surfaces near a supporting block are easier to pick; walls still win.
export const DETAIL_LEAD = 12;

// hits: {key, distance, proxy} in any order, key null for the map's own walls (nothing to select);
// nestOf(key): the key of the outermost nest around it, or null.
// The keys under the pointer, nearest first, each once (the walls once, as null): what a plain click picks
// first (the nest of the nearest thing, when it is in one), then every thing itself.
export function stackKeys(hits, nestOf = () => null) {
  const ranked = hits.map((h) => ({ ...h, key: h.key ?? null, rank: h.distance - (h.proxy ? PROXY_LEAD : 0) }))
    .sort((a, b) => a.rank - b.rank);
  const first = ranked[0];
  let detail = null;
  if (first?.proxy && /^(b|d):/.test(first.key || '')) {
    for (const hit of ranked.slice(1)) {
      if (hit.distance > first.distance + DETAIL_LEAD) continue;
      if (hit.detail && hit.key && hit.key !== first.key) {
        // A wall or a different structure in front of the detail still wins.
        const blocked = ranked.some(other => !other.proxy && other.key !== hit.key && other.distance < hit.distance);
        if (!blocked) detail = hit.key;
        break;
      }
      if (!hit.proxy || (hit.key && !/^(b|d):/.test(hit.key))) break;
    }
  }
  const keys = ranked.map((h) => h.key);
  if (detail) keys.unshift(detail);
  const nest = keys[0] ? nestOf(keys[0]) : null;
  return [...new Set(nest ? [nest, ...keys] : keys)];
}

const sameOrder = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
// the same things, in any order
function sameKeys(a, b) {
  const has = new Set(b);
  return a.length === b.length && a.every((k) => has.has(k));
}

// Unity's click again: a click within `radius` pixels of the last one, over the same things, picks the one
// after the last pick, and wraps; anywhere else the nearest. It goes on only while what the last pick selected
// is still the selection (current: its key, null for nothing, undefined for several things): after Esc, or with
// another selection, the nearest again. A click `doubleClick` ms after the last one (time: the event's, ms) is a
// double click's second: the same pick (the double click picks for itself).
export function createPickCycle(radius = 4, doubleClick = 500) {
  let last = null;                       // {at: [x, y], keys, i, time} of the last click
  return {
    // the index in keys that a click at `at` picks, -1 when there is nothing under it
    next(at, keys, current, time) {
      const prev = last, again = !!prev && Math.hypot(at[0] - prev.at[0], at[1] - prev.at[1]) <= radius && sameOrder(prev.keys, keys);
      let i = keys.length ? 0 : -1;
      if (again && prev.i >= 0 && time !== undefined && prev.time !== undefined && time - prev.time < doubleClick) i = prev.i;
      else if (again && prev.i >= 0 && (keys[prev.i] ?? null) === current) i = (prev.i + 1) % keys.length;
      last = { at, keys, i, time };
      return i;
    },
  };
}

// Invert selection: what can be picked and is not taken now
export function invertPick(all, taken) {
  const out = new Set(taken);
  return all.filter((x) => !out.has(x));
}

// Edit > Previous / Next selection, as Unity's: the last `limit` selections of one map (scope), as keys.
// Nothing selected is no step: Back from it returns to the last selection. A selection whose things were
// all deleted is skipped (live(key): is it still in the map?), and what was deleted of one is dropped.
export function createSelectionHistory(limit = 50) {
  let list = [], at = -1, scope = null;
  const enter = (s) => { if (s !== scope) { scope = s; list = []; at = -1; } };
  // where a step in dir starts: Back from a selection not kept (nothing selected) is the current entry itself
  const from = (dir, current) => (dir < 0 && at >= 0 && !sameKeys(list[at], current) ? at : at + dir);
  return {
    // a new selection goes after the current one; what was ahead of it goes, as in a browser
    record(s, keys) {
      enter(s);
      if (!keys.length || (at >= 0 && sameKeys(list[at], keys))) return;
      list = list.slice(0, at + 1).concat([[...keys]]).slice(-limit);
      at = list.length - 1;
    },
    // the selection one step back (dir -1) or forward (1), null when there is none
    step(s, dir, current, live) {
      enter(s);
      for (let i = from(dir, current); i >= 0 && i < list.length; i += dir) {
        const keys = list[i].filter(live);
        if (keys.length) { list[i] = keys; at = i; return keys; }
      }
      return null;
    },
    // is there an entry that way (deleted things are only found out by step)
    canStep(s, dir, current) {
      if (s !== scope) return false;
      const i = from(dir, current);
      return i >= 0 && i < list.length;
    },
  };
}
