import { itemOptionsHtml } from './item-options.js';
// The conditions of a rule (Interactions) and of a Story event: one model for both, the page's side of
// conditions.py (editor/LOGIC.md, "Conditions"). A state keeps the Story's {flag, is}; the other kinds say what they
// are: {type: 'item', item, has}, {type: 'alive', actor, is}, {type: 'skill', skill, level},
// {type: 'counter', counter, op, value}, {type: 'credits', op, value}, {type: 'near', at: [x, y, z], radius, is}; the
// player's own (P9 slice 2): {type: 'health' | 'energy' | 'skillpoints', op, value}, {type: 'aug', aug, how: 'has' |
// 'on' | 'level', level, is}, {type: 'water', is}, {type: 'zone', zone, is}, {type: 'items', item, op, value} (things of
// a kind: the class or any under it). A compared value is a whole number or (P9 slice 5) a formula of counters such
// as "Alarms + 1" (logic-numbers.js), kept as its text.
// conditionText is the sentence; mountConditions shows a list in a container and edits it (a state with the shared
// state field: state-editor.js).
import { SKILLS } from './behaviours.js';
import { isFormula, valueNow, valueText, formulaProblem } from './logic-numbers.js';

export const CONDITION_KINDS = [['flag', 'A state'], ['item', 'The player carries'], ['alive', 'A character is alive'],
  ['skill', "The player's skill"], ['counter', 'A counter'], ['credits', "The player's credits"], ['near', 'The player is near a point'],
  ['health', "The player's health"], ['energy', "The player's energy"], ['skillpoints', "The player's skill points"],
  ['aug', 'An augmentation of the player'], ['water', 'The player is in water'], ['zone', 'The player is in a zone'],
  ['items', 'The player carries things of a kind']];
// the augmentations of the game (both games: DeusEx.<class>), as the augmentation screen names them
export const AUGS = [['AugAqualung', 'Aqualung'], ['AugBallistic', 'Ballistic Protection'], ['AugCloak', 'Cloak'],
  ['AugCombat', 'Combat Strength'], ['AugDefense', 'Aggressive Defense System'], ['AugDrone', 'Spy Drone'], ['AugEMP', 'EMP Shield'],
  ['AugEnviro', 'Environmental Resistance'], ['AugHealing', 'Regeneration'], ['AugHeartLung', 'Synthetic Heart'], ['AugIFF', 'IFF'],
  ['AugDatalink', 'Infolink'], ['AugLight', 'Light'], ['AugMuscle', 'Microfibral Muscle'], ['AugPower', 'Power Recirculator'],
  ['AugRadarTrans', 'Radar Transparency'], ['AugShield', 'Energy Shield'], ['AugSpeed', 'Speed Enhancement'], ['AugStealth', 'Run Silent'],
  ['AugTarget', 'Targeting'], ['AugVision', 'Vision Enhancement']];
export const AUG_HOW = [['has', 'has'], ['on', 'has turned on'], ['level', 'has at level']];
export const AUG_LEVELS = [[1, '1'], [2, '2'], [3, '3'], [4, '4']];
// kinds of things for "carries things of a kind": [class, one, many]; any item of the game is one too (by its name)
export const ITEM_KINDS = [['DeusEx.DeusExWeapon', 'weapon', 'weapons'], ['DeusEx.DeusExAmmo', 'box of ammunition', 'boxes of ammunition'],
  ['DeusEx.DeusExPickup', 'pickup', 'pickups'], ['DeusEx.ChargedPickup', 'charged pickup', 'charged pickups'],
  ['DeusEx.MedKit', 'med kit', 'med kits'], ['DeusEx.BioelectricCell', 'bioelectric cell', 'bioelectric cells'],
  ['DeusEx.Lockpick', 'lockpick', 'lockpicks'], ['DeusEx.Multitool', 'multitool', 'multitools']];
