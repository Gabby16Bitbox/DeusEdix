// Window > Logic > Try it: the map's rules played in the editor, with no game and no build (logic-sim.js runs the
// compiled form the game gets: /api/logic/compile). What the rules wait for is a row of buttons (a button pressed:
// it happens now, JC's part of the tick); what only the game decides (a character arriving, an animation ending) is
// offered after; the clock steps on, runs to what is due next, or starts again. The log is the game's logic log in
// sentences; the State shows the states, the counters and each rule; "Why not?" says, rule by rule, why it did not
// run, from this session. The Story's dialogues play inside (P5): one a rule, the Story or the player starts shows
// its line (Next line) or the player's answers, its lines and answers go into the log, and the rules waiting for its
// end run when it ends.
//
// createLogicTry({root, trial, status, starts})
//   trial()  a Promise of {compiled: logic_compile.compiled (actors, outputs, left, error), world: {player, actors},
//            catalog (config/logic.json), names: {name: title}, labels: {name: {port key: label}}, options: {computer:
//            [its options' texts]}, map, key (changes
//            when the rules change)}
//   starts   the project's Play scenarios as named starts (logic-starts.js; app.js): {list() [{name}], get(name) (a
//            scenario or null), save(scenario) (true when kept), play(name) (Play starts with it)}; none: no Start list
// Returns {show(), why(id)}: show draws it again from the map's rules (a new session when they changed since); why is
// the session's "Why not?" for a rule ([{why, t, text}]) when the session is of the rules as they are now (key: the
// trial's), null when nothing has been tried with them.
import { createSession } from './logic-sim.js';
import { vocabulary, goalTexts } from './logic-vocab.js';
import { LOGIC_TAG, parseLogicLine, logicSentence } from './logic-log.js';
import { partsText } from './console-lines.js';
import { escapeHtml as esc } from './shortcut-bar.js';
import { startOf, startFromState, startSummary, phaseFlags } from './logic-starts.js';
import { yesOf, conditionText } from './conditions.js';

const secs = (t) => `${Math.round(t * 10) / 10} s`;

// the verbs the game's log says for the rules' own (links.py: a walk on the walkable area is navgo / navrun)
const LOG_VERBS = { navgo: 'goto', navrun: 'run' };
// the actions whose log detail is their first value (a message's text, a counter's or a state's name, a goal...)
const DETAIL_IS_A = new Set(['message', 'count', 'flag', 'goal', 'note', 'sound', 'input', 'key', 'travel', 'timerstart', 'floor', 'signal', 'talk', 'infolink']);
const capital = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const low = (s) => String(s || '').toLowerCase();
// why a dialogue cannot start now (logic-sim.js talkWhyNot, the game's TalkNow)
const TALK_NOT = { busy: 'A conversation is playing', unmet: "Its conditions do not hold now",
  played: 'It plays once, and it was played already', missing: 'Who says it is not in the map' };

