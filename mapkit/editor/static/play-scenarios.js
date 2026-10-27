// Saved play scenarios and the buttons of a game being played, as Unity's Play mode scenarios and its Pause.
// A scenario is a named way to start Play, kept in the project (app.js: projectStorageKey 'playScenarios'): where JC
// starts (below the camera, at the map's PlayerStart or where the mission preset puts him, or at a point kept with
// it on one map), the mission preset (editor/play.py setups), the starting states (play-state.js's raw flags), the
// UNATCO route, and JC's loadout: items with their counts (ammo is an item too), augmentations, skill levels, skill
// points, credits, health, god or invisible. The server turns the loadout into the game's console commands
// (editor/play.py loadout_run). Before Play the classes a scenario names are checked against those the editor
// knows, as Unity checks a scenario, and what is missing is left out and said. No DOM here: tests/test_play_scenarios.mjs.

export const MAX_SCENARIOS = 30;
export const NAME_LENGTH = 40;
// as editor/play.py: the items at JC's feet in all (each one a step of the game's runner, half a second), of one
// item, skill points (as the game's allskillpoints), credits
export const MAX_ITEMS = 40, MAX_COUNT = 20, MAX_SKILL_POINTS = 115900, MAX_CREDITS = 1000000;
export const STARTS = { camera: 'Below the camera', playerstart: 'At the PlayerStart (or where the preset puts him)',
  point: 'At a point kept with the scenario' };
export const CHEATS = { none: 'None', god: 'God: he takes no damage', invisible: 'Invisible: enemies do not see him' };
export const SKILL_LEVELS = ['Untrained', 'Trained', 'Advanced', 'Master'];
// the buttons of the game's header during Play (game-view.js): the game's own console commands when pressed and
// when let go (the Console's channel to the game, console.js)
export const PLAY_CONTROLS = [
  { id: 'pause', label: 'Pause', on: 'pause', off: 'pause', title: 'Pause the game, or go on (its own Pause)' },
  { id: 'slomo', label: 'Slow motion', on: 'slomo 0.25', off: 'slomo 1', title: 'The game at a quarter of its speed (slomo 0.25), or at its own (slomo 1)' },
  { id: 'ghost', label: 'Ghost', on: 'ghost', off: 'walk', title: 'JC flies through walls (ghost), or walks again (walk)' },
  { id: 'god', label: 'God', on: 'god', off: 'god', title: 'JC takes no damage (god), or takes it again' },
];

// a name as it is kept: trimmed, its spaces one, at most NAME_LENGTH letters; throws when nothing is left
export function scenarioName(text) {
  const name = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_LENGTH).trim();
  if (!name) throw new Error('Give the scenario a name.');
  return name;
}
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export function findScenario(list, name) { return list.find((s) => same(s.name, name)) || null; }

const whole = (v, low, high) => (Number.isInteger(v) && v >= low && v <= high ? v : null);   // in range, or null
const className = (v) => (typeof v === 'string' && /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/.test(v) ? v : null);
const vector = (v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v.slice() : null);

