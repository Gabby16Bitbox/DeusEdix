// Copy and paste of properties, Reset to the class default and presets (static/prop-sets.js), and the list of what
// changes as its window draws it (static/prop-sets-dialog.js), as Unity's Copy Component, Paste Component Values,
// Reset and Presets: only the properties a class has, what stays an object's own not pasted unless ticked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OWN, baseOf, fieldKeys, classKeys, valueKeys, sameText, shownOf, keyChange, rawChange, copySet, rawSet, pastePlan, resetPlan,
  clearRawPlan, changeRows, chosenPlans, fieldPaste, readPresets, presetsText, presetName, withPreset, withoutPreset, presetsFor } from '../editor/static/prop-sets.js';
import { changesHtml } from '../editor/static/prop-sets-dialog.js';

// fields as editor/props.py fields_for gives them
const LIGHT = [
  { group: 'Links', prop: 'Tag', kind: 'name', default: ['Light'] },
  { group: 'Light', prop: 'LightHue', kind: 'lightcolor', default: ['0'] },
  { group: 'Light', prop: 'LightSaturation', kind: 'byte', default: ['255'] },
  { group: 'Light', prop: 'LightBrightness', kind: 'byte', default: ['64'] },
  { group: 'Light', prop: 'LightType', kind: 'enum', default: ['LT_Steady'], options: ['LT_Steady', 'LT_Flicker'] },
];
const GUARD = [
  { group: 'Character', prop: 'BindName', kind: 'string', default: [''] },
  { group: 'Character', prop: 'Orders', kind: 'choice', default: ['Standing'] },
  { group: 'Character', prop: 'InitialInventory', kind: 'inventory', default: ['(Inventory=None,Count=1)', '(Inventory=None,Count=1)'] },
  { group: 'Model', prop: 'Mesh', kind: 'mesh', default: [''] },
  { group: 'Text', prop: 'SpecialText', kind: 'text', default: '' },
];
// an object as app.js describes it: each key of its class with what is set in the editor and in the map, the class
// that declares it and whether it is read only there
const object = (name, fields, { edited = {}, map = {}, raw = {}, rawNames = null, cls = 'Light', readOnly = [] } = {}) => {
  const props = {};
  for (const [key, k] of classKeys(fields)) props[key] = { raw: raw[key], edited: edited[key], base: key in map ? map[key] : k.def, def: k.def,
    declared: k.field.declared, readOnly: readOnly.includes(key) };
  return { name, cls, props, raw, rawNames };
};

test('the keys of a class: one for each value, a model, hidden fields and kept texts are no values to copy', () => {
  assert.deepEqual(fieldKeys(GUARD[2]), ['InitialInventory(0)', 'InitialInventory(1)']);
  assert.deepEqual(fieldKeys(GUARD[4]), ['SpecialText']);                 // a default of '' (no values): the property itself
  const keys = classKeys(GUARD);
  assert.deepEqual([...keys.keys()], ['BindName', 'Orders', 'InitialInventory(0)', 'InitialInventory(1)']);
  assert.equal(keys.get('InitialInventory(1)').def, '(Inventory=None,Count=1)');
  assert.equal(keys.get('Orders').field.group, 'Character');
  assert.equal(baseOf('InitialInventory(1)'), 'InitialInventory');
  // a light's colour takes its saturation with it, when the class has one
  assert.deepEqual(valueKeys(LIGHT[1], classKeys(LIGHT)), ['LightHue', 'LightSaturation']);
  assert.deepEqual(valueKeys(LIGHT[1], new Map()), ['LightHue']);
  assert.ok(OWN.has('Tag') && OWN.has('Event') && OWN.has('BindName') && !OWN.has('Orders'));
});

test('two texts the same value: numbers as numbers, True and False in any case, no value only as no value', () => {
  assert.ok(sameText('0.5', '0.500000'));
  assert.ok(sameText(64, '64'));
  assert.ok(sameText('True', 'true'));
  assert.ok(!sameText('None', 'none'));                 // names keep their case: only True and False do not
  assert.ok(!sameText('', '0'));
  assert.ok(sameText(null, undefined));
  assert.ok(!sameText(null, ''));
});

