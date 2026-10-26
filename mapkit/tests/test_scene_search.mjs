// The Hierarchy's search (static/scene-search.js), as Unity's scene search: words and tokens (t:, tag:, event:,
// label:, name:, snd:, tex:, mesh:, is:, ref:), quotes, = for the whole value, - to leave out, every term must hold;
// what the map's objects use (their properties' sounds, textures and models); the autocomplete under the box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_KEYS, IS_STATES, KIND_WORDS, TYPE_WORDS, parseSearch, searchMatcher, folderSearch, typesOf, assetsOf, fieldValues,
  searchSuggestions, applySuggestion, quoteValue, searchToken } from '../editor/static/scene-search.js';
import { SHOW_KINDS } from '../editor/static/scene-kinds.js';

// an object as app.js describes it: values, lists and functions (read only when a token asks)
const door = {
  name: 'DeusExMover3', label: 'Door', cls: 'DeusExMover', types: () => typesOf('mover', 'DeusExMover', ['Mover']),
  tag: 'VaultDoor', event: 'None', sounds: () => ['MoverSFX.Door.MetalDoorOpen', 'Ambient.Ambient.Hum'],
  textures: ['CoreTexMetal.Metal.MetalDoor_A'], meshes: [], is: (s) => s === 'original',
};
const lamp = {
  name: 'Light12', label: 'Light', cls: 'Light', types: () => typesOf('light', 'Light'), tag: 'Alarm Lights',
  event: '', sounds: [], textures: [], meshes: [], is: (s) => s === 'added' || s === 'hidden',
};
const match = (text, facts, refs) => searchMatcher(parseSearch(text), { refs })(facts);

test('plain words: name, label or class, every word, as the search did before', () => {
  assert.ok(match('door', door) && match('mover3', door) && match('deusexmover', door));
  assert.ok(match('door mover', door) && !match('door lamp', door));
  assert.ok(!match('vaultdoor', door));                    // a Tag is a token's (tag:), not a word's
  assert.ok(match('"Door"', door));                        // quotes: the word as it is
  assert.ok(!match('-door', door) && match('-door', lamp)); // - leaves out what it finds
  assert.deepEqual(parseSearch('   ').terms, []);
  assert.ok(parseSearch('').empty && parseSearch('door').plain && !parseSearch('tag:x').plain);
  assert.ok(parseSearch('door -tag:x').plain && !parseSearch('door tag:x').plain);      // a - token only leaves out
});

test('tokens: a part with :, the whole with = (or its last part after a dot), quotes for spaces', () => {
  assert.ok(match('tag:vault', door) && !match('tag=vault', door) && match('tag=vaultdoor', door));
  assert.ok(match('tag:"alarm lights"', lamp) && match('tag="Alarm Lights"', lamp) && !match('tag:alarm lights', lamp));
  assert.ok(match('snd:metaldoor', door) && match('snd=MetalDoorOpen', door) && match('snd=moversfx.door.metaldooropen', door));
  assert.ok(!match('snd=Door', door));                     // = is a whole name, not a group of it
  assert.ok(match('tex=MetalDoor_A', door) && !match('tex:metal', lamp));
  assert.ok(match('name:mover3', door) && match('label=door', door) && !match('label=doo', door));
  assert.ok(!match('event:none', door));                   // None is the game's empty name
  assert.ok(match('-tag:alarm', door) && !match('-tag:alarm', lamp));
  assert.ok(match('class:mover', door) && match('CLASS:Mover', door));        // class: is t:, keys in any case
});

test('several terms: every one must hold; tokens still being typed ask nothing yet', () => {
  assert.ok(match('t:door tag:vault snd:hum', door));
  assert.ok(!match('t:door tag:vault snd:rain', door));
  assert.ok(match('door is:original', door) && !match('door is:added', door));
  for (const text of ['tag:', 'is:', 'ref:', 't=', '""']) assert.ok(parseSearch(text).empty, text);
  assert.ok(match('door tag:', door));                     // the half-typed token: as if it were not there
  assert.ok(!match('is:nothing', door));                   // an unknown state holds for nothing
  assert.ok(match('foo:bar', { name: 'foo:bar', label: '' }));     // an unknown key: a word
});

