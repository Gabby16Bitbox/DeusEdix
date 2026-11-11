// Live control of the logic while Play runs (P7): the lines the editor sends (static/logic-live.js liveCommand), what
// the game's lines say of them (liveStep), and their sentences (static/logic-log.js). The game's side is
// project-template UCConsoleLink.Live / UCLink.LiveHeard, LivePause: the commands and line kinds must agree with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveCommand, liveState, liveStep, ruleLive, traceBits, liveBook, liveOf, liveRead, liveAny, liveBarHtml, pausedWords } from '../editor/static/logic-live.js';
import { parseLogicLine, logicSentence } from '../editor/static/logic-log.js';

const CLASSES = new URL('../project-template/src/DeusEdix/Classes/', import.meta.url);
const uc = (name) => readFileSync(new URL(name, CLASSES), 'utf8');
const line = (s) => parseLogicLine('DeusEdixLogic: ' + s);
const text = (e, names) => logicSentence(e, names).parts.map((p) => (typeof p === 'string' ? p : p.rule || p.name)).join('');

test('the lines sent for each command', () => {
  assert.equal(liveCommand('fire', 'L7'), 'deusedix fire L7');
  assert.equal(liveCommand('step', 'R3_U000'), 'deusedix step R3_U000');
  assert.equal(liveCommand('mute', 'L7', true), 'deusedix mute L7');
  assert.equal(liveCommand('mute', 'L7', false), 'deusedix mute L7 off');
  assert.equal(liveCommand('break', 'L7'), 'deusedix break L7');
  assert.equal(liveCommand('trace', 'L7', false), 'deusedix trace L7 off');
  assert.equal(liveCommand('happen', 'Button1', 'used'), 'deusedix happen Button1 used');
  assert.equal(liveCommand('set', 'Vault_PowerOff', true), 'deusedix set Vault_PowerOff yes');
  assert.equal(liveCommand('set', 'Vault_PowerOff', false), 'deusedix set Vault_PowerOff no');
  assert.equal(liveCommand('set', 'Keys', '3'), 'deusedix set Keys 3');
  assert.equal(liveCommand('set', 'Keys', -2), 'deusedix set Keys -2');
  assert.equal(liveCommand('input', 'UCBPhases0', 'GoTo_Alarm'), 'deusedix input UCBPhases0 GoTo_Alarm');
  assert.equal(liveCommand('input', 'Clock1', 'Start', 'Seconds=10'), 'deusedix input Clock1 Start Seconds=10');
  assert.equal(liveCommand('continue'), 'deusedix continue');
  assert.equal(liveCommand('clear'), 'deusedix clear');
  assert.equal(liveCommand('paused'), 'deusedix paused');
});

test('what is refused, in words', () => {
  assert.throws(() => liveCommand('fire', ''), /Choose a rule/);
  assert.throws(() => liveCommand('fire', 'L7 extra'), /Choose a rule/);
  assert.throws(() => liveCommand('set', 'Keys', '2.5'), /whole number/);
  assert.throws(() => liveCommand('set', 'Keys', ''), /whole number/);
  assert.throws(() => liveCommand('set', '9x', true), /letters, digits/);
  assert.throws(() => liveCommand('input', 'B1', 'Start', 'a b'), /without spaces/);
  assert.throws(() => liveCommand('teleport', 'L7'), /Unknown/);
});

test('the game\'s lines: muted, traced, a break, a step, Continue, the player going on, Clear', () => {
  const s = liveState();
  for (const l of ['live|M|L7|mute|on', 'live|M|L8@3.20|trace|on', 'live|M|L9|break|on']) liveStep(s, line(l));
  assert.deepEqual(ruleLive(s, 'l7'), { muted: true, traced: false, breaks: false, stepping: false });
  assert.deepEqual(ruleLive(s, 'L8'), { muted: false, traced: true, breaks: false, stepping: false }, 'a UCRule\'s @time is not its id');
  assert.equal(ruleLive(s, 'L9').breaks, true);
  liveStep(s, line('break|M|L9|fire|'));
  assert.deepEqual(s.paused, { rule: 'L9', why: 'fire', step: null });
  liveStep(s, line('live|M|L9|step|'));
  assert.equal(s.paused, null);
  assert.equal(ruleLive(s, 'L9').stepping, true);
  liveStep(s, line('break|M|L9@4.00#a2|act|1'));
  assert.deepEqual(s.paused, { rule: 'L9', why: 'act', step: 1 });
  liveStep(s, line('fire|M|L1|Button1|used|JCDenton0|x'));
  assert.ok(s.paused, 'other lines of the same frame do not say the game goes on');
  liveStep(s, line('live|M||resumed|'));
  assert.equal(s.paused, null, 'the player went on (Jump): the console link says so');
  assert.equal(ruleLive(s, 'L9').stepping, true, 'still stepping until Continue');
  liveStep(s, line('live|M||continue|'));
  assert.equal(ruleLive(s, 'L9').stepping, false);
  liveStep(s, line('live|M|L7|mute|off'));
  assert.equal(ruleLive(s, 'L7').muted, false);
  liveStep(s, line('live|M||clear|'));
  assert.deepEqual([s.muted.size, s.traced.size, s.breaks.size, s.stepping.size], [0, 0, 0, 0]);
});

