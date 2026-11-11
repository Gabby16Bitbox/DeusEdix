// Live control of the logic while Play runs (P7, editor/LOGIC.md "Live control while Play runs"). The editor sends
// "deusedix ..." lines to the running game (the Console's line: UCConsoleLink, which handles them itself), and the game's
// logic log says what came of them:
//   live|map|rule|what|detail   a command it took (fire, mute on, trace off, break on, step; set, input, happen,
//                               continue, clear and resumed have no rule)
//   trace|map|rule|by|phase|bits  a traced rule heard its cause: its phase ("" no phase gate, 1 in, 0 not) and each
//                               condition, in order, 1 it holds, 0 not
//   break|map|rule|why|step     the game paused at a rule: it runs (fire), or after its action (act, the step)
//   skip|map|rule|muted|        a muted rule heard its cause and did nothing
// Pure (no DOM): tests/test_logic_live.mjs.

const ID = /^[A-Za-z_][\w-]*$/;              // a rule's id (L7, R3_U000), an object's, a state's or a block's name
const ARGS = /^[^\s|]*$/;                     // a block's input arguments ("Seconds=10;Mode=red"): one word

function need(ok, what) {
  if (!ok) throw new Error(what);
}

// The line to send for a command, or an Error that says what is wrong.
//   liveCommand('fire', rule)           as if the rule's cause happened now (its phase, once, conditions still count)
//   liveCommand('happen', object, out)  every rule on that output of the object
//   liveCommand('set', state, value)    a state (true / false) or a counter (a whole number)
//   liveCommand('input', block, input, args)
//   liveCommand('mute' | 'trace' | 'break', rule, on)
//   liveCommand('step', rule)  liveCommand('continue')  liveCommand('clear')
//   liveCommand('paused')      whether the game is paused now (its answer: "The game runs", "The game is paused (...)")
export function liveCommand(verb, a = '', b = '', c = '') {
  const id = (x, what) => { need(ID.test(String(x || '')), what); return String(x); };
  switch (verb) {
    case 'fire': case 'step':
      return `deusedix ${verb} ${id(a, 'Choose a rule first.')}`;
    case 'mute': case 'trace': case 'break':
      return `deusedix ${verb} ${id(a, 'Choose a rule first.')}${b === false ? ' off' : ''}`;
    case 'happen':
      return `deusedix happen ${id(a, 'Choose an object first.')} ${id(b, 'Choose what happens to it.')}`;
    case 'set': {
      const name = id(a, "A state's name is letters, digits and underscores.");
      if (typeof b === 'boolean') return `deusedix set ${name} ${b ? 'yes' : 'no'}`;
      need(Number.isInteger(+b) && String(b).trim() !== '' && Math.abs(+b) < 2 ** 31, 'A counter is a whole number.');
      return `deusedix set ${name} ${+b}`;
    }
    case 'input': {
      const line = `deusedix input ${id(a, 'Choose a block first.')} ${id(b, 'Choose its input.')}`;
      need(ARGS.test(String(c || '')), "An input's values go without spaces (Seconds=10;Mode=red).");
      return c ? `${line} ${c}` : line;
    }
    case 'continue': case 'clear': case 'paused':
      return `deusedix ${verb}`;
    default:
      throw new Error(`Unknown live command: ${verb}`);
  }
}

// What the game is told and has said, for one map: {muted, traced, breaks, stepping} (Sets of rule ids, lower case)
// and paused ({rule, why, step} while a break holds the game, else null).
export function liveState() {
  return { muted: new Set(), traced: new Set(), breaks: new Set(), stepping: new Set(), paused: null };
}

const low = (s) => String(s ?? '').toLowerCase();
const mapKey = (m) => low(m).replace(/\.(dx|unr)$/, '');      // as logic-trails.js sameMap
const SETS = { mute: 'muted', trace: 'traced', break: 'breaks' };

