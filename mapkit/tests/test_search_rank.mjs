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
  assert.deepEqual(words('Café.WALL'), ['cafe', 'wall']);
});

test('nothing typed is no search', () => {
  assert.equal(createSearch('   '), null);
});

test('the game\'s sink is found by sink, in any case, and by its other names', () => {
  for (const typed of ['sink', 'SINK', 'washbasin', 'tap']) assert.ok(find(typed).includes('Faucet'), typed);
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

// the texture picker: a texture's name, group and package, with the words of its theme (texture-words.js)
import { TEXTURE_THEMES } from '../editor/static/texture-words.js';
const TEXTURES = [
  ['Flr_Wd02', 'CoreTexWood.Floors.Flr_Wd02'], ['MtlPnl3', 'CoreTexMetal.Panels.MtlPnl3'], ['BrkWall_A', 'CoreTexBrick.Walls.BrkWall_A'],
  ['bathtile1', 'CoreTexCeramic.Tiles.bathtile1'], ['woodpanel04', 'UNATCO.Office.woodpanel04'], ['Glass_Clear', 'CoreTexGlass.Windows.Glass_Clear'],
];
const tfields = ([name, full]) => [{ text: name, weight: 3 }, { text: full.split('.').slice(1, -1).join(' '), weight: 2 }, { text: full.split('.')[0], weight: 1 }];
const findTex = (typed) => rank(TEXTURES, createSearch(typed, { synonyms: TEXTURE_THEMES }), tfields).map((t) => t[0]);

test('textures: a theme finds the short forms of the game\'s names', () => {
  assert.deepEqual(findTex('wood floor'), ['Flr_Wd02']);
  assert.ok(findTex('wood').includes('woodpanel04') && findTex('wood').includes('Flr_Wd02'));
  assert.equal(findTex('wood')[0], 'woodpanel04', 'the word itself before a short form of it');
  assert.deepEqual(findTex('metal panel'), ['MtlPnl3']);
  assert.deepEqual(findTex('brick'), ['BrkWall_A']);
  assert.ok(findTex('ceramic').includes('bathtile1') && findTex('tile').includes('bathtile1'));
  assert.deepEqual(findTex('window'), ['Glass_Clear']);
  assert.deepEqual(findTex('stone'), []);
});
