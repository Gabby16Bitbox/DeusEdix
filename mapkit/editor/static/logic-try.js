// Window > Logic > Try it: the map's rules played in the editor, with no game and no build (logic-sim.js runs the
// compiled form the game gets: /api/logic/compile). What the rules wait for is a row of buttons (a button pressed:
// it happens now, JC's part of the tick); what only the game decides (a character arriving, an animation ending) is
// offered after; the clock steps on, runs to what is due next, or starts again. The log is the game's logic log in
// sentences; the State shows the states, the counters and each rule; "Why not?" says, rule by rule, why it did not
// run, from this session.
//
// createLogicTry({root, trial, status})
//   trial()  a Promise of {compiled: logic_compile.compiled (actors, outputs, left, error), world: {player, actors},
//            catalog (config/logic.json), names: {name: title}, labels: {name: {port key: label}}, options: {computer:
//            [its options' texts]}, map, key (changes
//            when the rules change)}
// Returns {show()}: drawn again from the map's rules (a new session when they changed since).
import { createSession } from './logic-sim.js';
import { vocabulary } from './logic-vocab.js';
import { LOGIC_TAG, parseLogicLine, logicSentence } from './logic-log.js';
import { partsText } from './console-lines.js';
import { escapeHtml as esc } from './shortcut-bar.js';

const secs = (t) => `${Math.round(t * 10) / 10} s`;

// the verbs the game's log says for the rules' own (links.py: a walk on the walkable area is navgo / navrun)
const LOG_VERBS = { navgo: 'goto', navrun: 'run' };
// the actions whose log detail is their first value (a message's text, a counter's or a state's name, a goal...)
const DETAIL_IS_A = new Set(['message', 'count', 'flag', 'goal', 'note', 'sound', 'input', 'key', 'travel', 'timerstart', 'floor']);
const capital = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };

// A log line of the game read as a sentence (logic-log.js), with its mark. ctx (optional): {vocab, words, sentences,
// player} to say it in the Logic window's words: a rule that runs by its sentence, an action as the rule says it, the
// objects by their names, JC not named as who set it off.
export function lineText(line, ctx = {}) {
  const e = parseLogicLine(LOGIC_TAG + line);
  if (!e) return { mark: '', text: line };
  const { vocab, words, sentences = {}, player = '' } = ctx;
  const name = (n) => (words && words.name ? words.name(n) : n);
  const plain = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.rule ? '' : name(p.name))).join('').replace(/\s+/g, ' ').trim();
  const s = logicSentence(e, words ? { actor: name, item: words.itemName } : {});
  const out = { mark: s.mark || '', kind: e.kind, rule: e.rule || '', verb: e.verb || '', target: e.target || '' };
  if (e.kind === 'fire' && vocab) {
    const said = sentences[e.rule] || e.label || `${name(e.source)} ${e.when}`;
    const by = e.by && e.by.toLowerCase() !== String(player).toLowerCase() && !/jcdenton/i.test(e.by) ? ` (set off by ${name(e.by)})` : '';
    return { ...out, text: capital(said) + by };
  }
  if (e.kind === 'act' && vocab) {
    const x = { verb: LOG_VERBS[e.verb] || e.verb, delay: 0 };
    if (/^tag /.test(e.target || '')) x.targetTag = e.target.slice(4);
    else if (/^area /.test(e.target || '')) return { ...out, text: capital(plain(s.parts)) };
    else x.target = e.target || '';
    if (DETAIL_IS_A.has(x.verb) && e.detail) x.a = e.detail;
    try { return { ...out, text: capital(vocab.actText(x, words)) }; } catch { /* a verb the vocabulary does not know: as the log says it */ }
  }
  return { ...out, text: capital(plain(s.parts)) };
}

