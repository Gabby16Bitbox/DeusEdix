import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../editor/static/menubar.js', import.meta.url), 'utf8');
const autosaveSource = await readFile(new URL('../editor/static/autosave.js', import.meta.url), 'utf8');
const { normalizeAutosaveSettings } = await import('data:text/javascript;base64,' + Buffer.from(autosaveSource).toString('base64'));

class Element {
  constructor(tag = 'div', attrs = '') {
    this.tagName = tag.toUpperCase();
    this.attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match => [match[1], match[2] ?? '']));
    this.dataset = Object.fromEntries(Object.entries(this.attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value]));
    this.type = this.attributes.type || '';
    this.value = this.attributes.value || '';
    this.checked = 'checked' in this.attributes;
    this.disabled = 'disabled' in this.attributes;
    this.listeners = new Map();
    this.children = [];
    this.classList = { add() {}, remove() {}, contains: () => false };
    this.parentElement = { querySelector: () => null };
  }
  set innerHTML(html) {
    this.html = html;
    this.children = [...html.matchAll(/<(input|select|button)\b([^>]*)>/g)].map(match => new Element(match[1], match[2]));
  }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(selector) {
    const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (match) return this.children.filter(el => match[1] in el.attributes && (match[2] === undefined || el.attributes[match[1]] === match[2]));
    if (selector.startsWith('.')) return this.children.filter(el => (el.attributes.class || '').split(' ').includes(selector.slice(1)));
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  change(value) {
    if (this.type === 'checkbox') this.checked = value;
    else this.value = String(value);
    this.listeners.get('change')?.();
  }
}

function setup(saved = {}) {
  const storage = new Map([['deusedix.prefs', JSON.stringify(saved)]]);
  const nodes = [], calls = [];
  const editor = { cam: {}, configureAutosave: () => calls.push('configure') };
  const document = {
    createElement: tag => new Element(tag),
    body: { appendChild: el => nodes.push(el) },
  };
  const context = vm.createContext({
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    document, window: { addEventListener() {}, dispatchEvent() {}, __editor: editor },
    $: () => ({ value: 'classic' }), ed: () => editor, normalizeAutosaveSettings,
    themes: () => [{ label: 'Deus Ex · Classic' }], keyOf: () => 'G', recording: null,
  });
  const preferences = source.slice(source.indexOf("const PREFS = 'deusedix.prefs';"), source.indexOf('\nconst desktop ='));
  const settings = source.slice(source.indexOf('const DEFAULTS ='), source.indexOf('\nfunction recordKey('));
  vm.runInContext(preferences + '\n' + settings + '\nthis.api = { openSettings, setPref, prefs, DEFAULTS };', context);
  context.api.openSettings('general');
  return {
    ...context.api, storage, calls,
    get dialog() { return nodes[0]; },
    control(name) { return nodes[0].querySelector(`[data-p="${name}"]`); },
    saved() { return JSON.parse(storage.get('deusedix.prefs')); },
  };
}

test('General settings offer enabled autosave every five minutes by default', () => {
  const app = setup();
  assert.equal(app.DEFAULTS.autosave, true);
  assert.equal(app.DEFAULTS.autosaveMinutes, 5);
  assert.equal(app.control('autosave').checked, true);
  assert.equal(app.control('autosaveMinutes').value, '5');
  assert.equal(app.control('autosaveMinutes').disabled, false);
  assert.deepEqual(['min', 'max', 'step'].map(name => app.control('autosaveMinutes').attributes[name]), ['1', '60', '1']);
  assert.match(app.dialog.innerHTML, /Saves map changes and Story\. Training is excluded\. Rebuild is separate\./);
});

test('turning autosave off disables its interval and updates the editor immediately', () => {
  const app = setup({ autosaveMinutes: 12 });
  app.control('autosave').change(false);
  assert.equal(app.prefs.autosave, false);
  assert.equal(app.saved().autosave, false);
  assert.equal(app.control('autosaveMinutes').disabled, true);
  assert.equal(Number(app.control('autosaveMinutes').value), 12);
  app.control('autosave').change(true);
  assert.equal(app.saved().autosave, true);
  assert.equal(app.control('autosaveMinutes').disabled, false);
  assert.equal(Number(app.control('autosaveMinutes').value), 12);
  assert.deepEqual(app.calls, ['configure', 'configure']);
});

test('interval input persists a normalized whole number and displays the same value', () => {
  const app = setup();
  for (const [input, expected] of [['15', 15], ['10.7', 11], ['0', 1], ['100', 60], ['', 5], ['invalid', 5], ['Infinity', 5]]) {
    app.control('autosaveMinutes').change(input);
    assert.equal(app.prefs.autosaveMinutes, expected, input);
    assert.equal(app.saved().autosaveMinutes, expected, input);
    assert.equal(Number(app.control('autosaveMinutes').value), expected, input);
  }
  assert.equal(app.calls.length, 7);
});

test('settings reopen with the saved choice and tolerate older invalid values', () => {
  const first = setup();
  first.control('autosaveMinutes').change('23');
  first.control('autosave').change(false);
  const second = setup(first.saved());
  assert.equal(second.control('autosave').checked, false);
  assert.equal(second.control('autosaveMinutes').disabled, true);
  assert.equal(second.control('autosaveMinutes').value, '23');
  for (const [value, expected] of [[-5, 1], [90, 60], ['broken', 5], [null, 5]]) {
    const app = setup({ autosaveMinutes: value });
    assert.equal(Number(app.control('autosaveMinutes').value), expected);
  }
});

test('Back to defaults restores five-minute autosave without deleting unrelated preferences', () => {
  const app = setup({ autosave: false, autosaveMinutes: 40, keys: { save: 'Ctrl+Shift+S' }, customPreference: 'keep' });
  app.dialog.querySelector('[data-resetall]').onclick();
  assert.equal(app.control('autosave').checked, true);
  assert.equal(app.control('autosaveMinutes').disabled, false);
  assert.equal(app.control('autosaveMinutes').value, '5');
  assert.equal('autosave' in app.saved(), false);
  assert.equal('autosaveMinutes' in app.saved(), false);
  assert.equal(app.saved().customPreference, 'keep');
  assert.deepEqual(app.saved().keys, { save: 'Ctrl+Shift+S' });
  assert.deepEqual(app.calls, ['configure']);
});

test('external preference updates use the same validation and notify the scheduler', () => {
  const app = setup();
  app.setPref('autosaveMinutes', '70');
  assert.equal(app.saved().autosaveMinutes, 60);
  app.setPref('autosave', false);
  assert.equal(app.saved().autosave, false);
  assert.deepEqual(app.calls, ['configure', 'configure']);
});