// A log line of the game read as a sentence (logic-log.js), with its mark. ctx (optional): {vocab, words, sentences,
// player} to say it in the Logic window's words: a rule that runs by its sentence, an action as the rule says it, the
// objects by their names, JC not named as who set it off; rules ({id: the rule}, optional): an action said with all of
// its rule's step, as the log has only its first value (12 Nov 2026: 'A new goal ""' for a goal completed, "2 × ?")
export function lineText(line, ctx = {}) {
  const e = parseLogicLine(LOGIC_TAG + line);
  if (!e) return { mark: '', text: line };
  const { vocab, words, sentences = {}, player = '', rules = null } = ctx;
  const name = (n) => (words && words.name ? words.name(n) : n);
  const plain = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.rule ? '' : name(p.name))).join('').replace(/\s+/g, ' ').trim();
  const s = logicSentence(e, words ? { actor: name, item: words.itemName, storyTitle: words.storyTitle, phaseNames: words.phaseNames } : {});
  const out = { mark: s.mark || '', kind: e.kind, rule: e.rule || '', verb: e.verb || '', target: e.target || '' };
  if (e.kind === 'fire' && vocab) {
    // a "while" rule's end (links.py: <id>_until) by its rule's sentence now, not the label it was built with (13 Nov
    // 2026: "When the player walks into the zone: sound the alarm (undone)" after "While the player is in Collision box")
    const base = /^(.+)_until$/.exec(e.rule || ''), undone = base && sentences[base[1]] ? `${sentences[base[1]]} (undone)` : '';
    const said = sentences[e.rule] || undone || e.label || `${name(e.source)} ${e.when}`;
    const other = e.by && e.by.toLowerCase() !== String(player).toLowerCase() && !/jcdenton/i.test(e.by), rule = /^UCLink_(\w+)$/i.exec(e.by || '');
    const by = !other ? '' : /^(UCEd_\w+|UCLink\d+)$/i.test(e.by) ? ' (set off by the Story)' : rule ? ` (set off by rule ${rule[1]})` : ` (set off by ${name(e.by)})`;
    return { ...out, text: capital(said) + by };
  }
  if (e.kind === 'act' && vocab) {
    const x = { verb: LOG_VERBS[e.verb] || e.verb, delay: 0 };
    // (anyone of a kind or a faction, P9: "every <its name>", the group's words)
    const every = /^every /.test(e.target || '') ? e.target.slice(6) : null;
    if (every !== null) {
      x.group = '?';
      try { return { ...out, text: capital(vocab.actText(x, { ...(words || {}), groupName: () => every })) }; } catch { /* as the log says it */ }
    }
    if (/^tag /.test(e.target || '')) x.targetTag = e.target.slice(4);
    else if (/^area /.test(e.target || '')) return { ...out, text: capital(plain(s.parts)) };
    else x.target = e.target || '';
    if (DETAIL_IS_A.has(x.verb) && e.detail) x.a = e.detail;
    const step = stepOf(rules && rules[e.rule], x);
    try { return { ...out, text: capital(vocab.actText(step ? { ...shownStep(step), delay: 0 } : x, words)) }; } catch { /* a verb the vocabulary does not know: as the log says it */ }
  }
  return { ...out, text: capital(plain(s.parts)) };
}