test('t: the class, the classes it comes from, the kind and the Show menu\'s row', () => {
  assert.ok(match('t:door', door) && match('t:elevator', door) && match('t=Mover', door) && match('t=mover', door));
  assert.ok(match('t:light', lamp) && !match('t:light', door));
  assert.ok(match('t=Light', lamp) && match('t:lights', lamp));
  assert.deepEqual(typesOf('logic', 'AmbientSound'), ['AmbientSound', 'logic', 'sound', 'Sounds']);   // in the Sounds folder
  assert.deepEqual(typesOf('structure'), ['structure', 'Structures']);
  assert.ok(typesOf('drawn').includes('Blocks'));          // a drawing goes with the blocks
  // every word t: offers finds a kind by its name
  const kinds = [['structure'], ['pawn'], ['light'], ['prop'], ['mover'], ['logic'], ['path'], ['box'], ['logic', 'AmbientSound'],
    ['prop', 'SecurityCamera'], ['logic', 'ZoneInfo']];
  for (const w of TYPE_WORDS) assert.ok(kinds.some(([k, c]) => match('t:' + w, { types: typesOf(k, c) })), w);
});

test('t= with each word the autocomplete offers finds its row of the Show menu, and only that row', () => {
  assert.deepEqual(TYPE_WORDS, SHOW_KINDS.flatMap((k) => KIND_WORDS[k.id]));
  const things = { structure: ['structure'], pawn: ['pawn', 'ScriptedPawn'], light: ['light', 'Light'], prop: ['prop', 'Barrel1'],
    mover: ['mover', 'DeusExMover'], logic: ['logic', 'Dispatcher'], path: ['path', 'PathNode'], box: ['box'],
    sound: ['logic', 'AmbientSound'], camera: ['prop', 'SecurityCamera'], zone: ['logic', 'ZoneInfo'] };
  assert.deepEqual(Object.keys(things), SHOW_KINDS.map((k) => k.id));
  for (const k of SHOW_KINDS) for (const w of KIND_WORDS[k.id]) for (const [id, [kind, cls]] of Object.entries(things)) {
    const facts = { name: 'X1', label: 'X', cls: cls || '', types: () => typesOf(kind, cls) };
    assert.equal(match(`t=${w}`, facts), id === k.id, `t=${w} on ${id}`);
    assert.equal(match(`-t=${w}`, facts), id !== k.id, `-t=${w} on ${id}`);
  }
});

