// The Hierarchy as renderHierarchy draws it (static/app.js, run as it is): a folder for each row of the 3D view's Show
// menu, whose eye and padlock cover every row it lists, the drawings with the blocks; the search inside folders,
// structures and their pieces, with - words; a folder with a locked kind in it still dragged and deleted as one; the
// search ends with its map.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { projectStorageKey } from '../editor/static/projects.js';
import { createSceneVisibility } from '../editor/static/scene-visibility.js';
import { HIER_FOLDERS, ICON_KINDS, SHOW_KINDS, SHOW_KIND, KIND_STATES, classKind, showKindOf, createKindFilter } from '../editor/static/scene-kinds.js';
import { parseSearch, searchMatcher, folderSearch, typesOf, assetsOf } from '../editor/static/scene-search.js';
import { defaultFolder } from '../editor/static/hierarchy-folders.js';
import { DRAW_LABELS } from '../editor/static/draw-tools.js';
import { linkOf } from '../editor/static/prefab-links.js';

const source = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const stateSource = source.slice(source.indexOf('function keyOf(o)'), source.indexOf('const nestById ='));
const body = (name) => { const start = source.indexOf(`function ${name}(`); assert.ok(start >= 0, name); return source.slice(start, source.indexOf('\n}', start) + 2); };
const line = (start) => { const i = source.indexOf(start); assert.ok(i >= 0, start); return source.slice(i, source.indexOf('\n', i)); };
// the Hierarchy's icons: the kinds' colours, symbols and names
const iconSource = source.slice(source.indexOf('const KIND_COLOR ='), source.indexOf('function lightColor('))
  + source.slice(source.indexOf('function hierColor(kind)'), source.indexOf('function npcDisposition('));
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// an object of the map: its name, class, kind and the label the Hierarchy shows
const thing = (name, cls, kind, label = name) => ({ userData: { actor: { name, cls, kind, props: {}, label }, kind, source: 'map' }, visible: true });