// the step of a rule the game's log line is about: the same verb on the same object (and the same first value when the
// log has it); null when the rule has none, or several that the line cannot tell apart
// a step's texts as the game shows them (links.py _text, gametext.plain: no bar, no double quote, Latin-1 only; 13 Nov
// 2026, Edge Lab: Try it said a new goal with the "|" and the "✓" the game shows as "/" and "?")
const SHOWN_TEXTS = { goal: ['b'], message: ['a'], note: ['a'] };
const PLAIN = { '“': '"', '”': '"', '‘': "'", '’': "'", '—': '-', '–': '-', '…': '...' };
export const gameText = (s) => [...String(s ?? '').replace(/[\r\n]/g, ' ')].map((c) => PLAIN[c] ?? (c.codePointAt(0) > 255 ? '?' : c)).join('')
  .replace(/"/g, "'").replace(/\|/g, '/');
function shownStep(step) {
  const out = { ...step };
  for (const k of SHOWN_TEXTS[step.verb] || []) if (typeof out[k] === 'string') out[k] = gameText(out[k]);
  return out;
}
function stepOf(rule, x) {
  if (!rule || x.targetTag) return null;
  const same = [...(rule.do || []), ...(rule.else || [])].filter((s) => s && s.verb === x.verb && low(s.target || '') === low(x.target || '')
    && (x.a === undefined || String(s.a ?? '') === String(x.a)));
  return same.length === 1 ? same[0] : null;
}

// What was said in a conversation (logic-sim.js said(): a line, an answer, what a step or an action does, a start or an
// end) as an entry of Try it's log: {kind: 'say', mark, text, ...} or null (nothing to say: a rule's start of a
// dialogue is the rule's own line). ctx: {words (name, storyTitle, itemName), player}.
export function saidLine(e, { words = {}, player = '', vocab = null } = {}) {
  const nameOf = (n) => (words.name ? words.name(n) : n);
  const who = (n) => (n && low(n) === low(player) ? 'The player' : nameOf(n || '') || 'Someone');
  const title = (key, id) => (words.storyTitle ? words.storyTitle(key, id) : String(id));
  const itemName = (cls) => (words.itemName ? words.itemName(cls) : String(cls).split('.').pop());
  const yesNo = (c) => (yesOf(c, 'is') ? 'Yes' : 'No');
  function doneText(s) {
    const list = s.type === 'flag' && s.requires?.length ? s.requires : [s];
    switch (s.type) {
      case 'flag': return `Sets ${list.filter((f) => f.flag).map((f) => `${f.flag} to ${yesNo(f)}`).join(', ') || 'a state'}`;
      case 'credits': return `Credits ${+s.amount >= 0 ? '+' : ''}${+s.amount || 0}`;
      case 'skillpoints': return `Skill points +${+s.amount || 0}`;
      case 'give': return `The player receives ${s.count || 1} × ${itemName(s.item || '?')}`;
      case 'goal': return `Goal ${s.done ? 'completed' : 'added'}: ${s.text || s.goal || ''}`;
      case 'note': return `Note: ${s.text || ''}`;
      case 'message': return `Message: ${s.text || ''}`;
      case 'trigger': return `Triggers the event ${s.tag || '?'}`;
      case 'signal': return `Sends the signal ${s.signal || '?'}`;
      case 'talk': return `Starts the dialogue "${title('dialogues', s.dialogue)}"`;
      case 'infolink': return `Plays the InfoLink "${title('infolinks', s.infolink)}"`;
      case 'npc': case 'door': return `${nameOf(s.actor || '?')}: ${s.act || ''} (the game does it)`;
      case 'travel': return `Travels to ${s.map || '?'} (the game does it)`;
      case 'act': {                 // a Logic action of the Story (P5): in the rules' words
        let t = '';
        try { t = vocab && s.act ? vocab.actText({ ...s.act, delay: 0 }, { name: nameOf, ...words }) : ''; } catch { t = ''; }
        return capital(t || (s.act && s.act.verb) || 'an action');
      }
      default: return `${capital(s.type || 'step')} (the game does it)`;
    }
  }
  const said = (text) => ({ kind: 'say', mark: '', rule: '', verb: '', target: '', text });
  const d = e.dialogue !== undefined ? title('dialogues', e.dialogue) : '';
  if (e.kind === 'start') return low(e.by) === low(player) ? said(`The player talks to ${who(e.who)}: "${d}"`) : null;
  if (e.kind === 'line') return said(`${e.infolink !== undefined ? e.who || 'InfoLink' : who(e.who)}: "${e.text}"`);
  if (e.kind === 'answer') return said(`The player answers: "${e.text}"`);
  if (e.kind === 'effect') return said(doneText(e.step || e.action || {}));
  if (e.kind === 'end') return said(`The dialogue "${d}" has ended${e.why && e.why !== 'End of dialogue' ? ` (${e.why.charAt(0).toLowerCase()}${e.why.slice(1)})` : ''}`);
  return null;
}

export function createLogicTry({ root, trial, status = () => {}, starts = null }) {
  root.innerHTML = `<div class="lt-bar">
      <select class="lt-start" aria-label="Start from" title="Where Try it starts from: the map as it starts, or a start kept by name (the Play scenarios: Play can start with the same one)"></select>
      <button type="button" data-do="save" title="Keep the states, the player's items and credits now as a start with a name, for Try it and for Play">Save start…</button>
      <button type="button" data-do="playwith" title="Play the map in the game with this start (it becomes the scenario Play starts with)">Play with this start</button>
      <span class="lt-div"></span>
      <button type="button" data-do="restart" title="The map from its start again">Restart</button>
      <button type="button" data-do="step" title="Half a second on">+0.5 s</button>
      <button type="button" data-do="five" title="Five seconds on">+5 s</button>
      <button type="button" data-do="next" title="On to what is due next by itself: an action after its delay, a timer, a door">Next</button>
      <span class="lt-clock"></span>
      <span class="lt-note hint"></span>
    </div>
    <form class="lt-saveform" hidden>
      <label>Name of the start <input type="text" class="lt-savename" maxlength="40" spellcheck="false" required></label>
      <button type="submit" class="primary">Keep it</button>
      <button type="button" data-do="cancelsave">Cancel</button>
      <span class="lt-savenote hint"></span>
    </form>
    <div class="lt-body">
      <div class="lt-col">
        <h4 class="lt-thead" hidden>Conversation</h4><div class="lt-talk"></div>
        <h4>Make it happen</h4><div class="lt-happen"></div>
        <h4 class="lt-phead" hidden>The player talks</h4><div class="lt-talks"></div>
        <h4 class="lt-dhead" hidden>The game decides</h4><div class="lt-decide"></div>
        <h4>State</h4><div class="lt-state"></div>
      </div>
      <div class="lt-col lt-wide">
        <h4>What happened</h4><ol class="lt-log"></ol>
        <h4>Why not?</h4>
        <div class="lt-whyrow"><select class="lt-rule" aria-label="Rule"></select></div>
        <ul class="lt-why"></ul>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let session = null, key = '', vocab = null, names = {}, labels = {}, options = {}, ruleIds = [], note = '';
  let families = {}, items = {}, usable = {}, sentences = {}, heads = {}, ruleOf = {}, player = '', groups = {}, storyTitles = {}, phaseNames = {};
  let startName = '', derived = new Set();       // the start chosen ('' the map as it starts); the states Phases blocks keep
  let place = () => '';                          // "near a point": the object there (app.js lkPlaceName)
  let placeName = null;                          // where a character is sent ("runs to Path Node 2", app.js lkPointName)
  let zoneName = (n) => n;                       // "in a zone": as the Logic window names it (app.js lkCondNames.zone)
  if (!starts) for (const el of root.querySelectorAll('.lt-start, [data-do=save], [data-do=playwith], .lt-div')) el.remove();
  const startNow = () => (starts && startName ? starts.get(startName) : null);

  const nameOf = (n) => names[n] || n;
  const words = () => ({ name: nameOf, portLabel: (n, k) => (labels[n] || {})[k] || k.split(':')[1] || '?',
    optionText: (l) => (options[l.src] || [])[+l.option || 0] || '', family: (n) => families[n] || 'other', word: () => '',
    usable: (n) => !!usable[n], itemName: (cls) => items[cls] || String(cls).split('.').pop(), groupName: (id) => groups[id] || '',
    storyTitle: (key, id) => (storyTitles[key] || {})[id] || String(id), goalText: goalTexts(Object.values(ruleOf)), placeName,
    phaseNames: (root) => phaseNames[String(root || '').toLowerCase()] || null });
  async function open() {
    const t = await trial();
    if (startName && !startNow()) startName = '';          // deleted in the Play window
    const k = `${t.key}|${startName}|${JSON.stringify(startOf(startNow()))}`;
    if (k === key && session) return;
    key = k;
    derived = phaseFlags(t.world);
    names = t.names || {};
    labels = t.labels || {};
    options = t.options || {};
    vocab = vocabulary(t.catalog);
    families = t.families || {}; items = t.items || {}; usable = t.usable || {}; player = t.world?.player || ''; groups = t.groups || {};
    storyTitles = t.storyTitles || {};
    phaseNames = t.phaseNames || {};
    place = t.place || (() => '');
    placeName = typeof t.placeName === 'function' ? t.placeName : null;
    zoneName = t.zone || ((n) => n);
    // each rule as it says itself now, and by what sets it off (Why not?'s list)
    sentences = {}; heads = {}; ruleOf = {};
    for (const l of t.rules || []) {
      ruleOf[l.id] = l;
      try { sentences[l.id] = vocab.sentence(l, words()); heads[l.id] = vocab.whenText(l, words()); } catch { sentences[l.id] = l.label || l.id; }
    }
    const c = t.compiled || {};
    if (c.error) { session = null; note = `The rules cannot be compiled: ${c.error}`; return; }
    session = createSession({ actors: c.actors || [], outputs: c.outputs || t.catalog.outputs, left: c.left || [], world: t.world,
      map: t.map || 'Map', vocab, ctx: words(), start: startOf(startNow()) });
    ruleIds = [...new Set([...(c.actors || []).filter((a) => a.cls === 'UCLink').map((a) => String(a.props.Rule || '').replace(/"/g, '')),
      ...(c.left || []).map((l) => l.id)])].filter(Boolean);
    note = (c.left || []).length ? `${c.left.length} rule${c.left.length === 1 ? ' is' : 's are'} not in the game: see Why not?` : '';
  }
  function act(fn) {
    if (!session) return;
    const r = fn();
    if (r && r.stopped) status(r.stopped.text, 'warn');
    draw();
  }
  // the number each output that comes with one is tried with (kept while the window is open)
  const numbers = new Map(), numberKey = (h) => `${low(h.thing)}|${low(h.port)}`;
  root.addEventListener('input', (ev) => {
    const t = ev.target.closest('.lt-hnum');
    if (t) numbers.set(t.dataset.key, t.value);
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !session) return;
    const d = b.dataset;
    if (d.do === 'restart') act(() => session.restart());
    else if (d.do === 'step') act(() => session.run(0.5));
    else if (d.do === 'five') act(() => session.run(5));
    else if (d.do === 'next') act(() => session.runToNext());
    else if (d.fire !== undefined) {
      const h = session.happenings()[+d.fire];
      // an output that comes with a number (P8 slice 5b): the number in the box by its button is Value
      const value = h && h.carries ? Math.trunc(+(numbers.get(numberKey(h)) ?? 1) || 0) : undefined;
      if (h) act(() => { session.fire({ thing: h.thing, output: h.output, option: h.option, port: h.port, ...(value === undefined ? {} : { value }), ...(h.world || {}) }); session.step(1); });
    } else if (d.decide) act(() => { session.decide(d.decide); session.step(1); });
    else if (d.say !== undefined) act(() => { session.say(+d.say); session.step(1); });
    else if (d.talk !== undefined) act(() => { session.talk(d.talk); session.step(1); });
    else if (d.flag !== undefined) act(() => session.set({ flags: { [d.flag]: d.value === '1' } }));
    else if (d.place !== undefined) {                       // the player goes to a point the rules ask about, or away
      const p = session.places()[+d.place];
      if (p) act(() => session.set({ jc: d.value === '1' ? [...p.at] : null }));
    }
    else if (d.ask !== undefined) act(() => session.makeAsk(+d.ask, d.value === '1'));     // the player's own (P9)
    else if (d.do === 'save') openSave();
    else if (d.do === 'cancelsave') $('.lt-saveform').hidden = true;
    else if (d.do === 'playwith' && starts && startName) Promise.resolve(starts.play(startName)).catch((e) => status(String(e.message || e), 'warn'));
  });
  // ---- named starts: one chosen starts the session again from it
  $('.lt-start')?.addEventListener('change', async (ev) => {
    startName = ev.target.value;
    await show();
  });
  function openSave() {
    if (!session || !starts) return;
    const form = $('.lt-saveform'), input = $('.lt-savename');
    form.hidden = false;
    input.value = startName || `Start ${starts.list().length + 1}`;
    const { left } = startFromState(session.state(), { name: input.value, derived });
    $('.lt-savenote').textContent = left.length ? `Not kept (Play cannot set them yet): ${left.join('; ')}.` : '';
    input.focus(); input.select();
  }
  $('.lt-saveform')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!session || !starts) return;
    const name = $('.lt-savename').value.replace(/\s+/g, ' ').trim();
    if (!name) return;
    const base = starts.get(name) || startNow();
    const { scenario, left } = startFromState(session.state(), { name, base, derived });
    if (!starts.save(scenario)) return;
    $('.lt-saveform').hidden = true;
    // the session goes on as it is: it is now the start's
    const kept = starts.get(name);
    startName = kept ? kept.name : name;
    key = `${key.split('|')[0]}|${startName}|${JSON.stringify(startOf(kept))}`;
    status(`Start "${startName}" kept: ${startSummary(kept)}.${left.length ? ` Not kept (Play cannot set them yet): ${left.join('; ')}.` : ''}`
      + ' Play with it from here, or choose it in the list next to Play.', left.length ? 'warn' : 'ok');
    draw();
  });
  $('.lt-savename')?.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') $('.lt-saveform').hidden = true; });
  $('.lt-rule').addEventListener('change', () => drawWhy());

  function drawWhy() {
    const id = $('.lt-rule').value;
    $('.lt-why').innerHTML = !session || !id ? '' : session.why(id).map((w) => `<li>${w.t !== null ? `<b>${secs(w.t)}</b> ` : ''}${esc(w.text)}</li>`).join('');
  }
  function drawStarts() {
    const sel = $('.lt-start');
    if (!sel || !starts) return;
    const list = starts.list();
    sel.innerHTML = `<option value="">Start: the map as it starts</option>${list.map((x) => `<option value="${esc(x.name)}">Start: ${esc(x.name)}</option>`).join('')}`;
    sel.value = startName;
    sel.title = `Where Try it starts from. ${startSummary(startNow())}. A start is a Play scenario: Play can start with the same one.`;
    const play = $('[data-do=playwith]');
    play.disabled = !startName;
    play.title = startName ? `Play the map in the game starting as "${startName}" (it becomes the scenario Play starts with)` : 'Choose or save a start first';
  }
  // ---- the Story's conversations (P5): who says a line, the dialogue's title, a log entry of what was said
  const who = (n) => (n && low(n) === low(player) ? 'The player' : nameOf(n || '') || 'Someone');
  const title = (key, id) => words().storyTitle(key, id);
  const saidText = (e) => saidLine(e, { words: words(), player, vocab });
  function drawTalk() {
    const now = session.talking(), ts = session.talks();
    $('.lt-thead').hidden = !now;
    if (!now) $('.lt-talk').innerHTML = '';
    else if (now.shown?.type === 'choice') {
      $('.lt-talk').innerHTML = `<p class="lt-tline"><b>${esc(title('dialogues', now.id))}</b>: the player answers</p>`
        + now.shown.options.map((o) => `<button type="button" data-say="${o.k}" ${o.shown ? '' : 'disabled title="Its conditions do not hold now: the game does not offer it"'}>${esc(o.text)}</button>`).join('');
    } else {
      const l = now.shown || { who: now.owner, text: '' };
      $('.lt-talk').innerHTML = `<p class="lt-tline"><b>${esc(who(l.who))}</b>: ${esc(l.text)}</p>`
        + `<button type="button" data-say="-1" title="On to what comes next in &quot;${esc(title('dialogues', now.id))}&quot;">Next line</button>`;
    }
    $('.lt-phead').hidden = !ts.length;
    $('.lt-talks').innerHTML = ts.map((x) => `<button type="button" data-talk="${esc(x.id)}" ${x.why ? `disabled title="${esc(TALK_NOT[x.why] || x.why)}"` : `title="The dialogue plays here, line by line"`}>`
      + `${x.start === 'near' ? 'Comes near' : 'Talks to'} ${esc(nameOf(x.owner))}: "${esc(x.title)}"</button>`).join('');
  }
  function draw() {
    drawStarts();
    if (!session) {
      $('.lt-clock').textContent = '';
      $('.lt-note').textContent = note || 'No rules to try on this map.';
      for (const s of ['.lt-happen', '.lt-decide', '.lt-state', '.lt-log', '.lt-why', '.lt-talk', '.lt-talks']) $(s).innerHTML = '';
      $('.lt-thead').hidden = $('.lt-phead').hidden = true;
      return;
    }
    $('.lt-clock').textContent = `t = ${secs(session.t)}`;
    $('.lt-note').textContent = note;
    const hs = session.happenings();
    $('.lt-happen').innerHTML = hs.length ? hs.map((h, i) => {
      const said = vocab.whenText({ src: h.thing, when: h.output, option: h.option, port: h.port, near: h.near, signal: h.signal, dialogue: h.dialogue, infolink: h.infolink, ...(h.world || {}) }, words()).replace(/^When /, '');
      const button = `<button type="button" data-fire="${i}" ${h.present ? '' : 'disabled'} title="Rules ${esc(h.rules.join(', '))}${h.watched ? ' (looked at every half second)' : ''}">${esc(said)}</button>`;
      if (!h.carries) return button;
      const key = numberKey(h);
      return `<span class="lt-hval">${button}<input type="number" step="1" class="lt-hnum" data-key="${esc(key)}" value="${esc(String(numbers.get(key) ?? 1))}"`
        + ` aria-label="The number it comes with" title="The number it comes with: the rules it starts use it as Value"></span>`;
    }).join('') : '<p class="hint">No rule waits for something to happen (rules "when the map starts" run by themselves: press Next).</p>';
    const ds = session.decisions();
    $('.lt-dhead').hidden = !ds.length;
    $('.lt-decide').innerHTML = ds.map((d) => `<button type="button" data-decide="${esc(d.id)}">${esc(d.text)}</button>`).join('');
    drawTalk();
    const st = session.state();
    const rows = [];
    for (const [k, v] of Object.entries(st.flags || {})) rows.push(`<div>State <b>${esc(k)}</b> = ${v ? 'Yes' : 'No'} <button type="button" data-flag="${esc(k)}" data-value="${v ? 0 : 1}">${v ? 'Set No' : 'Set Yes'}</button></div>`);
    session.places().forEach((p, i) => {
      const by = place(p.at), where = by ? `the point by ${by}` : `the point (${p.at.map((v) => Math.round(v)).join(', ')})`;
      rows.push(`<div title="Rules ${esc(p.rules.join(', '))}">The player is ${p.here ? '' : 'not '}within ${Math.round(p.radius)} units of ${esc(where)} `
        + `<button type="button" data-place="${i}" data-value="${p.here ? 0 : 1}">${p.here ? 'Walk away' : 'Go there'}</button></div>`);
    });
    // the player's own conditions the rules ask about (P9 slice 2: energy, an augmentation, in water...)
    const condNames = { item: words().itemName, zone: zoneName };
    session.asks().forEach((p, i) => {
      const said = conditionText(p.c, condNames);
      rows.push(`<div title="Rules ${esc(p.rules.join(', '))}">${esc(said.charAt(0).toUpperCase() + said.slice(1))}: ${p.holds ? 'Yes' : 'No'} `
        + `<button type="button" data-ask="${i}" data-value="${p.holds ? 0 : 1}">${p.holds ? 'Make it not so' : 'Make it so'}</button></div>`);
    });
    for (const [k, v] of Object.entries(st.counters || {})) rows.push(`<div>Counter <b>${esc(k)}</b> = ${esc(String(v))}</div>`);
    const counts = session.counts();
    for (const [id, r] of Object.entries(st.rules || {})) {
      const c = counts[id] || {}, ran = c.fired ? `ran ${c.fired === 1 ? 'once' : c.fired + ' times'}` : '';
      if (r.running) rows.push(`<div>Rule ${esc(id)}: running, its next action at ${secs(r.next)}${ran ? ` (${ran})` : ''}</div>`);
      else if (ran) rows.push(`<div>Rule ${esc(id)}: ${ran}${c.failed ? `, ${c.failed} failed` : ''}</div>`);
    }
    for (const [n, t] of Object.entries(st.timers || {})) rows.push(`<div>${esc(nameOf(n))}: ${t.running ? `${t.paused ? 'paused' : 'running'}, ${secs(t.left)} left` : 'stopped'}</div>`);
    $('.lt-state').innerHTML = rows.join('') || '<p class="hint">Nothing set yet.</p>';
    const lines = session.log(), told = session.said(), from = Math.max(0, lines.length - 300);
    const said = { vocab, words: words(), sentences, player, rules: ruleOf };
    // an action on objects tagged alike, then the same action on each of them in the same moment: one line, with their
    // names. What was said in a conversation goes in where it was said (P5).
    const read = [];
    let k = 0;
    while (k < told.length && told[k].at < from) k++;
    for (let n = from; n <= lines.length; n++) {
      for (; k < told.length && told[k].at <= n; k++) {
        const s = saidText(told[k]);
        if (s) read.push({ t: told[k].t, s, names: [] });
      }
      if (n === lines.length) break;
      const { t, line } = lines[n];
      const s = lineText(line, said), last = read.at(-1);
      if (last && last.s.tagged && s.kind === 'act' && last.t === t && last.s.rule === s.rule && last.s.verb === s.verb) { last.names.push(nameOf(s.target)); continue; }
      s.tagged = s.kind === 'act' && /^(tag|every) /.test(s.target);         // the objects it reached, after it
      read.push({ t, s, names: [] });
    }
    for (const r of read) if (r.names.length) r.s.text += ': ' + (r.names.length > 4 ? `${r.names.slice(0, 4).join(', ')} and ${r.names.length - 4} more` : r.names.join(', '));
    $('.lt-log').innerHTML = read.map(({ t, s }) => {
      return `<li class="lt-${esc(s.kind || 'line')}"><b>${secs(t)}</b><span>${esc(s.mark)} ${esc(s.text)}</span>`
        + `${s.rule && s.kind !== 'act' ? `<i>${esc(s.rule)}</i>` : ''}</li>`;
    }).join('') || '<li class="hint">Nothing yet: press one of the buttons on the left, or Next.</li>';
    const log = $('.lt-log');
    log.scrollTop = log.scrollHeight;
    const sel = $('.lt-rule'), was = sel.value;
    sel.innerHTML = '<option value="">Choose a rule</option>' + ruleIds.map((id) => `<option value="${esc(id)}">${esc(heads[id] ? `${heads[id]} (${id})` : id)}</option>`).join('');
    sel.value = ruleIds.includes(was) ? was : '';
    drawWhy();
  }
  async function show() {
    try { await open(); } catch (e) { session = null; note = 'Try it: ' + (e.message || e); }
    draw();
  }
  return {
    show,
    // (only a session of these rules: key is logicTrial's, the map and its edits now)
    why: (id, now) => (session && key === now && session.log().length ? session.why(id) : null),
  };
}
