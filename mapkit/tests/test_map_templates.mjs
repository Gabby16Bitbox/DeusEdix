// New map's tiles (static/map-templates.js, G35): An empty room, A copy of a map, then the project's map templates, each
// a radio named nmfrom as before, with its picture, its words and a × to delete it; names and words escaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTiles, templateBase, templateNote } from '../editor/static/map-templates.js';

const room = { id: '20261026-101500-Warm_room', name: 'Warm room', description: 'Lamps and wood', source: '01_Feature_Lab',
  room: { size: [2048, 1024, 384], textures: {}, mood: 'warm' }, picture: '/map_templates/20261026-101500-Warm_room/thumb.jpg?v=1' };
const copy = { id: '20261026-101600-Street', name: 'Street <b>&</b> "sky"', description: '', source: '06_Block', room: null, picture: '' };
const radios = (html) => [...html.matchAll(/<input type="radio" name="nmfrom" value="(\w+)"( data-template="([^"]+)")?( checked)?>/g)]
  .map((m) => [m[1], m[3] || '', !!m[4]]);

test('An empty room and A copy of a map first, An empty room chosen; then each template', () => {
  const html = startTiles([room, copy], { empty: '<svg id="e"></svg>', copy: '<svg id="c"></svg>' });
  assert.deepEqual(radios(html), [['empty', '', true], ['copy', '', false], ['template', room.id, false], ['template', copy.id, false]]);
  assert.match(html, /<span class="nm-pic"><svg id="e"><\/svg><\/span><span>An empty room<\/span>/);
  assert.match(html, /<span class="nm-pic"><svg id="c"><\/svg><\/span><span>A copy of a map<\/span>/);
  // a template: its picture, its name, a × that names it
  assert.ok(html.includes(`<img class="nm-pic" src="${room.picture}" alt="">`));
  assert.ok(html.includes(`data-nmdel="${room.id}"`));
  assert.ok(html.includes('aria-label="Delete the template Warm room"'));
  // only the templates can be deleted
  assert.equal((html.match(/data-nmdel=/g) || []).length, 2);
});

test('no templates: the two tiles of before', () => {
  assert.deepEqual(radios(startTiles([])), [['empty', '', true], ['copy', '', false]]);
});

test('a name, a description and a source are text, never markup', () => {
  const html = startTiles([copy, { ...room, description: 'a "quoted" <i>room</i>' }]);
  assert.ok(!html.includes('<b>&</b>') && html.includes('Street &lt;b&gt;&amp;&lt;/b&gt; &quot;sky&quot;'));
  assert.ok(!html.includes('<i>room</i>') && html.includes('a &quot;quoted&quot; &lt;i&gt;room&lt;/i&gt;'));
  assert.ok(html.includes('<span class="nm-pic"></span><span>Street'));         // no picture: an empty one
});

test('what a template starts a map with, and what New map says of it', () => {
  assert.equal(templateBase(room), 'The room of 01_Feature_Lab (2048 x 1024 x 384) with its changes.');
  assert.equal(templateBase(copy), 'A copy of 06_Block with its changes.');
  assert.equal(templateNote(room), 'Lamps and wood\nThe room of 01_Feature_Lab (2048 x 1024 x 384) with its changes. '
    + 'Characters, Interactions, cutscenes and the Story are not in it. The room is built at once (about half a minute).');
  assert.equal(templateNote(copy), 'A copy of 06_Block with its changes. Characters, Interactions, cutscenes and the Story are not in it.');
  // the tile's tooltip: the description, then the base
  assert.ok(startTiles([room]).includes('title="Lamps and wood\nThe room of 01_Feature_Lab'));
});