// a scenario's parts as they are kept, from anything (what was stored, what the Play window made): what does not fit
// is left out, what is missing is as the game starts. The name may be '' (the Play window's unsaved choices)
export function scenarioDraft(raw = {}) {
  const at = vector(raw.point?.at);
  const point = at ? { at, yaw: whole(raw.point.yaw, 0, 65535) ?? 0, pitch: whole(raw.point.pitch, -16384, 16384) ?? 0,
    map: String(raw.point.map ?? '') } : null;
  const start = Object.hasOwn(STARTS, raw.start) && (raw.start !== 'point' || point) ? raw.start : 'camera';
  const items = [];
  for (const row of Array.isArray(raw.items) ? raw.items : []) {
    const cls = className(row?.cls), count = whole(row?.count, 1, MAX_COUNT);
    if (cls && count && !items.some((r) => same(r.cls, cls))) items.push({ cls, count });
  }
  const augs = [...new Set((Array.isArray(raw.augs) ? raw.augs : []).map(className).filter(Boolean))];
  const skills = [];
  for (const row of Array.isArray(raw.skills) ? raw.skills : []) {
    const cls = className(row?.cls), level = whole(row?.level, 0, SKILL_LEVELS.length - 1);
    if (cls && level !== null && !skills.some((r) => same(r.cls, cls))) skills.push({ cls, level });
  }
  return { name: String(raw.name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_LENGTH).trim(), start, point,
    setup: typeof raw.setup === 'string' && /^\w*$/.test(raw.setup) ? raw.setup : '', route: raw.route !== false,
    flags: typeof raw.flags === 'string' ? raw.flags : '', items, augs, skills,
    skillPoints: whole(raw.skillPoints, 0, MAX_SKILL_POINTS), credits: whole(raw.credits, 0, MAX_CREDITS),
    health: whole(raw.health, 1, 100), cheat: Object.hasOwn(CHEATS, raw.cheat) ? raw.cheat : 'none' };
}
// a scenario to keep: a draft with a name, or null
export function cleanScenario(raw) {
  try { return { ...scenarioDraft(raw), name: scenarioName(raw?.name) }; } catch { return null; }
}

// the scenarios as kept in the project: {active: the one Play starts with ('' none), list}; anything that does not
// fit is left out, a name is taken once, at most MAX_SCENARIOS
export function readScenarios(text) {
  let data = null;
  try { data = JSON.parse(text || 'null'); } catch { data = null; }
  const list = [];
  for (const raw of Array.isArray(data?.list) ? data.list : []) {
    const s = cleanScenario(raw);
    if (s && !findScenario(list, s.name) && list.length < MAX_SCENARIOS) list.push(s);
  }
  return { active: findScenario(list, data?.active ?? '')?.name || '', list };
}
export function scenariosText(state) { return JSON.stringify({ version: 1, active: state.active, list: state.list }); }
// the scenarios with this one: one of the same name (in any case) is replaced where it is, a new one goes last; one
// more than MAX_SCENARIOS throws
export function withScenario(state, scenario) {
  const s = cleanScenario(scenario);
  if (!s) throw new Error('Give the scenario a name.');
  if (findScenario(state.list, s.name)) return { ...state, list: state.list.map((x) => (same(x.name, s.name) ? s : x)) };
  if (state.list.length >= MAX_SCENARIOS) throw new Error(`At most ${MAX_SCENARIOS} scenarios are kept: delete one first.`);
  return { ...state, list: [...state.list, s] };
}
export function withoutScenario(state, name) {
  return { active: same(state.active, name) ? '' : state.active, list: state.list.filter((s) => !same(s.name, name)) };
}
// Play starts with this one ('' or one not kept: none)
export function chooseScenario(state, name) { return { ...state, active: findScenario(state.list, name)?.name || '' }; }
export function activeScenario(state) { return state.active ? findScenario(state.list, state.active) : null; }

// an item with this count (not given: one more of it, a new one once), at most MAX_COUNT; 0 takes it away
export function withItem(s, cls, count) {
  const at = s.items.findIndex((r) => same(r.cls, cls));
  const n = count === undefined ? Math.min(MAX_COUNT, at < 0 ? 1 : s.items[at].count + 1)
    : Math.max(0, Math.min(MAX_COUNT, Math.round(count) || 0));
  const items = at < 0 ? [...s.items, { cls, count: n }] : s.items.map((r, i) => (i === at ? { ...r, count: n } : r));
  return { ...s, items: items.filter((r) => r.count > 0) };
}
export function itemCount(s) { return s.items.reduce((sum, r) => sum + r.count, 0); }