test('a value given: set in the editor, back to the map\'s when it is the map\'s, All properties\' value goes', () => {
  const s = { raw: undefined, edited: undefined, base: '64', def: '64' };
  assert.deepEqual(keyChange(s, '200'), { from: '64', to: '200', props: '200' });
  assert.equal(keyChange(s, '64.000000'), null);                                  // it shows that already
  assert.deepEqual(keyChange({ ...s, edited: '200' }, '64'), { from: '200', to: '64', props: null });
  // the map has its own: the class default is set in the editor (the map's would stay)
  assert.deepEqual(keyChange({ ...s, base: '128' }, '64'), { from: '128', to: '64', props: '64' });
  // All properties wins in the game: it goes, the value is the Properties'
  assert.deepEqual(keyChange({ ...s, raw: '10' }, '200'), { from: '10', to: '200', raw: null, props: '200' });
  assert.deepEqual(keyChange({ ...s, raw: '10' }, '64'), { from: '10', to: '64', raw: null });
  // no value of its own (Movement): the edit goes; with nothing set, nothing changes
  const move = { raw: undefined, edited: '304.000000', base: undefined, def: null };
  assert.deepEqual(keyChange(move, null), { from: '304.000000', to: null, props: null });
  assert.equal(keyChange({ ...move, edited: undefined }, null), null);
  assert.deepEqual(rawChange(undefined, 'True'), { from: null, to: 'True', raw: 'True' });
  assert.deepEqual(rawChange('True', ''), { from: 'True', to: null, raw: null });
  assert.equal(rawChange('0.5', '0.500000'), null);
});

test('Copy: what each key shows, a section only; All properties\' own keys as they are', () => {
  const lamp = object('Light3', LIGHT, { edited: { LightBrightness: '200' }, map: { LightHue: '32', Tag: 'Lamp' }, raw: { LightType: 'LT_Flicker', bCorona: 'True' } });
  assert.equal(shownOf(lamp.props.LightType), 'LT_Flicker');
  const all = copySet(lamp);
  assert.deepEqual(all, { cls: 'Light', from: 'Light3', raw: { bCorona: 'True' }, declared: {},
    props: { Tag: 'Lamp', LightHue: '32', LightSaturation: '255', LightBrightness: '200', LightType: 'LT_Flicker' } });
  assert.deepEqual(copySet(lamp, new Set(['LightBrightness'])).props, { LightBrightness: '200' });
  assert.deepEqual(copySet(lamp, new Set(['LightBrightness'])).raw, {});
  assert.deepEqual(rawSet(lamp), { cls: 'Light', from: 'Light3', props: {}, raw: { LightType: 'LT_Flicker', bCorona: 'True' } });
  // a light placed in the editor holds numbers (LightCone: 64): copied as text, so a preset of it is kept
  const spot = object('UCEdit3', LIGHT, { map: { LightBrightness: 64 } });
  assert.equal(copySet(spot).props.LightBrightness, '64');
  assert.equal(readPresets(presetsText(withPreset([], 'Spot', copySet(spot)))).length, 1);
});

test('Paste: only what the class has, what stays an object\'s own marked, a section only', () => {
  const set = copySet(object('Light3', LIGHT, { edited: { LightBrightness: '200', Tag: 'Lamp' } }));
  const other = object('Light4', LIGHT, { map: { LightBrightness: '96' } });
  const guard = object('Guard1', GUARD, { cls: 'MJ12Troop' });
  const [onLight, onGuard] = pastePlan(set, [other, guard]);
  assert.deepEqual(onLight, { name: 'Light4', changes: [
    { key: 'Tag', own: true, from: 'Light', to: 'Lamp', props: 'Lamp' },
    { key: 'LightBrightness', own: false, from: '96', to: '200', props: '200' }] });
  assert.deepEqual(onGuard, { name: 'Guard1', changes: [] });           // a guard has none of a light's properties
  const light = pastePlan(set, [other], () => new Set(['LightHue', 'LightSaturation']));
  assert.deepEqual(light[0].changes, []);                               // the Light section: the same colour already
  // All properties: only where the class has the property (its class_props), else left out
  const raw = { cls: 'Light', from: 'L', props: {}, raw: { bCorona: 'True', VolumeFog: '1' } };
  assert.deepEqual(pastePlan(raw, [object('L5', LIGHT, { rawNames: new Map([['bCorona', 'Lighting']]) }), object('L6', LIGHT)]).map((p) => p.changes.map((c) => c.key)),
    [['bCorona'], []]);
  // the target's All properties value of a key pasted from the Properties goes (it would win in the game)
  const lit = pastePlan({ props: { LightBrightness: '200' }, raw: {} }, [object('L7', LIGHT, { raw: { LightBrightness: '10' } })]);
  assert.deepEqual(lit[0].changes, [{ key: 'LightBrightness', own: false, from: '10', to: '200', raw: null, props: '200' }]);
});