test('the sentences of the new lines', () => {
  assert.equal(text(line('live|M|L7|fire|')), 'L7 set off from the editor');
  assert.equal(text(line('live|M|L7|mute|on')), 'L7 muted for this Play');
  assert.equal(text(line('live|M|L7|break|off')), 'L7 the game no longer pauses on it');
  assert.equal(text(line('live|M||set|Vault_PowerOff=yes')), 'Vault_PowerOff set to Yes from the editor');
  assert.equal(text(line('live|M||set|Keys=3')), 'Keys set to 3 from the editor');
  assert.equal(text(line('live|M||resumed|')), 'The game goes on');
  assert.equal(text(line('live|M||happen|Button1 used')), 'Button1 used from the editor');
  assert.equal(text(line('break|M|L7|fire|')), 'L7 the game is paused here: it runs');
  assert.equal(text(line('break|M|L7|act|0')), 'L7 the game is paused after its step 1');
  assert.equal(text(line('skip|M|L7|muted|')), 'L7 did not run: it is muted for this Play');
  const tr = line('trace|M|L7|JCDenton0|0|10');
  assert.deepEqual(traceBits(tr), { phase: false, conds: [true, false] });
  assert.equal(text(tr), 'L7 heard it (by JCDenton0): not in its phase; 1 of 2 conditions hold');
  const reqs = [{ flag: 'Vault_PowerOff', is: true }, { flag: 'Met', is: true }];
  assert.match(text(tr, { conditionsOf: (r) => (r === 'L7' ? reqs : null) }), /Vault_PowerOff.* ✓, .*Met.* ✗$/);
  assert.equal(text(line('trace|M|L7|JCDenton0||')), 'L7 heard it (by JCDenton0): it has no conditions');
});

test('the game classes take these commands and write these lines', () => {
  const link = uc('UCConsoleLink.uc'), rule = uc('UCLink.uc'), v2 = uc('UCRule.uc');
  for (const verb of ['fire', 'happen', 'set', 'input', 'mute', 'trace', 'break', 'step', 'continue', 'clear', 'paused']) {
    assert.ok(link.includes(`case "${verb}":`), `UCConsoleLink.Live takes ${verb}`);
  }
  assert.ok(link.includes('Left(Caps(Cmd), 9) == "DEUSEDIX "'), 'the console link keeps "deusedix ..." for itself');
  assert.ok(link.includes('||resumed|'), 'it says when the game goes on');
  assert.ok(rule.includes('Level.Pauser = "DeusEdix"'), 'a break pauses the level by name (SetPause gives the empty player name: nothing pauses)');
  assert.ok(rule.includes('var transient bool bLiveMute, bLiveTrace, bLiveBreak, bLiveStep;'), 'never in a saved game');
  for (const kind of ['"trace"', '"break"', '"live"']) assert.ok(rule.includes(`Report(${kind}`), `UCLink writes ${kind}`);
  assert.ok(rule.includes('Report("skip", "muted|")'));
  assert.ok(v2.includes('if (!LiveHeard(By))') && v2.split('LiveFired();').length === 3, 'UCRule hears, breaks on a run and its Otherwise');
});

test('a map the player goes to starts as built; the lines of each map are its own', () => {
  const book = liveBook();
  liveRead(book, line('live|A|L7|mute|on'));
  liveRead(book, line('live|B|L1|break|on'));
  assert.equal(ruleLive(liveOf(book, 'A'), 'L7').muted, true, 'A keeps what it was told while the player is away');
  liveRead(book, line('fire|A.dx|L2|Button1|used|JCDenton0|x'));
  assert.equal(ruleLive(liveOf(book, 'a'), 'L7').muted, false, 'back on A: a new visit, the rules as built');
  assert.equal(ruleLive(liveOf(book, 'B'), 'L1').breaks, true);
  assert.equal(liveAny(liveOf(book, 'A')), false);
  assert.equal(liveAny(liveOf(book, 'B')), true);
});

