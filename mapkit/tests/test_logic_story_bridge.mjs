// P5 slice 1, the Story bridge: a rule starts a dialogue of the map's Story ("talk") or plays one of its InfoLinks
// ("infolink"). The words (logic.json, logic-vocab.js), the wires into the Story's nodes (logic-graph-model.js),
// Try it (logic-sim.js: missing, heard once) and the log's sentences (logic-log.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { logicIndex, logicGraph, storyId } from '../editor/static/logic-graph-model.js';
import { createSession } from '../editor/static/logic-sim.js';
import { parseLogicLine, logicSentence } from '../editor/static/logic-log.js';
import { vocabulary } from '../editor/static/logic-vocab.js';
import { argRowsHtml } from '../editor/static/logic-rule-ui.js';
import { lineText } from '../editor/static/logic-try.js';
import { world } from './logic_graph_world.mjs';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const story = { dialogues: [{ id: 'd1', title: 'Gate talk', owner: 'Guard1', steps: [] }], infolinks: [{ id: 'i1', title: 'Jock calls' }] };
const nodeOf = (g, id) => g.nodes.find((n) => n.id === id);
const wireOf = (g, id) => g.wires.find((w) => w.id === id);

test('the two actions: no object, a Story id, said by its title', () => {
  for (const verb of ['talk', 'infolink']) {
    const e = logic.inputs[verb];
    assert.equal(e.target, false, verb);
    assert.deepEqual(e.args.map((a) => [a.id, a.type]), [['a', verb === 'talk' ? 'dialogue' : 'infolink']]);
    assert.ok(logic.free.includes(verb), `${verb} needs no object`);
    assert.ok(logic.types[e.args[0].type], `the type ${e.args[0].type} is described`);
  }
  const v = vocabulary(logic), titles = { dialogues: { d1: 'Gate talk' }, infolinks: { i1: 'Jock calls' } };
  const ctx = { name: (n) => n, storyTitle: (key, id) => titles[key][id] || `${id} (missing)` };
  assert.equal(v.actText({ verb: 'talk', a: 'd1' }, ctx), 'start the dialogue "Gate talk"');
  assert.equal(v.actText({ verb: 'infolink', a: 'i1' }, ctx), 'play the InfoLink "Jock calls"');
  assert.equal(v.actText({ verb: 'talk', a: 'd1' }, { name: (n) => n }), 'start the dialogue "d1"', 'no Story read: its id');
});

test('the field: the Story\'s dialogues or InfoLinks to choose, one gone said missing, none yet said', () => {
  const esc = (s) => String(s);
  const h = { esc, name: (n) => n, dialogues: [{ id: 'd1', label: 'Gate talk' }], infolinks: [] };
  const html = argRowsHtml(logic.inputs.talk.args, { verb: 'talk', a: 'd1' }, 0, h);
  assert.match(html, /<select data-lkarg="0" data-k="a"/);
  assert.match(html, /<option value="d1" selected>Gate talk<\/option>/);
  assert.match(argRowsHtml(logic.inputs.talk.args, { verb: 'talk', a: 'd7' }, 0, h), /d7 \(missing\)/);
  assert.match(argRowsHtml(logic.inputs.infolink.args, { verb: 'infolink', a: '' }, 0, h), /has no InfoLink yet/);
  assert.match(argRowsHtml(logic.inputs.talk.args, { verb: 'talk', a: 'd1' }, 0, { ...h, dialogues: null }), /reading the Story/);
});

test('the graph: the wire goes into the dialogue\'s Start and the InfoLink\'s Play; one not in the Story makes no node', () => {
  const links = [{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'talk', a: 'd1' }, { verb: 'infolink', a: 'i1' }] },
    { id: 'L2', src: 'Button1', when: 'used', do: [{ verb: 'infolink', a: 'i1' }] },
    { id: 'L3', src: 'Button1', when: 'used', do: [{ verb: 'talk', a: 'd9' }, { verb: 'message', a: 'x' }] }];
  const g = logicGraph(logicIndex(world(links, { story })));
  const dlg = storyId('dialogues', 'd1'), info = storyId('infolinks', 'i1');
  assert.deepEqual(wireOf(g, 'act:L1/a1').to, { node: dlg, pin: 'in:start' });
  assert.deepEqual(wireOf(g, 'act:L1/a2').to, { node: info, pin: 'in:play' });
  // (with no object it is a card, as a signal's: its row's wire)
  assert.deepEqual(wireOf(g, 'act:L2/a1').to, { node: info, pin: 'in:play' });
  assert.deepEqual(nodeOf(g, dlg).pins.in.map((p) => p.id), ['in:start'], 'the Story\'s node keeps its own pins');
  assert.deepEqual(nodeOf(g, info).pins.in.map((p) => p.id), ['in:play']);
  const rows = nodeOf(g, 'rule:L1').sections.flatMap((s) => s.rows).map((r) => r.text);
  assert.deepEqual(rows, ['start the dialogue "Gate talk"', 'play the InfoLink "Jock calls"']);
  const l3 = nodeOf(g, 'rule:L3').sections.flatMap((s) => s.rows);
  assert.equal(l3[0].text, 'start the dialogue "d9 (missing)"');
  assert.equal(l3[0].target, null);
  assert.ok(!g.nodes.some((n) => n.id === storyId('dialogues', 'd9')));
  // no Story given (not read yet): no node, no wire, its id
  const bare = logicGraph(logicIndex(world(links)));
  assert.equal(nodeOf(bare, 'rule:L1').sections.flatMap((s) => s.rows)[0].target, null);
  assert.equal(nodeOf(bare, 'rule:L1').sections.flatMap((s) => s.rows)[0].text, 'start the dialogue "d1"');
});