export function createLogicTry({ root, trial, status = () => {} }) {
  root.innerHTML = `<div class="lt-bar">
      <button type="button" data-do="restart" title="The map from its start again">Restart</button>
      <button type="button" data-do="step" title="Half a second on">+0.5 s</button>
      <button type="button" data-do="five" title="Five seconds on">+5 s</button>
      <button type="button" data-do="next" title="On to what is due next by itself: an action after its delay, a timer, a door">Next</button>
      <span class="lt-clock"></span>
      <span class="lt-note hint"></span>
    </div>
    <div class="lt-body">
      <div class="lt-col">
        <h4>Make it happen</h4><div class="lt-happen"></div>
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
  let families = {}, items = {}, usable = {}, sentences = {}, heads = {}, player = '';

  const nameOf = (n) => names[n] || n;
  const words = () => ({ name: nameOf, portLabel: (n, k) => (labels[n] || {})[k] || k.split(':')[1] || '?',
    optionText: (l) => (options[l.src] || [])[+l.option || 0] || '', family: (n) => families[n] || 'other', word: () => '',
    usable: (n) => !!usable[n], itemName: (cls) => items[cls] || String(cls).split('.').pop() });
  async function open() {
    const t = await trial();
    if (t.key === key && session) return;
    key = t.key;
    names = t.names || {};
    labels = t.labels || {};
    options = t.options || {};
    vocab = vocabulary(t.catalog);
    families = t.families || {}; items = t.items || {}; usable = t.usable || {}; player = t.world?.player || '';
    // each rule as it says itself now, and by what sets it off (Why not?'s list)
    sentences = {}; heads = {};
    for (const l of t.rules || []) {
      try { sentences[l.id] = vocab.sentence(l, words()); heads[l.id] = vocab.whenText(l, words()); } catch { sentences[l.id] = l.label || l.id; }
    }
    const c = t.compiled || {};
    if (c.error) { session = null; note = `The rules cannot be compiled: ${c.error}`; return; }
    session = createSession({ actors: c.actors || [], outputs: c.outputs || t.catalog.outputs, left: c.left || [], world: t.world,
      map: t.map || 'Map', vocab, ctx: words() });
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
      if (h) act(() => { session.fire({ thing: h.thing, output: h.output, option: h.option, port: h.port }); session.step(1); });
    } else if (d.decide) act(() => { session.decide(d.decide); session.step(1); });
    else if (d.flag !== undefined) act(() => session.set({ flags: { [d.flag]: d.value === '1' } }));
  });
  $('.lt-rule').addEventListener('change', () => drawWhy());

  function drawWhy() {
    const id = $('.lt-rule').value;
    $('.lt-why').innerHTML = !session || !id ? '' : session.why(id).map((w) => `<li>${w.t !== null ? `<b>${secs(w.t)}</b> ` : ''}${esc(w.text)}</li>`).join('');
  }
  function draw() {
    if (!session) {
      $('.lt-clock').textContent = '';
      $('.lt-note').textContent = note || 'No rules to try on this map.';
      for (const s of ['.lt-happen', '.lt-decide', '.lt-state', '.lt-log', '.lt-why']) $(s).innerHTML = '';
      return;
    }
    $('.lt-clock').textContent = `t = ${secs(session.t)}`;
    $('.lt-note').textContent = note;
    const hs = session.happenings();
    $('.lt-happen').innerHTML = hs.length ? hs.map((h, i) => {
      const said = vocab.whenText({ src: h.thing, when: h.output, option: h.option, port: h.port, near: h.near }, words()).replace(/^When /, '');
      return `<button type="button" data-fire="${i}" ${h.present ? '' : 'disabled'} title="Rules ${esc(h.rules.join(', '))}${h.watched ? ' (looked at every half second)' : ''}">${esc(said)}</button>`;
    }).join('') : '<p class="hint">No rule waits for something to happen (rules "when the map starts" run by themselves: press Next).</p>';
    const ds = session.decisions();
    $('.lt-dhead').hidden = !ds.length;
    $('.lt-decide').innerHTML = ds.map((d) => `<button type="button" data-decide="${esc(d.id)}">${esc(d.text)}</button>`).join('');
    const st = session.state();
    const rows = [];
    for (const [k, v] of Object.entries(st.flags || {})) rows.push(`<div>State <b>${esc(k)}</b> = ${v ? 'Yes' : 'No'} <button type="button" data-flag="${esc(k)}" data-value="${v ? 0 : 1}">${v ? 'Set No' : 'Set Yes'}</button></div>`);
    for (const [k, v] of Object.entries(st.counters || {})) rows.push(`<div>Counter <b>${esc(k)}</b> = ${esc(String(v))}</div>`);
    const counts = session.counts();
    for (const [id, r] of Object.entries(st.rules || {})) {
      const c = counts[id] || {}, ran = c.fired ? `ran ${c.fired === 1 ? 'once' : c.fired + ' times'}` : '';
      if (r.running) rows.push(`<div>Rule ${esc(id)}: running, its next action at ${secs(r.next)}${ran ? ` (${ran})` : ''}</div>`);
      else if (ran) rows.push(`<div>Rule ${esc(id)}: ${ran}${c.failed ? `, ${c.failed} failed` : ''}</div>`);
    }
    for (const [n, t] of Object.entries(st.timers || {})) rows.push(`<div>${esc(nameOf(n))}: ${t.running ? `${t.paused ? 'paused' : 'running'}, ${secs(t.left)} left` : 'stopped'}</div>`);
    $('.lt-state').innerHTML = rows.join('') || '<p class="hint">Nothing set yet.</p>';
    const lines = session.log();
    const said = { vocab, words: words(), sentences, player };
    // an action on objects tagged alike, then the same action on each of them in the same moment: one line, with their names
    const read = [];
    for (const { t, line } of lines.slice(-300)) {
      const s = lineText(line, said), last = read.at(-1);
      if (last && last.s.tagged && s.kind === 'act' && last.t === t && last.s.rule === s.rule && last.s.verb === s.verb) { last.names.push(nameOf(s.target)); continue; }
      s.tagged = s.kind === 'act' && /^tag /.test(s.target);
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
  return {
    async show() {
      try { await open(); } catch (e) { session = null; note = 'Try it: ' + (e.message || e); }
      draw();
    },
  };
}
