// The parts of a rule's form (app.js lkRuleHtml) that the catalogue describes (config/logic.json): an action's
// arguments by their type (the P4 verbs: no hand-made rows), what an output takes (hurt below N%, a floor, the
// player's health, a game event's Tag), and the rule's own options of the Logic runtime v2 (P6: other causes, all or
// any of its checks, again while it runs, at most N runs, a pause between runs, the player talking). Only HTML here:
// app.js wires the data-* attributes (lkWire) to edits.links, as it does for its own rows.
//
// The values are kept as links.py reads them (editor/links.py: _whole, _secs, watch_test, needs_rule): numbers as
// text, a place as [x, y, z] in 'at', a bool as true/false, a yes/no as '1'/'0', a crate's items as
// "Package.Class:weight;...".

// the action rows app.js draws itself (the verbs before P4, and interaction-blocks.js's)
export const HAND_ROWS = new Set(['key', 'attack', 'hostile', 'goto', 'run', 'explode', 'sound', 'message', 'note', 'goal', 'flag',
  'input', 'floor', 'count', 'fpmoment', 'travel', 'body', 'sit', 'timerstart', 'npcuse', 'effect']);
// the cause rows app.js draws itself (near: within; keypress: the key; option: the computer's button; output: a
// script's port)
export const HAND_CAUSES = new Set(['near', 'keypress', 'option', 'output']);
// the causes with no object: what happens in the world (the Logic window's "The map" list, "Or when...")
export const WORLD_CAUSES = ['start', 'keypress', 'becomes', 'changes', 'jchealth', 'gametag'];
export const AGAIN = [['', 'while running: let it finish'], ['restart', 'while running: start again'], ['each', 'run it again alongside (8 at most)']];
export const TALK_BUSY = [['', 'go on'], ['wait', 'wait until the talk is over'], ['giveup', 'give up that run']];
// a few of the game's characters for "Send reinforcements" (any Package.Class can be typed)
export const PAWN_CLASSES = ['DeusEx.MJ12Troop', 'DeusEx.MJ12Commando', 'DeusEx.UNATCOTroop', 'DeusEx.Terrorist', 'DeusEx.Soldier',
  'DeusEx.RiotCop', 'DeusEx.Cop', 'DeusEx.ThugMale', 'DeusEx.MIB', 'DeusEx.WIB', 'DeusEx.SecurityBot2', 'DeusEx.SecurityBot3',
  'DeusEx.MilitaryBot', 'DeusEx.SpiderBot2', 'DeusEx.Greasel', 'DeusEx.Karkian'];

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