test('Try it: started, played, heard once (the game\'s own state), missing, not chosen', () => {
  const rule = (id, acts) => ({ cls: 'UCLink', name: 'UCLink_' + id, props: { Rule: `"${id}"`, When: 'used', Source: 'Button1', Tag: 'UCL_Button1',
    ...Object.fromEntries(acts.map((a, i) => [`Act(${i})`, `"0|${a}"`])) } });
  const actors = [rule('L1', ['talk||d1', 'infolink||i1', 'talk||d9', 'infolink||'])];
  const play = (worldStory, times = 1) => {
    const s = createSession({ actors, outputs: logic.outputs, world: { player: 'JCDentonMale0', actors: [{ name: 'Button1', chain: ['Button1'] }], story: worldStory }, map: 'M' });
    for (let k = 0; k < times; k++) { s.fire({ thing: 'Button1', output: 'used' }); s.step(1); }
    return { lines: s.log().map((l) => l.line).filter((l) => /^(act|fail)/.test(l)), state: s.state() };
  };
  const known = { dialogues: ['d1'], infolinks: [{ id: 'i1', once: true, flag: 'UCEd1234_i1_Heard' }] };
  const one = play(known);
  assert.deepEqual(one.lines, ['act|M|L1|talk||d1', 'act|M|L1|infolink||i1', 'act|M|L1|talk||d9', 'fail|M|L1|talk|d9|missing',
    'act|M|L1|infolink||', 'fail|M|L1|infolink||noname']);
  assert.equal(one.state.flags.UCEd1234_i1_Heard, true, 'the InfoLink heard is the state the game sets');
  const two = play(known, 2).lines;
  assert.ok(two.includes('fail|M|L1|infolink|i1|heard'), two.join('\n'));
  assert.ok(!play({ ...known, infolinks: [{ id: 'i1', once: false, flag: 'F' }] }, 2).lines.includes('fail|M|L1|infolink|i1|heard'), 'not once: again');
  // a Story Try it does not know: it is the game's to say
  assert.deepEqual(play(undefined).lines.filter((l) => l.startsWith('fail')), ['fail|M|L1|infolink||noname']);
});

test('the log says it with the Story\'s words: what was asked, and why it did not happen', () => {
  const say = (line, names = {}) => logicSentence(parseLogicLine('DeusEdixLogic: ' + line), names).parts.map((p) => (typeof p === 'string' ? p : p.name || p.rule)).join('');
  const names = { storyTitle: (key, id) => ({ d1: 'Gate talk', i1: 'Jock calls' })[id] || id };
  assert.match(say('act|M|L1|talk||d1', names), /start the dialogue "Gate talk"$/);
  assert.match(say('act|M|L1|infolink||i1'), /play the InfoLink "i1"$/);
  assert.match(say('fail|M|L1|talk|d1|busy', names), /start the dialogue "Gate talk": the player is already talking$/);
  assert.match(say('fail|M|L1|infolink|i1|heard', names), /it plays once, and it was heard already$/);
  assert.match(say('fail|M|L1|talk|d9|missing'), /has no such dialogue, or its character is not in the map$/);
  assert.match(say('fail|M|L1|infolink|i9|missing'), /has no such InfoLink$/);
  assert.match(say('fail|M|L1|talk||noname'), /start the dialogue: no dialogue chosen$/);
  assert.match(say('fail|M|L1|talk|d1|nostory'), /Story is not in the game yet: Build the map$/);
  assert.match(say('fail|M|L1|talk|d1|refused'), /would not start it now$/);
  assert.match(say('fail|M|L1|talk|d1|off'), /does not run here yet$/);
  assert.match(say('fail|M|L1|talk|d2|played'), /it plays once, and it was played already$/);
  assert.match(say('fail|M|L1|talk|d2|unmet'), /the dialogue's own conditions do not hold$/);
});

test('Try it and the timeline say the action by the Story\'s title, not its id', () => {
  const vocab = vocabulary(logic), titles = { d1: 'Gate talk', i1: 'Jock calls' };
  const words = { name: (n) => n, storyTitle: (key, id) => titles[id] || `${id} (missing)` };
  assert.equal(lineText('act|M|L1|talk||d1', { vocab, words }).text, 'Start the dialogue "Gate talk"');
  assert.equal(lineText('act|M|L1|infolink||i1', { vocab, words }).text, 'Play the InfoLink "Jock calls"');
  assert.equal(lineText('act|M|L1|talk||d9', { vocab, words }).text, 'Start the dialogue "d9 (missing)"');
});
