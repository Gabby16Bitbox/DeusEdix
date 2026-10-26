// The Hierarchy's search box (static/search-box.js, on a stand-in page): a whole query set from elsewhere searches at
// once; clear() (another map) empties it without a search of its own and hides its chips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSearchBox } from '../editor/static/search-box.js';

function element(id) {
  const on = {};
  return { id, value: '', hidden: false, innerHTML: '', selectionStart: 0, attrs: {}, on,
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(type, f) { on[type] = f; }, setSelectionRange(a) { this.selectionStart = a; }, blur() {} };
}

test('set searches at once; clear empties the box with no search and no chips', () => {
  const input = element('hsearch'), list = element('hsuggest'), calls = [];
  globalThis.document = { activeElement: input };
  const box = mountSearchBox(input, list, { values: () => ['Alarm'], changed: () => calls.push(input.value) });
  box.set('ref:UCEdit5');
  assert.deepEqual(calls, ['ref:UCEdit5']);
  input.value = 'tag:'; input.selectionStart = 4; input.on.input();          // typing: the chips of the tag's values
  assert.equal(list.hidden, false);
  box.clear();
  assert.equal(input.value, '');
  assert.equal(list.hidden, true);
  assert.deepEqual(calls, ['ref:UCEdit5'], 'the page draws the next map anew: no search of its own');
});