function fixture() {
  const storage = new Map(), el = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null }, search = { value: '' };
  const objects = [thing('Hale', 'ScientistMale', 'pawn'), thing('Lamp1', 'Light', 'light', 'Lamp'), thing('Crate1', 'CrateUnbreakableSmall', 'prop', 'Crate'),
    thing('Trig1', 'Trigger', 'logic'), thing('Amb1', 'AmbientSound', 'logic'), thing('Amb2', 'RevAmbientSound', 'logic'), thing('Zone1', 'ZoneInfo', 'logic'),
    thing('Cut1', 'UCCutscene', 'logic'), thing('Cam1', 'SecurityCamera', 'prop'),
    thing('Crate2', 'CrateUnbreakableSmall', 'prop', 'Crate'), thing('Lamp2', 'Light', 'light', 'Lamp'),           // in the structure
    thing('Crate3', 'CrateUnbreakableSmall', 'prop', 'Crate'), thing('Lamp3', 'Light', 'light', 'Lamp'),            // in the folder
    thing('Desk4', 'OfficeDesk', 'prop', 'Desk')];                                                                  // in the folder's structure
  const room = { userData: { kind: 'structure', name: 'Room' }, visible: true }, booth = { userData: { kind: 'structure', name: 'Booth' }, visible: true };
  const proxies = { children: objects }, group = { userData: { kind: 'group' }, members: [] };
  const c = vm.createContext({
    script: 'test-map', projectContext: { id: 'legacy', kind: 'legacy' }, projectStorageKey, temporaryTutorial: () => false,
    buildJob: null, waitsForRebuild: () => false,       // no Rebuild running (rebuildMap)
    edits: { props: {}, nests: [{ id: 'n1', label: 'Office', items: ['a:Crate3', 'a:Lamp3', 's:Booth'] }], boxes: [], added: [] },
    selected: null, groupPivot: group, members: () => group.members, proxies, actorStruct: { Crate2: 'Room', Lamp2: 'Room', Desk4: 'Booth' },
    structures: { Room: { name: 'Room', label: 'Storeroom', obj: room, category: 'Building', pieces: [{ id: 'p1', label: 'Crate stack' }, { id: 'p2', label: 'Wall' }] },
      Booth: { name: 'Booth', label: 'Booth', obj: booth, category: 'Building', pieces: [{ id: 'p3', label: 'Panel' }] } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    poseOf: () => ({ deleted: false }), proxyOf: (name) => objects.find((p) => p.userData.actor?.name === name),
    isStruct: (p) => p?.userData.kind === 'structure', nests: () => c.edits.nests,
    parentNest: (key) => c.edits.nests.find((n) => n.items.includes(key)), nestById: (id) => c.edits.nests.find((n) => n.id === id),
    nestLeaves: (n) => (n?.items || []).map((k) => c.objOf(k)).filter(Boolean), piecesInside: (st) => st.pieces,
    tc: { detach() {} }, outline: {}, lightRange: {}, soundRange: {}, triggerZone: {}, anim: null, vpBar: null, showIcons: true,
    select() {}, buildHierarchy() {}, showDetails() {}, status() {}, wake() {}, setViewportIconSize() {}, showDefaultFolderBar() {},
    createSceneVisibility, HIER_FOLDERS, ICON_KINDS, SHOW_KINDS, SHOW_KIND, KIND_STATES, showKindOf, createKindFilter,
    parseSearch, searchMatcher, folderSearch, typesOf, assetsOf, defaultFolder, escapeHtml,
    $: (sel) => (sel === '#hier' ? el : sel === '#hsearch' ? search : null),
    searchContext: (picked) => ({ picked, refs: () => [], played: () => [], classMesh: () => '' }),
    searchView: { active: false, show: (list) => { c.bright = list; } },
    hierLabel: (a) => a.label, blockLabel: (b) => b.name, DRAW_LABELS, classKind, npcDisposition: () => 'neutral', hasOriginalConversations: () => false,
    actorProp: () => undefined, unquote: (s) => s, hierRank: () => new Map(), CATS: [],
    ICON: { trash: '', eye: '', eyeoff: '', lock: '', unlock: '' }, IS_TESTS: {}, chainNow: {},
    tagOf: () => '', eventOf: () => '', texturesOf: () => [], meshOf: () => '',
    hierOpen: new Set(), hierItems: [], hierTimer: 0, hierarchyDragging: false, hierRenaming: false, hierFolderOn: null, hierFlash: null,
    linkOf, prefabBrowser: { cached: () => c.library },       // linked prefabs: the library's list as last read
  });
  vm.runInContext(stateSource + '\n' + iconSource + '\n' + line('function pasteEntry(') + '\n'
    + ['objectLabel', 'hierarchyIcon', 'searchFacts', 'prefabOfCopy', 'prefabBadge', 'renderHierarchy'].map(body).join('\n'), c);
  c.draw = (query = '') => { search.value = query; c.renderHierarchy(); return el.innerHTML; };
  return c;
}
// the kind folders drawn: {row id: {kinds: what its eye and padlock set, rows: the keys of what it lists}}
function kindFolders(html) {
  const out = {};
  for (const m of html.matchAll(/<details data-hk="k:(\w+)"[^>]*>([\s\S]*?)<\/details>/g)) {
    const [summary, rows] = m[2].split('</summary>');
    out[m[1]] = { kinds: [...new Set([...summary.matchAll(/data-kind="(\w+)"/g)].map((x) => x[1]))], rows: [...rows.matchAll(/data-key="([^"]+)"/g)].map((x) => x[1]) };
  }
  return out;
}
const lists = (html, key) => html.includes(`data-key="${key}"`);
// the row of a key, as drawn (a row's icon and buttons have no div of their own)
const rowHtml = (html, key) => new RegExp(`<div class="hrow[^"]*"[^>]*data-key="${key}"[\\s\\S]*?</div>`).exec(html)?.[0] || '';

test('a folder for each row of the Show menu: its eye and padlock are that row\'s, and cover every row it lists', () => {
  const c = fixture(), folders = kindFolders(c.draw());
  assert.deepEqual(Object.keys(folders), ['pawn', 'light', 'prop', 'logic', 'sound', 'camera', 'zone']);   // the menu's order
  for (const [id, f] of Object.entries(folders)) {
    assert.deepEqual(f.kinds, [id], id);
    for (const key of f.rows) assert.equal(c.sceneKindOf(c.objOf(key)), id, key);
  }
  assert.deepEqual(folders.logic.rows, ['a:Trig1']);
  assert.deepEqual(folders.sound.rows, ['a:Amb1', 'a:Amb2']);
  assert.deepEqual(folders.camera.rows, ['a:Cam1', 'a:Cut1']);
  assert.deepEqual(folders.prop.rows, ['a:Crate1']);
  // the Triggers and logic folder's eye hides all it lists, and nothing it does not
  c.setKindView('logic', 'hidden', true);
  assert.deepEqual(c.proxies.children.filter((p) => !p.visible).map((p) => p.userData.actor.name), ['Trig1']);
  assert.equal(c.kindFolder(c.objOf('a:Amb1')), 'k:sound');                     // where the drag and a selection look for it
});

test('the search in folders and structures: a - word leaves out what it finds wherever it is', () => {
  const c = fixture();
  const shown = (query) => { const html = c.draw(query); return ['Crate1', 'Crate2', 'Crate3', 'Lamp1', 'Lamp2', 'Lamp3'].filter((n) => lists(html, 'a:' + n)); };
  assert.deepEqual(shown('-crate'), ['Lamp1', 'Lamp2', 'Lamp3']);
  assert.deepEqual([...c.bright].map((p) => p.userData?.actor?.name || p.userData.name).filter((n) => /Crate|Lamp/.test(n)).sort(),
    ['Lamp1', 'Lamp2', 'Lamp3'], 'the 3D view keeps bright what is listed');
  let html = c.draw('-crate');
  assert.ok(html.includes('data-piece="Room|p2"') && !html.includes('data-piece="Room|p1"'), 'the pieces too');
  assert.deepEqual(shown('office'), ['Crate3', 'Lamp3']);                   // a word of a folder's name: all it holds
  assert.deepEqual(shown('storeroom -crate'), ['Lamp2']);                   // all a structure holds but the crates
  html = c.draw('storeroom -crate');
  assert.ok(html.includes('data-piece="Room|p2"') && !html.includes('data-piece="Room|p1"'));
  assert.deepEqual(shown('t:light'), ['Lamp1', 'Lamp2', 'Lamp3']);
  assert.deepEqual(shown('t=object'), ['Crate1', 'Crate2', 'Crate3']);
});

test('a folder with a locked kind in it is still dragged and deleted as one; an object\'s own padlock still holds it', () => {
  const c = fixture(), nestRow = () => /<summary class="hnest[^"]*"[^>]*>/.exec(c.draw())[0], bin = () => /data-nd="n1"[^>]*>/.exec(c.draw())[0];
  c.setKindView('light', 'locked', true);
  assert.match(nestRow(), /draggable="true"/);
  assert.doesNotMatch(bin(), /disabled/);
  c.setObjectView(['a:Lamp3'], 'locked', true);
  assert.match(nestRow(), /draggable="false"/);
  assert.match(bin(), /disabled/);
});

