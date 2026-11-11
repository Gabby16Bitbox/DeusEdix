// The Logic window's Read view and Copy as text (editor/static/logic-graph-read.js): the map's logic as plain prose by
// phase, each rule as the Inspector says it, what it does otherwise and its options in words, the Story and the
// problems after; restricted to a scope or a selection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicIndex, logicGraph, scopeOf } from '../editor/static/logic-graph-model.js';
import { readView, readText } from '../editor/static/logic-graph-read.js';
import { catalog, featureLab, world } from './logic_graph_world.mjs';

const read = (input, options) => readView(logicIndex(input), options);

test('Feature Lab as prose: each rule as app.js said it, by the thing it belongs to, the dialogue, the problems', () => {
  const lab = featureLab();
  const view = read(lab);
  assert.deepEqual(view.sections.map((s) => [s.title, s.groups.map((g) => [g.title, g.node, g.lines.map((l) => l.rule)])]), [['', [
    ['Button UCEdit5', 'obj:UCEdit5', ['L1', 'L2', 'L3', 'L4', 'L8']], ['script UCEdit29', 'obj:UCEdit29', ['L5']], ['door UCEditBox7', 'obj:UCEditBox7', ['L6', 'L7']]]]]);
  for (const l of lab.edits.links) {
    const line = view.sections[0].groups.flatMap((g) => g.lines).find((x) => x.rule === l.id);
    assert.equal(line.text, `${l.id}: ${l.label}`);
  }
  assert.deepEqual(view.story, [{ node: 'dlg:d1', text: 'Dialogue "Rossi at the door" - "why are you mad?"' }]);
  assert.equal(readText(view), [
    '01_Feature_Lab: logic', '',
    'Button UCEdit5',
    '  L1: When the player uses Button UCEdit5: play the animation of door UCEditBox7, Officer Rossi UCEdit8 walks to a place',
    '  L2: When the player uses Button UCEdit5: add 1 to the counter Test_Presses, the message "Press counted"',
    '  L3: When the player uses Button UCEdit5, only if the counter Test_Presses is at least 2: the message "Second press: the counter holds"',
    '  L4: When the player uses Button UCEdit5: script UCEdit29: Start it (Seconds=1)',
    '  L8: When the player uses Button UCEdit5, only if the counter Test_Presses is at least 3: blow up door UCEditBox7 (only once)',
    'script UCEdit29',
    '  L5: When script UCEdit29 says "it is done": the message "TestBlock said Done", add 1 to the counter Test_Done',
    'door UCEditBox7',
    '  L6: When door UCEditBox7 has opened: the message "Door opened"',
    '  L7: When door UCEditBox7 is blown up: the message "Door destroyed"', '',
    'Conversations and Story events',
    '  Dialogue "Rossi at the door" - "why are you mad?"', '',
    'Problems',
    '  info: L5: Nothing reads the counter Test_Done.',
    '  info: Nothing reads the state UCEd9fd2_d1_Played.', ''].join('\n'));
});

test('by phase: rules kept to a phase first, the others after under "Always"; options and otherwise in words', () => {
  const logic = { phases: [{ id: 'Base', name: 'Base alert', list: ['Quiet', 'Alarm'] }] };
  const view = read(world([
    { id: 'L1', src: 'Button1', when: 'used', once: true, do: [{ verb: 'open', target: 'Door3' }] },
    { id: 'L2', src: 'Pad1', when: 'code', phase: { set: 'Base', in: ['Alarm'] }, cooldown: 5, mute: true, do: [{ verb: 'open', target: 'Door3', delay: 2 }],
      else: [{ verb: 'message', a: 'The keypad is dead.' }] },
    { id: 'L3', src: '', when: 'start', do: [{ verb: 'message', a: 'Welcome' }] },
  ], { edits: { logic } }));
  assert.deepEqual(view.sections.map((s) => s.title), ['While Base alert is Alarm', 'Always']);
  assert.deepEqual(view.sections[0].groups[0].lines.map((l) => l.text),
    ['L2: When the right code is typed on the keypad Pad1: after 2 s open the door Door3 [cooldown 5 s, muted]; otherwise: the message "The keypad is dead."']);
  assert.deepEqual(view.sections[1].groups.map((g) => [g.title, g.lines.map((l) => l.text)]), [
    ['the button Button1', ['L1: When the player uses the button Button1: open the door Door3 (only once)']],
    ['When the map starts', ['L3: When the map starts: the message "Welcome"']]]);
  // with no phase at all, no section title
  assert.deepEqual(read(world([{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'open', target: 'Door3' }] }])).sections.map((s) => s.title), ['']);
});

test('the words come from the vocabulary: a Story event\'s cause as a rule\'s, an otherwise as a rule\'s steps', () => {
  const story = { events: [{ id: 'e1', title: 'Body found', when: { type: 'dead', actor: 'Guard1' }, do: [{ type: 'door', actor: 'Door3', act: 'open' }] }] };
  const links = [{ id: 'L1', src: 'Pad1', when: 'code', do: [{ verb: 'open', target: 'Door3' }], else: [{ verb: 'message', a: 'Later', delay: 3 }, { verb: 'message', a: 'No.' }] }];
  const say = (cat) => {
    const ix = logicIndex({ ...world(links, { story }), catalog: cat });
    return [readView(ix).story[0].text, readView(ix).sections[0].groups[0].lines[0].text, ix.vocab.steps(links[0].else, ix.ctx)];
  };
  const [event, rule, steps] = say(catalog);
  assert.equal(event, 'Story event "Body found" - When the character Guard1 is not alive: open the door Door3');
  assert.equal(steps, 'the message "No.", after 3 s the message "Later"');
  assert.equal(rule, `L1: When the right code is typed on the keypad Pad1: open the door Door3; otherwise: ${steps}`);
  // the rename pass of logic.json (about_v2: "As soon as") and a new way to say a step reach the Read view too
  const renamed = JSON.parse(JSON.stringify(catalog));
  renamed.sentence.when = 'As soon as {say}';
  renamed.sentence.step = '{act}[ ({delay} s later)]';
  const [event2, rule2] = say(renamed);
  assert.equal(event2, 'Story event "Body found" - As soon as the character Guard1 is not alive: open the door Door3');
  assert.equal(rule2, 'L1: As soon as the right code is typed on the keypad Pad1: open the door Door3; otherwise: the message "No.", the message "Later" (3 s later)');
});

test('a scope or a selection: only what it shows; an empty map says so', () => {
  const links = [{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'open', target: 'Door3' }] },
    { id: 'L2', src: 'Zone1', when: 'enter', do: [{ verb: 'lighton', target: 'Gone' }] }];
  const input = world(links), ix = logicIndex(input), g = logicGraph(ix);
  const s = scopeOf(g, { kind: 'chain', root: 'obj:Button1' });
  const only = new Set([...s.nodes.map((n) => n.id), ...s.wires.map((w) => w.id)]);         // L1 is a wire: its id is the rule's
  const view = readView(ix, { only });
  assert.deepEqual(view.sections.flatMap((x) => x.groups.flatMap((gr) => gr.lines.map((l) => l.rule))), ['L1']);
  assert.deepEqual(view.problems, []);                                                         // L2's missing light is not in it
  assert.deepEqual(readView(ix).problems.map((p) => p.text), ['L2: Gone is not in the map any more.']);
  assert.equal(readText(read(world([]))), '01_Test: logic\n\nNo logic yet.\n');
});