// The state after one entry of the logic log (logic-log.js parseLogicLine), changed in place and returned.
export function liveStep(s, e) {
  if (!e) return s;
  if (e.kind === 'break') {
    s.paused = { rule: e.rule, why: e.why, step: e.step === '' || e.step === undefined ? null : +e.step };
    return s;
  }
  if (e.kind !== 'live') return s;
  const rule = low(e.rule), [what, how] = [e.verb, e.detail];
  if (SETS[what] && rule) {
    if (how === 'off') s[SETS[what]].delete(rule);
    else s[SETS[what]].add(rule);
  } else if (what === 'step' && rule) {
    s.stepping.add(rule);
    s.paused = null;
  } else if (what === 'continue' || what === 'resumed') {
    if (what === 'continue') s.stepping.clear();
    s.paused = null;
  } else if (what === 'clear') {
    for (const k of ['muted', 'traced', 'breaks', 'stepping']) s[k].clear();
    s.paused = null;
  }
  return s;
}

// What a rule is set to now, for its buttons: {muted, traced, breaks, stepping}
export function ruleLive(s, rule) {
  const r = low(rule);
  return { muted: s.muted.has(r), traced: s.traced.has(r), breaks: s.breaks.has(r), stepping: s.stepping.has(r) };
}

// A trace line's conditions: [{held}], in the order of the rule's requires, and its phase (null when it has no gate)
export function traceBits(e) {
  return {
    phase: e.phase === '1' ? true : e.phase === '0' ? false : null,
    conds: String(e.bits || '').split('').filter((x) => x === '0' || x === '1').map((x) => x === '1'),
  };
}

// ---------------------------------------------------------------- the bar of the Logic window while Play runs
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const LIVE_LIMITS = 'What you do here reaches the game in about half a second, and its answer comes back as fast; '
  + 'what the rules then do shows in the trails a few seconds later, when the game has written it in its log. '
  + 'The game pauses while the editor has the focus, so a rule set off here runs its first steps at once and waits for '
  + 'the game to go on for the rest. Mute, Trace and Pause here last for this Play on this map: loading a game or '
  + 'going to another map forgets them.';
// Where a break holds the game, in words: "as it runs" (its steps with no wait are done in that moment), "after its step 2"
export const pausedWords = (p) => (p.why === 'act' && Number.isInteger(p.step) ? `after its step ${p.step + 1}` : 'as it runs');

// The bar's HTML (pure): what the game is paused at, with Step and Continue; the rule chosen in the graph with its
// buttons (pressed as the game said: liveState); else an object's happenings to make happen now; a state or counter
// to set now; Clear all when anything is muted, traced or paused on.
//   rule      {id, title} the rule chosen, or null
//   flags     ruleLive(state, rule.id)
//   paused    state.paused, with pausedTitle: the rule's words
//   happen    {object, title, list: [{key, text}]} an object chosen and the happenings its rules wait for, or null
//   state     {name, type: 'bool' | 'int'} the state or counter shown, or null
//   any       anything muted, traced or paused on (Clear all)
export function liveBarHtml({ rule = null, flags = {}, paused = null, pausedTitle = '', happen = null, state = null, any = false } = {}) {
  const btn = (live, text, title, on) => `<button type="button" data-live="${live}"${on === undefined ? '' : ` aria-pressed="${!!on}" class="${on ? 'on' : ''}"`} title="${esc(title)}">${esc(text)}</button>`;
  const out = [`<span class="lw-ldot" title="${esc(LIVE_LIMITS)}">Live</span>`];
  if (paused) {
    out.push(`<span class="lw-lpaused" title="${esc(pausedTitle || paused.rule)}"><b>The game is paused at ${esc(paused.rule)}</b> <span>${esc(pausedWords(paused))}</span></span>`,
      btn('step', 'Step', 'The game goes on until this rule\'s next step, and pauses again'),
      btn('continue', 'Continue', 'The game goes on; the rules no longer pause it step by step (Pause here stays on)'));
  }
  if (rule) {
    out.push(`<span class="lw-ltarget" title="${esc(`Rule ${rule.id}: ${rule.title}`)}"><b>${esc(rule.title)}</b><i>${esc(rule.id)}</i></span>`,
      btn('fire', 'Set it off now', 'As if what sets it off happened now: its phase, Once and its conditions still count'),
      btn('mute', 'Mute', 'While on, it does nothing when what sets it off happens (for this Play)', flags.muted),
      btn('trace', 'Trace', 'While on, each time it hears its cause the Console and the trails say which of its conditions hold', flags.traced),
      btn('break', 'Pause here', 'While on, the game pauses each time this rule runs (F9)', flags.breaks));
  } else if (happen && happen.list.length) {
    out.push(`<span class="lw-ltarget"><b>${esc(happen.title)}</b></span>`,
      `<select class="lw-lhappen" aria-label="What happens to ${esc(happen.title)}">${happen.list.map((h) => `<option value="${esc(h.key)}">${esc(h.text)}</option>`).join('')}</select>`,
      btn('happen', 'Make it happen', 'Every rule waiting for this sets off now, as if it happened in the game'));
  } else if (!paused && !state) {
    out.push('<span class="lw-lhint">Select a rule to set it off, mute it, trace it or pause the game on it.</span>');
  }
  if (state) {
    const field = state.type === 'int'
      ? `<input type="number" step="1" class="lw-lvalue" placeholder="0" aria-label="${esc(state.name)} now">`
      : `<select class="lw-lvalue" aria-label="${esc(state.name)} now"><option value="1">Yes</option><option value="0">No</option></select>`;
    out.push(`<label class="lw-lstate" title="The game's value now, until a rule changes it (the start value is not changed)">${esc(state.name)} now ${field}</label>`,
      btn('set', 'Set', `Set ${state.name} in the game now`));
  }
  if (any) out.push(btn('clear', 'Clear all', 'No rule muted, traced or paused on any more; the game goes on'));
  return out.join('');
}

