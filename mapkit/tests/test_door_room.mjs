import test from 'node:test';
import assert from 'node:assert/strict';
import {roomOf, wayOf, roomNote} from '../editor/static/door-room.js';

// a door at x 128 that opens east its own way, west the other way; a wall at `wallX` (the Discord's narrow alley)
const lines = {built: [[[140, -180, 32], [170, -160, 32]]], other: [[[116, -180, 32], [86, -160, 32]]],
  middle: {built: [164, -196, 64], other: [92, -196, 64]}};
const wallAt = (x) => (a, b) => (a[0] - x) * (b[0] - x) <= 0;

test('each way has room unless something is across its lines', () => {
  assert.deepEqual(roomOf(lines, () => false), {built: true, other: true});
  assert.deepEqual(roomOf(lines, wallAt(100)), {built: true, other: false});
  assert.deepEqual(roomOf(lines, wallAt(150)), {built: false, other: true});
  assert.equal(roomOf({built: [], other: []}, () => true), null);         // a door that does not turn
  assert.equal(roomOf(undefined, () => true), null);
});

test('the way each Opens takes, into as the build picks it', () => {
  assert.equal(wayOf('built'), 'built');
  assert.equal(wayOf(undefined), 'built');
  assert.equal(wayOf('other'), 'other');
  assert.equal(wayOf('away'), 'away');
  assert.equal(wayOf('into', [-300, -168, 48], lines.middle), 'other');
  assert.equal(wayOf('into', [400, -168, 48], lines.middle), 'built');
});

test('the Inspector says when a door goes into something, and what to choose', () => {
  const both = {built: true, other: true}, eastOnly = {built: true, other: false}, westOnly = {built: false, other: true};
  for (const opens of ['built', 'other', 'away', 'into']) assert.equal(roomNote(opens, both, [-300, 0, 0], lines.middle), '');
  assert.equal(roomNote('built', null), '');
  assert.equal(roomNote('built', eastOnly), '');
  assert.match(roomNote('other', eastOnly), /One way, as in its map/);
  assert.match(roomNote('built', westOnly), /One way, the other side/);
  assert.match(roomNote('into', eastOnly, [-300, -168, 48], lines.middle), /goes into something/);
  assert.match(roomNote('away', eastOnly), /always opens its own way/);
  assert.match(roomNote('away', westOnly), /always opens the other way/);
  assert.match(roomNote('built', {built: false, other: false}), /either way/);
});
