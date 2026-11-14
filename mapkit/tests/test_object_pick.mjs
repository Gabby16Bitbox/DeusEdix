// object-pick.js: the eyedropper button of the fields that name an object of the map, and the words under a Tag
// field (14 Nov 2026)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickButton, saidHtml, PICK_SVG } from '../editor/static/object-pick.js';

test('the button carries its attributes, a title and the pipette', () => {
  const b = pickButton('data-namepick="pp1"', 'Pick the door "A" (eyedropper)');
  assert.match(b, /^<button type="button" class="object-pick" data-namepick="pp1"/);
  assert.ok(b.includes('title="Pick the door &quot;A&quot; (eyedropper)"'));
  assert.ok(b.includes(PICK_SVG));
});

test('what a Tag reaches: names, "and n more", a warning for none, nothing for no Tag', () => {
  assert.equal(saidHtml(null), '');
  assert.match(saidHtml([]), /class="object-pick-said none">no object has this Tag</);
  assert.match(saidHtml(['Door · B', 'Light 2']), />→ Door · B, Light 2</);
  assert.match(saidHtml(['a', 'b', 'c', 'd', 'e']), /→ a, b, c and 2 more/);
  assert.match(saidHtml(['Key <1>'], { arrow: 'opened by' }), />opened by Key &lt;1&gt;</);
});
