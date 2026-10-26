// The command palette's search (static/command-search.js), as Unity's Search window: > and @ and the Hierarchy's
// tokens narrow it, words are found fuzzily (letters in order, best at the start of a word), every word must be found,
// the groups come best first with what cannot run now at their end, the token chips of the Hierarchy's search, the
// arrows' next row and the last 20 queries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_GROUPS, SHOWN, RECENT_MAX, readQuery, fuzzyScore, itemScore, rankPalette, paletteSuggestions, stepRow,
  readRecent, withRecent } from '../editor/static/command-search.js';

const item = (label, ...more) => ({ label, texts: [label, ...more] });
const labels = (groups, id) => groups.find((g) => g.id === id)?.items.map((i) => i.label);

test('a prefix narrows the search: > the commands, @ the map, a token of the Hierarchy the map too', () => {
  assert.deepEqual(readQuery('rebuild light'), { scope: 'all', text: 'rebuild light', from: 0, words: ['rebuild', 'light'], empty: false });
  assert.deepEqual(readQuery('  > save'), { scope: 'command', text: 'save', from: 4, words: ['save'], empty: false });
  assert.equal(readQuery('@').scope, 'object');
  assert.ok(readQuery('@').empty && readQuery('>').empty && readQuery('   ').empty);
  const tokens = readQuery('t:light door');
  assert.equal(tokens.scope, 'object');
  assert.deepEqual(tokens.words, ['door']);                 // the token is the Hierarchy search's alone
  assert.equal(readQuery('-is:hidden').scope, 'object');
  assert.equal(readQuery('t:').scope, 'object');            // a token still being typed: the map already
  assert.ok(readQuery('t:').empty);
  assert.equal(readQuery('note: crate').scope, 'all');      // not a token of the Hierarchy's search: words
  assert.deepEqual(readQuery('"door frame" -crate').words, ['door frame']);
});

test('fuzzy: the letters in order, better at the start of words and one after the other', () => {
  assert.equal(fuzzyScore('rbx', 'Rebuild lighting'), null);
  assert.equal(fuzzyScore('lr', 'Rebuild lighting'), null);              // in their order only
  assert.ok(fuzzyScore('rl', 'Rebuild lighting') > fuzzyScore('rl', 'Rebuild AI paths'));   // the capitals of its words
  assert.ok(fuzzyScore('build', 'Build') > fuzzyScore('build', 'Rebuild'));                // at the start of a word
  assert.ok(fuzzyScore('mover', 'DeusExMover') > fuzzyScore('mover', 'Demo over'));        // DeusExMover: Mover is a word
  assert.ok(fuzzyScore('rebuild', 'Rebuild') > fuzzyScore('rebuild', 'Rebuild lighting')); // the whole of it, a shorter text
  assert.equal(fuzzyScore('', 'anything'), 0);
  assert.equal(fuzzyScore('a', ''), null);
});

test('every word must be found, each in the best of an item\'s texts, the label counting most', () => {
  assert.equal(itemScore(['map', 'rebuild'], ['Rebuild', 'Map']) !== null, true);         // the menu's name helps
  assert.equal(itemScore(['map', 'zzz'], ['Rebuild', 'Map']), null);
  assert.ok(itemScore(['light'], ['Light', 'Map']) > itemScore(['light'], ['Lamp', 'Light']));
  assert.ok(itemScore(['rebuild', 'light'], ['Rebuild lighting']) > itemScore(['light', 'rebuild'], ['Rebuild lighting']));  // as typed
});

test('the groups of a search of everything: best group first, a few of each, what cannot run after the rest', () => {
  const sources = {
    command: [{ ...item('Undo', 'Edit'), disabled: true }, item('Rebuild lighting', 'Map'), item('Rebuild', 'Map'), item('Game lighting', 'View')],
    object: [item('Light', 'Light12', 'Light')],              // found by the Hierarchy's search: only ordered here
    class: [item('Light', 'Light', 'Lights'), item('Spotlight', 'Spotlight', 'Lights'), item('Crate', 'CrateUnbreakableSmall', 'Decorations')],
    texture: Array.from({ length: 9 }, (_, i) => item(`LightTex${i}`, 'CoreTexMetal')),
  };
  const groups = rankPalette(readQuery('light'), sources);
  assert.equal(groups[0].id, 'object');                     // the whole of a label: the best match
  assert.deepEqual(labels(groups, 'command'), ['Game lighting', 'Rebuild lighting']);
  assert.deepEqual(labels(groups, 'class'), ['Light', 'Spotlight']);
  const tex = groups.find((g) => g.id === 'texture');
  assert.equal(tex.items.length, SHOWN.all);
  assert.equal(tex.more, 9 - SHOWN.all);
  assert.equal(groups.find((g) => g.id === 'object').prefix, '@');
  assert.ok(!groups.some((g) => g.id === 'sound'));         // no source, no group
  // what its menu greys out comes after what runs, whatever its score
  const undo = rankPalette(readQuery('u'), { command: [{ ...item('Undo'), disabled: true }, item('Rebuild')] });
  assert.deepEqual(labels(undo, 'command'), ['Rebuild', 'Undo']);
  assert.deepEqual(rankPalette(readQuery(''), sources), []); // nothing typed: nothing (the recent searches instead)
});