test('the bar: paused with Step and Continue, a rule\'s buttons pressed as the game said, an object\'s happenings, a state', () => {
  const press = (html, live) => new RegExp(`data-live="${live}" aria-pressed="(true|false)"`).exec(html)?.[1];
  let html = liveBarHtml({});
  assert.match(html, /Select a rule/);
  assert.doesNotMatch(html, /data-live="clear"/);
  html = liveBarHtml({ rule: { id: 'L7', title: 'When the player uses <Button1>' }, flags: { muted: true, traced: false, breaks: true }, any: true });
  assert.match(html, /&lt;Button1&gt;/, 'its words escaped');
  assert.equal(press(html, 'mute'), 'true');
  assert.equal(press(html, 'trace'), 'false');
  assert.equal(press(html, 'break'), 'true');
  assert.match(html, /data-live="fire"/);
  assert.match(html, /data-live="clear"/);
  html = liveBarHtml({ paused: { rule: 'L7', why: 'act', step: 1 }, pausedTitle: 'When the player uses Button1' });
  assert.match(html, /title="When the player uses Button1"><b>The game is paused at L7<\/b>/);
  assert.match(html, /after its step 2/);
  assert.match(html, /data-live="step"/);
  assert.match(html, /data-live="continue"/);
  assert.doesNotMatch(html, /Select a rule/, 'paused: no hint');
  assert.equal(pausedWords({ why: 'fire', step: null }), 'as it runs');
  html = liveBarHtml({ happen: { object: 'Button1', title: 'Button1', list: [{ key: 'used', text: 'Used' }, { key: 'trigger', text: 'Triggered' }] } });
  assert.match(html, /<option value="used">Used<\/option><option value="trigger">Triggered<\/option>/);
  assert.match(html, /data-live="happen"/);
  assert.match(liveBarHtml({ state: { name: 'Keys', type: 'int' } }), /type="number"[^>]*class="lw-lvalue"/);
  assert.match(liveBarHtml({ state: { name: 'Met', type: 'bool' } }), /<select class="lw-lvalue"/);
});

test('the game\'s answer presses the buttons at once; an answer that did nothing does not', async () => {
  const { liveAnswered } = await import('../editor/static/logic-live.js');
  assert.deepEqual(liveAnswered('mute', 'L7', true, 'L7: mute on'), { kind: 'live', rule: 'L7', verb: 'mute', detail: 'on' });
  assert.deepEqual(liveAnswered('break', 'L7', false, 'L7: break off'), { kind: 'live', rule: 'L7', verb: 'break', detail: 'off' });
  assert.equal(liveAnswered('mute', 'L9', true, 'This map has no rule L9'), null);
  assert.equal(liveAnswered('fire', 'L7', '', 'Set off L7'), null, 'what a rule did comes from the log');
  assert.equal(liveAnswered('continue', '', '', 'The game goes on').verb, 'continue');
  const book = liveBook();
  liveRead(book, line('break|M|L7|fire|'));
  liveRead(book, { ...liveAnswered('continue', '', '', 'The game goes on'), map: book.last });
  assert.equal(liveOf(book, 'M').paused, null);
  liveRead(book, line('live|M||continue|'));
  assert.equal(liveOf(book, 'M').paused, null, 'the log saying it again changes nothing');
  assert.match(liveBarHtml({ paused: { rule: 'L7', why: 'fire' }, pausedTitle: 'A long sentence' }), /title="A long sentence"><b>The game is paused at L7<\/b>/);
  assert.doesNotMatch(liveBarHtml({ state: { name: 'Keys', type: 'int' } }), /Select a rule/);
});

test('the answer to "paused" says where a rule holds the game; the classes say it and keep the question out of the Console', async () => {
  const { pausedAnswer } = await import('../editor/static/logic-live.js');
  assert.deepEqual(pausedAnswer('The game runs (12.5)'), { paused: false, by: '', at: null });
  assert.deepEqual(pausedAnswer('The game is paused (DeusEdix, 37.634373) at P_changed|fire|'),
    { paused: true, by: 'DeusEdix', at: { rule: 'P_changed', why: 'fire', step: null } });
  assert.deepEqual(pausedAnswer('The game is paused (DeusEdix, 4) at L9|act|2').at, { rule: 'L9', why: 'act', step: 2 });
  assert.deepEqual(pausedAnswer('The game is paused (Player, 4)'), { paused: true, by: 'Player', at: null });
  assert.equal(pausedAnswer('Set off L7'), null);
  const link = uc('UCConsoleLink.uc'), rule = uc('UCLink.uc');
  assert.ok(link.includes('") at " $ default.HeldAt'), 'the answer names where');
  assert.ok(link.includes('if (Cmd ~= "deusedix paused")'), 'asked every second: not logged');
  assert.ok(rule.includes('class\'UCConsoleLink\'.default.HeldAt = Rule $ "|" $ why;'), 'a break says where');
});
