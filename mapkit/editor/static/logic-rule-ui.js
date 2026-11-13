import { itemOptionsHtml, itemWarningText, isNanoKey, keyFieldsHtml } from './item-options.js';
// The parts of a rule's form (app.js lkRuleHtml) that the catalogue describes (config/logic.json): an action's
// arguments by their type (the P4 verbs: no hand-made rows), what an output takes (hurt below N%, a floor, the
// player's health, a game event's Tag), and the rule's own options of the Logic runtime v2 (P6: other causes, all or
// any of its checks, again while it runs, at most N runs, a pause between runs, the player talking). Only HTML here:
// app.js wires the data-* attributes (lkWire) to edits.links, as it does for its own rows.
//
// The values are kept as links.py reads them (editor/links.py: _whole, _secs, watch_test, needs_rule): numbers as
// text, a place as [x, y, z] in 'at', a bool as true/false, a yes/no as '1'/'0', a crate's items as
// "Package.Class:weight;...".

import { AUGS, FORMULA_TITLE } from './conditions.js';
import { isFormula } from './logic-numbers.js';

// A goal's name from what the player reads ("Find the NSF shipping records" -> FindNsfShipping), the first one free
// among `used` (lower case), or '' when the text has no word for it. A new goal is named Goal1, Goal2... until its
// text is written (13 Nov 2026: every goal of a mission was GoalN, the rules completing them said nothing).
const GOAL_SKIP = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'and', 'or', 'for', 'with', 'from', 'by', 'into', 'your', 'his', 'her', 'their', 'its']);
export function goalNameFrom(text, used = new Set()) {
  const words = String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, ' ').replace(/_/g, ' ').split(/\s+/)
    .filter((w) => w && !GOAL_SKIP.has(w.toLowerCase()));
  let base = words.slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  base = base.replace(/^\d+/, '').slice(0, 28);
  if (!base) return '';
  let name = base, k = 2;
  while (used.has(name.toLowerCase())) name = base + k++;
  return name;
}

// the action rows app.js draws itself (the verbs before P4, and interaction-blocks.js's)
export const HAND_ROWS = new Set(['key', 'attack', 'hostile', 'goto', 'run', 'explode', 'sound', 'message', 'note', 'goal', 'flag',
  'input', 'floor', 'count', 'fpmoment', 'travel', 'body', 'sit', 'timerstart', 'npcuse', 'effect']);
// the cause rows app.js draws itself (near: within; keypress: the key; option: the computer's button; output: a
// script's port)
export const HAND_CAUSES = new Set(['near', 'keypress', 'option', 'output']);
// the causes with no object: what happens in the world (the Logic window's "The map" list, "Or when...")
export const WORLD_CAUSES = ['start', 'keypress', 'signal', 'ended', 'heard', 'becomes', 'changes', 'jchealth', 'gametag',
  'loaded', 'back', 'goaldone', 'noise', 'appears'];