test('a drawing is listed with the blocks or in its folder: its icon, kind and name, its own eye and padlock, the search', () => {
  const c = fixture();
  c.proxies.children.push({ userData: { drawn: { name: 'UCDrawn0', kind: 'wall' }, kind: 'drawn', source: 'drawn' }, visible: true });
  let html = c.draw();
  assert.deepEqual(kindFolders(html).box.rows, ['d:UCDrawn0'], 'under Blocks, whose eye and padlock hide and lock it');
  let row = rowHtml(html, 'd:UCDrawn0');
  assert.match(row, /role="img" aria-label="Block"/, 'the blocks\' icon');
  assert.match(row, /<span class="hl">Wall<\/span><small>UCDrawn0<\/small>/, 'its kind and its name');
  assert.match(row, /data-view-key="d:UCDrawn0" data-view-state="hidden"/);
  assert.match(row, /draggable="true"/);
  c.setObjectView(['d:UCDrawn0'], 'locked', true);
  row = rowHtml(c.draw(), 'd:UCDrawn0');
  assert.match(row, /draggable="false"/);
  assert.match(row, /aria-pressed="true" aria-label="Unlock selection"/);
  c.setObjectView(['d:UCDrawn0'], 'locked', false);
  c.setKindView('box', 'hidden', true);
  assert.equal(c.objOf('d:UCDrawn0').visible, false);
  assert.match(rowHtml(c.draw(), 'd:UCDrawn0'), /hier-hidden/, 'greyed with its kind');
  c.setKindView('box', 'hidden', false);
  c.edits.nests[0].items.push('d:UCDrawn0');                       // in a folder (New objects go here): listed there
  html = c.draw();
  assert.equal(kindFolders(html).box, undefined);
  assert.match(rowHtml(html, 'd:UCDrawn0'), /data-in="n1"/);
  for (const query of ['t:block', 't=block', 'wall', 'UCDrawn0', 'office']) assert.ok(lists(c.draw(query), 'd:UCDrawn0'), query);
  for (const query of ['t:light', '-wall', '-t:block']) assert.ok(!lists(c.draw(query), 'd:UCDrawn0'), query);
  c.draw('wall');
  assert.ok(c.bright.has(c.objOf('d:UCDrawn0')), 'bright in the 3D view while it is listed');
});

test('a folder found by its name lists the structures it holds, with what they hold, but what a - word leaves out', () => {
  const c = fixture();
  let html = c.draw('office');
  assert.ok(lists(html, 's:Booth') && lists(html, 'a:Desk4') && html.includes('data-piece="Booth|p3"'));
  assert.ok(c.bright.has(c.structures.Booth.obj));
  html = c.draw('office -desk');
  assert.ok(lists(html, 's:Booth') && !lists(html, 'a:Desk4') && html.includes('data-piece="Booth|p3"'));
  html = c.draw('booth');                                           // the structure by its own name, in the folder
  assert.ok(lists(html, 'a:Desk4') && !lists(html, 'a:Crate3'));
});

