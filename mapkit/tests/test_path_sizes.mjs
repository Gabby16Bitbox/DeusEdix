// Who can walk an AI path link (editor/static/ai-paths.js, 5 Nov 2026): the kinds of character by size from the
// game's collision cylinders, the colour a link takes for the characters of a map (green where all of them fit,
// else the biggest kind that does, red where nobody does), and the room of both ways of a link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZE_KINDS, EVERYONE, NOBODY, fitsLink, linkSize, characterSize, linkWho, pathStrips } from '../editor/static/ai-paths.js';

const PERSON = { radius: 20, height: 47.5 }, KARKIAN = { radius: 54, height: 37.1 }, BOT = { radius: 80, height: 79 },
  RAT = { radius: 16, height: 3.5 }, GUNTHER = { radius: 24.2, height: 52.66 }, DOG = { radius: 35, height: 23 };
const link = (radius, height) => ({ radius, height });
const key = (w) => w.key;

test('the kinds hold one another, biggest first', () => {
  for (let i = 1; i < SIZE_KINDS.length; i++) {
    assert.ok(SIZE_KINDS[i].radius <= SIZE_KINDS[i - 1].radius && SIZE_KINDS[i].height <= SIZE_KINDS[i - 1].height, SIZE_KINDS[i].key);
  }
  assert.deepEqual([BOT, KARKIAN, DOG, GUNTHER, PERSON, RAT].map(characterSize), [0, 1, 1, 1, 2, 3]);
  assert.equal(characterSize({ radius: 112, height: 51 }), 0, 'bigger than all (a spider bot): the biggest');
});

test('a character walks a link no narrower and no lower than itself; an older cache: everyone', () => {
  assert.ok(fitsLink(PERSON, link(24, 70)));
  assert.ok(!fitsLink(KARKIAN, link(44, 79)));
  assert.ok(!fitsLink(PERSON, link(60, 40)), 'too low');
  assert.ok(fitsLink(BOT, link(0, 0)));
  assert.ok(fitsLink(PERSON, link(20, 0)), 'no height given: the radius only');
  assert.deepEqual([link(115, 79), link(70, 70), link(44, 79), link(24, 70), link(15, 79), link(12, 61)].map(linkSize), [0, 1, 2, 2, 4, 4]);
});

test('the colour: green where every character of the map fits, the biggest that does elsewhere', () => {
  const people = [PERSON, PERSON];
  assert.deepEqual([link(115, 79), link(24, 70), link(15, 79)].map((l) => key(linkWho(l, people))), ['everyone', 'everyone', 'nobody']);
  const zoo = [PERSON, KARKIAN];
  assert.deepEqual([link(70, 70), link(44, 79), link(18, 20)].map((l) => key(linkWho(l, zoo))), ['everyone', 'person', 'small']);
  assert.equal(key(linkWho(link(22, 70), [GUNTHER])), 'person', 'Gunther is wider than the link: people pass, not him');
  assert.equal(key(linkWho(link(115, 79), [{ radius: 112, height: 51 }])), 'everyone');
  assert.equal(key(linkWho(link(90, 79), [{ radius: 112, height: 51 }])), 'huge', 'a spider bot does not fit: up to military bots');
  assert.equal(key(linkWho(link(24, 70), [])), 'everyone', 'no characters: people are assumed');
  assert.equal(key(linkWho(link(18, 70), [])), 'small');
  assert.equal(EVERYONE.color !== NOBODY.color, true);
});

test('a link both ways: one line, the room the wider way gives', () => {
  const data = { points: { A: [0, 0, 0, 0], B: [0, 100, 0, 0], C: [0, 200, 0, 0] },
    links: [['A', 'B', 1, 24, 70, 100], ['B', 'A', 1, 44, 79, 100], ['B', 'C', 8, 60, 61, 100]] };
  assert.deepEqual(pathStrips(data).map((s) => [s.a, s.b, s.two, s.kind, s.radius, s.height]),
    [['A', 'B', true, 'walk', 44, 79], ['B', 'C', false, 'jump', 60, 61]]);
});
