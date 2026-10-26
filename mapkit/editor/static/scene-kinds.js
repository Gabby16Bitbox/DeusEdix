// The kinds of things in a map, as the Hierarchy sorts them, and the 3D view's Show menu over them, as Unity's Layers
// and Gizmos menus: each kind shown or hidden, locked (not picked, marquee-selected, snapped to or moved) or not, its
// icons drawn or not, and how big the icons are. Without the page: app.js says what a thing is (its kind and class)
// and keeps the state per project, apart from each object's own eye and lock (a thing shows only when both allow it).

// the kinds of the map's objects (classtree.py), as the Hierarchy and the Show menu name them, in their order (the
// structures come first)
export const HIER_KINDS = [['pawn', 'Characters'], ['light', 'Lights'], ['prop', 'Objects'], ['mover', 'Doors and elevators'],
  ['logic', 'Triggers and logic'], ['path', 'AI paths'], ['box', 'Blocks']];
// the kinds drawn as an icon in the 3D view when they have no model of their own (viewport-icons.js)
export const ICON_KINDS = ['light', 'path', 'logic'];
export const ZONE_CLASSES = /^(ZoneInfo|WaterZone|PrecipitationZone|SnowZone|SkyZoneInfo|RevSoundZone|RevZoneInfo)$/;
// The kinds of a class, inside whatever kind holds it: a row each in the Show menu, a folder each in the Hierarchy, an
// icon of their own there and in the 3D view (viewport-icons.js). Found by a word of the class's name, so a mod's own
// sounds and zones are too (RevAmbientSound, WarpZoneInfo); a zone's name ends with it (a ZoneTrigger is a trigger, a
// WarpZoneMarker a path).
const CLASS_KINDS = [
  { id: 'sound', label: 'Sounds', word: /sound|music/i },
  { id: 'camera', label: 'Cameras and cutscenes', word: /camera|cutscene|interpolationpoint/i },
  { id: 'zone', label: 'Zones', word: /zone(info)?$/i },
];
// the kinds a word of the class's name never takes a thing out of: a character stays one (the engine's Camera is a
// PlayerPawn, not a camera of the map)
const OWN_KINDS = ['pawn'];
// The Show menu's rows, in the Hierarchy's order: the structures, its kinds, then the kinds of a class.
// icons: the kind has icons in the 3D view, so its row has an icon switch.
export const SHOW_KINDS = Object.freeze([
  { id: 'structure', label: 'Structures', icons: false },
  ...HIER_KINDS.map(([id, label]) => ({ id, label, icons: ICON_KINDS.includes(id) })),
  ...CLASS_KINDS.map(({ id, label }) => ({ id, label, icons: true })),
].map(Object.freeze));
export const SHOW_KIND = Object.freeze(Object.fromEntries(SHOW_KINDS.map((k) => [k.id, k])));
// the Hierarchy's folders of objects: the Show menu's rows but the structures (they have a folder of their own, by
// category), so that a folder's eye and padlock are its row's and cover every row in it
export const HIER_FOLDERS = Object.freeze(SHOW_KINDS.filter((k) => k.id !== 'structure'));

// the kind of a class with an icon of its own ('sound', 'camera', 'zone'), null for the others; a name with two of
// the words is what the last one says (RevSoundZone is a zone, PrecipitationSound a sound). of: the thing's own kind,
// when it is known (a character is never one of these: OWN_KINDS)
export function classKind(cls, of = '') {
  if (OWN_KINDS.includes(of)) return null;
  const name = String(cls || '').split('.').pop();
  let kind = null, at = -1;
  for (const k of CLASS_KINDS) {
    const m = k.word.exec(name);
    if (m && m.index > at) { kind = k.id; at = m.index; }
  }
  return kind;
}
// The Show menu's row of a thing: by its class first (a sound, a camera, a zone), else by its kind ('structure', a
// kind of the Hierarchy); a drawing (Tools > Draw) goes with the blocks, anything else with the objects.
export function showKindOf(kind, cls) {
  return classKind(cls, kind) || (kind === 'drawn' ? 'box' : SHOW_KIND[kind] ? kind : 'prop');
}

// What a kind can be besides shown, unlocked and with its icons, as it is kept.
export const KIND_STATES = ['hidden', 'locked', 'noIcons'];
// the icons' size (units across, as the 3D view draws them): the slider's ends, its step and the size at first
export const ICON_SIZE = Object.freeze({ min: 8, max: 96, step: 4, start: 32 });
// a size as kept or typed: on a step, within the ends; the first size when it is no number
export function iconSizeOf(v) {
  if (v === null || v === '' || !Number.isFinite(Number(v))) return ICON_SIZE.start;
  const n = Math.round(Number(v) / ICON_SIZE.step) * ICON_SIZE.step;
  return Math.min(ICON_SIZE.max, Math.max(ICON_SIZE.min, n));
}

// The Show menu's state, from what was kept (anything else, or nothing: every kind shown, unlocked, with its icons).
// JSON.stringify keeps it (toJSON); has() is a set's lookup, for what runs over every object.
export function createKindFilter(saved) {
  const read = (v) => new Set(Array.isArray(v) ? v.filter((id) => SHOW_KIND[id]) : []);
  const sets = Object.fromEntries(KIND_STATES.map((s) => [s, read(saved?.[s])]));
  let size = iconSizeOf(saved?.iconSize);
  return {
    // is this kind hidden, locked, without icons (state: one of KIND_STATES; id: a kind, or null for no kind)
    has: (state, id) => !!id && sets[state].has(id),
    set(state, id, on) {
      if (!sets[state] || !SHOW_KIND[id]) return;
      if (on) sets[state].add(id); else sets[state].delete(id);
    },
    // a kind's name: only it shown; again, when it is the only one shown: every kind (the locks and icons stay)
    solo(id) {
      if (!SHOW_KIND[id]) return;
      const alone = !sets.hidden.has(id) && sets.hidden.size === SHOW_KINDS.length - 1;
      sets.hidden = new Set(alone ? [] : SHOW_KINDS.map((k) => k.id).filter((k) => k !== id));
    },
    reset() { for (const s of KIND_STATES) sets[s].clear(); },
    // the kinds in a state, in the menu's order
    kinds: (state) => SHOW_KINDS.filter((k) => sets[state].has(k.id)).map((k) => k.id),
    // something is hidden, locked or without its icons (the toolbar's button says so)
    get filtering() { return KIND_STATES.some((s) => sets[s].size > 0); },
    get iconSize() { return size; },
    setIconSize(v) { size = iconSizeOf(v); return size; },
    toJSON() { return { ...Object.fromEntries(KIND_STATES.map((s) => [s, this.kinds(s)])), iconSize: size }; },
  };
}
