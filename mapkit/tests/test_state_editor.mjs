import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const modelSource = await readFile(new URL('../editor/static/state-model.js', import.meta.url), 'utf8');
const modelURL = 'data:text/javascript;base64,' + Buffer.from(modelSource).toString('base64');
const { fateCode, fateFlag, parseFate, stateLabel, FATE_PREDICATES, normalizeCatalog, filterCatalog, applyStateValue } = await import(modelURL);

assert.equal(fateCode('01_NYC_UNATCOIsland'), fateCode('01_nyc_unatcoisland'));
assert.equal(fateFlag('Warehouse', 'Guard_2', 'KO'), `UCFate${fateCode('Warehouse')}_Guard_2_KO`);
assert.deepEqual(parseFate('UCFateabcdef_Guard_2_Down'), { code: 'abcdef', actor: 'Guard_2', kind: 'Down', map: '' });
assert.equal(parseFate('Quest_Down'), null);
assert.equal(parseFate(fateFlag('Warehouse', 'Guard_2', 'KO'), ['Warehouse']).map, 'Warehouse');
assert.equal(new Set(FATE_PREDICATES.map(p => p.id)).size, 6);
assert.equal(stateLabel({ flag: 'UCFateabcdef_Guard_2_Down', is: false }), 'Guard_2 · Not killed or knocked out');
assert.equal(stateLabel('UCFateabcdef_Guard_2_Dead', false), 'Guard_2 · Was not killed');
assert.ok(FATE_PREDICATES.every(p => !/alive/i.test(p.label)), 'Negative death predicates must not imply alive or conscious');

const catalog = normalizeCatalog([
  'GateOpen', { flag: 'GateOpen', label: 'Gate unlocked', uses: [{ map: 'A' }, { map: 'B' }] },
  { name: 'MissionIndex', category: 'original', type: 'int', references: [1] },
  { name: 'RadioComplete', source: 'InfoLink completion' },
  { name: 'UCFateabcdef_Guard_2_Dead', source: 'watcher' },
]);
assert.equal(catalog.length, 4);
assert.equal(catalog.find(row => row.name === 'GateOpen').uses, 2);
assert.equal(catalog.find(row => row.name === 'MissionIndex').selectable, false);
assert.deepEqual(catalog.find(row => row.name === 'GateOpen').references, [{ map: 'A' }, { map: 'B' }]);
const merged = normalizeCatalog([
  { name: 'Money', label: 'Credits', description: 'An original integer', source: 'Original game', type: 'integer', uses: [{ map: 'A', id: 'read' }] },
  { name: 'money', references: [{ id: 'read', map: 'A' }, { map: 'B', id: 'write' }] },
  'Money',
]);
assert.equal(merged[0].type, 'integer', 'A name-only reference cannot downgrade a numeric flag to boolean');
assert.equal(merged[0].selectable, false);
assert.equal(merged[0].label, 'Credits'); assert.equal(merged[0].source, 'Original game');
assert.equal(merged[0].uses, 2);
assert.deepEqual(merged[0].references, [{ map: 'A', id: 'read' }, { map: 'B', id: 'write' }], 'Usage details survive merging and equivalent reference objects are deduplicated');
assert.equal(filterCatalog(catalog, 'gate unlocked', 'story').length, 1);
assert.equal(filterCatalog(catalog, '', 'character').length, 1);
assert.equal(filterCatalog(catalog, '', 'dialogue').length, 1);
assert.deepEqual(normalizeCatalog([{ name: 'Opening_Played' }, { name: 'Briefing_Heard' }, { name: 'ConversationDone', source: 'automatic' }]).map(row => row.category), ['dialogue', 'dialogue', 'dialogue']);
const payload = { flag: 'DoorOpen', is: true, expiration: 11, custom: { preserve: true } };
assert.equal(applyStateValue(payload, { flag: 'DoorClosed', is: false, expiration: 99, custom: 'overwritten' }), payload);
assert.deepEqual(payload, { flag: 'DoorClosed', is: false, expiration: 11, custom: { preserve: true } });
assert.throws(() => applyStateValue(payload, { flag: 'Valid', is: true, expiration: -1 }, { expiration: true }));
assert.equal(payload.flag, 'DoorClosed', 'Invalid multi-field change is atomic');
assert.throws(() => applyStateValue(payload, { flag: 'wrong name' }));
applyStateValue(payload, { flag: '' }, { allowEmpty: true }); assert.equal(payload.flag, '');
console.log('State model: exact fate semantics, map identity, catalog types and lossless atomic patches passed');