export const augName = (a) => (AUGS.find((x) => x[0] === a) || [a, a || '?'])[1];
const low = (s) => String(s ?? '').toLowerCase();
// a zone by its name: as the caller names it, else a pool of a box (zones.py: its WaterZone "UCZone_<box>") as the
// Logic window lists it, "Pool (water)"
const zoneText = (n, names) => (names.zone ? names.zone(n) : /^UCZone_./i.test(n) ? `${n.slice(7)} (water)` : n);
// "a weapon", "3 med kits", "2 × Flare" (an item of the game by its own name)
function thingsText(c, n, item) {
  const k = ITEM_KINDS.find((x) => low(x[0]) === low(c.item));
  if (k) return n === 1 ? `a ${k[1]}` : `${n} ${k[2]}`;
  return `${n} × ${c.item ? item(c.item) : '?'}`;
}
export const OPS = [['>=', 'at least'], ['>', 'more than'], ['==', 'exactly'], ['!=', 'not'], ['<=', 'at most'], ['<', 'less than']];
export const LEVELS = [[1, 'Trained'], [2, 'Advanced'], [3, 'Master']];
export const MAX_CONDITIONS = 8;                // a rule's (UCLink.Cond[8], conditions.py); the Story's events take as many

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const kindOf = (c) => c.type || ('flag' in c ? 'flag' : null);
// a condition's Yes or No (a state's or a character's `is`, an item's `has`) as the game gets it: conditions.py _yes
// writes 1 for a key left out, else Python's truth of the value (0, null, '', an empty list or object are No), and
// Holds reads Field != "0". The page's words and fields, the Logic simulator and the Story's Play-test (story-sim.js)
// all read it here, so none says Yes where the game reads No
const pyTruth = (v) => (v !== null && typeof v === 'object' ? Object.keys(v).length > 0 : !!v);
export const yesOf = (c, key) => !Object.hasOwn(c, key) || c[key] === undefined || pyTruth(c[key]);
const opText = (op) => (OPS.find((o) => o[0] === op) || [op, op])[1];
const skillName = (s) => (SKILLS.find((k) => k[0] === s) || [s, s])[1];

// a new condition of a kind, ready to be filled in
export function newCondition(kind, at = null) {
  switch (kind) {
    case 'item': return { type: 'item', item: '', has: true };
    case 'alive': return { type: 'alive', actor: '', is: true };
    case 'skill': return { type: 'skill', skill: 'SkillLockpicking', level: 1 };
    case 'counter': return { type: 'counter', counter: '', op: '>=', value: 1 };
    case 'credits': return { type: 'credits', op: '>=', value: 100 };
    case 'near': return { type: 'near', at: [...(at || [0, 0, 0])].map((v) => Math.round(+v || 0)), radius: 256, is: true };
    case 'health': return { type: 'health', op: '<', value: 30 };
    case 'energy': return { type: 'energy', op: '<', value: 20 };
    case 'skillpoints': return { type: 'skillpoints', op: '>=', value: 1000 };
    case 'aug': return { type: 'aug', aug: 'AugSpeed', how: 'on', is: true };
    case 'water': return { type: 'water', is: true };
    case 'zone': return { type: 'zone', zone: '', is: true };
    case 'items': return { type: 'items', item: 'DeusEx.DeusExWeapon', op: '>=', value: 1 };
    default: return { flag: '', is: true };
  }
}

