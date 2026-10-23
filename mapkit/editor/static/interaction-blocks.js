// The building blocks of the Interactions (editor/links.py; in the game UCTimer, UCUsable, UCNpcUse,
// UCEffect): timers, objects JC can use, characters going to use an object, effects on objects. Generic
// on purpose: a bomb to defuse, a generator to sabotage, a hostage to free in time, a PC to hack while the
// guards come are all made of the same pieces. Labels, sentences and the HTML of their rows live here
// (pure functions: app.js wires them; tests/test_interaction_blocks.mjs checks them).

// what can start a rule
export const BLOCK_WHEN = {
  npcused: 'a character has used it',
  finished: 'it runs out',
  stopped: 'an action stops it',
  arrived: 'they get where they were sent (Walk / Run to a place)',
};

// what a rule can do: [label, kind of object it acts on]
export const BLOCK_VERBS = {
  timerstart: ['Start the timer', 'timer'],
  timerstop: ['Stop the timer', 'timer'],
  timerpause: ['Pause the timer', 'timer'],
  timerresume: ['Resume the timer', 'timer'],
  npcuse: ['Go and use an object', 'character'],
  effect: ['An effect on it (mist, sparks, light...)', 'any'],
};

export const TIMER_VERBS = ['timerstart', 'timerstop', 'timerpause', 'timerresume'];
// the kinds of objects an effect can be put on (Interactions: LK_FOR of app.js)
export const EFFECT_ON = ['door', 'camera', 'alarm', 'item', 'object', 'keypad', 'computer', 'other'];

export const EFFECT_KINDS = [
  ['mist', 'Mist pouring out'], ['smoke', 'Smoke rising'], ['sparks', 'Sparks'], ['fire', 'Fire'],
  ['blinklight', 'A blinking light'], ['pulse', 'A pulsing light'], ['off', 'Stop its effects'],
];
export const EFFECT_COLOURS = ['red', 'green', 'blue', 'yellow', 'orange', 'white'];
const effectLabel = (k) => (EFFECT_KINDS.find((e) => e[0] === k) || [k, k])[1];
export const isLightEffect = (k) => k === 'blinklight' || k === 'pulse';

// the colour and the beep of a light effect, kept together in the action's c field ("red beep"); "exact":
// exactly on the object, without the offsets of the effect (UCEffect: not lowered to the floor, not on top)
export function effectOptions(c) {
  const words = String(c || '').toLowerCase().split(/\s+/);
  return { colour: EFFECT_COLOURS.find((x) => words.includes(x)) || 'red', beep: words.includes('beep'), exact: words.includes('exact') };
}
export function effectOptionText(colour, beep, exact = false) {
  return `${EFFECT_COLOURS.includes(colour) ? colour : 'red'}${beep ? ' beep' : ''}${exact ? ' exact' : ''}`;
}
// the c field with "exact" on or off, the rest kept
export function withExact(c, on) {
  const words = String(c || '').toLowerCase().split(/\s+/).filter((w) => w && w !== 'exact');
  if (on) words.push('exact');
  return words.join(' ');
}

export function blockDefaults(x) {
  if (x.verb === 'npcuse') { x.b = x.b || '4'; x.c = x.c === 'stand' ? 'stand' : 'crouch'; }
  if (x.verb === 'effect') {
    if (!EFFECT_KINDS.some((e) => e[0] === x.a)) x.a = 'mist';
    if (x.b === undefined || x.b === '') x.b = '0';
    if (isLightEffect(x.a) && !x.c) x.c = 'red';
  }
}

const secs = (v) => (+v > 0 ? `${+v} s` : '');

// "When ..." for the new events (s: the object's name in the sentence)
export function blockWhenText(when, s) {
  switch (when) {
    case 'npcused': return `When a character has used ${s}`;
    case 'finished': return `When ${s} runs out`;
    case 'stopped': return `When ${s} is stopped`;
    case 'arrived': return `When ${s} gets where they were sent`;
    default: return '';
  }
}

