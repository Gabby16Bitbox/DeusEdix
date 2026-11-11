// Your own blocks in the Logic window (P8 slice 1, editor/static/logic-boxes.js): rules and logic pieces in a box,
// drawn as one node whose ports are the wires that cross its edge, opened as a level of the graph of its own. Only a
// way of looking: tests/test_logic_boxes.py checks that the build makes the same rules with them as without.
// Feature Test's map (01_Feature_Lab, tests/fixtures/logic_graph) is the real input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicIndex, logicGraph } from '../editor/static/logic-graph-model.js';
import { boxesOf, nextBoxId, boxedRules, boxedView, boxPath, selectionMembers, makeBox, unpackBox, renameBox, renamePort,
  pruneBoxes, rulesInside, boxOfRule, shownAs } from '../editor/static/logic-boxes.js';
import { featureLab } from './logic_graph_world.mjs';

// logic-window.js adds its stylesheet to the page: loaded here with an inert document (as tests/test_logic_trails.mjs)
async function load() {
  const inert = () => new Proxy(function () {}, { get: (t, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : inert()),
    apply: () => inert(), construct: () => inert(), set: () => true });
  const had = Object.hasOwn(globalThis, 'document');
  if (!had) globalThis.document = inert();
  try { return await import('../editor/static/logic-window.js'); } finally { if (!had) delete globalThis.document; }
}
const { canvasOf } = await load();

const box = (id, rules, more = {}) => ({ id, name: more.name || id, rules, pieces: more.pieces || [], parent: more.parent || null, ports: more.ports || {} });
// Feature Lab with its blocks: the graph as the window draws it (the boxed rules cards), at a level
function labView(boxes, at = null) {
  const lab = featureLab();
  lab.edits.logic = { ...(lab.edits.logic || {}), boxes };
  const ix = logicIndex(lab), bl = boxesOf(ix.edits);
  return { ix, whole: logicGraph(ix, { open: [...boxedRules(bl)] }), view: boxedView(logicGraph(ix, { open: [...boxedRules(bl)] }), bl, at), bl };
}
const ids = (g) => g.nodes.map((n) => n.id);
const ends = (g) => g.wires.map((w) => `${w.from.node}|${w.from.pin} > ${w.to.node}|${w.to.pin}`);

test('the blocks of a map are read cleanly', () => {
  const got = boxesOf({ logic: { boxes: [box('X1', ['L1']), { id: 'bad', name: 'x' }, null, { id: 'X2', rules: 'L2', parent: 'X9' }, box('X3', [], { parent: 'X3' })] } });
  assert.deepEqual(got.map((b) => [b.id, b.name, b.rules, b.parent]), [['X1', 'X1', ['L1'], null], ['X2', 'X2', [], null], ['X3', 'X3', [], null]]);
  assert.deepEqual(boxesOf({}), []);
  assert.deepEqual(boxesOf({ logic: { boxes: 'no' } }), []);
  assert.equal(nextBoxId([box('X1', []), box('X3', [])]), 'X2');
});

test('Feature Lab: a block of two rules is one node, the wires that cross it its ports', () => {
  const { view } = labView([box('X1', ['L1', 'L2'], { name: 'Presses' })]);
  assert.ok(!ids(view).includes('rule:L1') && !ids(view).includes('rule:L2'));
  const n = view.nodes.find((x) => x.id === 'box:X1');
  assert.equal(n.label, 'Presses');
  assert.equal(n.word, '2 rules inside');
  assert.equal(n.family, 'box');
  // one input for the button both rules wait on, an output per thing they act on, one for the counter L2 sets
  assert.deepEqual(n.pins.in.map((p) => `${p.id}=${p.label}`), ['in:obj:UCEdit5|out:used=UCEdit5: the player uses it']);
  assert.deepEqual(n.pins.out.map((p) => `${p.id}=${p.label}`), ['out:obj:UCEditBox7|in:anim=UCEditBox7: Play its animation',
    'out:obj:UCEdit8|in:goto=Officer Rossi: Walk to a place', 'out:state:Test_Presses=Test_Presses']);
  const crossing = ends(view).filter((e) => e.includes('box:X1'));
  assert.deepEqual(crossing, ['obj:UCEdit5|out:used > box:X1|in:obj:UCEdit5|out:used',
    'box:X1|out:obj:UCEditBox7|in:anim > obj:UCEditBox7|in:anim', 'box:X1|out:obj:UCEdit8|in:goto > obj:UCEdit8|in:goto',
    'box:X1|out:state:Test_Presses > rule:L3|if:0', 'box:X1|out:state:Test_Presses > rule:L8|if:0']);
  // the rest of the map as it was
  assert.ok(ids(view).includes('rule:L3') && ids(view).includes('obj:UCEdit5'));
  assert.ok(ends(view).includes('obj:UCEdit5|out:used > obj:UCEdit29|in:input:Start'));         // L4, simple, outside: a wire
});