// "JC carries Multitool", "Guard1 is alive"... names: {actor(name), item(cls), state(c), place(at): what is there,
// "Door2", or ''} give the page's own words; state gets the condition with its `is` already the game's Yes or No
// (true, false)
const pointText = (at) => `(${(at || [0, 0, 0]).map((v) => Math.round(+v || 0)).join(', ')})`;
export function conditionText(c, names = {}) {
  const actor = names.actor || ((n) => n), item = names.item || ((cls) => String(cls).split('.').pop());
  switch (kindOf(c)) {
    case 'flag': return names.state ? names.state({ ...c, is: yesOf(c, 'is') }) : `${c.flag || '?'} is ${yesOf(c, 'is') ? 'Yes' : 'No'}`;
    case 'item': return `the player ${yesOf(c, 'has') ? 'carries' : 'does not carry'} ${c.item ? item(c.item) : '?'}`;
    case 'alive': return `${c.actor ? actor(c.actor) : '?'} is ${yesOf(c, 'is') ? 'alive' : 'not alive'}`;
    case 'skill': return `the player's ${skillName(c.skill)} skill is at least ${(LEVELS.find((l) => l[0] === +c.level) || [0, '?'])[1]}`;
    case 'counter': return `the counter ${c.counter || '?'} is ${opText(c.op)} ${valueText(c.value)}`;
    case 'credits': return `the player has ${opText(c.op)} ${valueText(c.value)} credits`;
    case 'near': {
      const by = names.place ? names.place(c.at) : '';
      return `the player is ${yesOf(c, 'is') ? '' : 'not '}within ${Math.round(+c.radius || 256)} units of ${by ? `the point by ${by}` : 'the point ' + pointText(c.at)}`;
    }
    case 'health': case 'energy': return `the player's ${kindOf(c)} is ${opText(c.op)} ${valueText(c.value)}`;
    case 'skillpoints': return `the player has ${opText(c.op)} ${valueText(c.value)} skill points`;
    case 'aug': {
      const yes = yesOf(c, 'is'), a = augName(c.aug);
      if (c.how === 'on') return `the player's ${a} is ${yes ? 'on' : 'not on'}`;
      if (c.how === 'level') return `the player's ${a} is ${yes ? `at level ${+c.level || 1} or more` : `below level ${+c.level || 1}`}`;
      return `the player ${yes ? 'has' : 'does not have'} ${a}`;
    }
    case 'water': return `the player is ${yesOf(c, 'is') ? '' : 'not '}in water`;
    case 'zone': return `the player is ${yesOf(c, 'is') ? '' : 'not '}in ${c.zone ? zoneText(c.zone, names) : '?'}`;
    case 'items': return `the player carries ${opText(c.op)} ${thingsText(c, numberOrText(c.value), item).replace(/^an? /, 'one ')}`;
    default: return '?';
  }
}

// A condition becoming true, as a rule's cause says it (P9 slice 2: "the player's energy falls below 20", "the player
// turns on Speed Enhancement", "the player enters water"); null when there is no better way than "... becomes true"
const RISE = { '<': 'falls below', '<=': 'falls to', '==': 'becomes', '!=': 'is no longer', '>=': 'reaches', '>': 'rises above' };
const RISE_MANY = { '<': 'fall below', '<=': 'fall to', '==': 'become', '!=': 'are no longer', '>=': 'reach', '>': 'rise above' };
export function comesText(c, names = {}) {
  if (!c || typeof c !== 'object') return null;
  const yes = yesOf(c, 'is'), n = numberOrText(c.value), item = names.item || ((cls) => String(cls).split('.').pop());
  const rise = (what, many = false) => ((many ? RISE_MANY : RISE)[c.op] ? `${what} ${(many ? RISE_MANY : RISE)[c.op]} ${n}${c.op === '<=' ? ' or below' : ''}` : null);
  switch (kindOf(c)) {
    case 'near': return nearComesText(c, names);
    case 'credits': return rise("the player's credits", true);
    case 'health': case 'energy': return rise(`the player's ${kindOf(c)}`);
    case 'skillpoints': return rise("the player's skill points", true);
    case 'aug': {
      const a = augName(c.aug);
      if (c.how === 'on') return yes ? `the player turns on ${a}` : `the player turns off ${a}`;
      if (c.how === 'level') return yes ? `the player's ${a} reaches level ${+c.level || 1}` : `the player's ${a} drops below level ${+c.level || 1}`;
      return yes ? `the player gets ${a}` : `the player loses ${a}`;
    }
    case 'water': return yes ? 'the player enters water' : 'the player comes out of the water';
    case 'zone': { const z = c.zone ? zoneText(c.zone, names) : '?'; return yes ? `the player enters ${z}` : `the player leaves ${z}`; }
    // a state, a counter: "Alarm becomes Yes", "the counter WrongCodes reaches 3" (12 Nov 2026: "When the counter
    // WrongCodes is at least 3 becomes true"); a character's fate keeps its own words
    case 'flag': {
      const said = names.state ? names.state({ ...c, is: yes }) : `${c.flag || '?'} is ${yes ? 'Yes' : 'No'}`;
      const m = /^(.*) is (Yes|No)$/.exec(String(said || ''));
      return m ? `${m[1]} becomes ${m[2]}` : null;
    }
    case 'counter': return rise(`the counter ${c.counter || '?'}`);
    case 'items':
      if (c.op === '>=' && n === 1) return `the player gets ${thingsText(c, 1, item)}`;
      if (c.op === '>=' || c.op === '>') return `the player has ${c.op === '>' ? 'more than' : 'at least'} ${thingsText(c, n, item)}`;
      return null;
    default: return null;
  }
}