// The rows of an action's arguments (step j). h: {esc, name(n), items [{cls, name}], rules [{id, label}], songs []}
export function argRowsHtml(args, x, j, h) {
  const { esc } = h;
  const row = (inner) => `<div class="row" style="padding-left:38px">${inner}</div>`;
  const label = (a) => `<label style="width:auto" title="${esc(a.label || a.id)}">${esc(a.label || a.id)}</label>`;
  let out = '';
  for (const a of args || []) {
    const v = argValue(x, a), k = esc(a.id), at = `data-lkarg="${j}" data-k="${k}"`;
    if (NUMERIC.has(a.type)) {
      const min = a.type === 'whole' ? '' : ' min="0"', max = a.type === 'percent' ? ' max="100"' : '';
      out += row(`${label(a)}<input type="number" ${at} value="${esc(String(v))}"${min}${max} step="${STEP[a.type] || 1}" style="width:72px">`);
    } else if (a.type === 'choice') {
      const choices = a.choices || [];
      out += row(`${label(a)}<select ${at} style="flex:1;min-width:0">${choices.map(([cv, cl]) => `<option value="${esc(cv)}" ${String(cv) === String(v) ? 'selected' : ''}>${esc(cl)}</option>`).join('')}</select>`);
    } else if (a.type === 'bool') {
      out += row(`<label style="width:auto"><input type="checkbox" data-lkargb="${j}" data-k="${k}" ${x[a.id] === undefined ? (a.default ? 'checked' : '') : x[a.id] ? 'checked' : ''}> ${esc(a.label || a.id)}</label>`);
    } else if (a.type === 'yesno') {
      out += row(`<label style="width:auto"><input type="checkbox" data-lkargyn="${j}" data-k="${k}" ${String(v) === '0' ? '' : 'checked'}> ${esc(a.label || a.id)}</label>`);
    } else if (a.type === 'place') {
      const p = Array.isArray(x[a.id]) ? x[a.id] : null;
      out += row(`${label(a)}<span class="hint" style="margin:0;flex:1">${p ? p.map((n) => Math.round(n)).join(', ') : '(click a place)'}</span><button data-lkat="${j}" data-k="${k}" title="Click the floor there">pick</button>`);
    } else if (a.type === 'object') {
      const has = !!x[a.id];
      out += row(`${label(a)}<a href="#" data-lkgo="${esc(x[a.id] || '')}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${has ? '' : ';color:var(--bad)'}" title="Go to it">${esc(has ? h.name(x[a.id]) : a.empty || '(none yet)')}</a><button data-lkobj="${j}" data-k="${k}" title="Click it in the map">${has ? 'change' : 'pick'}</button>`);
    } else if (a.type === 'itemclass') {
      out += row(`${label(a)}${itemSelect(h, `${at}`, v)}`);
    } else if (a.type === 'items') {
      out += itemsRowsHtml(parseItems(v), j, a.id, h, row);
    } else if (a.type === 'hex') {
      out += row(`${label(a)}<input type="color" ${at} value="${esc(/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : '#ffffff')}" style="width:56px">`);
    } else if (a.type === 'rule') {
      const rules = h.rules || [];
      out += row(`${label(a)}<select ${at} style="flex:1;min-width:0"><option value="">(choose a rule)</option>${rules.map((r) => `<option value="${esc(r.id)}" ${r.id === v ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}${v && !rules.some((r) => r.id === v) ? `<option selected value="${esc(v)}">${esc(v)} (missing)</option>` : ''}</select>`);
    } else {                                   // text, line, tag, state, counter, goal, map, pawnclass, song, sound...
      const list = a.type === 'pawnclass' ? `lk-pawns-${j}` : a.type === 'song' && (h.songs || []).length ? `lk-songs-${j}` : '';
      const opts = a.type === 'pawnclass' ? PAWN_CLASSES : a.type === 'song' ? h.songs || [] : [];
      const ph = a.type === 'pawnclass' ? 'Package.Class, e.g. DeusEx.MJ12Troop' : a.type === 'song' ? 'Package.Song (empty: silence)' : a.label || '';
      out += row(`${label(a)}<input type="text" ${at} value="${esc(String(v))}" placeholder="${esc(ph)}" ${list ? `list="${list}"` : ''} style="flex:1;min-width:0">`
        + (list ? `<datalist id="${list}">${opts.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''));
    }
  }
  return out;
}
function itemSelect(h, attrs, v) {
  const { esc } = h, items = h.items || [];
  return `<select ${attrs} style="flex:1;min-width:0"><option value="">(choose an item)</option>${items.map((i) => `<option value="${esc(i.cls)}" ${i.cls === v ? 'selected' : ''}>${esc(i.name || i.cls)}</option>`).join('')}`
    + `${v && !items.some((i) => i.cls === v) ? `<option selected value="${esc(v)}">${esc(String(v).split('.').pop())}</option>` : ''}</select>`;
}
// a crate's items, each as likely as its weight: one row each, and one to add
function itemsRowsHtml(list, j, k, h, row) {
  const { esc } = h;
  let out = row('<span class="hint" style="margin:0;flex:1">Items, each picked as often as its weight</span>');
  list.forEach((it, i) => {
    out += row(`${itemSelect(h, `data-lkitem="${j}" data-k="${esc(k)}" data-i="${i}"`, it.cls)}<label style="width:auto" title="How likely: 2 is twice as likely as 1">×</label>`
      + `<input type="number" data-lkitemw="${j}" data-k="${esc(k)}" data-i="${i}" value="${it.w}" min="0" step="1" style="width:52px"><button data-lkitemrm="${j}" data-k="${esc(k)}" data-i="${i}" title="Remove this item">✕</button>`);
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
    + WORLD_CAUSES.map((w) => `<option value="${w}">${esc(h.whenLabel({ when: w }, w))}</option>`).join('') + '</select></div>';
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
  if (l.again === 'restart') more.push('set off again: from the start');
  if (l.again === 'each') more.push('set off again: alongside');
  if (+l.max > 0) more.push(`at most ${+l.max} time${+l.max === 1 ? '' : 's'}`);
  if (+l.cooldown > 0) more.push(`at least ${+l.cooldown} s apart`);
  if (l.talkBusy === 'wait') more.push('waits while the player talks');
  if (l.talkBusy === 'giveup') more.push('not while the player talks');
  return { also: also.length ? ' or ' + also.join(' or ') : '', more };
}
