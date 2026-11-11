// P3's named groups (edits.logic.groups) in the Logic window: a step on a group is a wire to the group's node
// (grp:<id>), said "the group "<name>""; a rule started by any of a group stays on its first object (the list of
// objects shows it there), said "any of the group"; "To check" says when a group is gone or has nothing in the map, never "has no object".
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicIndex, logicGraph } from '../editor/static/logic-graph-model.js';
import { logicProblems } from '../editor/static/logic-graph-problems.js';
import { world } from './logic_graph_world.mjs';

const groups = [{ id: 'G1', name: 'Lab doors', members: ['Door3', 'Lamp1'] }, { id: 'G2', name: 'Nobody', members: ['Ghost9'] }];
const input = (links, gs = groups) => world(links, { edits: { logic: { groups: gs } } });
const brief = (ps) => ps.map((p) => `${p.level} ${p.code} ${p.node}${p.act ? '/' + p.act : ''}: ${p.text}`);

test('a step on a group wires to the group\'s node and says the group\'s name', () => {
  const ix = logicIndex(input([{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'open', target: '', group: 'G1' }] }]));
  const g = logicGraph(ix);
  const wire = g.wires.find((w) => w.rule === 'L1' && w.part === 'do');
  assert.equal(wire.to.node, 'grp:G1');
  assert.equal(wire.to.pin, 'in:open');
  assert.match(ix.vocab.actText({ verb: 'open', target: '', group: 'G1' }, ix.ctx), /the group "Lab doors"/);
  assert.deepEqual(brief(logicProblems(ix)).filter((p) => /no-object|group/.test(p)), []);
});

test('a rule started by any of a group: on its first object, as the game builds it, said "any of the group"', () => {
  const ix = logicIndex(input([{ id: 'L2', src: 'Door3', group: 'G1', when: 'opened', do: [{ verb: 'message', a: 'x' }] }]));
  const g = logicGraph(ix);
  const cause = g.wires.find((w) => w.rule === 'L2' && w.part === 'when');
  assert.equal(cause.from.node, 'obj:Door3');
  assert.match(ix.vocab.whenText({ src: 'Door3', group: 'G1', when: 'opened' }, ix.ctx), /any of the group "Lab doors"/);
  assert.deepEqual(brief(logicProblems(ix)).filter((p) => /source|group/.test(p)), []);
});

test('To check: a group that is gone, a group with nothing in the map', () => {
  const ps = brief(logicProblems(logicIndex(input([
    { id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'open', target: '', group: 'G9' }, { verb: 'open', target: '', group: 'G2' }] },
    { id: 'L2', src: 'Door3', group: 'G2', when: 'opened', do: [{ verb: 'message', a: 'x' }] }]))));
  assert.ok(ps.some((p) => p.startsWith('error no-group rule:L1/a1')), ps.join('\n'));
  assert.ok(ps.some((p) => p.startsWith('warn group-empty rule:L1/a2')), ps.join('\n'));
  assert.ok(ps.some((p) => p.startsWith('error group-empty rule:L2')), ps.join('\n'));
  assert.equal(ps.filter((p) => p.includes('no-object')).length, 0);
});

// P3 slice 11: a group with a filter ("Name this group"): by tag, the objects with the tag (the page's tags); by radius,
// its saved objects, and with newcomers never empty
test('a group by tag holds the objects with the tag; by radius with newcomers it is never empty; no rule starts on a group by tag', () => {
  const gs = [{ id: 'G1', name: 'Vault', members: [], filter: { tag: 'VAULT' } },
    { id: 'G2', name: 'Guards near', members: [], filter: { area: { kind: 'character', at: [0, 0, 0], radius: 512, tag: '', dynamic: true } } },
    { id: 'G3', name: 'Lamps near', members: ['Ghost9'], filter: { area: { kind: 'light', at: [0, 0, 0], radius: 256, tag: '', dynamic: false } } }];
  const links = [{ id: 'L1', src: 'Button1', when: 'used', do: [{ verb: 'open', target: '', group: 'G1' }, { verb: 'hostile', target: '', group: 'G2' },
    { verb: 'lightoff', target: '', group: 'G3' }] },
  { id: 'L2', src: 'Door3', group: 'G1', when: 'opened', do: [{ verb: 'message', a: 'x' }] }];
  const ix = logicIndex(world(links, { edits: { logic: { groups: gs } }, tags: { vault: ['Door3'], OTHER: ['Lamp1'] } }));
  assert.deepEqual(logicGraph(ix).nodes.find((n) => n.id === 'grp:G1').members, ['Door3'], 'any case, as the game');
  const ps = brief(logicProblems(ix)).filter((p) => /group/.test(p));
  assert.deepEqual(ps.map((p) => p.split(':')[0] + ':' + p.split(':')[1]), ['warn group-empty rule:L1/a3', 'error group-by-tag rule:L2'], ps.join('\n'));
  // a page that does not say which objects have which tag: no warning about it
  const blind = logicIndex(world([links[0]], { edits: { logic: { groups: gs } } }));
  assert.ok(!brief(logicProblems(blind)).some((p) => /group-empty rule:L1\/a1/.test(p)));
});

// P9 slice 1: a group of a kind or of a faction (filter {kind} / {faction}): the characters the page found in it
// (input.sets); a rule on it (no src) comes out of the group's node, its happenings are a character's as the game
// rules look (sees, killed...); To check: another happening is an error, none in the map now only info (newcomers
// count), a step a character cannot do a warning
test('a group of a kind or a faction: its rules out of its node, its happenings a character\'s, what To check says', () => {
  const gs = [{ id: 'G1', name: 'Troopers', members: [], filter: { kind: 'UNATCOTroop' } },
    { id: 'G2', name: 'MJ12', members: [], filter: { faction: 'MJ12' } }];
  const links = [{ id: 'L1', src: '', group: 'G1', when: 'sees', do: [{ verb: 'message', a: 'seen' }] },
    { id: 'L2', src: '', group: 'G2', when: 'killed', do: [{ verb: 'open', target: '', group: 'G2' }, { verb: 'hostile', target: '', group: 'G1' }] },
    { id: 'L3', src: '', group: 'G1', when: 'opened', do: [{ verb: 'message', a: 'x' }] }];
  const ix = logicIndex(world(links, { edits: { logic: { groups: gs } }, sets: { G1: ['Guard1'], G2: [] } }));
  const g = logicGraph(ix);
  const cause = g.wires.find((w) => w.rule === 'L1' && w.part === 'when');
  assert.equal(cause.from.node, 'grp:G1');
  assert.equal(cause.from.pin, 'out:sees');
  const node = g.nodes.find((n) => n.id === 'grp:G1');
  assert.deepEqual(node.members, ['Guard1']);
  assert.ok(node.pins.out.some((p) => p.id === 'out:sees' && /see the player/.test(p.label)), JSON.stringify(node.pins.out));
  assert.match(ix.vocab.whenText(links[0], ix.ctx), /any of the group "Troopers" sees the player/);
  const ps = brief(logicProblems(ix)).filter((p) => /group|set-|source/.test(p));
  assert.deepEqual(ps.map((p) => p.split(':').slice(0, 2).join(':')),
    ['info set-empty rule:L2', 'warn set-not-character rule:L2/a1', 'error set-when rule:L3'], ps.join('\n'));
  // a page that does not say who is in it: nothing said about none being there
  const blind = logicIndex(world([links[1]], { edits: { logic: { groups: gs } } }));
  assert.ok(!brief(logicProblems(blind)).some((p) => /set-empty/.test(p)));
});
