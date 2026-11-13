// The Logic window's drawing of the model (editor/static/logic-window.js canvasOf, indexOf) and Try it's log in words
// (logic-try.js lineText): what a level designer needs, in their words (5 Nov 2026). A thing is titled by its name,
// with its picture or its kind's icon, and only the pins in use; a rule card by what sets it off, the thing it is
// wired to called "it"; its steps' time only when one of them waits; no "+N more"; the index lists the objects, the
// states and counters and what to check. The modules add their stylesheet to the page as they load: here the page is
// a stand-in, only while they load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicIndex, logicGraph } from '../editor/static/logic-graph-model.js';
import { logicProblems, problemsByNode } from '../editor/static/logic-graph-problems.js';
import { vocabulary } from '../editor/static/logic-vocab.js';
import { catalog, world, featureLab } from './logic_graph_world.mjs';

async function load() {
  const inert = () => new Proxy(function () {}, { get: (t, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : inert()),
    apply: () => inert(), construct: () => inert(), set: () => true });
  const had = Object.hasOwn(globalThis, 'document');
  if (!had) globalThis.document = inert();
  try {
    return { ...(await import('../editor/static/logic-window.js')), ...(await import('../editor/static/logic-try.js')) };
  } finally {
    if (!had) delete globalThis.document;
  }
}
const { canvasOf, indexOf, lineText, ICONS, proposalHtml, markShown, whyHtml, storyItemOf, watchList, WATCH_MAX, FRESH_SECS,
  startOf, startText, startBarHtml } = await load();
const drawn = (input, pictures) => {
  const ix = logicIndex(input), problems = logicProblems(ix);
  return { ix, problems, g: canvasOf(logicGraph(ix), problemsByNode(problems), pictures) };
};
const node = (g, title) => g.nodes.find((n) => n.title === title);

test('a rule card is titled by what sets it off, the thing called "it"; its id is a dim badge; no sentence under it', () => {
  const { g } = drawn(world([
    { id: 'L1', src: 'Comp1', when: 'option', option: 2, do: [{ id: 'a1', verb: 'open', target: 'Door3' }, { id: 'a2', verb: 'message', a: 'Hi' }] },
  ]));
  const card = g.nodes.find((n) => n.kind === 'rule');
  assert.equal(card.title, 'When the player chooses "Call the guards" on it');
  assert.equal(card.sub, undefined);
  assert.equal(card.badges.at(-1).text, 'L1');
  assert.equal(card.in.id, 'cause:0', 'the cause comes into its header');
  assert.deepEqual(card.rows.map((r) => [r.text, r.time]), [['Open the door Door3', undefined], ['The message "Hi"', undefined]],
    'no "Then" without a condition, no time when nothing waits');
  assert.ok(g.wires.some((w) => w.to.node === card.id && w.to.pin === 'cause:0'));
});

test('a rule that holds "while" is titled by the lasting state, "in it" kept as it is', () => {
  const { g } = drawn(world([{ id: 'L1', src: 'Zone1', when: 'enter', while: true, do: [{ id: 'a1', verb: 'open', target: 'Door3' }, { id: 'a2', verb: 'message', a: 'Hi' }] }]));
  assert.equal(g.nodes.find((n) => n.kind === 'rule').title, 'While the player is in it');
  // a rule of the map's own: the condition, not "When a condition becomes true"
  const map = drawn(world([{ id: 'L2', src: '', when: 'becomes', watch: { flag: 'Power' }, while: true,
    do: [{ id: 'a1', verb: 'open', target: 'Door3' }, { id: 'a2', verb: 'message', a: 'Hi' }] }])).g;
  assert.match(map.nodes.find((n) => n.kind === 'rule').title, /^While Power is Yes/);
});

test('a condition: "Only if" then "Then"; a step that waits gives every step its time', () => {
  const { g } = drawn(world([{ id: 'L1', src: 'Button1', when: 'used', requires: [{ flag: 'Ready', is: true }],
    do: [{ id: 'a1', verb: 'open', target: 'Door3' }, { id: 'a2', verb: 'message', a: 'Later', delay: 2 }] }]));
  const card = g.nodes.find((n) => n.kind === 'rule');
  assert.deepEqual(card.rows.map((r) => [r.head ? 'head' : '', r.text, r.time]), [
    ['head', 'Only if', undefined], ['', 'Ready is Yes', undefined], ['head', 'Then', undefined],
    ['', 'Open the door Door3', 'now'], ['', 'The message "Later"', '+2 s']]);
});