test('Reset: the class default (Movement: the game\'s), a section only; the whole object clears All properties', () => {
  const lamp = object('Light3', LIGHT, { edited: { LightBrightness: '200', Tag: 'Lamp' }, map: { LightHue: '32' }, raw: { bCorona: 'True' } });
  assert.deepEqual(resetPlan([lamp], () => new Set(['LightHue', 'LightBrightness']))[0].changes, [
    { key: 'LightHue', own: false, from: '32', to: '0', props: '0' },
    { key: 'LightBrightness', own: false, from: '200', to: '64', props: null }]);
  assert.deepEqual(resetPlan([lamp])[0].changes.map((c) => [c.key, c.own]),
    [['Tag', true], ['LightHue', false], ['LightBrightness', false], ['bCorona', false]]);
  const move = { name: 'G', props: { GroundSpeed: { edited: '500.000000', base: undefined, def: null } }, raw: {} };
  assert.deepEqual(resetPlan([move])[0].changes, [{ key: 'GroundSpeed', own: false, from: '500.000000', to: null, props: null }]);
  assert.deepEqual(clearRawPlan([lamp])[0].changes, [{ key: 'bCorona', own: false, from: 'True', to: null, raw: null }]);
});

test('the list of changes: a row for each key over the objects; the ticked keys only', () => {
  const plans = [{ name: 'A', changes: [{ key: 'Tag', own: true, from: 'x', to: 'y' }, { key: 'LightBrightness', own: false, from: '64', to: '200' }] },
    { name: 'B', changes: [{ key: 'LightBrightness', own: false, from: '96', to: '200' }] }];
  assert.deepEqual(changeRows(plans), [{ key: 'Tag', own: true, names: ['A'], from: ['x'], to: ['y'] },
    { key: 'LightBrightness', own: false, names: ['A', 'B'], from: ['64', '96'], to: ['200', '200'] }]);
  assert.deepEqual(chosenPlans(plans, new Set(['Tag'])), [{ name: 'A', changes: [plans[0].changes[0]] }]);
  const html = changesHtml(changeRows(plans), (k) => (k === 'Tag' ? 'Engine tag' : 'Brightness'), (k, v) => `<${v}>`);
  assert.match(html, /data-ps="0">/);                                     // what stays an object's own: not ticked
  assert.match(html, /data-ps="1" checked>/);
  assert.match(html, /class="ps-from">—</);                              // their values differ
  assert.match(html, /&lt;200&gt;/);                                      // the values as they show, escaped
  assert.match(html, /2 objects/);
  assert.match(changesHtml([], String, String), /Nothing changes/);
});

test('Paste value: into a field of the same kind and size, or of the same property', () => {
  const clip = { prop: 'LightBrightness', kind: 'byte', values: ['200'] };
  assert.deepEqual(fieldPaste(clip, { prop: 'LightRadius', kind: 'byte', keys: ['LightRadius'] }), [['LightRadius', '200']]);
  assert.deepEqual(fieldPaste(clip, { prop: 'LightBrightness', kind: 'ByteProperty', keys: ['LightBrightness'] }), [['LightBrightness', '200']]);
  assert.equal(fieldPaste(clip, { prop: 'Orders', kind: 'choice', keys: ['Orders'] }), null);
  assert.equal(fieldPaste({ prop: 'LightHue', kind: 'lightcolor', values: ['32', '0'] }, { prop: 'LightHue', kind: 'lightcolor', keys: ['LightHue'] }), null);
  assert.equal(fieldPaste(null, { prop: 'X', kind: 'byte', keys: ['X'] }), null);
});