// "near a point" becoming true, as a rule's cause says it: "the player comes within 256 units of the point by Door2",
// "the player goes further than 256 units from ..."
export function nearComesText(c, names = {}) {
  const by = names.place ? names.place(c.at) : '', where = by ? `the point by ${by}` : 'the point ' + pointText(c.at);
  const r = Math.round(+(c.radius ?? 256));
  return yesOf(c, 'is') ? `the player comes within ${r} units of ${where}` : `the player goes further than ${r} units from ${where}`;
}

// a compared value in a sentence: a number, or a formula's text
const numberOrText = (v) => (isFormula(v) ? valueText(v) : +v || 0);
// what the game compares with (Holds: NumberOf): a formula worked out with the counters now
const valueOf = (c, game) => valueNow(c.value, (n) => (game.counter ? game.counter(n) : 0), game.value || 0);   // Value: CameWith
const VALUED = new Set(['counter', 'credits', 'health', 'energy', 'skillpoints', 'items']);

// What is missing to make it a condition the game can check ('' when nothing).
export function conditionProblem(c) {
  if (VALUED.has(kindOf(c)) && formulaProblem(c.value)) return 'the formula: ' + formulaProblem(c.value);
  switch (kindOf(c)) {
    case 'flag': return c.flag ? '' : 'choose the state';
    case 'item': return /^\w+\.\w+$/.test(c.item || '') ? '' : 'choose the item';
    case 'alive': return /^\w+$/.test(c.actor || '') ? '' : 'choose the character';
    case 'counter': return String(c.counter || '').trim() ? '' : 'name the counter';
    case 'near': return !Array.isArray(c.at) || c.at.length !== 3 || c.at.some((v) => !Number.isFinite(+v)) ? 'choose the point'
      : (+(c.radius ?? 256) >= 1 && +(c.radius ?? 256) <= 65536 ? '' : 'give a distance from 1 to 65536 units');
    case 'items': return /^\w+\.\w+$/.test(c.item || '') ? '' : 'choose the kind of thing';
    case 'zone': return /^\w+$/.test(c.zone || '') ? '' : 'choose the zone';
    case 'aug': return !/^\w+$/.test(c.aug || '') ? 'choose the augmentation'
      : c.how === 'level' && !(+c.level >= 1 && +c.level <= 4) ? 'choose a level from 1 to 4' : '';
    default: return '';
  }
}

// Does a condition hold now? The page's twin of the game's UCEditorStory.Holds, for every kind, so the Logic
// simulator (logic-sim.js) judges a rule's conditions as the game does (story-sim.js knows states only). game: what
// the game reads, {flag(name), counter(name), carries(cls), alive(actor), skill(name), credits, player: where the
// player is, [x, y, z] or null}; a part left out reads as nothing set (No, 0, carries nothing, nobody alive,
// untrained, the player nowhere); the player's own (P9 slice 2): health, energy, skillPoints (numbers), aug(name): {has, on,
// level 1-4} or null, water (true: in water), zone (its name), countOf(cls): how many things of a class or under it.
// A kind the game does not know never holds (Holds logs it: logic-log.js 'bad').
// near: as the game, the point and the distance in whole units (conditions.py encode), measured in 3D (VSize)
export function nearHolds(c, player) {
  if (!player) return false;
  const at = (c.at || [0, 0, 0]).map((v) => Math.round(+v || 0));
  return Math.hypot(player[0] - at[0], player[1] - at[1], player[2] - at[2]) <= Math.round(+(c.radius ?? 256));
}
const COMPARE = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b,
  '>=': (a, b) => a >= b, '>': (a, b) => a > b };
