// The Logic window's Phases page (editor/static/logic-phases-page.js, P3): a Phases block's phases in order, each
// with the rules on its Enter_ / Leave_ outputs, the rules kept to it and the rules that send the block there; Next,
// Previous, Reset and Changed under them; a Go to a phase the block lacks shown as such.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicIndex } from '../editor/static/logic-graph-model.js';
import { phasesPage, phasesHtml } from '../editor/static/logic-phases-page.js';
import { world, actorOf, ACTORS } from './logic_graph_world.mjs';

const PHASES = [{ id: 'Calm', text: 'Calm' }, { id: 'Alarm', text: 'Alarm' }, { id: 'Way_out', text: 'Way out' }];
const BLOCK = { name: 'Ph1', label: 'Phases 1', stateName: 'Raid', phases: PHASES, mission: '' };
const actors = { ...ACTORS, Ph1: actorOf('phases', { title: 'Phases 1', stateName: 'Raid', phases: PHASES }) };
const go = (a) => ({ verb: 'input', target: 'Ph1', a });
const LINKS = [
  { id: 'L1', src: 'Button1', when: 'used', do: [go('Next')] },
  { id: 'L2', src: 'Door3', when: 'opened', do: [go('GoTo_Alarm')] },
  { id: 'L3', src: 'Ph1', when: 'output', port: 'Enter_Alarm', do: [{ verb: 'message', a: 'Alarm!' }] },
  { id: 'L4', src: 'ph1', when: 'output', port: 'Leave_Calm', do: [{ verb: 'message', a: 'bye' }] },
  { id: 'L5', src: 'Button2', when: 'used', do: [{ verb: 'message', a: 'only' }], phase: { set: 'Ph1', in: ['Alarm', 'way_out'] } },
  { id: 'L6', src: 'Button2', when: 'used', do: [go('Reset')], phase: { set: 'Ph1', in: ['Way_out'] } },
  { id: 'L7', src: 'Lamp1', when: 'used', do: [go('Previous'), go('GoTo_Nowhere')] },
  { id: 'L8', src: 'Ph1', when: 'output', port: 'Changed', do: [{ verb: 'message', a: 'changed' }] },
  { id: 'L9', src: 'Zone1', when: 'enter', do: [{ verb: 'message', a: 'x' }], else: [go('GoTo_Way_out')] },
  { id: 'L10', src: 'Button1', when: 'used', do: [go('GoTo_Calm')], otherwiseOf: 'L1' },            // an "If not": its main's
];
const page = () => phasesPage(logicIndex(world(LINKS, { actors })), [BLOCK])[0];
const ids = (rules) => rules.map((r) => r.id);

test('Phases page: each phase with what starts and ends it, what is kept to it and what brings the mission there', () => {
  const p = page();
  assert.deepEqual(p.phases.map((ph) => [ph.id, ph.flag, ph.first]), [['Calm', 'Raid_Calm', true], ['Alarm', 'Raid_Alarm', false], ['Way_out', 'Raid_Way_out', false]]);
  assert.deepEqual(ids(p.phases[1].enter), ['L3']);
  assert.deepEqual(ids(p.phases[0].leave), ['L4'], 'the block named in any letter case');
  assert.deepEqual(ids(p.phases[1].only), ['L5']);
  assert.deepEqual(ids(p.phases[2].only), ['L5', 'L6']);
  assert.deepEqual(ids(p.phases[1].comes), ['L2']);
  assert.deepEqual(ids(p.phases[2].comes), ['L9'], 'an Otherwise moves it too');
  assert.deepEqual(ids(p.phases[0].comes), [], 'a rule\'s "If not" (otherwiseOf) is not a rule of its own here');
});

test('Phases page: Next, Previous, Reset and Changed, each from the phases it is kept to', () => {
  const p = page();
  assert.deepEqual(ids(p.next), ['L1']);
  assert.equal(p.next[0].from, null, 'in every phase');
  assert.deepEqual(ids(p.previous), ['L7']);
  assert.deepEqual(ids(p.reset), ['L6']);
  assert.deepEqual(p.reset[0].from, ['Way out']);
  assert.deepEqual(ids(p.changed), ['L8']);
  assert.deepEqual(p.unknown.map((r) => [r.id, r.input]), [['L7', 'GoTo_Nowhere']]);
  assert.match(p.next[0].cause, /Button1/);
  assert.doesNotMatch(p.next[0].cause, /^(when|as soon as) /i, 'its "When" is the heading\'s');
  assert.match(p.phases[1].enter[0].does, /Alarm!/, 'a phase\'s own rules are said by what they do');
});

test('Phases page: its HTML names each phase in order, a rule as a button that opens it, and says when there are none', () => {
  const html = phasesHtml([page()]);
  const order = ['Calm', 'Alarm', 'Way out'].map((t) => html.indexOf(`<b>${t}</b>`));
  assert.ok(order.every((k, i) => k > 0 && (i === 0 || k > order[i - 1])), 'left to right in their order');
  assert.match(html, /data-rule="L2" data-src="Door3"/);
  assert.match(html, /data-block="Ph1" data-port="Enter_Calm"/);
  assert.match(html, /The map starts here/);
  assert.match(html, /Go to a phase it does not have/);
  assert.match(phasesHtml([{ ...page(), mission: 'Raid' }]), /Mission phases: Raid/);
  assert.match(phasesHtml([]), /no phases yet/);
  assert.ok(!/<script/i.test(phasesHtml([{ ...page(), label: '<script>x</script>' }])), 'names are escaped');
});

test('Phases page while Play runs (P7): each phase has Go here now, its block and phase for the game\'s GoTo_<phase>', () => {
  assert.doesNotMatch(phasesHtml([page()]), /lp-go/, 'not while editing');
  const html = phasesHtml([page()], { live: true });
  assert.match(html, /class="lp-go" data-block="Ph1" data-phase="Calm"/);
  assert.equal((html.match(/class="lp-go"/g) || []).length, 3);
});