test('Paste value: a choice only into a field that has its value, All properties\' enums, structs and objects only into theirs', () => {
  const type = { prop: 'LightType', kind: 'enum', values: ['LT_Steady'], options: ['LT_None', 'LT_Steady', 'LT_Pulse'] };
  assert.equal(fieldPaste(type, { prop: 'LightEffect', kind: 'enum', keys: ['LightEffect'], options: ['LE_None', 'LE_Spotlight'] }), null);
  assert.deepEqual(fieldPaste(type, { prop: 'LightType', kind: 'enum', keys: ['LightType'], options: ['LT_None', 'LT_Steady'] }), [['LightType', 'LT_Steady']]);
  assert.deepEqual(fieldPaste(type, { prop: 'OtherType', kind: 'enum', keys: ['OtherType'], options: ['LT_Steady'] }), [['OtherType', 'LT_Steady']]);
  assert.equal(fieldPaste({ prop: 'Orders', kind: 'choice', values: ['Patrolling'], options: ['Standing', 'Patrolling'] },
    { prop: 'DamageType', kind: 'choice', keys: ['DamageType'], options: ['Burned', 'Shocked'] }), null);
  // All properties (UnrealEd's types): a number into any number of that type, the rest only into the same property
  const raw = (prop, kind, more = {}) => ({ prop, kind, keys: [prop], ...more });
  const pulse = { prop: 'LightType', kind: 'ByteProperty', category: 'Lighting', values: ['LT_Pulse'], options: type.options };
  const bright = { prop: 'LightBrightness', kind: 'ByteProperty', category: 'LightColor', values: ['200'] };
  assert.equal(fieldPaste(pulse, raw('LightBrightness', 'ByteProperty', { category: 'LightColor' })), null);
  assert.equal(fieldPaste(bright, raw('LightType', 'ByteProperty', { category: 'Lighting', options: type.options })), null);
  assert.deepEqual(fieldPaste(pulse, raw('LightType', 'ByteProperty', { category: 'Lighting', options: type.options })), [['LightType', 'LT_Pulse']]);
  assert.deepEqual(fieldPaste(bright, raw('LightRadius', 'ByteProperty', { category: 'LightColor' })), [['LightRadius', '200']]);
  assert.deepEqual(fieldPaste({ prop: 'DrawScale', kind: 'FloatProperty', values: ['2.000000'] }, raw('LifeSpan', 'FloatProperty')), [['LifeSpan', '2.000000']]);
  assert.equal(fieldPaste({ prop: 'DrawScale', kind: 'FloatProperty', values: ['2.000000'] }, raw('Health', 'IntProperty')), null);
  assert.equal(fieldPaste({ prop: 'Location', kind: 'StructProperty', category: 'Movement', values: ['(X=1,Y=2,Z=3)'] },
    raw('Rotation', 'StructProperty', { category: 'Movement' })), null);
  assert.equal(fieldPaste({ prop: 'Texture', kind: 'ObjectProperty', category: 'Display', values: ["Texture'Engine.S_Light'"] },
    raw('AmbientSound', 'ObjectProperty', { category: 'Sound' })), null);
  assert.equal(fieldPaste({ prop: 'bHidden', kind: 'BoolProperty', category: 'Advanced', values: ['True'] }, raw('bCollideActors', 'BoolProperty')), null);
  // a value of the Properties into the same property of All properties: the two say their declarations their own way
  assert.deepEqual(fieldPaste({ ...bright, kind: 'byte', declared: 'Actor', category: undefined }, raw('LightBrightness', 'ByteProperty', { category: 'LightColor' })),
    [['LightBrightness', '200']]);
});