const whole = (v) => Math.trunc(+v || 0);       // the game's int(): a fraction cut, not a number 0
const compare = (a, op, b) => Object.hasOwn(COMPARE, op) && COMPARE[op](whole(a), whole(b));     // Holds' Compare
export function conditionHolds(c, game) {
  const yes = (key) => yesOf(c, key);
  switch (kindOf(c)) {
    case 'flag': return !!(game.flag && game.flag(c.flag)) === yes('is');
    case 'item': return !!(game.carries && game.carries(c.item)) === yes('has');
    case 'alive': return !!(game.alive && game.alive(c.actor)) === yes('is');
    case 'skill': return whole(game.skill ? game.skill(c.skill) : 0) >= whole(c.level);
    case 'counter': return compare(game.counter ? game.counter(c.counter) : 0, c.op, valueOf(c, game));
    case 'credits': return compare(game.credits, c.op, valueOf(c, game));
    case 'near': return nearHolds(c, game.player || null) === yes('is');
    case 'health': return compare(game.health, c.op, valueOf(c, game));
    case 'energy': return compare(game.energy, c.op, valueOf(c, game));
    case 'skillpoints': return compare(game.skillPoints, c.op, valueOf(c, game));
    case 'aug': {
      const a = game.aug ? game.aug(c.aug) : null, has = !!a && !!a.has;
      const now = c.how === 'on' ? has && !!a.on : c.how === 'level' ? has && whole(a.level) >= whole(c.level) : has;
      return now === yes('is');
    }
    case 'water': return !!game.water === yes('is');
    case 'zone': return (!!game.zone && low(game.zone) === low(c.zone)) === yes('is');
    case 'items': return compare(game.countOf ? game.countOf(c.item) : 0, c.op, valueOf(c, game));
    default: return false;
  }
}

const options = (pairs, cur) => pairs.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(t)}</option>`).join('');

// one row's own fields (data-cf: the field it writes)
function rowFields(c, ctx) {
  const yesNo = (key, yes, no) => `<select data-cf="${key}">${options([['1', yes], ['0', no]], yesOf(c, key) ? '1' : '0')}</select>`;
  let number = (key) => `<input type="number" data-cf="${key}" value="${+c[key] || 0}" step="1" style="width:70px">`;
  if (VALUED.has(kindOf(c))) {          // the compared value: a number, or (P9 slice 5) a formula of counters
    const plain = number;
    number = (key) => (key !== 'value' ? plain(key) : isFormula(c.value) ? formulaInput(c.value)
      : `${plain(key)}<button type="button" data-cfx title="${esc(FORMULA_TITLE)}">ƒx</button>`);
  }
  switch (kindOf(c)) {
    case 'flag': return '<div class="cond-state" style="flex:1;min-width:0"></div>';
    case 'item': return `${yesNo('has', 'The player carries', 'The player does not carry')}<select data-cf="item" style="flex:1;min-width:0">${itemOptionsHtml(ctx.items, c.item)}</select>`;
    case 'alive': return `<select data-cf="actor" style="flex:1;min-width:0"><option value="">(choose the character)</option>${options((ctx.characters || []).map((a) => [a.name, a.label]), c.actor)}${
      c.actor && !(ctx.characters || []).some((a) => a.name === c.actor) ? `<option selected value="${esc(c.actor)}">${esc(c.actor)}</option>` : ''}</select>${yesNo('is', 'is alive', 'is not alive')}`;
    case 'skill': return `<select data-cf="skill" style="flex:1;min-width:0">${options(SKILLS, c.skill)}</select><span class="hint" style="margin:0">at least</span><select data-cf="level">${options(LEVELS, c.level)}</select>`;
    case 'counter': return `<input type="text" data-cf="counter" value="${esc(c.counter || '')}" placeholder="counter name" list="${ctx.counterList}" style="flex:1;min-width:0"><select data-cf="op">${options(OPS, c.op)}</select>${number('value')}`;
    case 'credits': return `<span class="hint" style="margin:0">The player has</span><select data-cf="op">${options(OPS, c.op)}</select>${number('value')}<span class="hint" style="margin:0">credits</span>`;
    case 'health': case 'energy': return `<span class="hint" style="margin:0">The player's ${kindOf(c)} is</span><select data-cf="op">${options(OPS, c.op)}</select>${number('value')}`;
    case 'skillpoints': return `<span class="hint" style="margin:0">The player has</span><select data-cf="op">${options(OPS, c.op)}</select>${number('value')}<span class="hint" style="margin:0">skill points</span>`;
    case 'aug': return `${yesNo('is', 'The player', 'The player not')}<select data-cf="how">${options(AUG_HOW, c.how || 'has')}</select>`
      + `<select data-cf="aug" style="flex:1;min-width:0">${options(AUGS, c.aug)}${c.aug && !AUGS.some((a) => a[0] === c.aug) ? `<option selected value="${esc(c.aug)}">${esc(c.aug)}</option>` : ''}</select>`
      + (c.how === 'level' ? `<span class="hint" style="margin:0">or more:</span><select data-cf="level">${options(AUG_LEVELS, c.level)}</select>` : '');
    case 'water': return yesNo('is', 'The player is in water', 'The player is not in water');
    case 'zone': return `${yesNo('is', 'The player is in', 'The player is not in')}<select data-cf="zone" style="flex:1;min-width:0"><option value="">(choose the zone)</option>${options((ctx.zones || []).map((z) => [z.name, z.label]), c.zone)}${
      c.zone && !(ctx.zones || []).some((z) => z.name === c.zone) ? `<option selected value="${esc(c.zone)}">${esc(c.zone)}</option>` : ''}</select>`;
    case 'items': {
      const kinds = ITEM_KINDS.map((k) => [k[0], `any ${k[1]}`]), isKind = kinds.some((k) => k[0] === c.item);
      return `<span class="hint" style="margin:0">The player carries</span><select data-cf="op">${options(OPS, c.op)}</select>${number('value')}`
        + `<select data-cf="item" style="flex:1;min-width:0"><optgroup label="Kinds">${options(kinds, c.item)}</optgroup>${itemOptionsHtml(ctx.items, c.item, { empty: null, fallback: !isKind })}</select>`;
    }
    case 'near': return `<div style="flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:4px;align-items:center">${yesNo('is', 'The player is', 'The player is not')}<span class="hint" style="margin:0">within</span><input type="number" data-cf="radius" value="${Math.round(+(c.radius ?? 256))}" step="32" min="1" style="width:64px"><span class="hint" style="margin:0">units of</span>`
      + [0, 1, 2].map((k) => `<span style="display:inline-flex;gap:3px;align-items:center;white-space:nowrap"><span class="hint" style="margin:0">${'XYZ'[k]}</span><input type="number" data-cat="${k}" value="${Math.round(+(c.at || [])[k] || 0)}" style="width:72px"></span>`).join('')
      + (ctx.point ? '<button type="button" data-cpt="selected" title="Put the point where the selected object is">Selected object</button><button type="button" data-cpt="camera" title="Put the point in front of the camera">In front of the camera</button>' : '')
      + '</div>';
    default: return '';
  }
}

