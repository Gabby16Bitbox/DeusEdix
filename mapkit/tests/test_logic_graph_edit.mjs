// The Logic window's graph edited (editor/static/logic-graph-edit.js, 12 Nov 2026): its pure parts. What each gesture
// changes is app.js's (logicEditOf: the List's own edits), checked in the editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nameOf, whenOfPin, verbOfPin, wireParts, rulesOf, actsOf, simpleAct, withValues, valueOf, frameAround, decorations, freeId }
  from '../editor/static/logic-graph-edit.js';

test('nodes and pins say what they stand for', () => {
  assert.equal(nameOf('obj:Door3'), 'Door3');
  assert.equal(nameOf('world'), '');
  assert.equal(nameOf('rule:L7'), null);
  assert.equal(nameOf('dlg:d1'), null);
  assert.equal(whenOfPin('out:used'), 'used');
  assert.equal(whenOfPin('out:output:Done'), 'output:Done');
  assert.equal(whenOfPin('out'), '');
  assert.equal(verbOfPin('in:open'), 'open');
  assert.equal(verbOfPin('in'), '');
});

test('wires: a simple rule, its cause, a step', () => {
  assert.deepEqual(wireParts('rule:L7'), { rule: 'L7', part: 'rule' });
  assert.deepEqual(wireParts('rule:L7/cause0'), { rule: 'L7', part: 'cause' });
  assert.deepEqual(wireParts('act:L7/a2'), { rule: 'L7', act: 'a2', part: 'act' });
  assert.deepEqual(wireParts('act:L12/e1'), { rule: 'L12', act: 'e1', part: 'act' });
  assert.equal(wireParts('state:Alarm:x>y'), null);
  assert.equal(wireParts('game:3'), null);
});

test('the rules of a selection, each once; the steps apart', () => {
  const nodes = [{ id: 'rule:L1', kind: 'rule', rule: 'L1' }, { id: 'obj:Door3', kind: 'door' }, { id: 'rule:L4', kind: 'rule', rule: 'L4' }];
  const sel = { nodes: ['rule:L1', 'obj:Door3'], wires: ['rule:L2', 'rule:L1/cause0', 'act:L4/a1', 'state:x'] };
  assert.deepEqual(rulesOf(sel, nodes).sort(), ['L1', 'L2']);
  assert.deepEqual(actsOf(sel), [{ rule: 'L4', act: 'a1', part: 'act' }]);
  assert.deepEqual(rulesOf({}, nodes), []);
  const graph = { wires: [{ id: 'rule:L2', part: 'rule', rule: 'L2', act: 'a1' }, { id: 'act:L4/a1', part: 'do', rule: 'L4', act: 'a1' }] };
  assert.deepEqual(simpleAct(graph, 'rule:L2'), { rule: 'L2', act: 'a1' });
  assert.equal(simpleAct(graph, 'act:L4/a1'), null);
});

test('a card\'s values: what sets it off, a condition, a step and its time, a step to add', () => {
  const card = { kind: 'rule', rule: 'L7', causes: [{}] };
  const node = { id: 'rule:L7', rows: [{ id: 'if:0', text: 'Alarm is Yes' }, { id: 'ifhead', head: true, text: 'Only if' },
    { id: 'act:L7/a1', text: 'Open', time: 'now' }, { id: 'act:L7/a2', text: 'Close', time: '+2 s' }, { id: 'none', text: 'Nothing yet' }] };
  withValues(node, card);
  assert.equal(node.titleValue, 'when:L7');
  assert.deepEqual(node.rows.map((r) => r.value || ''), ['if:L7:0', '', 'act:L7/a1', 'act:L7/a2', 'add:L7']);
  assert.deepEqual(node.rows.map((r) => r.timeValue || ''), ['', '', '', 'time:L7/a2', '']);
  // the folded "If not" rule's steps are its own rule's
  const other = withValues({ id: 'rule:L7', rows: [{ id: 'act:L8/a1', text: 'Shout' }] }, card);
  assert.equal(other.rows[0].value, 'act:L8/a1');
  // several causes: no title value, each cause row instead
  const many = withValues({ id: 'rule:L9', rows: [{ id: 'cause:0', text: 'A' }, { id: 'cause:1', text: 'B' }] }, { kind: 'rule', rule: 'L9', causes: [{}, {}] });
  assert.equal(many.titleValue, undefined);
  assert.deepEqual(many.rows.map((r) => r.value), ['when:L9', 'when:L9']);
  // the Story's nodes and the things are left as they are
  const thing = withValues({ id: 'obj:Door3', rows: [{ id: 'out:used', text: 'Used' }] }, undefined);
  assert.equal(thing.rows[0].value, undefined);
  assert.equal(withValues({ id: 'dlg:d1', rows: [] }, { kind: 'rule', readOnly: true }).titleValue, undefined);
});

test('values read back', () => {
  assert.deepEqual(valueOf('act:L7/a1'), { kind: 'act', rule: 'L7', act: 'a1' });
  assert.deepEqual(valueOf('time:L7/e2'), { kind: 'time', rule: 'L7', act: 'e2' });
  assert.deepEqual(valueOf('if:L7:3'), { kind: 'if', rule: 'L7', check: 3 });
  assert.deepEqual(valueOf('when:L7'), { kind: 'when', rule: 'L7' });
  assert.deepEqual(valueOf('add:L12'), { kind: 'add', rule: 'L12' });
  assert.equal(valueOf('who'), null);
});

test('a frame around nodes, notes and frames from the view, free ids', () => {
  assert.deepEqual(frameAround([[100, 100, 200, 80], [400, 300, 100, 50]], 20), [80, 62, 440, 308]);
  assert.equal(frameAround([]), null);
  const d = decorations({ frames: [{ id: 'F1', title: 'Doors', rect: [0, 0, 10, 10] }, { id: 'F2' }, null], notes: [{ id: 'N1', text: 'hi', at: [1, 2] }, {}] });
  assert.deepEqual(d.frames, [{ id: 'F1', title: 'Doors', rect: [0, 0, 10, 10], tone: undefined }]);
  assert.deepEqual(d.notes, [{ id: 'N1', text: 'hi', at: [1, 2] }]);
  assert.deepEqual(decorations(undefined), { frames: [], notes: [] });
  assert.equal(freeId([{ id: 'N1' }, { id: 'N3' }], 'N'), 'N2');
  assert.equal(freeId(undefined, 'F'), 'F1');
});