test('folders and structures found by their name: what they hold shows for a word looked for, never for a - word alone', () => {
  const crate = { name: 'Crate1', label: 'Crate', cls: 'CrateUnbreakableSmall', types: () => typesOf('prop', 'CrateUnbreakableSmall') };
  const lamp = { name: 'Light4', label: 'Lamp', cls: 'Light', types: () => typesOf('light', 'Light') };
  const shown = (text, holder, within = false) => {
    const q = parseSearch(text), own = searchMatcher(q), f = folderSearch(q);
    return [crate, lamp].filter((facts) => f.shows(f.opens(holder, within), { facts, match: own(facts) })).map((x) => x.label);
  };
  assert.deepEqual(shown('-crate', 'Office'), ['Lamp']);              // the folder is no crate: that does not show its crates
  assert.deepEqual(shown('office', 'Office'), ['Crate', 'Lamp']);     // a word of its name: all it holds, as before
  assert.deepEqual(shown('office -crate', 'Office'), ['Lamp']);       // all it holds but what a - word leaves out
  assert.deepEqual(shown('crate -small', 'Crates'), ['Lamp']);        // the small crate stays out of the folder Crates
  assert.deepEqual(shown('t:light', 'Lights'), ['Lamp']);             // tokens: a folder has none, only what matches
  assert.deepEqual(shown('t:prop lights', 'Lights'), []);             // nor with a word of its name besides
  assert.deepEqual(shown('office -t:light', 'Office'), ['Crate']);    // a - token leaves out too: all it holds but lights
  assert.deepEqual(shown('-t:light', 'Office'), ['Crate']);           // a - token alone opens no folder: the crate is no light
  // in a folder or a structure inside one found by its name: all it holds too, but what a - word leaves out
  assert.deepEqual(shown('office', 'Storeroom', true), ['Crate', 'Lamp']);
  assert.deepEqual(shown('office -crate', 'Storeroom', true), ['Lamp']);
  assert.deepEqual(shown('-crate', 'Storeroom', true), ['Lamp']);
  const f = folderSearch(parseSearch('-crate'));
  assert.ok(f.named('Office') && !f.named('Crate stack'));            // a folder itself is found by its name
  assert.ok(!folderSearch(parseSearch('t:light')).named('Lights'));
  // the pieces of a structure: by their own name, or all those a - word leaves in when the structure's name is looked for
  const pieces = (text, holder, within = false) => {
    const f = folderSearch(parseSearch(text));
    return ['Crate stack', 'Wall'].filter((p) => f.piece(p, f.opens(holder, within)));
  };
  assert.deepEqual(pieces('-crate', 'Storeroom'), ['Wall']);
  assert.deepEqual(pieces('storeroom', 'Storeroom'), ['Crate stack', 'Wall']);
  assert.deepEqual(pieces('storeroom -crate', 'Storeroom'), ['Wall']);
  assert.deepEqual(pieces('storeroom -t:light', 'Storeroom'), ['Crate stack', 'Wall']);   // a piece is no light
  assert.deepEqual(pieces('wall', 'Storeroom'), ['Wall']);
  assert.deepEqual(pieces('office -crate', 'Storeroom', true), ['Wall']);         // a structure in the folder Office
});

test('a folder or a structure with nothing to show in it is listed only when it is found itself by something looked for', () => {
  const only = folderSearch(parseSearch('-crate -t:light'));
  assert.equal(only.opens('Office'), false);
  assert.equal(only.listed(only.opens('Office')), false, 'a - word alone: every folder is no crate, none is found');
  assert.equal(only.listed(false, true), false, 'nor a structure that is no crate');
  const named = folderSearch(parseSearch('office -crate'));
  assert.equal(named.listed(named.opens('Office')), true, 'found by its name: listed with nothing left in it');
  assert.equal(named.listed(named.opens('Storeroom')), false);
  assert.equal(named.listed(named.opens('Storeroom', true)), true, 'inside a folder found by its name');
  const token = folderSearch(parseSearch('t:structure'));
  assert.equal(token.listed(token.opens('Room'), true), true, 'a structure found by its own facts');
});

test('ref: the names the page gives for that object, asked once per name', () => {
  let asked = 0;
  const refs = (v) => { asked++; return v === 'button1' ? ['Button1', 'DeusExMover3'] : []; };
  const m = searchMatcher(parseSearch('ref:Button1'), { refs });
  assert.ok(m(door) && !m(lamp) && m({ name: 'BUTTON1' }));
  assert.equal(asked, 1);
  assert.ok(!match('ref:nobody', door, refs) && match('-ref:button1', lamp, refs));
});

test('the sounds, textures and models the properties name', () => {
  assert.deepEqual(assetsOf(["Sound'Ambient.Ambient.Hum'", "Texture'Pkg.Skins.Face'", "FireTexture'Fx.Fire'", "LodMesh'DeusExDeco.Chair1'",
    'None', "Sound'Ambient.Ambient.Hum'", 12, null, "Class'DeusEx.Key'", "Mesh'Pkg.M'"]),
  { sounds: ['Ambient.Ambient.Hum'], textures: ['Pkg.Skins.Face', 'Fx.Fire'], meshes: ['DeusExDeco.Chair1', 'Pkg.M'] });
  assert.deepEqual(assetsOf(undefined), { sounds: [], textures: [], meshes: [] });
});

