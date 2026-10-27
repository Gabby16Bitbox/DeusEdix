// Saved play scenarios (static/play-scenarios.js), as Unity's Play mode scenarios: names kept clean and once, at
// most MAX_SCENARIOS, what was stored read back with what does not fit left out, the classes and the preset checked
// against those there are (and left out), and what Play sends with a scenario.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SCENARIOS, MAX_COUNT, NAME_LENGTH, PLAY_CONTROLS, scenarioName, scenarioDraft, cleanScenario, readScenarios,
  scenariosText, withScenario, withoutScenario, chooseScenario, activeScenario, findScenario, withItem, itemCount,
  scenarioProblems, withoutProblems, loadoutOf, playOverrides, pressedAtStart, scenarioSummary } from '../editor/static/play-scenarios.js';

const turret = () => cleanScenario({ name: ' Turret   room ', start: 'point', point: { at: [10, 20, 48], yaw: 16384, pitch: -200, map: '01_Lab' },
  setup: 'UCDbgOtherMission', flags: 'DoorOpen=1', route: false,
  items: [{ cls: 'DeusEx.WeaponPistol', count: 1 }, { cls: 'DeusEx.Ammo10mm', count: 3 }, { cls: 'DeusEx.Lockpick', count: 2 }],
  augs: ['AugCloak', 'AugSpeed'], skills: [{ cls: 'SkillLockpicking', level: 3 }], credits: 500, health: 60, cheat: 'god' });
const known = { items: [{ cls: 'DeusEx.WeaponPistol' }, { cls: 'DeusEx.Ammo10mm' }], augs: [{ cls: 'AugCloak' }],
  skills: [{ cls: 'SkillLockpicking' }], setups: [{ name: 'UCDbgOtherMission' }], map: '01_Lab' };

test('a name is trimmed, its spaces one, cut at NAME_LENGTH; an empty one is refused', () => {
  assert.equal(scenarioName('  Turret   room '), 'Turret room');
  assert.equal(scenarioName('x'.repeat(90)).length, NAME_LENGTH);
  for (const bad of ['', '  ', null, undefined]) assert.throws(() => scenarioName(bad), /name/);
  assert.equal(cleanScenario({ name: '   ' }), null);
});

test('a draft keeps what fits and starts as the game does for the rest', () => {
  const d = scenarioDraft({ start: 'point', items: [{ cls: 'DeusEx.WeaponPistol', count: 0 }, { cls: 'bad name;exit', count: 1 },
    { cls: 'DeusEx.MedKit', count: MAX_COUNT + 1 }, { cls: 'DeusEx.Flare', count: 2 }, { cls: 'deusex.flare', count: 5 }],
    augs: ['AugCloak', 'AugCloak', 'Aug;Bad'], skills: [{ cls: 'SkillTech', level: 4 }, { cls: 'SkillMedicine', level: 0 }],
    credits: -1, health: 0, skillPoints: 2.5, cheat: 'fly', setup: 'UCDbg Hotel', flags: 7 });
  assert.equal(d.start, 'camera', 'a point start without its point starts below the camera');
  assert.deepEqual(d.items, [{ cls: 'DeusEx.Flare', count: 2 }], 'counts out of range, bad names and a second row of a class left out');
  assert.deepEqual(d.augs, ['AugCloak']);
  assert.deepEqual(d.skills, [{ cls: 'SkillMedicine', level: 0 }]);
  assert.deepEqual([d.credits, d.health, d.skillPoints, d.cheat, d.setup, d.flags, d.route, d.name], [null, null, null, 'none', '', '', true, '']);
  const s = turret();
  assert.equal(s.name, 'Turret room');
  assert.deepEqual(s.point, { at: [10, 20, 48], yaw: 16384, pitch: -200, map: '01_Lab' });
  assert.equal(itemCount(s), 6);
});

