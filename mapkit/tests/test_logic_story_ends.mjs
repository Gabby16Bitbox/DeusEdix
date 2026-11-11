// P5 slice 2: rules that wait for the map's Story, "When the dialogue ... has ended" (when: ended, dialogue) and "When
// the InfoLink ... has been heard" (when: heard, infolink). The words (logic.json, logic-vocab.js), the field
// (logic-rule-ui.js), the wire out of the Story's node (logic-graph-model.js), the map check (logic-graph-problems.js)
// and Try it (logic-sim.js: a dialogue started there ends at once). The game's side: test_logic_story_ends.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { logicIndex, logicGraph, storyId } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { createSession } from '../editor/static/logic-sim.js';
import { vocabulary } from '../editor/static/logic-vocab.js';
import { causeRowsHtml, causeDefaults, WORLD_CAUSES } from '../editor/static/logic-rule-ui.js';
import { world } from './logic_graph_world.mjs';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const story = { dialogues: [{ id: 'd1', title: 'Gate talk', owner: 'Guard1', steps: [] }], infolinks: [{ id: 'i1', title: 'Jock calls' }] };
const wireOf = (g, id) => g.wires.find((w) => w.id === id);
const codes = (ps, rule) => ps.filter((p) => p.rule === rule).map((p) => p.code);

test('the two causes: no object, the Story\'s id, said by its title, offered with the map\'s own', () => {
  for (const [when, arg, type] of [['ended', 'dialogue', 'dialogue'], ['heard', 'infolink', 'infolink']]) {
    const e = logic.outputs[when];
    assert.equal(e.hears, 'gametag', `${when}: the game triggers its Tag (UCD_ / UCI_)`);
    assert.deepEqual(e.args.map((a) => [a.id, a.type]), [[arg, type]]);
    assert.ok(WORLD_CAUSES.includes(when), `${when} is one of the map's own causes`);
  }
  const v = vocabulary(logic), titles = { d1: 'Gate talk', i1: 'Jock calls' };
  const ctx = { name: (n) => n, storyTitle: (key, id) => titles[id] || `${id} (missing)` };
  assert.equal(v.whenText({ when: 'ended', dialogue: 'd1' }, ctx), 'When the dialogue "Gate talk" has ended');
  assert.equal(v.whenText({ when: 'heard', infolink: 'i1' }, ctx), 'When the InfoLink "Jock calls" has been heard');
  assert.equal(v.whenText({ when: 'ended', dialogue: 'd9' }, ctx), 'When the dialogue "d9 (missing)" has ended');
  assert.deepEqual(causeDefaults({ when: 'ended' }), { when: 'ended', dialogue: '' });
  assert.deepEqual(causeDefaults({ when: 'heard' }), { when: 'heard', infolink: '' });
});

test('the cause\'s field: the Story\'s dialogues or InfoLinks by title, one gone said missing', () => {
  const h = { esc: (s) => String(s), dialogues: [{ id: 'd1', label: 'Gate talk' }], infolinks: [] };
  const html = causeRowsHtml(logic.outputs.ended, { when: 'ended', dialogue: 'd1' }, -1, h);
  assert.match(html, /<select data-lkwarg="-1" data-k="dialogue"/);
  assert.match(html, /<option value="d1" selected>Gate talk<\/option>/);
  assert.match(causeRowsHtml(logic.outputs.ended, { when: 'ended', dialogue: 'd7' }, 0, h), /data-lkwarg="0".*d7 \(missing\)/s);
  assert.match(causeRowsHtml(logic.outputs.heard, { when: 'heard', infolink: '' }, -1, h), /has no InfoLink yet/);
});

