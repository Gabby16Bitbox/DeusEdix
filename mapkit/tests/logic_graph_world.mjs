// The worlds the Logic window's model is tested on (tests/test_logic_graph_*.mjs): the input logic-graph-model.js takes,
// as the page will build it (its actors from /api/props io, lkName, lkEventsOf). featureLab() is the Feature Test
// project's map 01_Feature_Lab and its Story, frozen in tests/fixtures/logic_graph (liveFeatureLab(): the project
// itself, when asked for); world() makes a small map of one object of each kind.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const catalog = JSON.parse(fs.readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const family = (id) => catalog.families.find((f) => f.id === id);

// What an object of a family offers, as logic_catalog.io_for gives it (a script's declared ports first) and as the
// Inspector offers it (lkEventsOf: animdone when it has an animation; lkRuleHtml: its animation verbs first)
export function actorOf(familyId, extra = {}, { ports = null, animated = false } = {}) {
  const f = family(familyId);
  const outputs = [...(ports ? ports.outputs.map((p) => 'output:' + p.id) : []), ...f.outputs, ...(animated ? ['animdone'] : [])];
  const inputs = [...(animated ? ['anim', 'animback', 'animstop'] : []), ...(ports ? ports.inputs.map((p) => 'input:' + p.id) : []), ...f.inputs];
  const labels = ports ? Object.fromEntries([...ports.outputs.map((p) => ['output:' + p.id, p.label]), ...ports.inputs.map((p) => ['input:' + p.id, p.label])]) : {};
  return { family: familyId, outputs, inputs, labels, ...extra };
}

// The Feature Test project's map, as saved: 8 rules on a button, a door (a moving block with an animation), a script
// with ports Start and Done, and Officer Rossi with a dialogue. The tests assert its exact output, so they read the
// copy in tests/fixtures/logic_graph (its README), never the live project, which people edit.
const FIXTURE = fileURLToPath(new URL('./fixtures/logic_graph/', import.meta.url));
export const featureLabFiles = { edits: path.join(FIXTURE, '01_Feature_Lab.edits.json'), story: path.join(FIXTURE, '01_Feature_Lab.story.json') };
export const featureLab = () => labWorld(featureLabFiles);
// The live project (its tools/mapkit folder in DEUSEDIX_FEATURE_TEST), for a smoke check that asserts nothing exact;
// null when it is not asked for or not there
export function liveFeatureLab() {
  const project = process.env.DEUSEDIX_FEATURE_TEST;
  const files = project && { edits: path.join(project, 'maps', 'new_01_feature_lab.edits.json'), story: path.join(project, 'story', '01_Feature_Lab.json') };
  return files && fs.existsSync(files.edits) ? labWorld(files) : null;
}
function labWorld(files) {
  const edits = JSON.parse(fs.readFileSync(files.edits, 'utf8'));
  const story = fs.existsSync(files.story) ? JSON.parse(fs.readFileSync(files.story, 'utf8')) : {};
  const testBlock = { inputs: [{ id: 'Start', label: 'Start it' }], outputs: [{ id: 'Done', label: 'it is done' }] };
  const actors = {
    UCEdit5: actorOf('object', { title: 'Button UCEdit5', label: 'UCEdit5', at: [1024, 120, 119.9] }),
    UCEditBox7: actorOf('door', { title: 'door UCEditBox7', label: 'UCEditBox7' }, { animated: true }),
    UCEdit8: actorOf('character', { title: 'Officer Rossi UCEdit8', label: 'Officer Rossi' }),
    UCEdit29: actorOf('script', { title: 'script UCEdit29', label: 'UCEdit29' }, { ports: testBlock }),
  };
  return { catalog, edits, story, actors, map: '01_Feature_Lab', storyFlags: { playedFlag: (d) => `UCEd9fd2_${d.id}_Played`, heardFlag: (il) => `UCEd9fd2_${il.id}_Heard` } };
}

// A small map: one object of each kind the tests need, named as the vocabulary tests name them
export const ACTORS = {
  Button1: actorOf('object', { title: 'the button Button1' }),
  Button2: actorOf('object', { title: 'the button Button2' }),
  Door3: actorOf('door', { title: 'the door Door3', locked: true }),
  VaultDoor: actorOf('door', { title: 'the door VaultDoor', locked: false }),
  Lamp1: actorOf('light', { title: 'the light Lamp1' }),
  Guard1: actorOf('character', { title: 'the character Guard1' }),
  Pad1: actorOf('keypad', { title: 'the keypad Pad1' }),
  Comp1: actorOf('computer', { title: 'the computer Comp1', options: ['Unlock the vault', '', 'Call the guards', ''] }),
  Body1: actorOf('carcass', { title: 'the body Body1' }),
  Zone1: actorOf('zone', { title: 'the zone Zone1' }),
  Timer1: actorOf('timer', { title: 'the timer Timer1' }),
  Timer2: actorOf('timer', { title: 'the timer Timer2' }),
  Gen0: actorOf('script', { title: 'the script Gen0' }, { ports: { inputs: [{ id: 'Start', label: 'Start the generator' }], outputs: [{ id: 'Sabotaged', label: 'Sabotaged!' }] } }),
  Crate: actorOf('object', { title: 'the object Crate' }),
  Lift1: actorOf('elevator', { title: 'the elevator Lift1' }),
  Cut1: actorOf('cutscene', { title: 'the cutscene "Intro"' }),
  P1: actorOf('effectpoint', { title: 'the effect point P1' }),
};
// an object for each kind of thing a verb acts on (logic.json "acts")
export const TARGET_OF = { door: 'Door3', character: 'Guard1', light: 'Lamp1', any: 'Crate', script: 'Gen0', elevator: 'Lift1', cutscene: 'Cut1', timer: 'Timer1' };
export function world(links, more = {}) {
  const { edits = {}, ...rest } = more;
  return { catalog, edits: { links, ...edits }, actors: ACTORS, map: '01_Test', ...rest };
}

// The canvas's wire kinds (graph-canvas.js WIRE_KINDS), whose keys the model's wires must use. The canvas adds its
// stylesheet to the page as it loads: here the page is a stand-in that takes anything and does nothing, only while
// it loads.
export async function canvasWireKinds() {
  const inert = () => new Proxy(function () {}, { get: (t, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : inert()),
    apply: () => inert(), construct: () => inert(), set: () => true });
  const had = Object.hasOwn(globalThis, 'document');
  if (!had) globalThis.document = inert();
  try {
    return (await import('../editor/static/graph-canvas.js')).WIRE_KINDS;
  } finally {
    if (!had) delete globalThis.document;
  }
}

// A behaviour fixture of tests/fixtures/logic (the runtime's ground truth) as the model's input: each actor's family
// is the one of its nearest ancestor in its class chain (logic_catalog.family_of)
export function fixtureWorld(name) {
  const fx = JSON.parse(fs.readFileSync(new URL(`./fixtures/logic/${name}.json`, import.meta.url), 'utf8'));
  const familyOf = (chain) => (chain.map((cls) => catalog.families.find((f) => f.classes.includes(cls))).find(Boolean) || family('other')).id;
  const actors = Object.fromEntries(fx.world.actors.filter((a) => !a.absent).map((a) => [a.name, actorOf(familyOf(a.chain), { title: a.name })]));
  return { catalog, edits: fx.edits, actors, map: fx.map };
}
