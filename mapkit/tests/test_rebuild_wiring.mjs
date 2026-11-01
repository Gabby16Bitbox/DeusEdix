// The page's wiring of these features, read from where app.js and workspace.js call them. Each piece runs as it is
// in its own test (test_rebuild_page, test_agent_rebuild, test_map_check, test_scene_transforms, test_workspace_layout);
// these say the page really uses it: File > Close map and the AI assistant see a Rebuild, Check map compares the
// properties and drops onto what the view hides, the keys wait during a build, Ctrl+U sees a maximized panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../editor/static/' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = read('app.js'), workspace = read('workspace.js');
const between = (source, from, to) => { const at = source.indexOf(from); assert.ok(at >= 0, from); return source.slice(at, source.indexOf(to, at)); };
const editor = between(app, 'window.__editor = {', '\n};');

test('window.__editor closes the map through closeMap, which waits for a Rebuild, and says when one runs', () => {
  assert.match(editor, /[{,\s]closeMap,/, 'File > Close map and the tutorial go through closeMap');
  assert.doesNotMatch(editor, /closeMap:/);
  assert.match(between(app, 'function closeMap()', '\n'), /waitsForRebuild\(/);
  assert.match(editor, /get building\(\) \{ return !!buildJob; \}/, 'agent.js asks it before every edit');
  assert.match(read('agent.js'), /\.building\b/);
});

test('Check map compares the properties of stacked copies and drops onto what only the view hides', () => {
  const check = between(app, 'async function checkMap(', '\n}\n');
  assert.match(check, /props: checkedProps\(shown\.get\(a\.name\)\)/);
  assert.match(check, /dropSelected\(presentHits\)/);
  assert.match(app, /function dropSelected\(among = visibleHits\)/, 'the user\'s own Drop stays on what is shown');
  assert.match(between(app, 'function gapBelow(', '\n}\n'), /presentHits\)/, 'what is under a thing: hidden things too');
});

test('the keydown handler asks buildKeyGate before any key that edits', () => {
  const keys = between(app, "if (buildKeyGate(e)) return;", '\n}\n');
  assert.ok(keys.length, 'the handler calls buildKeyGate');
  const gate = app.indexOf('if (buildKeyGate(e)) return;'), save = app.indexOf("if (e.ctrlKey && k === 's') { e.preventDefault(); saveFromUser(); return; }");
  assert.ok(gate > 0 && save > gate && save - gate < 400, 'buildKeyGate comes first');
});

test('Ctrl+U decides with frontNow, which sees a maximized panel or 3D view', () => {
  assert.match(between(workspace, 'toggleFront:', '\n'), /frontNow\(state, maximized, id\)/);
});