test('one name declared in two classes apart is two properties: an ATM\'s accounts are not a computer\'s', () => {
  const sound = { group: 'Sound', prop: 'AmbientSound', kind: 'sound', declared: 'Actor', default: ['None'] };
  const computer = [{ group: 'Computer', prop: 'userList', kind: 'users', declared: 'Computers',
    default: ['(UserName="USER",Password="USER",accessLevel=AL_Untrained)', '(UserName="",Password="",accessLevel=AL_Untrained)'] }, sound];
  const atm = [{ group: 'Computer', prop: 'userList', kind: 'users', declared: 'ATM', default: ['(accountNumber="",PIN="",balance=0)', '(accountNumber="",PIN="",balance=0)'] }, sound];
  const set = copySet(object('Computer1', computer, { cls: 'ComputerPersonal', map: { AmbientSound: "Sound'Ambient.Hum'" } }));
  assert.deepEqual(set.declared, { 'userList(0)': 'Computers', 'userList(1)': 'Computers', AmbientSound: 'Actor' });
  const other = object('Computer2', computer, { cls: 'ComputerSecurity', edited: { 'userList(0)': '(UserName="ADMIN",Password="X",accessLevel=AL_Untrained)' } });
  const [onAtm, onComputer] = pastePlan(set, [object('ATM1', atm, { cls: 'ATM' }), other]);
  assert.deepEqual(onAtm.changes.map((c) => c.key), ['AmbientSound']);         // its sound (Actor's on both), not the accounts
  assert.deepEqual(onComputer.changes.map((c) => c.key), ['userList(0)', 'AmbientSound']);
  // a set that does not say (an older page's) goes by name
  assert.deepEqual(pastePlan({ props: { 'userList(0)': '(UserName="A")' }, raw: {} }, [object('ATM2', atm, { cls: 'ATM' })])[0].changes.map((c) => c.key), ['userList(0)']);
  // Paste value too
  const clip = { prop: 'userList', kind: 'users', declared: 'Computers', values: ['(UserName="USER")', '(UserName="")'] };
  assert.equal(fieldPaste(clip, { prop: 'userList', kind: 'users', declared: 'ATM', keys: ['userList(0)', 'userList(1)'] }), null);
  assert.equal(fieldPaste(clip, { prop: 'userList', kind: 'users', declared: 'Computers', keys: ['userList(0)', 'userList(1)'] }).length, 2);
  assert.equal(fieldPaste({ prop: 'userList(0)', kind: 'StructProperty', category: 'Computers', values: ['(UserName="USER")'] },
    { prop: 'userList(0)', kind: 'StructProperty', category: 'ATM', keys: ['userList(0)'] }), null);
  // All properties: by name and UnrealEd's category, where both classes' are known
  const rawSetOf = (rawNames) => ({ cls: 'ComputerPersonal', props: {}, raw: { 'userList(0)': '(UserName="A")', bHidden: 'True' }, rawNames });
  const onAtmRaw = object('ATM3', [], { cls: 'ATM', rawNames: new Map([['userList', 'ATM'], ['bHidden', 'Advanced']]) });
  assert.deepEqual(pastePlan(rawSetOf(new Map([['userList', 'Computers'], ['bHidden', 'Advanced']])), [onAtmRaw])[0].changes.map((c) => c.key), ['bHidden']);
  assert.deepEqual(pastePlan(rawSetOf(null), [onAtmRaw])[0].changes.map((c) => c.key), ['userList(0)', 'bHidden']);
});