test('the autocomplete: the keys, then the values of a key', () => {
  const keys = searchSuggestions('', 0).items.map((i) => i.label);
  assert.deepEqual(keys, SEARCH_KEYS.filter((k) => !k.alias).map((k) => k.key + ':'));
  assert.deepEqual(searchSuggestions('door ta', 7).items.map((i) => i.text), ['tag:']);
  assert.deepEqual(searchSuggestions('-ta', 3).items.map((i) => i.text), ['-tag:']);
  assert.deepEqual(searchSuggestions('lamp', 4).items, []);                   // a word: nothing to offer
  assert.deepEqual(searchSuggestions('t:light ', 8).items, []);              // after a term: a letter first
  assert.deepEqual(searchSuggestions('  ', 1).items.length, keys.length);     // a blank box: every key
  assert.deepEqual(searchSuggestions('is:', 3).items.map((i) => i.label), IS_STATES.slice(0, 8));
  assert.deepEqual(searchSuggestions('is:lo', 5).items.map((i) => i.text), ['is:locked ']);
  const values = (k) => ({ tag: ['Alarm Lights', 'VaultDoor', 'alarm'], t: ['Light', 'DeusExMover'] }[k] || []);
  const s = searchSuggestions('door tag:al', 11, values);
  assert.deepEqual([s.from, s.to], [5, 11]);
  assert.deepEqual(s.items.map((i) => i.text), ['tag:"Alarm Lights" ', 'tag:alarm ']);
  assert.deepEqual(searchSuggestions('t:li', 4, values).items.map((i) => i.label), ['light']);               // Light once
  assert.deepEqual(searchSuggestions('t:o', 3, values).items.map((i) => i.label),                           // starting with it first
    ['object', 'door', 'elevator', 'block', 'sound', 'zone', 'DeusExMover']);
  assert.deepEqual(searchSuggestions('tag:alarm', 9, values).items.map((i) => i.label), ['Alarm Lights']);  // not what is typed
  assert.deepEqual(searchSuggestions('nokey:x', 7, values).items, []);
  assert.equal(searchSuggestions('is:', 3, values, 2).items.length, 2);
});

test('a suggestion put in place of its piece, the caret after it', () => {
  const s = searchSuggestions('door ta snd:x', 7);
  assert.deepEqual(applySuggestion('door ta snd:x', s, s.items[0]), { text: 'door tag: snd:x', caret: 9 });
  const v = searchSuggestions('is:lo snd:x', 5);
  assert.deepEqual(applySuggestion('is:lo snd:x', v, v.items[0]), { text: 'is:locked snd:x', caret: 10 });    // one space
  const e = searchSuggestions('is:lo', 5);
  assert.deepEqual(applySuggestion('is:lo', e, e.items[0]), { text: 'is:locked ', caret: 10 });
});

test('the values of the map for a key, each once, in order', () => {
  const list = [door, lamp, { name: 'Light13', cls: 'light', tag: 'none', sounds: () => ['Ambient.Ambient.Hum'] }];
  assert.deepEqual(fieldValues(list, 't'), ['DeusExMover', 'Light']);
  assert.deepEqual(fieldValues(list, 'tag'), ['Alarm Lights', 'VaultDoor']);
  assert.deepEqual(fieldValues(list, 'ref'), ['DeusExMover3', 'Light12', 'Light13']);
  assert.deepEqual(fieldValues(list, 'snd'), ['Ambient.Ambient.Hum', 'MoverSFX.Door.MetalDoorOpen']);
  assert.deepEqual(fieldValues(list, 'is'), []);
  assert.deepEqual(fieldValues(list, 'nokey'), []);
});

test('the tokens of Find references and Find in map', () => {
  assert.equal(searchToken('ref', 'Button1'), 'ref:Button1');
  assert.equal(searchToken('snd', 'Ambient.Ambient.Hum', true), 'snd=Ambient.Ambient.Hum');
  assert.equal(quoteValue('my "odd" tag'), '"my odd tag"');
  assert.equal(quoteValue(''), '""');
  assert.ok(match(searchToken('tag', 'Alarm Lights', true), lamp));
});