export const FORMULA_TITLE = 'Work it out from counters instead: a formula such as Alarms + 1, Guards * 2 or (Coins + 5) / 2';
const formulaInput = (v) => `<input type="text" data-cf="value" value="${esc(String(v ?? ''))}" placeholder="Alarms + 1" title="${esc(FORMULA_TITLE)}" autocomplete="off" spellcheck="false" style="width:120px">`;

// the number field before the button b becomes a text field for a formula (the same field: its change still writes)
export function formulaField(b) {
  const n = b.previousElementSibling;
  n.type = 'text';
  n.placeholder = 'Alarms + 1';
  n.title = FORMULA_TITLE;
  n.autocomplete = 'off';
  n.spellcheck = false;
  n.style.width = '120px';
  b.remove();
  n.focus();
  n.select();
}

let mounts = 0;                                 // each list its own datalist of counters (ids are page-wide)
// Shows `list` in `host` and edits it. ctx: {change(mutate): the caller records the change (undo, save) and redraws;
// mountState(host, value, onChange): the shared state field; items: [{cls, name, cat}], characters: [{name, label}],
// counters: [names], empty: the text with no condition, max: how many it takes (a rule's: MAX_CONDITIONS; a Story
// event's: any number, Infinity), point(how): a place of the scene for "near a point", how 'selected' (the selected
// object's, or null) or 'camera' (in front of the camera; a new one starts there), warn(text): says a problem,
// addLabel: the adder's words ("+ Only if..." by default; a rule's watched condition: it takes the place of the one there)}
export function mountConditions(host, list, ctx) {
  const max = ctx.max ?? MAX_CONDITIONS;
  const counterList = 'cond-counters-' + (++mounts);
  host.innerHTML = (list.length ? '' : `<p class="hint" style="margin:2px 0">${esc(ctx.empty || 'No conditions: it always runs.')}</p>`)
    + list.map((c, i) => `<div class="row cond-row" data-ci="${i}" style="gap:4px;align-items:center">${rowFields(c, { ...ctx, counterList })}<button data-cdel="${i}" title="Remove this condition">✕</button></div>`
      + (conditionProblem(c) ? `<div class="hint" style="margin:0 0 4px 4px;color:var(--warn)">${esc(conditionProblem(c))}</div>` : '')).join('')
    + (list.length < max ? `<div class="row"><select data-cadd style="flex:1;min-width:0"><option value="">${esc(ctx.addLabel || '+ Only if...')}</option>${options(CONDITION_KINDS, '')}</select></div>` : '')
    + `<datalist id="${counterList}">${(ctx.counters || []).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`;
  list.forEach((c, i) => {
    const row = host.querySelector(`[data-ci="${i}"]`);
    if (kindOf(c) === 'flag') ctx.mountState(row.querySelector('.cond-state'), { flag: c.flag || '', is: yesOf(c, 'is') }, (v) => ctx.change(() => { c.flag = v.flag; c.is = v.is !== false; }));
    for (const f of row.querySelectorAll('[data-cf]')) f.onchange = () => ctx.change(() => {
      const key = f.dataset.cf;
      if (key === 'has' || key === 'is') c[key] = f.value === '1';
      else if (key === 'value' && isFormula(f.value)) c.value = f.value.trim();          // a formula (P9 slice 5)
      else if (key === 'level' || key === 'value') c[key] = Math.trunc(+String(f.value).replace(',', '.') || 0);
      else if (key === 'radius') c.radius = Math.min(65536, Math.max(1, Math.round(+f.value || 256)));
      else if (key === 'how') { c.how = f.value; if (c.how === 'level' && !(+c.level >= 1)) c.level = 1; }
      else c[key] = f.value.trim();
    });
    for (const b of row.querySelectorAll('[data-cfx]')) b.onclick = () => formulaField(b);   // the number becomes a formula
    for (const f of row.querySelectorAll('[data-cat]')) f.onchange = () => ctx.change(() => {
      c.at = [...(c.at || [0, 0, 0])];
      c.at[+f.dataset.cat] = Math.round(+f.value || 0);
    });
    for (const b of row.querySelectorAll('[data-cpt]')) b.onclick = () => {
      const p = ctx.point(b.dataset.cpt);
      if (!p) { ctx.warn?.('Select an object in the scene first.'); return; }
      ctx.change(() => { c.at = p.map((v) => Math.round(+v || 0)); });
    };
  });
  for (const b of host.querySelectorAll('[data-cdel]')) b.onclick = () => ctx.change(() => { list.splice(+b.dataset.cdel, 1); });
  const add = host.querySelector('[data-cadd]');
  if (add) add.onchange = () => {
    const kind = add.value;
    add.value = '';
    if (!kind) return;
    newRow = { n: list.length + 1, at: Date.now() };
    ctx.change(() => { list.push(newCondition(kind, kind === 'near' && ctx.point ? ctx.point('camera') : null)); });
  };
  focusNewRow(host, list);
}
// a condition just added: its first field has the keys once it is drawn, so the state's name is typed at once
// (13 Nov 2026: after "+ Only if... > A state" the keys stayed on the adder and the name field had to be clicked)
let newRow = null;
function focusNewRow(host, list) {
  const r = newRow;
  if (!r || Date.now() - r.at > 3000 || list.length !== r.n) return;
  const row = host.querySelector(`[data-ci="${r.n - 1}"]`);
  if (!row) return;
  newRow = null;
  const give = () => {
    const a = document.activeElement;
    const free = !a || a === document.body || !a.isConnected || a.matches('[data-cadd], .lw-edit');
    if (!free) return;                         // the keys went somewhere on purpose
    const f = row.querySelector('input:not([type=checkbox]):not([type=hidden]), select');
    if (f && f.offsetParent !== null) { f.focus({ preventScroll: false }); if (f.tagName === 'INPUT') f.select?.(); }
  };
  setTimeout(give, 0);
}