test('a thing: its name, its icon or picture, only the pins in use, no "+N more"', () => {
  const { g } = drawn(world([{ id: 'L1', src: 'Button1', when: 'used', requires: [{ flag: 'Ready', is: true }], do: [{ id: 'a1', verb: 'open', target: 'Door3' }] }]),
    (name) => (name === 'Button1' ? 'cls:Button1' : ''));
  const button = g.nodes.find((n) => n.id === 'obj:Button1'), door = g.nodes.find((n) => n.id === 'obj:Door3');
  assert.equal(button.thumb, 'cls:Button1');
  assert.equal(door.icon, 'door');
  assert.ok(ICONS.door);
  assert.equal(door.foot, undefined);
  assert.deepEqual(door.rows.map((r) => r.text), ['Open']);
  for (const n of g.nodes) assert.equal(n.foot, undefined);
});

test('Feature Lab drawn: every rule card titled "When ...", no thing with a foot', () => {
  const { g } = drawn(featureLab());
  const cards = g.nodes.filter((n) => n.kind === 'rule');
  assert.ok(cards.length >= 5);
  for (const c of cards) assert.match(c.title, /^When /);
});

test('the index: the objects (how many rules each starts), the states and counters, what to check', () => {
  const { ix, problems } = drawn(world([
    { id: 'L1', src: 'Button1', when: 'used', do: [{ id: 'a1', verb: 'count', a: 'Keys', b: '1' }] },
    { id: 'L2', src: 'Button1', when: 'used', requires: [{ flag: 'Never', is: true }], do: [{ id: 'a1', verb: 'open', target: 'Gone' }] },
  ]));
  const sections = indexOf(ix, logicGraph(ix), problems);
  assert.deepEqual(sections.map((s) => s.id), ['objects', 'states', 'check']);
  const objects = sections[0].rows;
  assert.ok(objects.some((r) => r.key === 'thing:obj:Button1' && r.note === '2'));
  assert.ok(objects.some((r) => r.key === 'thing:obj:Gone' && r.tone === 'bad'));
  assert.deepEqual(sections[1].rows.map((r) => [r.text, r.note, r.tone]), [['Keys', '#', undefined], ['Never', '', 'warn']]);
  assert.ok(sections[2].rows.every((r) => r.tone === 'bad' || r.tone === 'warn'));
});

test('the index: a group of a kind that starts rules is one of the objects (P9); "the object it happened to" is no missing object', () => {
  const groups = [{ id: 'G1', name: 'Troopers', members: [], filter: { kind: 'UNATCOTroop' } }];
  const { ix, problems } = drawn(world([{ id: 'L1', src: '', group: 'G1', when: 'hurt', do: [{ id: 'a1', verb: 'stand', target: '@it' }] }],
    { edits: { logic: { groups } }, sets: { G1: ['Guard1'] } }));
  const objects = indexOf(ix, logicGraph(ix), problems)[0].rows;
  assert.ok(objects.some((r) => r.key === 'thing:grp:G1' && r.text === 'Troopers' && r.note === '1'), JSON.stringify(objects));
  assert.deepEqual(problems.filter((p) => p.code === 'no-target'), []);
});