test('Feature Lab: inside the block, its rules and its ports at its edges, nothing of the outside', () => {
  const { view } = labView([box('X1', ['L1', 'L2'])], 'X1');
  assert.deepEqual(ids(view), ['rule:L1', 'rule:L2', 'port:in:obj:UCEdit5|out:used', 'port:out:obj:UCEditBox7|in:anim',
    'port:out:obj:UCEdit8|in:goto', 'port:out:state:Test_Presses']);
  const port = view.nodes.find((n) => n.id === 'port:in:obj:UCEdit5|out:used');
  assert.deepEqual([port.label, port.word, port.family, port.pins.out.map((p) => p.id)], ['UCEdit5: the player uses it', 'input', 'port', ['p']]);
  assert.deepEqual(ends(view), ['port:in:obj:UCEdit5|out:used|p > rule:L1|cause:0', 'rule:L1|act:L1/a1 > port:out:obj:UCEditBox7|in:anim|p',
    'rule:L1|act:L1/a2 > port:out:obj:UCEdit8|in:goto|p', 'port:in:obj:UCEdit5|out:used|p > rule:L2|cause:0',
    'rule:L2|act:L2/a1 > port:out:state:Test_Presses|p']);
  assert.deepEqual(view.ports.map((p) => p.side + ' ' + p.name), ['in UCEdit5: the player uses it', 'out UCEditBox7: Play its animation',
    'out Officer Rossi: Walk to a place', 'out Test_Presses']);
});

test('a simple rule put in a block is a card (its wire would cross the edge)', () => {
  const { whole, view } = labView([box('X1', ['L4'])], 'X1');
  assert.ok(whole.nodes.some((n) => n.id === 'rule:L4'));
  assert.deepEqual(ids(view), ['rule:L4', 'port:in:obj:UCEdit5|out:used', 'port:out:obj:UCEdit29|in:input:Start']);
});

test('a port renamed keeps its name on both sides, empty gives its words back', () => {
  let bl = [box('X1', ['L1', 'L2'])];
  bl = renamePort(bl, 'X1', 'in:obj:UCEdit5|out:used', '  Button pressed ');
  assert.deepEqual(bl[0].ports, { 'in:obj:UCEdit5|out:used': 'Button pressed' });
  const out = labView(bl).view, inside = labView(bl, 'X1').view;
  assert.equal(out.nodes.find((n) => n.id === 'box:X1').pins.in[0].label, 'Button pressed');
  assert.equal(inside.nodes.find((n) => n.id === 'port:in:obj:UCEdit5|out:used').label, 'Button pressed');
  assert.deepEqual(renamePort(bl, 'X1', 'in:obj:UCEdit5|out:used', '')[0].ports, {});
  assert.throws(() => renameBox(bl, 'X1', '  '), /needs a name/);
  assert.equal(renameBox(bl, 'X1', 'Presses')[0].name, 'Presses');
});

test('blocks nest: the inner one a node inside the outer, the path back up', () => {
  const bl = [box('X1', ['L1'], { name: 'Outer' }), box('X2', ['L2'], { name: 'Inner', parent: 'X1' })];
  const top = labView(bl).view;
  assert.ok(ids(top).includes('box:X1') && !ids(top).includes('box:X2'));
  assert.equal(top.nodes.find((n) => n.id === 'box:X1').word, '2 rules inside');
  const outer = labView(bl, 'X1').view;
  assert.ok(ids(outer).includes('rule:L1') && ids(outer).includes('box:X2') && !ids(outer).includes('rule:L2'));
  // the counter L2 sets goes out of the inner block, then out of the outer one
  assert.ok(ends(outer).includes('box:X2|out:state:Test_Presses > port:out:state:Test_Presses|p'));
  assert.deepEqual(boxPath(boxesOf({ logic: { boxes: bl } }), 'X2').map((p) => p.name), ['The map', 'Outer', 'Inner']);
  assert.deepEqual(rulesInside(bl, 'X1'), ['L1', 'L2']);
  assert.equal(boxOfRule(bl, 'l2'), 'X2');
  assert.equal(shownAs(bl, 'rule:L2', null), 'box:X1');
  assert.equal(shownAs(bl, 'rule:L2', 'X1'), 'box:X2');
  assert.equal(shownAs(bl, 'rule:L2', 'X2'), 'rule:L2');
  assert.equal(shownAs(bl, 'obj:UCEdit5', 'X1'), null);
});