test('the graph: the wire comes out of the dialogue\'s Ended and the InfoLink\'s Heard; one not in the Story, out of the map', () => {
  const links = [{ id: 'L1', src: '', when: 'ended', dialogue: 'd1', do: [{ verb: 'message', a: 'Bye' }] },
    { id: 'L2', src: '', when: 'heard', infolink: 'i1', do: [{ verb: 'message', a: 'Over' }, { verb: 'flag', a: 'Done', b: '1' }] },
    { id: 'L3', src: '', when: 'ended', dialogue: 'd9', do: [{ verb: 'message', a: 'Never' }] }];
  const g = logicGraph(logicIndex(world(links, { story })));
  const from = (rule) => g.wires.find((w) => w.to && w.to.node === `rule:${rule}` && w.kind === 'causes')?.from
    || g.wires.find((w) => w.id.startsWith(`act:${rule}/`))?.from;
  assert.deepEqual(from('L1'), { node: storyId('dialogues', 'd1'), pin: 'out:ended' });
  assert.deepEqual(from('L2'), { node: storyId('infolinks', 'i1'), pin: 'out:heard' });
  assert.notEqual(from('L3').node, storyId('dialogues', 'd9'));
  assert.ok(!g.nodes.some((n) => n.id === storyId('dialogues', 'd9')));
  assert.ok(wireOf(g, 'act:L1/a1') || g.wires.length, 'drawn');
});

test('the map check: a dialogue or an InfoLink not chosen, or not in the Story (only once the Story is read)', () => {
  const links = [{ id: 'L1', src: '', when: 'ended', dialogue: '', do: [{ verb: 'message', a: 'x' }] },
    { id: 'L2', src: '', when: 'heard', infolink: 'i9', do: [{ verb: 'message', a: 'x' }] },
    { id: 'L3', src: 'Button1', when: 'used', do: [{ verb: 'talk', a: 'd9' }, { verb: 'infolink', a: '' }] },
    { id: 'L4', src: '', when: 'ended', dialogue: 'd1', do: [{ verb: 'talk', a: 'd1' }, { verb: 'infolink', a: 'i1' }] }];
  const read = logicProblems(logicIndex(world(links, { story })));
  assert.deepEqual(codes(read, 'L1'), ['story-none']);
  assert.deepEqual(codes(read, 'L2'), ['story-missing']);
  assert.deepEqual(codes(read, 'L3'), ['story-missing', 'story-none']);
  assert.deepEqual(codes(read, 'L4'), []);
  assert.equal(read.find((p) => p.rule === 'L1').level, 'error', 'a rule waiting for nothing never runs');
  assert.equal(read.find((p) => p.rule === 'L3').level, 'warn');
  const unread = logicProblems(logicIndex(world(links)));
  assert.deepEqual([...codes(unread, 'L2'), ...codes(unread, 'L3').filter((c) => c === 'story-missing')], [], 'the Story not read: no "missing"');
});

test('Try it: the dialogue started ends at once, the InfoLink played is heard; one heard already sets nothing off', () => {
  const rule = (id, props, acts) => ({ cls: 'UCLink', name: 'UCLink_' + id, props: { Rule: `"${id}"`, ...props,
    ...Object.fromEntries(acts.map((a, i) => [`Act(${i})`, `"0|${a}"`])) } });
  const actors = [rule('L1', { When: 'used', Source: 'Button1', Tag: 'UCL_Button1' }, ['talk||d1', 'infolink||i1']),
    rule('L2', { When: 'ended', Tag: 'UCD_d1' }, ['message||Bye']),
    rule('L3', { When: 'heard', Tag: 'UCI_i1' }, ['message||Over'])];
  const s = createSession({ actors, outputs: logic.outputs, map: 'M',
    world: { player: 'JCDentonMale0', actors: [{ name: 'Button1', chain: ['Button1'] }],
      story: { dialogues: ['d1'], infolinks: [{ id: 'i1', once: true, flag: 'UCEd1234_i1_Heard' }] } } });
  const fired = () => s.log().map((l) => l.line).filter((l) => l.startsWith('fire|')).map((l) => l.split('|')[2]);
  s.fire({ thing: 'Button1', output: 'used' }); s.step(1);
  assert.deepEqual(fired(), ['L1', 'L2', 'L3']);
  s.fire({ thing: 'Button1', output: 'used' }); s.step(1);
  assert.deepEqual(fired(), ['L1', 'L2', 'L3', 'L1', 'L2'], 'the InfoLink plays once: heard already, it sets nothing off');
  // Try it's own buttons: the dialogue's end and the InfoLink, by their ids (the page says their titles)
  const hs = s.happenings().filter((h) => h.output === 'ended' || h.output === 'heard');
  assert.deepEqual(hs.map((h) => [h.output, h.dialogue || h.infolink]), [['ended', 'd1'], ['heard', 'i1']]);
});