test('the index: states watched while playing (P5) have their pin, come first, show what the game says, fresh a moment', () => {
  const rules = [
    { id: 'L1', src: 'Button1', when: 'used', do: [{ id: 'a1', verb: 'count', a: 'Keys', b: '1' }] },
    { id: 'L2', src: 'Button1', when: 'used', requires: [{ flag: 'Never', is: true }], do: [{ id: 'a1', verb: 'open', target: 'Gone' }] },
  ];
  // nothing watched: every state has a pin, off
  let { ix, problems } = drawn(world(rules));
  let states = indexOf(ix, logicGraph(ix), problems).find((s) => s.id === 'states').rows;
  assert.deepEqual(states.map((r) => [r.text, r.pin]), [['Keys', { name: 'Keys', on: false }], ['Never', { name: 'Never', on: false }]]);
  assert.match(states[0].title, /Click the pin to watch it while playing$/);
  // Never and a state no rule uses (the Story's) watched: first, then the others; values from the game, one fresh
  ({ ix, problems } = drawn(world(rules, { edits: { logic: { watch: ['never', 'StoryMet', 7, ''] } } })));
  assert.deepEqual(watchList(ix.edits), ['never', 'StoryMet']);
  const values = new Map([['never', { name: 'Never', value: 'true', old: 'false', t: 12.4, changes: 2 }], ['keys', { name: 'Keys', value: '3', t: 1, changes: 1 }]]);
  states = indexOf(ix, logicGraph(ix), problems, { values, fresh: new Map([['never', 1.5], ['storymet', FRESH_SECS + 1]]) }).find((s) => s.id === 'states').rows;
  assert.deepEqual(states.map((r) => [r.text, r.pin.on, r.note, r.age]), [
    ['Never', true, 'Yes', 1.5], ['StoryMet', true, '', undefined], ['Keys', false, '#', undefined]]);
  assert.match(states[0].title, /In the game: Yes \(changed 2 times, last at 12.4 s\)\nWatched while playing/);
  assert.match(states[1].title, /^StoryMet\nNo rule of this map sets or reads it/);
  assert.equal(states[1].key, 'state:StoryMet');
  assert.equal(WATCH_MAX, 32);
});

test('a start value (P5): the note and the line in the list until the game says, the bar over its graph', () => {
  const rules = [{ id: 'L2', src: 'Button1', when: 'used', requires: [{ flag: 'Never', is: true }], do: [{ id: 'a1', verb: 'open', target: 'Gone' }] }];
  const { ix, problems } = drawn(world(rules, { edits: { logic: { start: { never: true, Keys: 4 } } } }));
  assert.equal(startOf(ix.edits, 'NEVER'), true);
  assert.equal(startOf(ix.edits, 'Other'), undefined);
  assert.deepEqual([true, false, 0, 7].map(startText), ['Yes', 'No', '0', '7']);
  const row = indexOf(ix, logicGraph(ix), problems).find((s) => s.id === 'states').rows.find((r) => r.text === 'Never');
  assert.equal(row.note, '=Yes');
  assert.equal(row.tone, undefined, 'not a warning: it has a value');
  assert.match(row.title, /Starts as Yes on the map's first visit/);
  // a state: Yes / No / not set; a counter (or one only known by its number): a number
  assert.match(startBarHtml('Never', 'bool', true), /Starts as <select[^>]*>.*<option value="1" selected>Yes/);
  assert.match(startBarHtml('Never', 'bool', undefined), /<option value="" selected>not set/);
  assert.match(startBarHtml('Keys', 'int', 4), /Starts at <input type="number"[^>]*value="4"/);
  assert.match(startBarHtml('Keys', '', 4), /<input type="number"/);
  assert.match(startBarHtml('Odd', '', undefined), /<select/);
});

test('Try it\'s log in words: the rule as it says itself, actions with the names, the player not named', () => {
  const vocab = vocabulary(catalog), names = { UCEdit3: 'Button', UCEditBox3: 'Door', UCEdit5: 'UNATCO Troop' };
  const words = { name: (n) => names[n] || n, family: () => 'other', word: () => '', usable: () => false, portLabel: (n, k) => k,
    optionText: () => '', itemName: (c) => c };
  const ctx = { vocab, words, sentences: { L1: 'When the player uses Button: open Door' }, player: 'JCDentonMale0' };
  assert.equal(lineText('fire|M|L1|UCEdit3|used|RevJCDentonMale0|When the player uses Button UCEdit3: open door UCEditBox3', ctx).text,
    'When the player uses Button: open Door');
  assert.equal(lineText('act|M|L1|navgo|UCEdit5|-400.0', ctx).text, 'UNATCO Troop walks to a place');
  assert.equal(lineText('act|M|L1|message||Vault open', ctx).text, 'The message "Vault open"');
  assert.equal(lineText('act|M|L1|lightoff|tag white|', ctx).text, 'Turn off objects tagged white');
  assert.equal(lineText('act|M|L1@3.20#a1|hostile|every Troopers', ctx).text, 'The group "Troopers" turn hostile to the player');   // (P9)
  assert.match(lineText('skip|M|L2|cond|flag|GotKit|1', ctx).text, /^Did not run: only if GotKit is Yes/);
});

test('a list of steps: its rows in their order, If and Otherwise heads with their steps indented, no End; "If not" inside its card', () => {
  const steps = [{ verb: 'message', a: 'Go', delay: 0 }, { verb: 'if', requires: [{ flag: 'A' }] }, { verb: 'open', target: 'Door3', delay: 2 },
    { verb: 'else' }, { verb: 'message', a: 'No' }, { verb: 'end' }, { verb: 'wait', delay: 1 }, { verb: 'message', a: 'Done' }];
  const { g } = drawn(world([{ id: 'L1', src: 'Button1', when: 'used', steps: true, do: steps }]));
  const card = g.nodes.find((n) => n.kind === 'rule');
  assert.deepEqual(card.rows.map((r) => `${r.head ? '# ' : ''}${r.indent ? '  ' : ''}${r.text}${r.time ? ' ' + r.time : ''}`),
    ['The message "Go"', '# If A is Yes', '  Open the door Door3 +2 s', '# Otherwise', '  The message "No"', 'Wait 1 s', 'The message "Done"']);
  const two = drawn(world([
    { id: 'L1', src: 'Button1', when: 'used', requires: [{ flag: 'A' }], do: [{ verb: 'open', target: 'Door3' }, { verb: 'message', a: 'Yes' }] },
    { id: 'L2', src: 'Button1', when: 'used', otherwiseOf: 'L1', requires: [{ flag: 'A', is: false }], do: [{ verb: 'message', a: 'No' }] }])).g;
  assert.equal(two.nodes.filter((n) => n.kind === 'rule').length, 1, 'the "If not" rule is no card of its own');
  const main = two.nodes.find((n) => n.kind === 'rule');
  assert.deepEqual(main.rows.slice(-2).map((r) => r.text), ['If not', 'The message "No"']);
  assert.ok(!two.wires.some((w) => w.to.node === 'rule:L2' || w.from.node === 'rule:L2'), 'its wires are the card\'s');
});

test('a signal\'s hub (P3): drawn with its icon and its two pins; the index lists the signals, how many send and wait', () => {
  const links = [{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'signal', a: 'Alarm' }, { verb: 'message', a: 'x' }] },
    { id: 'L2', when: 'signal', signal: 'Alarm', do: [{ verb: 'open', target: 'Door3' }] },
    { id: 'L3', when: 'signal', signal: 'Quiet', do: [{ verb: 'close', target: 'Door3' }] }];
  const { ix, problems, g } = drawn(world(links));
  const hub = node(g, 'Alarm');
  assert.deepEqual([hub.kind, hub.icon, hub.sub, hub.rows.map((r) => r.text)], ['thing', 'signal', 'Signal', ['It is sent', 'Send it']]);
  assert.ok(ICONS.signal);
  const signals = indexOf(ix, logicGraph(ix), problems).find((s) => s.id === 'signals');
  assert.deepEqual(signals.rows.map((r) => [r.key, r.text, r.note, r.tone]), [['thing:sig:Alarm', 'Alarm', '1 → 1', undefined], ['thing:sig:Quiet', 'Quiet', '0 → 1', 'warn']]);
});