// What the game was told, map by map, from the lines of one Play (only those that come while it runs). A map the
// player goes to (its lines start after another map's) starts as built: whatever it was told on an earlier visit went
// with that visit. liveBook() -> {maps, last}; liveRead(book, entry) changes it; liveOf(book, map) one map's liveState.
export function liveBook() {
  return { maps: new Map(), last: '' };
}
export function liveOf(book, map) {
  const k = mapKey(map);
  if (!book.maps.has(k)) book.maps.set(k, liveState());
  return book.maps.get(k);
}
export function liveRead(book, e) {
  if (!e || !e.map) return book;
  const k = mapKey(e.map);
  if (book.last && book.last !== k) book.maps.delete(k);
  book.last = k;
  if (e.kind === 'live' || e.kind === 'break') liveStep(liveOf(book, k), e);
  return book;
}
// anything muted, traced, paused on or holding the game
export const liveAny = (s) => !!(s.paused || s.muted.size || s.traced.size || s.breaks.size || s.stepping.size);

// The game's answer to a command (UCConsoleLink.Live) as the line its log writes a moment later, so the buttons follow
// at once (the log reaches the editor up to a few seconds later; the same line again changes nothing). null when the
// answer says it did nothing ("This map has no rule L7") or the command has no lasting state.
export function liveAnswered(verb, a, b, answer) {
  const t = String(answer || '');
  if (!t || /^(This map has no|Unknown|The player is not|Say which|A state is)/.test(t)) return null;
  if (verb === 'mute' || verb === 'trace' || verb === 'break') return { kind: 'live', rule: String(a), verb, detail: b === false ? 'off' : 'on' };
  if (verb === 'step') return { kind: 'live', rule: String(a), verb: 'step', detail: '' };
  if (verb === 'continue' || verb === 'clear') return { kind: 'live', rule: '', verb, detail: '' };
  return null;
}

// The game's answer to "deusedix paused" (UCConsoleLink.Live): {paused, by, at: {rule, why, step} or null}, or null
// when it is not that answer. The editor asks it a moment after a command and every second while a rule may pause the
// game: the answer comes at once, the logic log's break line seconds later (the game writes its log in 4 KB blocks).
export function pausedAnswer(answer) {
  const t = String(answer || '');
  if (/^The game runs \(/.test(t)) return { paused: false, by: '', at: null };
  const m = /^The game is paused \((.*), [-\d.]+\)(?: at ([^|\s]+)\|(\w*)\|(\d*))?$/.exec(t);
  if (!m) return null;
  return { paused: true, by: m[1], at: m[2] ? { rule: m[2], why: m[3], step: m[4] === '' ? null : +m[4] } : null };
}
