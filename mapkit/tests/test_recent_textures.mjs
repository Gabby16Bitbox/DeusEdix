// Face selection's recent textures (static/recent-textures.js): the list kept in the project read back safely, a
// texture put from elsewhere first, ten at most; Alt+1…9 and Alt+0 the strip's places, as the menus' commands of the
// faces context (static/menubar.js ACTIONS, read from its source) say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MAX_RECENT, RECENT_ACTIONS, readRecent, withRecent, slotOfDigit } from '../editor/static/recent-textures.js';

test('the list kept is read back: texture references only, each once, ten at most', () => {
  assert.deepEqual(readRecent(null), []);
  assert.deepEqual(readRecent('not json'), []);
  assert.deepEqual(readRecent('{"a": 1}'), []);
  assert.deepEqual(readRecent(JSON.stringify(['CoreTexMetal.Metal.DrtySilvMetal_A', 'MyBricks', 'none', 'bad name', '../x', 7, null,
    'MyBricks', 'UNATCO.Stone.un_starwall_a'])), ['CoreTexMetal.Metal.DrtySilvMetal_A', 'MyBricks', 'UNATCO.Stone.un_starwall_a']);
  const many = Array.from({ length: 14 }, (_, i) => `Tex${i}`);
  assert.equal(MAX_RECENT, 10);
  assert.deepEqual(readRecent(JSON.stringify(many)), many.slice(0, 10));
});

test('a texture put comes first, once; the oldest goes past ten', () => {
  let list = [];
  for (const t of ['Floor', 'Wall', 'Trim', 'Ceiling']) list = withRecent(list, t);
  assert.deepEqual(list, ['Ceiling', 'Trim', 'Wall', 'Floor']);
  assert.deepEqual(withRecent(list, 'Wall'), ['Wall', 'Ceiling', 'Trim', 'Floor']);
  for (let i = 0; i < 9; i++) list = withRecent(list, `New${i}`);
  assert.equal(list.length, 10);
  assert.deepEqual([list[0], list[9]], ['New8', 'Ceiling']);
  assert.ok(!list.includes('Floor') && !list.includes('Wall') && !list.includes('Trim'));
});

test("Alt+1…9 and Alt+0 are the strip's ten places, the commands of the faces context in that order", () => {
  assert.deepEqual(['1', '2', '9', '0'].map(slotOfDigit), [0, 1, 8, 9]);
  const source = readFileSync(new URL('../editor/static/menubar.js', import.meta.url), 'utf8');
  const from = source.indexOf('const ACTIONS = [');
  const actions = vm.runInNewContext(source.slice(from, source.indexOf('\n];', from) + 3).replace('const ACTIONS =', 'ACTIONS ='), {});
  // (arrays of this realm: the vm's are not deepEqual to them)
  const faces = [...actions].filter((a) => a[3] === 'faces' && RECENT_ACTIONS.includes(a[0]));
  assert.deepEqual([...faces.map((a) => a[0])], RECENT_ACTIONS);
  assert.deepEqual([...faces.map((a) => a[2])], ['Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5', 'Alt+6', 'Alt+7', 'Alt+8', 'Alt+9', 'Alt+0']);
  assert.equal(RECENT_ACTIONS.length, MAX_RECENT);
  // the key pressed is the place of the command with it
  faces.forEach((a, i) => assert.equal(slotOfDigit(a[2].slice(-1)), i, a[0]));
});