// P3 logic_propose: the assistant's proposal drawn as ghosts (its rules and their wires), a rule it made with a faint
// mark until the user changes it, and the bar that says what it does
test('a proposal: its nodes and wires as ghosts, the assistant mark, the bar', () => {
  const shown = { nodes: [{ id: 'rule:L2', badges: [] }, { id: 'rule:L1', badges: [{ text: 'L1' }] }, { id: 'obj:Door1' }],
    wires: [{ id: 'w1', from: { node: 'obj:Button1' }, to: { node: 'rule:L2' } }, { id: 'w2', from: { node: 'obj:Button1' }, to: { node: 'rule:L1' } },
      { id: 'rule:L4', from: { node: 'obj:Button1' }, to: { node: 'obj:Door1' } }, { id: 'rule:L1', from: { node: 'obj:Button1' }, to: { node: 'obj:Door1' } }] };
  const ix = { edits: { links: [{ id: 'L1', by: 'assistant' }, { id: 'L2' }] } };
  markShown(shown, { ghost: new Set(['rule:L2', 'rule:L4']) }, ix);
  assert.equal(shown.nodes[0].ghost, true);
  assert.equal(shown.nodes[1].ghost, undefined);
  assert.deepEqual(shown.nodes[1].badges.map((b) => b.text), ['assistant', 'L1']);
  assert.deepEqual(shown.wires.map((w) => !!w.ghost), [true, false, true, false]);   // a simple rule's wire is its rule
  assert.match(shown.wires[3].title, /Made by the AI assistant/);
  const html = proposalHtml({ id: 1, summary: 'Open the vault <now>', added: ['L2'], changed: [], removed: [{ id: 'L3', sentence: 'when the player uses it: open it' }],
    groups: ['G1'], blocks: [], problems: { brought: [{ level: 'warn', text: 'No rule sends the signal "X".' }] } });
  assert.match(html, /The assistant proposes: Open the vault &lt;now&gt;/);
  assert.match(html, /1 new rule, 1 rule removed, 1 new group\./);
  assert.match(html, /Removes: When the player uses it: open it/);
  assert.match(html, /To check after it: No rule sends/);
  assert.deepEqual([...html.matchAll(/data-decide="(\w+)"/g)].map((m) => m[1]), ['accept', 'edit', 'reject']);
});

