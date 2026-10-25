// The conditions of a rule (Interactions) and of a Story event: one model for both, the page's side of
// conditions.py (editor/LOGIC.md, "Conditions"). A state keeps the Story's {flag, is}; the other kinds say what they
// are: {type: 'item', item, has}, {type: 'alive', actor, is}, {type: 'skill', skill, level},
// {type: 'counter', counter, op, value}, {type: 'credits', op, value}.
// conditionText is the sentence; mountConditions shows a list in a container and edits it (a state with the shared
// state field: state-editor.js).
import { SKILLS } from './behaviours.js';

export const CONDITION_KINDS = [['flag', 'A state'], ['item', 'JC carries'], ['alive', 'A character is alive'],
  ['skill', "JC's skill"], ['counter', 'A counter'], ['credits', "JC's credits"]];
export const OPS = [['>=', 'at least'], ['>', 'more than'], ['==', 'exactly'], ['!=', 'not'], ['<=', 'at most'], ['<', 'less than']];
export const LEVELS = [[1, 'Trained'], [2, 'Advanced'], [3, 'Master']];
export const MAX_CONDITIONS = 8;                // a rule's (UCLink.Cond[8], conditions.py); the Story's events take as many

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const kindOf = (c) => c.type || ('flag' in c ? 'flag' : null);
const opText = (op) => (OPS.find((o) => o[0] === op) || [op, op])[1];
const skillName = (s) => (SKILLS.find((k) => k[0] === s) || [s, s])[1];

// a new condition of a kind, ready to be filled in
export function newCondition(kind) {
  switch (kind) {
    case 'item': return { type: 'item', item: '', has: true };
    case 'alive': return { type: 'alive', actor: '', is: true };
    case 'skill': return { type: 'skill', skill: 'SkillLockpicking', level: 1 };
    case 'counter': return { type: 'counter', counter: '', op: '>=', value: 1 };
    case 'credits': return { type: 'credits', op: '>=', value: 100 };
    default: return { flag: '', is: true };
  }
}

// "JC carries Multitool", "Guard1 is alive"... names: {actor(name), item(cls), state(c)} give the page's own words
export function conditionText(c, names = {}) {
  const actor = names.actor || ((n) => n), item = names.item || ((cls) => String(cls).split('.').pop());
  switch (kindOf(c)) {
    case 'flag': return names.state ? names.state(c) : `${c.flag || '?'} is ${c.is === false ? 'No' : 'Yes'}`;
    case 'item': return `JC ${c.has === false ? 'does not carry' : 'carries'} ${c.item ? item(c.item) : '?'}`;
    case 'alive': return `${c.actor ? actor(c.actor) : '?'} is ${c.is === false ? 'not alive' : 'alive'}`;
    case 'skill': return `JC's ${skillName(c.skill)} skill is at least ${(LEVELS.find((l) => l[0] === +c.level) || [0, '?'])[1]}`;
    case 'counter': return `the counter ${c.counter || '?'} is ${opText(c.op)} ${+c.value || 0}`;
    case 'credits': return `JC has ${opText(c.op)} ${+c.value || 0} credits`;
    default: return '?';
  }
}

// What is missing to make it a condition the game can check ('' when nothing).
export function conditionProblem(c) {
  switch (kindOf(c)) {
    case 'flag': return c.flag ? '' : 'choose the state';
    case 'item': return /^\w+\.\w+$/.test(c.item || '') ? '' : 'choose the item';
    case 'alive': return /^\w+$/.test(c.actor || '') ? '' : 'choose the character';
    case 'counter': return String(c.counter || '').trim() ? '' : 'name the counter';
    default: return '';
  }
}