// "... do this" for the new actions (t: the target's name, nameOf: the name of another object; info.point:
// the target is an effect point)
export function blockActText(x, t, nameOf, info = {}) {
  switch (x.verb) {
    case 'timerstart': return `start ${t}${+x.a > 0 ? ` (${+x.a} s)` : ''}`;
    case 'timerstop': return `stop ${t}`;
    case 'timerpause': return `pause ${t}`;
    case 'timerresume': return `resume ${t}`;
    case 'npcuse': {
      const what = x.a ? nameOf(x.a) : '(an object: choose it)';
      return `${t} goes and uses ${what}${+x.b > 0 ? ` for ${+x.b} s` : ''}${x.c === 'stand' ? '' : ', crouching'}`;
    }
    case 'effect': {
      if (x.a === 'off') return `stop the effects on ${t}`;
      const o = effectOptions(x.c), light = isLightEffect(x.a);
      const what = light ? `a ${o.colour} ${x.a === 'pulse' ? 'pulsing' : 'blinking'} light${o.beep ? ' (beeping)' : ''}` : effectLabel(x.a).toLowerCase();
      const where = info.point ? `at ${t}${light ? '' : ', along its arrow'}` : `on ${t}${o.exact ? ' (exactly on it)' : ''}`;
      return `${what} ${where}${+x.b > 0 ? ` for ${secs(x.b)}` : ' until stopped'}`;
    }
    default: return '';
  }
}