test('what a selection puts in a block: rules, simple rules\' wires, logic pieces, blocks; never map objects', () => {
  const graph = { nodes: [{ id: 'rule:L1', kind: 'rule', rule: 'L1' }, { id: 'obj:Door1', kind: 'thing' }, { id: 'blk:B1', kind: 'block' }, { id: 'box:X2', kind: 'thing' }], wires: [] };
  const m = selectionMembers({ nodes: ['rule:L1', 'obj:Door1', 'blk:B1', 'box:X2'], wires: ['rule:L4', 'rule:L9@obj:a>box:X3'] }, graph,
    [{ id: 'L1' }, { id: 'L1b', otherwiseOf: 'L1' }]);
  assert.deepEqual(m, { rules: ['L1', 'L4', 'L9', 'L1b'], pieces: ['blk:B1'], boxes: ['X2'] });
  assert.deepEqual(selectionMembers({ nodes: ['obj:Door1'] }, graph), { rules: [], pieces: [], boxes: [] });
});

test('making a block, at a level, and unpacking it', () => {
  const start = [box('X1', ['L1', 'L2', 'L3'], { name: 'Outer' }), box('X2', ['L5'], { parent: 'X1' })];
  const made = makeBox(start, { rules: ['L2'], pieces: ['blk:B1'], boxes: ['X2'] }, { at: 'X1' });
  assert.equal(made.id, 'X3');
  const x3 = made.boxes.find((b) => b.id === 'X3');
  assert.deepEqual([x3.name, x3.rules, x3.pieces, x3.parent], ['Block 3', ['L2'], ['blk:B1'], 'X1']);
  assert.deepEqual(made.boxes.find((b) => b.id === 'X1').rules, ['L1', 'L3']);      // taken out of the box that held it
  assert.equal(made.boxes.find((b) => b.id === 'X2').parent, 'X3');
  assert.throws(() => makeBox(start, { rules: [], pieces: [], boxes: [] }), /Select rules or logic blocks first/);
  // unpacked: what it held goes to its parent, its blocks too
  const back = unpackBox(made.boxes, 'X3');
  assert.deepEqual(back.map((b) => [b.id, b.rules, b.pieces, b.parent]), [['X1', ['L1', 'L3', 'L2'], ['blk:B1'], null], ['X2', ['L5'], [], 'X1']]);
  assert.deepEqual(unpackBox([box('X1', ['L1'])], 'X1'), []);
  assert.deepEqual(pruneBoxes([box('X1', ['L1', 'L9'], { pieces: ['blk:B1', 'blk:B7'] })], ['L1'], ['blk:B1'])[0].rules, ['L1']);
});

test('the canvas draws a block and its ports as things, with their icons', () => {
  const { view } = labView([box('X1', ['L1', 'L2'], { name: 'presses' })]);
  const n = canvasOf(view).nodes.find((x) => x.id === 'box:X1');
  assert.deepEqual([n.kind, n.icon, n.title, n.sub], ['thing', 'box', 'Presses', '2 rules inside']);
  assert.deepEqual(n.rows.map((r) => r.text), ['UCEditBox7: Play its animation', 'Officer Rossi: Walk to a place', 'Test_Presses', 'UCEdit5: the player uses it']);
  const inside = canvasOf(labView([box('X1', ['L1', 'L2'])], 'X1').view);
  const p = inside.nodes.find((x) => x.id === 'port:out:state:Test_Presses');
  assert.deepEqual([p.icon, p.title, p.sub, p.rows.map((r) => r.text)], ['port', 'Test_Presses', 'output', ['To outside']]);
  // every wire drawn reaches a node drawn
  const drawn = new Set(inside.nodes.map((x) => x.id));
  assert.ok(inside.wires.every((w) => drawn.has(w.from.node) && drawn.has(w.to.node)));
});