test("Why didn't it run? as the panel shows it: the notes, then each rule's Play, Try it and checks", () => {
  const html = whyHtml({ notes: ['From the last Play, which ended at 18:02.'], rules: [
    { id: 'L1', src: 'Btn15', sentence: 'when the player uses Button 15: open <the> vault', play: [{ text: 'It heard it, but "Power is Yes" did not hold.' }],
      tried: [{ text: 'It ran once, the last at 2 s.' }], checks: [{ level: 'warn', text: 'Nothing sets Power.' }] },
    { id: 'L2', src: '', sentence: 'when the map starts: say hi', play: [], tried: [], checks: [] }] });
  assert.match(html, /From the last Play, which ended at 18:02\./);
  assert.match(html, /data-rule="L1" data-src="Btn15"[^>]*>When the player uses Button 15: open &lt;the&gt; vault</);
  assert.deepEqual([...html.matchAll(/<h5>([^<]+)<\/h5>/g)].map((m) => m[1]), ['In the last Play', 'In Try it', 'To check']);
  assert.match(html, /<li class="warn">Nothing sets Power\.<\/li>/);
  assert.match(html, /Nothing to say of it yet: Play the map, or set it off in Try it\./, 'a rule with nothing said of it');
  assert.match(whyHtml({ notes: [], rules: [] }), /It has no rules/);
  const many = whyHtml({ notes: [], rules: Array.from({ length: 15 }, (_, i) => ({ id: 'L' + i, sentence: 's', play: [], tried: [], checks: [] })) });
  assert.equal([...many.matchAll(/<section>/g)].length, 12);
  assert.match(many, /And 3 more rules/);
});

test('a Story node opened: a dialogue, an InfoLink or a Story event, by its node id; other nodes are not (P5)', () => {
  assert.deepEqual(storyItemOf('dlg:d4'), { key: 'dialogues', id: 'd4' });
  assert.deepEqual(storyItemOf('info:i2'), { key: 'infolinks', id: 'i2' });
  assert.deepEqual(storyItemOf('story:e3'), { key: 'events', id: 'e3' });
  assert.deepEqual(storyItemOf('dlg:talk:2'), { key: 'dialogues', id: 'talk:2' });
  for (const id of ['obj:Door2', 'rule:L7', 'sig:Alarm', 'world', 'dlg:', '', null, undefined]) assert.equal(storyItemOf(id), null, String(id));
});

test("Try it says a step's text as the game shows it: a bar a slash, a double quote a single one, a letter the fonts lack '?'", async () => {
  const { gameText } = await import('../editor/static/logic-try.js');
  assert.equal(gameText('Survive the lab; don\'t | break "it". ✓ — “x” àè'), "Survive the lab; don't / break 'it'. ? - 'x' àè");
  assert.equal(gameText('two\r\nlines'), 'two  lines');
});

test("a 'while' rule's end is said by its rule's sentence now, not the label it was built with", async () => {
  const { lineText } = await import('../editor/static/logic-try.js');
  const vocab = vocabulary(catalog);
  const ctx = { vocab, words: { name: (n) => n }, sentences: { L22: 'While the player is in Zone1: sound Alarm' } };
  assert.equal(lineText('fire|M|L22_until|Zone1|leave|JCDentonMale0|When the player walks into the zone: sound the alarm (undone)', ctx).text,
    'While the player is in Zone1: sound Alarm (undone)');
});