test('what is read only on an object is neither pasted nor reset there; a patrol point\'s animation is not copied', () => {
  // the conversation name the original conversations use (app.js readOnlyReason)
  const guard = object('Guard2', GUARD, { cls: 'MJ12Troop', map: { BindName: '"Guard2"' }, readOnly: ['BindName'],
    rawNames: new Map([['BindName', 'Conversation'], ['bHidden', 'Advanced']]) });
  assert.equal(keyChange(guard.props.BindName, '"Other"'), null);
  assert.equal(keyChange(guard.props.BindName, null), null);
  const set = { props: { BindName: '"Other"', Orders: 'Patrolling' }, raw: { BindName: '"Raw"', bHidden: 'True' } };
  assert.deepEqual(pastePlan(set, [guard])[0].changes.map((c) => c.key), ['Orders', 'bHidden']);
  const renamed = object('Guard3', GUARD, { cls: 'MJ12Troop', edited: { BindName: '"Renamed"', Orders: 'Sitting' }, readOnly: ['BindName'] });
  assert.deepEqual(resetPlan([renamed])[0].changes.map((c) => c.key), ['Orders']);
  // copied it still is (as the field shows it), for another object to take
  assert.equal(copySet(guard).props.BindName, '"Guard2"');
  // the animation of a patrol point: its own field sets up the characters patrolling there to play it
  const point = [{ group: 'Patrol', prop: 'PatrolAnim', kind: 'anim', default: ['None'] }, { group: 'Patrol', prop: 'PauseTime', kind: 'float', default: ['0.000000'] }];
  assert.deepEqual([...classKeys(point).keys()], ['PauseTime']);
  assert.deepEqual(valueKeys(point[0], classKeys(point)).filter((k) => classKeys(point).has(k)), []);
});

test('presets: kept without what stays an object\'s own, one name per class, for the class and those under it', () => {
  const set = { cls: 'Light', from: 'Light3', props: { Tag: 'Lamp', LightType: 'LT_Flicker', LightBrightness: '200' }, raw: { bCorona: 'True', Event: 'x' } };
  let list = withPreset([], ' Flickering fluorescent ', set, 'Light');
  assert.deepEqual(list, [{ name: 'Flickering fluorescent', cls: 'Light', section: 'Light', props: { LightType: 'LT_Flicker', LightBrightness: '200' }, raw: { bCorona: 'True' } }]);
  list = withPreset(list, 'flickering FLUORESCENT', { ...set, props: { LightBrightness: '90' } });       // the same name again: in its place
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].props, { LightBrightness: '90' });
  list = withPreset(list, 'Dim red alarm', set);
  list = withPreset(list, 'Hostile patrol', { cls: 'ScriptedPawn', props: { Orders: 'Patrolling' }, raw: {} });
  assert.deepEqual(list.map((p) => p.name), ['Dim red alarm', 'flickering FLUORESCENT', 'Hostile patrol']);
  assert.throws(() => withPreset(list, '   ', set), /name/);
  assert.equal(presetName('x'.repeat(61)), null);
  assert.equal(presetName('a\nb'), null);
  // a guard is a ScriptedPawn; a spotlight a Light: their own class's presets first
  const spot = ['Spotlight', 'Light', 'Actor'], guard = ['MJ12Troop', 'HumanMilitary', 'ScriptedPawn', 'Pawn', 'Actor'];
  assert.deepEqual(presetsFor(list, [spot]).map((p) => p.name), ['Dim red alarm', 'flickering FLUORESCENT']);
  assert.deepEqual(presetsFor(list, [guard]).map((p) => p.name), ['Hostile patrol']);
  assert.deepEqual(presetsFor(list, [spot, guard]), []);                  // none fits both
  assert.deepEqual(presetsFor([...list, { ...list[0], cls: 'Spotlight', name: 'Zz spot' }], [spot]).map((p) => p.name)[0], 'Zz spot');
  assert.deepEqual(withoutPreset(list, 'Light', 'dim red alarm').map((p) => p.name), ['flickering FLUORESCENT', 'Hostile patrol']);
  // kept as text in the project, what is not a preset left out
  assert.deepEqual(readPresets(presetsText(list)), list);
  const bad = JSON.stringify({ version: 1, presets: [{ name: '', cls: 'Light', props: {}, raw: {} }, { name: 'x', cls: 'Light', props: { 'bad key!': '1' }, raw: {} },
    { name: 'y', cls: 'Light', props: {}, raw: { A: null } }, { name: 'z', cls: 'Light', props: { A: null }, raw: { B: '1' } }] });
  assert.deepEqual(readPresets(bad).map((p) => p.name), ['z']);
  assert.deepEqual(readPresets('not json'), []);
  assert.deepEqual(readPresets(null), []);
  assert.deepEqual(readPresets(JSON.stringify({ version: 2, presets: list })), []);
});