test('- words alone list no folder or structure they leave empty; a folder found by its name stays', () => {
  const c = fixture();
  let html = c.draw('-crate -t:light -desk -panel');
  assert.ok(!html.includes('data-hk="n:n1"'), 'the folder left empty');
  assert.ok(!html.includes('data-hk="s:Booth"'), 'the structure left empty');
  assert.ok(html.includes('data-hk="s:Room"') && html.includes('data-piece="Room|p2"'), 'a structure with something left in it');
  html = c.draw('office -crate -t:light -desk -panel');
  assert.ok(html.includes('data-hk="n:n1"') && html.includes('data-hk="s:Booth"'), 'found by its name: listed, empty');
});

test('the search ends with its map: another map opened empties the box and the 3D view is bright again', async () => {
  const calls = [];
  const c = vm.createContext({ mapLoading: false, temporaryTutorial: () => false, tutorialSession: { revision: 0 }, busy() {},
    api: async () => ({ script: 'B', map: 'B' }), TUTORIAL_SCRIPT: 'deusedix_tutorial', isTrainingProject: () => false, projectContext: {},
    textureTransfer: null, textureSlip: null, surfaceTexturePreview: null, texturePreviewInfo: new Map(), texturePreviewPending: new Set(), window: {},
    closeAnim() {}, stopPreview() {}, resetInput() {}, cancelPlacing() {}, soundBrowser: null, endAimPick() {}, script: 'A',
    sceneView: { reset: () => calls.push('isolate ends') }, searchBox: { clear: () => calls.push('box emptied') },
    searchView: { show: (list) => calls.push(['3D view', list]) }, PACKAGE: '', MODELS_PKG: '',
    EMPTY: () => { throw new Error('the rest of the map is not this test\'s'); }, log() {}, status() {}, startScreen: null });
  vm.runInContext(line('function endMapSearch()') + '\nasync ' + body('loadScene'), c);
  assert.equal(await c.loadScene('B'), false);                     // stopped by the stand-in after the search
  assert.deepEqual(calls, ['isolate ends', 'box emptied', ['3D view', null]]);
  calls.length = 0;
  await c.loadScene('B');                                           // the same map again (a Rebuild): the search stays
  assert.deepEqual(calls, []);
});

test('a copy of a prefab of the library has a badge: its version, an older one, a prefab deleted', () => {
  const c = fixture(), V1 = 'usr_11111111111111111111111111111111', V2 = 'usr_22222222222222222222222222222222';
  c.edits.prefabs = [{ pid: 'p1', prefab: V1, label: 'Desk' }, { pid: 'p2', prefab: 'obj_pipe', label: 'Pipe' }];
  for (const pid of ['p1', 'p2']) c.structures['paste~' + pid] = { name: 'paste~' + pid, label: pid, paste: true, category: 'Pasted', pieces: [],
    obj: { userData: { kind: 'structure', name: 'paste~' + pid }, visible: true } };
  const badge = (html, pid) => new RegExp(`data-key="s:paste~${pid}"[^>]*>[\\s\\S]*?(<span class="prefab-badge[^"]*"[^>]*>[^<]*</span>)?<small>`).exec(html)[1] || '';
  c.library = null;                                          // the list is being read: the version, nothing more
  assert.match(badge(c.draw(), 'p1'), /class="prefab-badge" title="A copy of the prefab Desk, version 1">v1</);
  assert.equal(badge(c.draw(), 'p2'), '', 'a piece of the Pieces is not linked');
  c.library = [{ id: V2, line: V1, version: 2, label: 'Office desk' }];
  assert.match(badge(c.draw(), 'p1'), /class="prefab-badge old" title="A copy of the prefab Office desk, version 1: version 2 is in the library[^"]*">v1 ↑</);
  c.edits.prefabs[0] = { pid: 'p1', prefab: V2, line: V1, version: 2, label: 'Desk' };
  assert.match(badge(c.draw(), 'p1'), /class="prefab-badge" title="A copy of the prefab Office desk, version 2">v2</);
  c.library = [];
  assert.match(badge(c.draw(), 'p1'), /class="prefab-badge gone" title="A copy of a prefab no longer in the library/);
  c.edits.prefabs[0].unpacked = true;
  assert.equal(badge(c.draw(), 'p1'), '', 'unpacked: no badge');
});