// the world's own happenings (P9 slice 3: config/logic.json hears 'world'): a rule of its own only, never an "Or
// when..." (links.py: a UCRuleAlso hears none of them)
export const GAME_WORLD = ['loaded', 'back', 'goaldone', 'noise', 'appears'];
// the player's happenings (P9 slice 2): a rule "when a condition becomes true" with that condition ready to fill in
// (conditions.js comesText says it: "When the player's energy falls below 20"), [id, the menu's words, the condition]
export const PLAYER_CAUSES = [
  ['energy', "the player's energy falls below…", { type: 'energy', op: '<', value: 20 }],
  ['credits', "the player's credits reach…", { type: 'credits', op: '>=', value: 100 }],
  ['skillpoints', "the player's skill points reach…", { type: 'skillpoints', op: '>=', value: 1000 }],
  ['augget', 'the player gets an augmentation…', { type: 'aug', aug: 'AugSpeed', how: 'has', is: true }],
  ['augon', 'the player turns on an augmentation…', { type: 'aug', aug: 'AugSpeed', how: 'on', is: true }],
  ['augoff', 'the player turns off an augmentation…', { type: 'aug', aug: 'AugSpeed', how: 'on', is: false }],
  ['auglevel', 'an augmentation of the player reaches a level…', { type: 'aug', aug: 'AugSpeed', how: 'level', level: 2, is: true }],
  ['items', 'the player gets something of a kind…', { type: 'items', item: 'DeusEx.DeusExWeapon', op: '>=', value: 1 }],
  ['water', 'the player enters water', { type: 'water', is: true }],
  ['zone', 'the player enters a zone…', { type: 'zone', zone: '', is: true }],
];
// the signals a map's rules send or wait for (P3), for the lists of the signal fields
export function signalsOf(links, story) {
  const out = new Map();
  const add = (n) => { const s = String(n || '').trim(); if (s && !out.has(s.toLowerCase())) out.set(s.toLowerCase(), s); };
  for (const l of links || []) {
    for (const c of [l, ...(l.also || [])]) if (c && c.when === 'signal') add(c.signal);
    for (const a of [...(l.do || []), ...(l.else || [])]) if (a && a.verb === 'signal') add(a.a);
  }
  // the Story's (P5): a dialogue's step, an action of an event, of a dialogue's or an InfoLink's end
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.type === 'signal') add(o.signal); Object.values(o).forEach(walk); } };
  if (story) walk([story.dialogues, story.events, story.infolinks]);
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}
const signalList = (id, h, esc) => `<datalist id="${id}">${(h.signals || []).map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`;
export const AGAIN = [['', 'while running: let it finish'], ['restart', 'while running: start again'], ['each', 'run it again alongside (8 at most)']];
export const TALK_BUSY = [['', 'go on'], ['wait', 'wait until the talk is over'], ['giveup', 'give up that run']];
// a few of the game's characters for "Send reinforcements" (any Package.Class can be typed)
export const PAWN_CLASSES = ['DeusEx.MJ12Troop', 'DeusEx.MJ12Commando', 'DeusEx.UNATCOTroop', 'DeusEx.Terrorist', 'DeusEx.Soldier',
  'DeusEx.RiotCop', 'DeusEx.Cop', 'DeusEx.ThugMale', 'DeusEx.MIB', 'DeusEx.WIB', 'DeusEx.SecurityBot2', 'DeusEx.SecurityBot3',
  'DeusEx.MilitaryBot', 'DeusEx.SpiderBot2', 'DeusEx.Greasel', 'DeusEx.Karkian'];

// a character class in words, for its list: "DeusEx.MJ12Troop" -> "MJ12 Troop" (12 Nov 2026: only Package.Class)
export const pawnWords = (cls) => String(cls).split('.').pop().replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([0-9A-Z])([A-Z][a-z])/g, '$1 $2');

const NUMERIC = new Set(['whole', 'amount', 'number', 'seconds', 'percent', 'floor', 'button']);
const STEP = { seconds: 0.5, number: 0.1 };

// "DeusEx.Medkit:1;DeusEx.Flare:3" <-> [{cls, w}]
export function parseItems(v) {
  return String(v || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [cls, w] = s.split(':');
    const n = Math.round(+w);
    return { cls: cls.trim(), w: Number.isFinite(n) && w !== undefined && w.trim() !== '' ? Math.max(0, n) : 1 };
  }).filter((x) => x.cls);
}
export const itemsText = (list) => list.filter((x) => x.cls).map((x) => `${x.cls}:${Math.max(0, Math.round(+x.w || 0))}`).join(';');

// the value an argument shows: its own, else its default ('' none)
export function argValue(x, arg) {
  const v = x[arg.id];
  return v === undefined || v === null || v === '' ? (arg.default ?? '') : v;
}