test('a prefix alone lists its whole group in its own order; @ keeps what the map search found', () => {
  const sources = { command: ['Save', 'Undo', 'Redo'].map((l) => item(l)), object: [item('Door', 'DeusExMover3'), item('Lamp', 'Light2')] };
  assert.deepEqual(rankPalette(readQuery('>'), sources).map((g) => g.id), ['command']);
  assert.deepEqual(labels(rankPalette(readQuery('>'), sources), 'command'), ['Save', 'Undo', 'Redo']);
  assert.deepEqual(labels(rankPalette(readQuery('@'), sources), 'object'), ['Door', 'Lamp']);
  // tokens only: every object the Hierarchy's search gave, none dropped by the words
  assert.deepEqual(labels(rankPalette(readQuery('t:light'), sources), 'object'), ['Door', 'Lamp']);
  // a word too: found ones first (an object the map search found stays, last)
  assert.deepEqual(labels(rankPalette(readQuery('@ lamp'), sources), 'object'), ['Lamp', 'Door']);
  const many = { command: Array.from({ length: 70 }, (_, i) => item(`Command ${i}`)) };
  for (const query of ['>', '>command']) {                  // one kind: every one it finds (drawn a page at a time)
    const one = rankPalette(readQuery(query), many)[0];
    assert.deepEqual([one.items.length, one.more], [70, 0], query);
  }
  const all = rankPalette(readQuery('command'), many)[0];   // everything: the first few, and how many more (> shows them)
  assert.deepEqual([all.items.length, all.more], [SHOWN.all, 70 - SHOWN.all]);
  assert.deepEqual(PALETTE_GROUPS.map((g) => g.id), ['command', 'object', 'class', 'texture', 'sound', 'setting', 'panel']);
});

test('the Hierarchy\'s token chips in a search of the map, put in at the caret of the whole query', () => {
  assert.equal(paletteSuggestions('ta', 2), null);          // a search of everything: no chips
  const keys = paletteSuggestions('@ ta', 4);
  assert.deepEqual(keys.items.map((i) => i.label), ['tag:']);
  assert.deepEqual(keys.put(keys.items[0]), { text: '@ tag:', caret: 6 });
  const values = paletteSuggestions('tag:al door', 6, (k) => (k === 'tag' ? ['Alarm Lights', 'Vault'] : []));
  assert.deepEqual(values.items.map((i) => i.label), ['Alarm Lights']);
  assert.deepEqual(values.put(values.items[0]), { text: 'tag:"Alarm Lights" door', caret: 19 });
  assert.equal(paletteSuggestions('@ tag:al', 0, () => ['Alarm']), null);   // the caret on the prefix
});

test('the arrows skip what cannot be chosen and go round', () => {
  const off = [false, true, false, true];
  assert.equal(stepRow(off, -1, 1), 0);
  assert.equal(stepRow(off, -1, -1), 2);
  assert.equal(stepRow(off, 0, 1), 2);
  assert.equal(stepRow(off, 2, 1), 0);
  assert.equal(stepRow(off, 0, -1), 2);
  assert.equal(stepRow([true, true], 0, 1), -1);
  assert.equal(stepRow([], -1, 1), -1);
});

test('the last 20 queries: the newest first, once whatever its case, nothing empty or broken kept', () => {
  let list = [];
  for (let i = 0; i < 25; i++) list = withRecent(list, `query ${i}`);
  assert.equal(list.length, RECENT_MAX);
  assert.equal(list[0], 'query 24');
  list = withRecent(list, '  QUERY 10 ');
  assert.equal(list[0], 'QUERY 10');
  assert.equal(list.filter((q) => q.toLowerCase() === 'query 10').length, 1);
  assert.equal(withRecent(list, '   '), list);
  assert.equal(withRecent(list, 'x'.repeat(201)), list);
  assert.deepEqual(readRecent(JSON.stringify(list)), list);
  assert.deepEqual(readRecent('not json'), []);
  assert.deepEqual(readRecent('{"a":1}'), []);
  assert.deepEqual(readRecent(JSON.stringify(['ok', 3, '', null, 'x'.repeat(300)])), ['ok']);
  assert.deepEqual(readRecent(null), []);
});
