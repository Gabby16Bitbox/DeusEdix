// The folder new things go in (static/hierarchy-folders.js, as Unity's Set as Default Parent) and where new things and
// copies go among the Hierarchy's folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFolder, setDefaultFolder, forgetGoneDefault, putInFolder, putBeside } from '../editor/static/hierarchy-folders.js';

const map = () => ({ nests: [{ id: 'n1', label: 'Office 2 props', items: ['a:Lamp0'] }, { id: 'n2', label: 'Lobby', items: ['n:n1', 'b:UCEditBox0'] }] });

test('no folder at first; one of the map set, found by its id, cleared again', () => {
  const edits = map();
  assert.equal(defaultFolder(edits), null);
  assert.equal(defaultFolder(null), null);
  assert.equal(setDefaultFolder(edits, 'n1'), true);
  assert.equal(defaultFolder(edits).label, 'Office 2 props');
  edits.nests[0].label = 'Office 2';                          // renamed: it follows (the id stays)
  assert.equal(defaultFolder(edits).label, 'Office 2');
  assert.equal(setDefaultFolder(edits, null), true);
  assert.equal('defaultFolder' in edits, false);
});

test('a folder that does not exist is refused, the one set stays', () => {
  const edits = map();
  setDefaultFolder(edits, 'n2');
  assert.equal(setDefaultFolder(edits, 'n9'), false);
  assert.equal(edits.defaultFolder, 'n2');
  assert.equal(setDefaultFolder({}, 'n1'), false);           // a map without folders
});

test('a deleted folder takes the mark with it; a new folder under its id does not get it', () => {
  const edits = map();
  setDefaultFolder(edits, 'n1');
  assert.equal(forgetGoneDefault(edits), false);             // still there: kept
  assert.equal(edits.defaultFolder, 'n1');
  edits.nests = edits.nests.filter((n) => n.id !== 'n1');
  assert.equal(defaultFolder(edits), null);                  // gone: nothing goes in it any more
  assert.equal(forgetGoneDefault(edits), true);
  assert.equal('defaultFolder' in edits, false);
  edits.nests.push({ id: 'n1', label: 'Folder 1', items: [] });
  assert.equal(defaultFolder(edits), null);
  assert.equal(forgetGoneDefault(edits), false);             // nothing to forget
  assert.equal(forgetGoneDefault(null), false);
});

test('new things go at the end of the folder, each once; no folder, no change', () => {
  const edits = map(), n = edits.nests[0];
  assert.equal(putInFolder(n, ['a:UCEdit3', 'd:Wall1', 'a:UCEdit3']), n);
  assert.deepEqual(n.items, ['a:Lamp0', 'a:UCEdit3', 'd:Wall1']);
  assert.equal(putInFolder(null, ['a:UCEdit4']), null);
  assert.equal(edits.nests.flatMap((x) => x.items).includes('a:UCEdit4'), false);
});

test('a copy goes right after its original, in its folder; a copy of something at the top level stays there', () => {
  const edits = map();
  edits.nests[0].items.push('a:Desk0');
  putBeside(edits.nests, [['a:Lamp0', 'a:UCEdit1'], ['a:Desk0', 'a:UCEdit2'], ['a:Crate9', 'a:UCEdit3'], ['n:n1', 'n:n3'], ['b:UCEditBox0', null]]);
  assert.deepEqual(edits.nests[0].items, ['a:Lamp0', 'a:UCEdit1', 'a:Desk0', 'a:UCEdit2']);
  assert.deepEqual(edits.nests[1].items, ['n:n1', 'n:n3', 'b:UCEditBox0']);   // a nest's copy beside it, in the nest around it
  assert.equal(edits.nests.some((n) => n.items.includes('a:UCEdit3')), false);
  putBeside(edits.nests, [['a:Lamp0', 'a:UCEdit1']]);        // already there: not twice
  assert.equal(edits.nests[0].items.filter((k) => k === 'a:UCEdit1').length, 1);
});