test('kept scenarios read back as they were; names once, at most MAX_SCENARIOS, an active one that is gone is none', () => {
  let state = withScenario({ active: '', list: [] }, turret());
  state = withScenario(state, { name: 'Stealth', start: 'playerstart', augs: ['AugStealth'] });
  state = chooseScenario(state, 'TURRET ROOM');
  assert.equal(state.active, 'Turret room');
  assert.deepEqual(readScenarios(scenariosText(state)), state);
  state = withScenario(state, { name: 'turret room', cheat: 'invisible' });
  assert.deepEqual(state.list.map((s) => s.name), ['turret room', 'Stealth'], 'the same name in any case is replaced in its place');
  assert.equal(activeScenario(state).cheat, 'invisible');
  for (const bad of ['not json', 'null', '{"list": 3}', '']) assert.deepEqual(readScenarios(bad), { active: '', list: [] });
  const many = { active: 'Gone', list: [...Array(MAX_SCENARIOS + 5)].map((_, i) => ({ name: `S${i % (MAX_SCENARIOS + 2)}` })) };
  const read = readScenarios(JSON.stringify(many));
  assert.equal(read.list.length, MAX_SCENARIOS);
  assert.equal(read.active, '');
  let full = { active: '', list: [] };
  for (let i = 0; i < MAX_SCENARIOS; i++) full = withScenario(full, { name: 'S' + i });
  assert.throws(() => withScenario(full, { name: 'One more' }), /At most/);
  assert.equal(withScenario(full, { name: 's3', credits: 5 }).list.length, MAX_SCENARIOS, 'replacing one is still allowed');
  const less = withoutScenario(chooseScenario(full, 'S3'), 's3');
  assert.equal(less.active, '');
  assert.equal(findScenario(less.list, 'S3'), null);
  assert.throws(() => withScenario(full, { name: ' ' }), /name/);
});

test('items: one more of the same, a count kept in range, 0 takes it away', () => {
  let s = scenarioDraft({});
  s = withItem(withItem(s, 'DeusEx.MedKit'), 'deusex.medkit');
  assert.deepEqual(s.items, [{ cls: 'DeusEx.MedKit', count: 2 }]);
  assert.equal(withItem(s, 'DeusEx.MedKit', 99).items[0].count, MAX_COUNT);
  assert.deepEqual(withItem(s, 'DeusEx.MedKit', 0).items, []);
});

test('the check before Play: classes not there, a preset of another map and a point of another map are found and left out', () => {
  const s = turret();
  const problems = scenarioProblems(s, known);
  assert.deepEqual(problems.map((p) => [p.part, p.value]), [['items', 'DeusEx.Lockpick'], ['augs', 'AugSpeed']]);
  assert.match(problems[0].text, /neither the game nor the mod/);
  assert.deepEqual(scenarioProblems(s, {}), [], 'what the editor does not know is not checked');
  const elsewhere = scenarioProblems(s, { ...known, setups: [], map: '02_Other' });
  assert.deepEqual(elsewhere.slice(2).map((p) => p.part), ['setup', 'point']);
  const clean = withoutProblems(s, elsewhere);
  assert.deepEqual(clean.items.map((r) => r.cls), ['DeusEx.WeaponPistol', 'DeusEx.Ammo10mm']);
  assert.deepEqual(clean.augs, ['AugCloak']);
  assert.equal(clean.setup, '');
  assert.equal(clean.start, 'camera');
  assert.deepEqual(scenarioProblems(clean, { ...known, setups: [], map: '02_Other' }), []);
});

test('what Play sends: where JC starts, the preset, the states, the route and the loadout', () => {
  const s = turret();
  assert.deepEqual(playOverrides(s), { at: [10, 20, 48], yaw: 16384, pitch: -200, setup: 'UCDbgOtherMission', flags: 'DoorOpen=1', route: false,
    loadout: { items: s.items, augs: ['AugCloak', 'AugSpeed'], skills: [{ cls: 'SkillLockpicking', level: 3 }], skillPoints: null,
      credits: 500, health: 60, cheat: 'god' } });
  const camera = playOverrides(scenarioDraft({ name: 'Plain' }));
  assert.deepEqual(camera, { setup: '', flags: '', route: true, loadout: null }, 'below the camera: the camera at launch, no loadout');
  assert.deepEqual(playOverrides(scenarioDraft({ start: 'playerstart' })).at, null, 'at the PlayerStart: no place sent');
  assert.equal(loadoutOf(scenarioDraft({ health: 1 })).health, 1);
  assert.deepEqual(pressedAtStart(s), { god: true });
  assert.deepEqual(pressedAtStart(null), { god: false });
});

test('the summary and the header buttons', () => {
  assert.equal(scenarioSummary(turret()), 'JC at its point · UCDbgOtherMission · 6 items · 2 augmentations · 1 skill · 500 credits · health 60 · god');
  assert.equal(scenarioSummary(scenarioDraft({})), 'JC below the camera');
  assert.deepEqual(PLAY_CONTROLS.map((c) => [c.id, c.on, c.off]), [['pause', 'pause', 'pause'], ['slomo', 'slomo 0.25', 'slomo 1'],
    ['ghost', 'ghost', 'walk'], ['god', 'god', 'god']]);
});