const options = (pairs, cur) => pairs.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(t)}</option>`).join('');

// one row's own fields (data-cf: the field it writes)
function rowFields(c, ctx) {
  const yesNo = (key, yes, no) => `<select data-cf="${key}">${options([['1', yes], ['0', no]], c[key] === false ? '0' : '1')}</select>`;
  const number = (key) => `<input type="number" data-cf="${key}" value="${+c[key] || 0}" step="1" style="width:70px">`;
  switch (kindOf(c)) {
    case 'flag': return '<div class="cond-state" style="flex:1;min-width:0"></div>';
    case 'item': return `${yesNo('has', 'JC carries', 'JC does not carry')}<select data-cf="item" style="flex:1;min-width:0"><option value="">(choose the item)</option>${
      [...new Set((ctx.items || []).map((x) => x.cat))].map((cat) => `<optgroup label="${esc(cat)}">${options((ctx.items || []).filter((x) => x.cat === cat).map((x) => [x.cls, x.name]), c.item)}</optgroup>`).join('')}${
      c.item && !(ctx.items || []).some((x) => x.cls === c.item) ? `<option selected value="${esc(c.item)}">${esc(c.item)}</option>` : ''}</select>`;
    case 'alive': return `<select data-cf="actor" style="flex:1;min-width:0"><option value="">(choose the character)</option>${options((ctx.characters || []).map((a) => [a.name, a.label]), c.actor)}${
      c.actor && !(ctx.characters || []).some((a) => a.name === c.actor) ? `<option selected value="${esc(c.actor)}">${esc(c.actor)}</option>` : ''}</select>${yesNo('is', 'is alive', 'is not alive')}`;
    case 'skill': return `<select data-cf="skill" style="flex:1;min-width:0">${options(SKILLS, c.skill)}</select><span class="hint" style="margin:0">at least</span><select data-cf="level">${options(LEVELS, c.level)}</select>`;
    case 'counter': return `<input type="text" data-cf="counter" value="${esc(c.counter || '')}" placeholder="counter name" list="${ctx.counterList}" style="flex:1;min-width:0"><select data-cf="op">${options(OPS, c.op)}</select>${number('value')}`;
    case 'credits': return `<span class="hint" style="margin:0">JC has</span><select data-cf="op">${options(OPS, c.op)}</select>${number('value')}<span class="hint" style="margin:0">credits</span>`;
    default: return '';
  }
}

let mounts = 0;                                 // each list its own datalist of counters (ids are page-wide)
// Shows `list` in `host` and edits it. ctx: {change(mutate): the caller records the change (undo, save) and redraws;
// mountState(host, value, onChange): the shared state field; items: [{cls, name, cat}], characters: [{name, label}],
// counters: [names], empty: the text with no condition, max: how many it takes (a rule's: MAX_CONDITIONS; a Story
// event's: any number, Infinity)}
export function mountConditions(host, list, ctx) {
  const max = ctx.max ?? MAX_CONDITIONS;
  const counterList = 'cond-counters-' + (++mounts);
  host.innerHTML = (list.length ? '' : `<p class="hint" style="margin:2px 0">${esc(ctx.empty || 'No conditions: it always runs.')}</p>`)
    + list.map((c, i) => `<div class="row cond-row" data-ci="${i}" style="gap:4px;align-items:center">${rowFields(c, { ...ctx, counterList })}<button data-cdel="${i}" title="Remove this condition">✕</button></div>`
      + (conditionProblem(c) ? `<div class="hint" style="margin:0 0 4px 4px;color:var(--warn)">${esc(conditionProblem(c))}</div>` : '')).join('')
    + (list.length < max ? `<div class="row"><select data-cadd style="flex:1;min-width:0"><option value="">+ Only if...</option>${options(CONDITION_KINDS, '')}</select></div>` : '')
    + `<datalist id="${counterList}">${(ctx.counters || []).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`;
  list.forEach((c, i) => {
    const row = host.querySelector(`[data-ci="${i}"]`);
    if (kindOf(c) === 'flag') ctx.mountState(row.querySelector('.cond-state'), { flag: c.flag || '', is: c.is !== false }, (v) => ctx.change(() => { c.flag = v.flag; c.is = v.is !== false; }));
    for (const f of row.querySelectorAll('[data-cf]')) f.onchange = () => ctx.change(() => {
      const key = f.dataset.cf;
      if (key === 'has' || key === 'is') c[key] = f.value === '1';
      else if (key === 'level' || key === 'value') c[key] = Math.trunc(+f.value || 0);
      else c[key] = f.value.trim();
    });
  });
  for (const b of host.querySelectorAll('[data-cdel]')) b.onclick = () => ctx.change(() => { list.splice(+b.dataset.cdel, 1); });
  const add = host.querySelector('[data-cadd]');
  if (add) add.onchange = () => { const kind = add.value; add.value = ''; if (kind) ctx.change(() => { list.push(newCondition(kind)); }); };
}
