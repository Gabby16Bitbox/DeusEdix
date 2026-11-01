import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// its own modules by their files (a data: module cannot import next to itself): the transition, the Mods list,
// Dr. Hale's voice
const source = (await readFile(new URL('../editor/static/projects.js', import.meta.url), 'utf8'))
  .replace(/'\.\/([\w-]+\.js)'/g, (_, file) => JSON.stringify(new URL('../editor/static/' + file, import.meta.url).href));
const { createProjectHub, projectStorageKey, readProjectMapPrefs, writeProjectMapPref, unsavedProjectTools,
  isCustomProject, isTrainingProject, projectFolder, trainingProjectId } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const a = { id: 'campaign-a', kind: 'custom' }, b = { id: 'campaign-b', kind: 'custom' }, legacy = { id: 'legacy', kind: 'legacy' };
globalThis.window = { __projectContext: a, __menubar: { prefs: { lastMap: 'old-map', recentMaps: [{ script: 'old-map' }] } } };

assert.notEqual(projectStorageKey('objects.same_map', a), projectStorageKey('objects.same_map', b));
assert.notEqual(projectStorageKey('clipboard', a), projectStorageKey('clipboard', b));
assert.notEqual(projectStorageKey('tutorial', a), projectStorageKey('tutorial', b));
assert.equal(projectStorageKey('maps'), projectStorageKey('maps', a));
writeProjectMapPref('lastMap', 'same_map', a);
writeProjectMapPref('recentMaps', [{ script: 'same_map' }], a);
assert.deepEqual(readProjectMapPrefs(a), { lastMap: 'same_map', recentMaps: [{ script: 'same_map' }] });
assert.deepEqual(readProjectMapPrefs(b), {}, 'A different campaign must not inherit current or legacy recent maps');
assert.deepEqual(readProjectMapPrefs(legacy), { lastMap: 'old-map', recentMaps: [{ script: 'old-map' }] });
writeProjectMapPref('recentMaps', [], legacy);
assert.equal(readProjectMapPrefs(legacy).lastMap, 'old-map');
assert.deepEqual(readProjectMapPrefs(legacy).recentMaps, [], 'Cleared legacy recents must not reappear from old global preferences');
storage.set(projectStorageKey('maps', b), '[]');
assert.deepEqual(readProjectMapPrefs(b), {});
storage.set(projectStorageKey('maps', b), '{broken');
assert.deepEqual(readProjectMapPrefs(b), {});

assert.deepEqual(unsavedProjectTools({ __studio: { state: { dirty: true } }, __texedit: { state: { dirty: true } }, __characters: { dirty: true } }), ['Animator', 'Texture Editor', 'Character Creator']);
assert.deepEqual(unsavedProjectTools({ __studio: { state: { dirty: false } } }), []);
assert.equal(isCustomProject(a), true); assert.equal(isCustomProject(legacy), false);
assert.equal(isTrainingProject({ kind: 'tutorial' }), true); assert.equal(isTrainingProject({ kind: 'training' }), true);
assert.equal(isTrainingProject(a), false);
assert.equal(trainingProjectId(null), null);
assert.equal(trainingProjectId({id:'deusex-story',kind:'original'}),'training-revision');
assert.equal(trainingProjectId({id:'deusex-goty',kind:'original',target:'vanilla'}),'training-vanilla');
assert.equal(trainingProjectId({id:'my-vanilla-campaign',kind:'custom',target:'vanilla'}),'training-vanilla');
assert.equal(projectFolder('Warehouse campaign', 'C:\\DeusEdix\\Projects\\'), 'C:\\DeusEdix\\Projects\\Warehouse campaign');
assert.equal(projectFolder('A: new/campaign. ', 'C:\\Projects'), 'C:\\Projects\\A_ new_campaign');
assert.equal(projectFolder('Campaign', '/projects/'), '/projects/Campaign');
assert.equal(projectFolder('', 'C:\\Projects'), '');
console.log('Project UI helpers: storage isolation, legacy migration, dirty tools and folder paths passed');

// A covered editor can still receive window capture shortcuts. Verify the hub
// intercepts those while preserving default input behavior and prior inert state.
class Element {
  constructor(tagName = 'DIV') { this.tagName = tagName.toUpperCase(); this.inert = false; this.hidden = false; this.value = ''; this.nodes = new Map(); }
  setAttribute() {}
  querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key); }
  querySelectorAll() { return []; }
  closest() { return null; }
  addEventListener() {}
  focus() {}
  contains(target) { return target === this || [...this.nodes.values()].includes(target); }
}
const editor = new Element(), previouslyInert = new Element(), menubar = new Element(), top = new Element();
previouslyInert.inert = true; menubar.id = 'menubar'; top.id = 'top'; top.nodes.set('#menubar', menubar);
const body = { children: [editor, previouslyInert, top], appendChild(el) { this.children.push(el); }, classList: { add() {}, remove() {} },
  addEventListener() {} };                // the Mods section listens for a .dxmod dropped on the page
globalThis.fetch = async () => ({ ok: true, json: async () => ({ mods: [] }) });   // and asks for the installed mods
const events = new Map(), visibility = [];
globalThis.document = { body, head: { appendChild() {} }, createElement: tag => new Element(tag), getElementById() { return null; } };
globalThis.window = { __projectContext: a, addEventListener(type, handler, capture) {
  assert.equal(capture, true); events.set(type, handler);
} };
const hub = createProjectHub({ confirmLeave: async () => true, onVisibility: value => visibility.push(value) });
hub.show(); hub.show();
assert.equal(editor.inert, true); assert.equal(menubar.inert, false);
assert.equal(top.inert, false, 'The top bar containing the menus must remain usable in Projects');
for (const [type, key] of [['keydown', 'Delete'], ['keydown', 'k'], ['keydown', 'Enter'], ['keydown', 'Tab'], ['keyup', 'w'], ['paste', '']]) {
  let stopped = false, prevented = false;
  events.get(type)({ key, target: new Element('input'), stopImmediatePropagation() { stopped = true; }, preventDefault() { prevented = true; } });
  assert.equal(stopped, true, `${type} ${key} must not reach hidden tool shortcuts`);
  assert.equal(prevented, false, `${type} ${key} retains text input/form/default browser behavior`);
}
hub.hide();
assert.equal(editor.inert, false, 'Back restores the usable map');
assert.equal(previouslyInert.inert, true, 'Back must not activate controls that were disabled before the hub');
assert.deepEqual(visibility, [true, true, false]);
let stopped = false;
events.get('keydown')({ key: 'Delete', stopImmediatePropagation() { stopped = true; } });
assert.equal(stopped, false, 'Editor shortcuts resume after Back');
console.log('Project hub: capture shortcuts, default form input and background restoration passed');