// Small DOM surface: exercise the same event handlers used by the real chooser.
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.dataset = {}; this.value = ''; this.textContent = ''; this.disabled = false; this.hidden = false; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(type, callback, options) { const callbacks = this.listeners.get(type) || []; callbacks.push({ callback, once: options?.once }); this.listeners.set(type, callbacks); }
  dispatch(type) { for (const item of [...(this.listeners.get(type) || [])]) { item.callback({ target: this, stopPropagation() {} }); if (item.once) this.listeners.set(type, this.listeners.get(type).filter(x => x !== item)); } }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { document.activeElement = this; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  getBoundingClientRect() { return { left: 0, right: 600, top: 0, bottom: 600 }; }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
const text = node => node.textContent + node.children.map(text).join(' ');
const body = new Element('body'), head = new Element('head');
globalThis.document = { body, head, activeElement: null, createElement: tag => new Element(tag), getElementById: id => [...descendants(head), ...descendants(body)].find(node => node.id === id) };
const source = (await readFile(new URL('../editor/static/state-editor.js', import.meta.url), 'utf8')).replaceAll("'./state-model.js'", JSON.stringify(modelURL));
const { configureStateEditor, mountStateField } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const dialog = () => descendants(body).find(node => node.tagName === 'DIALOG');
const find = (root, predicate) => descendants(root).find(predicate);
const byLabel = (root, label) => find(root, node => node.getAttribute('aria-label') === label);
const byText = (root, label) => find(root, node => node.tagName === 'BUTTON' && text(node) === label);
let peopleCalls = 0;
configureStateEditor({ getCatalog: async () => catalog, getMaps: async () => ['Warehouse'], getCurrentMap: () => 'Warehouse', getPeople: async () => { peopleCalls++; return [{ name: 'FirstGuard', label: 'First guard' }]; } });
const host = new Element('div'); body.append(host);
const original = { flag: 'UCFateabcdef_MissingGuard_Down', is: false, expiration: 7, imported: { originalPackage: 'Revision' } };
let changes = 0, callbackObject;
let field = mountStateField(host, original, { mode: 'set', onChange: value => { changes++; callbackObject = value; } });
assert.equal(changes, 0);
assert.ok(text(host).includes('does not kill, knock out or revive'));
assert.equal(byLabel(host, 'Technical flag ID').value, original.flag);
assert.equal(find(host, node => node.type === 'number'), undefined, 'Imported expiration is preserved but not exposed unless the caller allows it');
const openCancelled = field.open(); await tick();
assert.equal(byLabel(dialog(), 'Character map').value, '@abcdef');
assert.equal(byLabel(dialog(), 'Character actor name').value, 'MissingGuard');
assert.equal(byLabel(dialog(), 'Character state').value, 'Down:false');
assert.equal(peopleCalls, 0, 'Unresolved map identity must not be replaced by the current map or first character');
byLabel(dialog(), 'Character actor name').value = 'Uncommitted';
byText(dialog(), 'Cancel').click(); await openCancelled;
assert.equal(changes, 0); assert.equal(original.flag, 'UCFateabcdef_MissingGuard_Down');
const openCommitted = field.open(); await tick();
const predicate = byLabel(dialog(), 'Character state'); predicate.value = 'Dead:false'; predicate.dispatch('change');
byText(dialog(), 'Use state').click(); await openCommitted;
assert.equal(original.flag, 'UCFateabcdef_MissingGuard_Dead'); assert.equal(original.is, false);
assert.equal(original.expiration, 7); assert.deepEqual(original.imported, { originalPackage: 'Revision' });
assert.equal(callbackObject, original); assert.equal(changes, 1);
field.destroy();

const regular = { flag: 'GateOpen', is: false, provenance: 'keep' };
field = mountStateField(host, regular, { mode: 'check', allowEmpty: true, onChange: () => { changes++; } });
const opened = field.open(); await tick();
const numeric = find(dialog(), node => node.tagName === 'BUTTON' && text(node).includes('MissionIndex'));
assert.equal(numeric.disabled, true); numeric.click(); assert.ok(dialog(), 'Integer flags cannot be selected as booleans');
const search = byLabel(dialog(), 'Search states'); search.value = 'NewStoryFlag'; search.dispatch('input');
assert.equal(regular.flag, 'GateOpen', 'Typing a new flag is still a draft');
byText(dialog(), 'Use new story flag “NewStoryFlag”').click(); await opened;
assert.deepEqual(regular, { flag: 'NewStoryFlag', is: false, provenance: 'keep' });
assert.equal(changes, 2);
const empty = field.open(); await tick(); byText(dialog(), 'No condition').click(); await empty;
assert.equal(regular.flag, ''); assert.equal(regular.is, false);
field.destroy();
const detachedValue = { flag: 'BeforeSwitch', is: true };
field = mountStateField(host, detachedValue, { onChange: () => { throw new Error('Detached control committed a stale map edit'); } });
const detachedChooser = field.open(); await tick();
const detachedSearch = byLabel(dialog(), 'Search states'); detachedSearch.value = 'AfterSwitch'; detachedSearch.dispatch('input');
host.isConnected = false;
byText(dialog(), 'Use new story flag “AfterSwitch”').click(); await detachedChooser;
assert.deepEqual(detachedValue, { flag: 'BeforeSwitch', is: true });
assert.equal(field.open(), undefined, 'Detached fields cannot open a new chooser');
field.destroy(); delete host.isConnected;
console.log('State editor: cancel, unresolved character references, exact predicates, typed flags and metadata preservation passed');