// What a scenario names that is not there now: [{part, value, text}], part 'items' | 'augs' | 'skills' (classes the
// game and the mod do not have), 'setup' (a mission preset that does not end in this map), 'point' (a point kept on
// another map). known: {items, augs, skills (lists of {cls}), setups (this map's, [{name}]), map (its name)}; a part
// not given is not checked (the server checks the classes again).
export function scenarioProblems(s, known = {}) {
  const out = [], has = (list, cls) => list.some((c) => same(c.cls, cls));
  const words = { items: 'item', augs: 'augmentation', skills: 'skill' };
  for (const part of ['items', 'augs', 'skills']) {
    if (!known[part]) continue;
    for (const v of s[part]) {
      const cls = typeof v === 'string' ? v : v.cls;
      if (!has(known[part], cls)) out.push({ part, value: cls, text: `the ${words[part]} ${cls} is in neither the game nor the mod` });
    }
  }
  if (s.setup && known.setups && !known.setups.some((x) => x.name === s.setup))
    out.push({ part: 'setup', value: s.setup, text: `the mission preset ${s.setup} is not one of this map's: the map starts as it is` });
  if (s.start === 'point' && known.map && !same(s.point.map, known.map))
    out.push({ part: 'point', value: s.point.map, text: `its point is on the map ${s.point.map || '(unknown)'}: JC starts below the camera` });
  return out;
}
// the scenario without what scenarioProblems found
export function withoutProblems(s, problems) {
  const gone = (part, cls) => problems.some((p) => p.part === part && same(p.value, cls));
  return { ...s, items: s.items.filter((r) => !gone('items', r.cls)), augs: s.augs.filter((a) => !gone('augs', a)),
    skills: s.skills.filter((r) => !gone('skills', r.cls)), setup: problems.some((p) => p.part === 'setup') ? '' : s.setup,
    start: problems.some((p) => p.part === 'point') ? 'camera' : s.start };
}

// the loadout as the server takes it (editor/play.py loadout_run), or null when the scenario gives JC nothing
export function loadoutOf(s) {
  const none = !s.items.length && !s.augs.length && !s.skills.length && s.skillPoints === null && s.credits === null
    && s.health === null && s.cheat === 'none';
  return none ? null : { items: s.items, augs: s.augs, skills: s.skills, skillPoints: s.skillPoints, credits: s.credits,
    health: s.health, cheat: s.cheat };
}
// what Play sends with a scenario (game-view.js start: the camera's place is the default): where JC starts (below the
// camera: nothing, the camera at launch), the mission preset, the starting states, the route, the loadout
export function playOverrides(s) {
  const where = s.start === 'playerstart' ? { at: null, yaw: 0, pitch: 0 }
    : s.start === 'point' ? { at: s.point.at, yaw: s.point.yaw, pitch: s.point.pitch } : {};
  return { ...where, setup: s.setup, flags: s.flags, route: s.route, loadout: loadoutOf(s) };
}
// the header's buttons pressed when the game starts with a scenario: God when it turns it on
export function pressedAtStart(s) { return { god: s?.cheat === 'god' }; }

// what JC has in a few words ('' nothing more than the game gives him)
export function loadoutSummary(s) {
  const parts = [], n = itemCount(s), plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  if (n) parts.push(plural(n, 'item'));
  if (s.augs.length) parts.push(plural(s.augs.length, 'augmentation'));
  if (s.skills.length) parts.push(plural(s.skills.length, 'skill'));
  if (s.skillPoints !== null) parts.push(`${s.skillPoints} skill points`);
  if (s.credits !== null) parts.push(`${s.credits} credits`);
  if (s.health !== null) parts.push(`health ${s.health}`);
  if (s.cheat !== 'none') parts.push(s.cheat);
  return parts.join(' · ');
}
// a scenario in a few words (the tooltip of the list next to Play): where JC starts, the preset, what he has
export function scenarioSummary(s) {
  const where = { camera: 'JC below the camera', playerstart: 'JC at the PlayerStart', point: 'JC at its point' }[s.start];
  return [where, s.setup, loadoutSummary(s)].filter(Boolean).join(' · ');
}