// the extra rows of an action (inside lkRuleHtml): seconds, the object a character uses, the effect
// (info.point: its target is an effect point)
export function blockRowsHtml(x, j, esc, nameOf, info = {}) {
  const row = (inner) => `<div class="row" style="padding-left:38px">${inner}</div>`;
  const num = (k, v, min, step, w = 60, title = '') => `<input type="number" data-lkarg="${j}" data-k="${k}" value="${esc(String(v))}" min="${min}" step="${step}" style="width:${w}px"${title ? ` title="${esc(title)}"` : ''}>`;
  if (x.verb === 'timerstart') {
    return row(`<label style="width:auto" title="0: the seconds set in the timer's Properties">for</label>${num('a', +x.a || 0, 0, 1, 64)}<span class="hint" style="margin:0">s (0: its own)</span>`);
  }
  if (x.verb === 'npcuse') {
    const has = !!x.a;
    return row(`<label style="width:auto">uses</label><a href="#" data-lkgo="${esc(x.a || '')}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${has ? '' : ';color:var(--bad)'}" title="Go to it">${esc(has ? nameOf(x.a) : '(no object yet)')}</a><button data-lkuse="${j}" title="Click the object they go and use">${has ? 'change' : 'pick'}</button>`)
      + row(`<label style="width:auto" title="Seconds they spend at it; then its rules 'a character has used it' run">for</label>${num('b', +x.b || 0, 0, 0.5, 56)}<span class="hint" style="margin:0">s</span>`
      + `<select data-lkarg="${j}" data-k="c" title="How they stand while they use it"><option value="crouch" ${x.c !== 'stand' ? 'selected' : ''}>crouching</option><option value="stand" ${x.c === 'stand' ? 'selected' : ''}>standing</option></select>`);
  }
  if (x.verb === 'effect') {
    let h = row(`<select data-lkarg="${j}" data-k="a" style="flex:1;min-width:0">${EFFECT_KINDS.map(([k, l]) => `<option value="${k}" ${k === x.a ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      + (x.a === 'off' ? '' : `<label style="width:auto" title="0: until an action stops it">for</label>${num('b', +x.b || 0, 0, 1, 52)}<span class="hint" style="margin:0">s</span>`));
    if (isLightEffect(x.a)) {
      const o = effectOptions(x.c);
      h += row(`<label style="width:auto">colour</label><select data-lkcol="${j}">${EFFECT_COLOURS.map((c) => `<option ${c === o.colour ? 'selected' : ''}>${c}</option>`).join('')}</select>`
        + (x.a === 'blinklight' ? `<label style="width:auto" title="A beep at every blink (faster as its time runs out)"><input type="checkbox" data-lkbeep="${j}" ${o.beep ? 'checked' : ''}> beeps</label>` : ''));
    }
    if (x.a !== 'off') {
      h += info.point
        ? row(`<span class="hint" style="margin:0;flex:1;min-width:0" title="Turn the point (E) or tilt it (Pitch in its Transform) to aim the effect">Exactly on the effect point${isLightEffect(x.a) ? '' : ', along its big arrow'}</span>`)
        : row(`<label style="width:auto" title="No automatic offsets: mist is not lowered to the floor, smoke and fire do not move to its top; the effect sits on the object's own point"><input type="checkbox" data-lkexact="${j}" ${effectOptions(x.c).exact ? 'checked' : ''}> exactly on the object</label>`
          + `<button data-lkfxpt="${j}" title="Put the effect on an Effect point instead (Objects > Triggers > Effect point): exactly there, along its arrow">at an Effect point...</button>`);
    }
    return h;
  }
  return '';
}

// ---------------------------------------------------------------- usable objects (edits.usable)
export function usableDefault() {
  return { text: 'Use', secs: 0, crouch: false, item: '', consume: false, uses: 0, hidden: false };
}

export function usableSummary(u) {
  if (!u) return '';
  const parts = [`"${u.text || 'Use'}"`];
  if (+u.secs > 0) parts.push(`takes ${+u.secs} s${u.crouch ? ' crouching' : ''}`);
  if (u.item) parts.push(`needs ${String(u.item).split('.').pop()}${u.consume ? ' (used up)' : ''}`);
  if (+u.uses > 0) parts.push(+u.uses === 1 ? 'once' : `${+u.uses} times`);
  if (u.hidden) parts.push('hidden at start');
  return parts.join(', ');
}

// the Usable section of an object's Properties (items: [{cls, name, cat}] of the game's inventory)
export function usableHtml(u, items, esc) {
  const on = !!u;
  let h = `<div class="row"><label style="width:auto" title="JC can use it: its rules 'When JC uses it' run when he has finished"><input type="checkbox" data-us="on" ${on ? 'checked' : ''}> JC can use it</label></div>`;
  if (!on) return h + '<div class="hint" style="margin:2px 0">Any model can be used: a bomb to defuse, a generator to sabotage, a lock to cut...</div>';
  const cats = [...new Set(items.map((x) => x.cat))];
  const itemSel = `<select data-us="item" style="flex:1;min-width:0"><option value="">(nothing)</option>${cats.map((c) => `<optgroup label="${esc(c)}">${items.filter((x) => x.cat === c).map((x) => `<option value="${esc(x.cls)}" ${String(x.cls).toLowerCase() === String(u.item || '').toLowerCase() ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}${u.item && !items.some((x) => String(x.cls).toLowerCase() === String(u.item).toLowerCase()) ? `<option value="${esc(u.item)}" selected>${esc(u.item)}</option>` : ''}</select>`;
  h += `<div class="row"><label style="width:auto;min-width:96px" title="What JC reads when he looks at it">Use text</label><input type="text" data-us="text" value="${esc(u.text || '')}" placeholder="Use" style="flex:1;min-width:0"></div>
    <div class="row"><label style="width:auto;min-width:96px" title="0: at once. More: JC is busy that long (a bar fills up); walking away cancels it">Takes</label><input type="number" data-us="secs" value="${+u.secs || 0}" min="0" step="0.5" style="width:64px"><span class="hint" style="margin:0">s</span>
      <label style="width:auto" title="JC crouches while he uses it"><input type="checkbox" data-us="crouch" ${u.crouch ? 'checked' : ''}> crouching</label></div>
    <div class="row"><label style="width:auto;min-width:96px" title="An item JC must carry (nothing: anyone can)">Needs</label>${itemSel}</div>`;
  if (u.item) h += `<div class="row" style="padding-left:12px"><label style="width:auto"><input type="checkbox" data-us="consume" ${u.consume ? 'checked' : ''}> it is used up</label>
      <input type="text" data-us="needtext" value="${esc(u.needtext || '')}" placeholder="message without it (optional)" style="flex:1;min-width:0"></div>`;
  h += `<div class="row"><label style="width:auto;min-width:96px" title="0: as often as JC likes; after the last time it is an ordinary object">Times</label><input type="number" data-us="uses" value="${+u.uses || 0}" min="0" step="1" style="width:64px"><span class="hint" style="margin:0">0 = always</span></div>
    <div class="row"><label style="width:auto" title="Not there until a rule makes it appear ('Appear again')"><input type="checkbox" data-us="hidden" ${u.hidden ? 'checked' : ''}> hidden at the start</label></div>
    <div class="hint" style="margin:2px 0">Its rules "When JC uses it" run when he has finished. Characters can use it too ("Go and use an object").</div>`;
  return h;
}

// a change made in the Usable section (field: the data-us of the input)
export function usableChange(u, field, input) {
  if (field === 'secs' || field === 'uses') u[field] = Math.max(0, field === 'uses' ? Math.round(+input.value || 0) : Math.round((+input.value || 0) * 10) / 10);
  else if (input.type === 'checkbox') u[field] = input.checked;
  else u[field] = String(input.value || '').trim();
  if (field === 'item' && !u.item) { u.consume = false; delete u.needtext; }
  return u;
}