// An action's default arguments (a new step, a verb changed): the catalogue's defaults where it has none yet; a
// place where the rule's object is (h.here(), or none)
export function argDefaults(x, args, here) {
  for (const a of args || []) {
    if (x[a.id] !== undefined && x[a.id] !== '') continue;
    if (a.type === 'place') { const p = here && here(); if (p) x[a.id] = p.slice(); continue; }
    if (a.type === 'bool') { x[a.id] = !!a.default; continue; }
    if (a.default !== undefined) x[a.id] = typeof a.default === 'number' ? String(a.default) : a.default;
  }
  return x;
}

// The rows of an action's arguments (step j). h: {esc, name(n), items [{cls, name}], rules [{id, label}], songs [],
// dialogues, infolinks [{id, label}] (P5: the map's Story; null while it is read)}
export function argRowsHtml(args, x, j, h) {
  const { esc } = h;
  const row = (inner) => `<div class="row" style="padding-left:38px">${inner}</div>`;
  const label = (a) => `<label style="width:auto" title="${esc(a.label || a.id)}">${esc(a.label || a.id)}</label>`;
  let out = '';
  for (const a of args || []) {
    if (a.forItem && String(x.a || '').toLowerCase() !== a.forItem.toLowerCase()) continue;
    if (a.id === 'b' && x.verb === 'giveitem' && isNanoKey(x.a)) continue;
    if (a.id === 'keyDescription' || a.id === 'keyId') continue; // rendered together below the item
    const v = argValue(x, a), k = esc(a.id), at = `data-lkarg="${j}" data-k="${k}"`;
    if (NUMERIC.has(a.type)) {
      const min = a.type === 'whole' ? '' : ' min="0"', max = a.type === 'percent' ? ' max="100"' : '';
      // an amount that takes a formula of counters (P9 slice 5, logic.json "formula"): a text field when it is one,
      // else the number and a button that makes it one (conditions.js formulaField)
      if (a.formula && isFormula(String(v))) out += row(`${label(a)}<input type="text" ${at} value="${esc(String(v))}" placeholder="Alarms + 1" title="${esc(FORMULA_TITLE)}" autocomplete="off" spellcheck="false" style="width:120px">`);
      else out += row(`${label(a)}<input type="number" ${at} value="${esc(String(v))}"${min}${max} step="${STEP[a.type] || 1}" style="width:72px">`
        + (a.formula ? `<button type="button" data-lkfx="${j}" title="${esc(FORMULA_TITLE)}">ƒx</button>` : ''));
    } else if (a.type === 'choice') {
      const choices = a.choices || [];
      out += row(`${label(a)}<select ${at} style="flex:1;min-width:0">${choices.map(([cv, cl]) => `<option value="${esc(cv)}" ${String(cv) === String(v) ? 'selected' : ''}>${esc(cl)}</option>`).join('')}</select>`);
    } else if (a.type === 'bool') {
      out += row(`<label style="width:auto"><input type="checkbox" data-lkargb="${j}" data-k="${k}" ${x[a.id] === undefined ? (a.default ? 'checked' : '') : x[a.id] ? 'checked' : ''}> ${esc(a.label || a.id)}</label>`);
    } else if (a.type === 'yesno') {
      out += row(`<label style="width:auto"><input type="checkbox" data-lkargyn="${j}" data-k="${k}" ${String(v) === '0' ? '' : 'checked'}> ${esc(a.label || a.id)}</label>`);
    } else if (a.type === 'place') {
      const p = Array.isArray(x[a.id]) ? x[a.id] : null;
      // named by what is there when something is (h.place: "Path Node 2", "next to Data Cube"), else its numbers
      const coords = p ? p.map((n) => Math.round(n)).join(', ') : '';
      const named = p && h.place ? h.place(p) : '';
      out += row(`${label(a)}<span class="hint" style="margin:0;flex:1"${named ? ` title="${esc(coords)}"` : ''}>${p ? esc(named || coords) : '(click a place)'}</span><button data-lkat="${j}" data-k="${k}" title="Pick a place from a list, or click the floor there">pick</button>`);
    } else if (a.type === 'object') {
      const has = !!x[a.id];
      out += row(`${label(a)}<a href="#" data-lkgo="${esc(x[a.id] || '')}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${has ? '' : ';color:var(--bad)'}" title="Go to it">${esc(has ? h.name(x[a.id]) : a.empty || '(none yet)')}</a><button data-lkobj="${j}" data-k="${k}" title="Click it in the map">${has ? 'change' : 'pick'}</button>`);
    } else if (a.type === 'itemclass') {
      out += row(`${label(a)}${itemSelect(h, `${at}`, v, x.verb === 'giveitem')}`);
      if (x.verb === 'giveitem') out += isNanoKey(v)
        ? keyFieldsHtml(x, (k) => `data-lkarg="${j}" data-k="${k}"`, row)
        : itemWarning(v, h, row);
    } else if (a.type === 'aug') {                 // P9 slice 4: an augmentation of the game
      out += row(`${label(a)}<select ${at} style="flex:1;min-width:0">${AUGS.map(([n, w]) => `<option value="${esc(n)}" ${n === v ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select>`);
    } else if (a.type === 'prop') {                // P9 slice 4: a property of the safe list of the object's family (h.props)
      const props = h.props || [];
      out += row(`${label(a)}<select ${at} style="flex:1;min-width:0"><option value="">(choose a property)</option>${props.map(([n, w]) => `<option value="${esc(n)}" ${n.toLowerCase() === String(v).toLowerCase() ? 'selected' : ''}>${esc(w)}</option>`).join('')}`
        + `${v && !props.some(([n]) => n.toLowerCase() === String(v).toLowerCase()) ? `<option selected value="${esc(v)}">${esc(v)} (not for this object)</option>` : ''}</select>`);
    } else if (a.type === 'items') {
      out += itemsRowsHtml(parseItems(v), j, a.id, h, row);
    } else if (a.type === 'hex') {
      out += row(`${label(a)}<input type="color" ${at} value="${esc(/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : '#ffffff')}" style="width:56px">`);
    } else if (a.type === 'dialogue' || a.type === 'infolink') {
      out += storyRows(a, v, at, label(a), h, row);
    } else if (a.type === 'rule') {
      const rules = h.rules || [];
      out += row(`${label(a)}<select ${at} style="flex:1;min-width:0"><option value="">(choose a rule)</option>${rules.map((r) => `<option value="${esc(r.id)}" ${r.id === v ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}${v && !rules.some((r) => r.id === v) ? `<option selected value="${esc(v)}">${esc(v)} (missing)</option>` : ''}</select>`);
    } else if (a.type === 'pawnclass' && (!v || PAWN_CLASSES.some((c) => c.toLowerCase() === String(v).toLowerCase()))) {
      // the game's characters by name ("MJ12 Troop"), another class typed after "Another class…" (13 Nov 2026: the
      // field showed DeusEx.MJ12Troop)
      out += row(`${label(a)}<select ${at} style="flex:1;min-width:0" title="${esc(String(v || ''))}">${v ? '' : '<option value="" selected>(choose who)</option>'}`
        + PAWN_CLASSES.map((c) => `<option value="${esc(c)}" ${c.toLowerCase() === String(v).toLowerCase() ? 'selected' : ''}>${esc(pawnWords(c))}</option>`).join('')
        + '<option value="@other">Another class (type its Package.Class)…</option></select>');
    } else {                                   // text, line, tag, state, counter, goal, map, pawnclass, song, sound...
      const list = a.type === 'pawnclass' ? `lk-pawns-${j}` : a.type === 'song' && (h.songs || []).length ? `lk-songs-${j}`
        : a.type === 'signal' ? `lk-signals-${j}` : a.type === 'faction' ? 'factionlist' : '';
      const opts = a.type === 'pawnclass' ? PAWN_CLASSES : a.type === 'song' ? h.songs || [] : a.type === 'signal' ? h.signals || [] : [];
      const ph = a.type === 'pawnclass' ? 'Package.Class, e.g. DeusEx.MJ12Troop' : a.type === 'song' ? 'Package.Song (empty: silence)'
        : a.type === 'signal' ? 'Alarm' : a.type === 'faction' ? 'MJ12' : a.type === 'propvalue' ? 'a number, or yes / no' : a.label || '';
      out += row(`${label(a)}<input type="text" ${at} value="${esc(String(v))}" placeholder="${esc(ph)}" ${list ? `list="${list}"` : ''} style="flex:1;min-width:0">`
        + (list && list !== 'factionlist' ? `<datalist id="${list}">${opts.map((o) => `<option value="${esc(o)}"${a.type === 'pawnclass' ? ` label="${esc(pawnWords(o))}"` : ''}>`).join('')}</datalist>` : ''));
    }
  }
  return out;
}
// a dialogue or an InfoLink of the map's Story (P5), by its title: one gone said missing, none yet said
function storyRows(a, v, at, label, h, row) {
  const { esc } = h, all = a.type === 'dialogue' ? h.dialogues : h.infolinks, opts = all || [];
  const what = a.type === 'dialogue' ? 'a dialogue' : 'an InfoLink';
  let out = row(`${label}<select ${at} style="flex:1;min-width:0"><option value="">(choose ${what})</option>${opts.map((o) => `<option value="${esc(o.id)}" ${o.id === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}`
    + `${v && !opts.some((o) => o.id === v) ? `<option selected value="${esc(v)}">${esc(v)} (${all ? 'missing' : 'reading the Story...'})</option>` : ''}</select>`);
  if (all && !opts.length) out += row(`<span class="hint" style="margin:0;flex:1">The map's Story has no ${a.type === 'dialogue' ? 'dialogue' : 'InfoLink'} yet: write one in Story first.</span>`);
  return out;
}
// Warn only about the selected special item; never change its saved class automatically.
function itemWarning(v, h, row) {
  const warning = itemWarningText(h.items, v);
  return warning ? row(`<span class="hint" style="margin:0;flex:1;min-width:0;color:var(--warn)">${h.esc(warning)}</span>`) : '';
}
function itemSelect(h, attrs, v, configureKey = false) {
  return `<select ${attrs} style="flex:1;min-width:0">${itemOptionsHtml(h.items, v, {configureKey})}</select>`;
}
// a crate's items, each as likely as its weight: one row each, and one to add
function itemsRowsHtml(list, j, k, h, row) {
  const { esc } = h;
  let out = row('<span class="hint" style="margin:0;flex:1">Items, each picked as often as its weight</span>');
  list.forEach((it, i) => {
    out += row(`${itemSelect(h, `data-lkitem="${j}" data-k="${esc(k)}" data-i="${i}"`, it.cls)}<label style="width:auto" title="How likely: 2 is twice as likely as 1">×</label>`
      + `<input type="number" data-lkitemw="${j}" data-k="${esc(k)}" data-i="${i}" value="${it.w}" min="0" step="1" style="width:52px"><button data-lkitemrm="${j}" data-k="${esc(k)}" data-i="${i}" title="Remove this item">✕</button>`);
    out += itemWarning(it.cls, h, row);
  });
  out += row(itemSelect(h, `data-lkitemadd="${j}" data-k="${esc(k)}"`, '').replace('(choose an item)', '+ Add an item...'));
  return out;
}

// What a cause takes (c: the rule itself or one of its "Or when..."; ci its index there, -1 the rule's own): the
// catalogue's arguments of its output, a condition for "becomes", a state or a counter for "changes"
export function causeRowsHtml(entry, c, ci, h) {
  const { esc } = h;
  const row = (inner) => `<div class="row" style="padding-left:12px">${inner}</div>`;
  if (c.when === 'becomes') return `<div class="lk-cond" data-lkwatchcond="${ci}" style="margin-left:12px"></div>`;
  if (c.when === 'changes') {
    const w = c.watch && typeof c.watch === 'object' ? c.watch : {}, counter = w.counter !== undefined;
    return row(`<select data-lkwatchk="${ci}"><option value="flag">the state</option><option value="counter" ${counter ? 'selected' : ''}>the counter</option></select>`
      + `<input type="text" data-lkwatchn="${ci}" value="${esc(String((counter ? w.counter : w.flag) || ''))}" placeholder="${counter ? 'Levers' : 'DoorOpen'}" style="flex:1;min-width:0">`);
  }
  if (HAND_CAUSES.has(c.when) && ci < 0) return '';
  let out = '';
  for (const a of (entry && entry.args) || []) {
    if (c.when === 'near' && ci < 0) continue;
    const v = c[a.id] ?? a.default ?? '';
    out += NUMERIC.has(a.type)
      ? row(`<label style="width:auto">${esc(a.label || a.id)}</label><input type="number" data-lkwarg="${ci}" data-k="${esc(a.id)}" value="${esc(String(v))}" min="0"${a.type === 'percent' ? ' max="100"' : ''} step="1" style="width:64px">`)
      : a.type === 'choice'
        ? row(`<label style="width:auto">${esc(a.label || a.id)}</label><select data-lkwarg="${ci}" data-k="${esc(a.id)}" style="flex:1;min-width:0">${(a.choices || []).map(([cv, cl]) => `<option value="${esc(cv)}" ${String(cv) === String(v) ? 'selected' : ''}>${esc(cl)}</option>`).join('')}</select>`)
      : a.type === 'dialogue' || a.type === 'infolink'
        ? storyRows(a, String(v), `data-lkwarg="${ci}" data-k="${esc(a.id)}"`, `<label style="width:auto">${esc(a.label || a.id)}</label>`, h, row)
      : a.type === 'signal'
        ? row(`<label style="width:auto">${esc(a.label || a.id)}</label><input type="text" data-lkwarg="${ci}" data-k="${esc(a.id)}" value="${esc(String(v))}" placeholder="Alarm" list="lk-wsignals-${ci + 1}" style="flex:1;min-width:0">`
          + signalList(`lk-wsignals-${ci + 1}`, h, esc))
        : row(`<label style="width:auto">${esc(a.label || a.id)}</label><input type="text" data-lkwarg="${ci}" data-k="${esc(a.id)}" value="${esc(String(v))}" placeholder="${esc(a.empty && a.empty !== '?' ? a.empty : a.label || '')}" style="flex:1;min-width:0">`);
  }
  return out;
}

// A new cause's own arguments (a rule made with it, an "Or when..." added)
export function causeDefaults(c) {
  if (c.when === 'near' && !c.near) c.near = 256;
  if (c.when === 'keypress' && !c.key) c.key = 'K';
  if (c.when === 'becomes' && !c.watch) c.watch = { flag: '', is: true };
  if (c.when === 'changes' && !c.watch) c.watch = { flag: '' };
  if (c.when === 'jchealth' && c.below === undefined) c.below = '30';
  if (c.when === 'gametag' && c.gameTag === undefined) c.gameTag = '';
  if (c.when === 'signal' && c.signal === undefined) c.signal = '';
  if (c.when === 'ended' && c.dialogue === undefined) c.dialogue = '';
  if (c.when === 'heard' && c.infolink === undefined) c.infolink = '';
  if (c.when === 'goaldone' && c.goal === undefined) c.goal = '';                      // the world (P9 slice 3)
  if (c.when === 'noise' && !c.noise) { c.noise = 'loud'; if (c.within === undefined) c.within = '0'; }
  if (c.when === 'appears' && !c.what) c.what = 'character';
  return c;
}

// How many of the rule's own options are set (the closed section's title says it)
export function optionsSet(l) {
  return [(l.also || []).length > 0, !!l.again, +l.max > 0, +l.cooldown > 0, !!l.talkBusy].filter(Boolean).length;
}

// The rule's options (P6): "Or when..." (its other causes, each with its object, what happens to it and what that
// takes), again while it runs, at most N runs, a pause between runs, the player talking. h: {esc, name(n),
// whenLabel(c, key), eventsOf(c) [keys], entryOf(when), open}
export function ruleOptionsHtml(l, h) {
  const { esc } = h, n = optionsSet(l);
  let s = `<details class="lk-more" data-lkmore="${esc(l.id)}" ${h.open ? 'open' : ''}><summary>More options${n ? ` (${n})` : ''}</summary>`;
  (l.also || []).forEach((c, i) => {
    const evs = h.eventsOf(c), cur = c.when;
    const list = evs.includes(cur) ? evs : [cur].concat(evs);
    s += `<div class="row"><b style="width:auto">Or when</b>${c.src ? `<a href="#" data-lkgo="${esc(c.src)}" title="Go to it">${esc(h.name(c.src))}</a>` : ''}`
      + `<select data-lkalsow="${i}" style="flex:1 1 120px;min-width:0">${list.map((w) => `<option value="${esc(w)}" ${w === cur ? 'selected' : ''}>${esc(h.whenLabel(c, w))}</option>`).join('')}</select>`
      + `<button data-lkalsorm="${i}" title="Remove this cause">✕</button></div>`;
    if (c.when === 'near') s += `<div class="row" style="padding-left:12px"><label style="width:auto">within</label><input type="number" data-lkwarg="${i}" data-k="near" value="${+c.near || 256}" step="32" min="32" style="width:70px"><span class="hint" style="margin:0">units</span></div>`;
    else if (c.when === 'keypress') s += `<div class="row" style="padding-left:12px"><label style="width:auto">key</label><select data-lkwarg="${i}" data-k="key">${(h.keys || []).map((k) => `<option ${k === c.key ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>`;
    else s += causeRowsHtml(h.entryOf(c.when), c, i, h);
  });
  s += `<div class="row"><select data-lkalsoadd style="flex:1;min-width:0"><option value="">+ Or when...</option>`
    + '<option value="@pick">an object does something (click it)…</option>'
    + WORLD_CAUSES.filter((w) => !GAME_WORLD.includes(w)).map((w) => `<option value="${w}">${esc(h.whenLabel({ when: w }, w))}</option>`).join('') + '</select></div>';
  s += `<div class="row"><label style="width:auto" title="What happens when it is set off again while it is still running">If set off again</label><select data-lkagain style="flex:1;min-width:0">${AGAIN.map(([v, t]) => `<option value="${v}" ${v === (l.again || '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  s += `<div class="row"><label style="width:auto" title="0: no limit">At most</label><input type="number" data-lkmaxruns value="${+l.max || 0}" min="0" step="1" style="width:60px"><span class="hint" style="margin:0">times (0: no limit)</span>`
    + `<label style="width:auto" title="The least time from one start to the next">at least</label><input type="number" data-lkcool value="${+l.cooldown || 0}" min="0" step="0.5" style="width:60px"><span class="hint" style="margin:0">s apart</span></div>`;
  s += `<div class="row"><label style="width:auto" title="When a step is due while the player is in a conversation">While the player talks</label><select data-lktalk style="flex:1;min-width:0">${TALK_BUSY.map(([v, t]) => `<option value="${v}" ${v === (l.talkBusy || '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  return s + '</details>';
}

// The sentence's words for the options (lkSentence): "or when ...", "(at most 3 times, at least 5 s apart)"
export function optionsText(l, whenText) {
  const also = (l.also || []).map((c) => whenText(c).replace(/^When /, 'when ')).filter(Boolean);
  const more = [];
  if (l.again === 'restart') more.push('set off again: starts over');
  if (l.again === 'each') more.push('set off again: runs alongside');
  if (+l.max > 0) more.push(`at most ${+l.max} time${+l.max === 1 ? '' : 's'}`);
  if (+l.cooldown > 0) more.push(`at least ${+l.cooldown} s apart`);
  if (l.talkBusy === 'wait') more.push('waits while the player talks');
  if (l.talkBusy === 'giveup') more.push('not while the player talks');
  return { also: also.length ? ' or ' + also.join(' or ') : '', more };
}
