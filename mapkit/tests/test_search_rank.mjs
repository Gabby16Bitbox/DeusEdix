// The browsers' search (static/search-rank.js): word by word, by the other words a class is known by, with a typo, best
// match first (Gabby, 2 Nov 2026: "SINK" found no sink: the game's is the class Faucet).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { words, createSearch, rank } from '../editor/static/search-rank.js';

const aliases = JSON.parse(readFileSync(new URL('../editor/config/palette.json', import.meta.url), 'utf-8')).searchAliases;
const OBJECTS = [
  { label: 'Faucet', cls: 'Faucet', cat: 'Decorations bathroom' },
  { label: 'Shower Faucet', cls: 'ShowerFaucet', cat: 'Decorations bathroom' },
  { label: 'Toilet', cls: 'Toilet', cat: 'Decorations bathroom' },
  { label: 'Office Chair', cls: 'OfficeChair', cat: 'Decorations seats' },
  { label: 'Chair', cls: 'Chair1', cat: 'Decorations seats' },
  { label: 'Trash can', cls: 'TrashCan3', cat: 'Decorations trash' },
  { label: 'Sink basin', cls: 'Pieces', cat: 'Pieces' },
].map((it) => ({ ...it, tags: aliases[it.cls] || '' }));
const fields = (it) => [{ text: it.label, weight: 3 }, { text: it.tags, weight: 2 }, { text: it.cls, weight: 2 }, { text: it.cat, weight: 1 }];
const find = (typed) => rank(OBJECTS, createSearch(typed), fields).map((it) => it.label);

test('words: class names, numbers, underscores and accents', () => {
  assert.deepEqual(words('OfficeChair_2'), ['office', 'chair', '2']);
  assert.deepEqual(words('HKMarketLight'), ['hk', 'market', 'light']);
  assert.deepEqual(words('Città.LAVANDINO'), ['citta', 'lavandino']);
});

test('nothing typed is no search', () => {
  assert.equal(createSearch('   '), null);
});

test('the game\'s sink is found by sink, in any case, and in Italian', () => {
  for (const typed of ['sink', 'SINK', 'lavandino', 'lavabo', 'rubinetto']) assert.ok(find(typed).includes('Faucet'), typed);
  assert.deepEqual(find('sink').slice(0, 2).sort(), ['Faucet', 'Sink basin']);
});

test('every word typed must match, in any order, written apart or together', () => {
  assert.deepEqual(find('office chair'), ['Office Chair']);
  assert.deepEqual(find('chair office'), ['Office Chair']);
  assert.deepEqual(find('officechair'), ['Office Chair']);
  assert.deepEqual(find('trashcan'), ['Trash can']);
  assert.deepEqual(find('chair nothing'), []);
});

test('a typo still finds it', () => {
  assert.equal(find('fauset')[0], 'Faucet');
  assert.equal(find('toilett')[0], 'Toilet');
});

test('best match first: the name itself before what only its category says', () => {
  assert.equal(find('chair')[0], 'Chair');
  assert.equal(find('faucet')[0], 'Faucet');
  const bathroom = find('bathroom');
  assert.ok(bathroom.includes('Toilet') && bathroom.includes('Faucet'));
});

test('a boost puts a favourite first among equals', () => {
  const found = rank(OBJECTS, createSearch('faucet'), fields, (it) => (it.cls === 'ShowerFaucet' ? 50 : 0));
  assert.equal(found[0].cls, 'ShowerFaucet');
});
