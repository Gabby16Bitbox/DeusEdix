import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../editor/static/play-state.js', import.meta.url), 'utf8');
const { parsePlayStates, updatePlayState, removePlayState, appendPlayState, mountPlayStates } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const values = text => parsePlayStates(text).map(({ flag, is }) => ({ flag, is }));

test('legacy values follow the play backend, including case-sensitive false aliases', () => {
  assert.deepEqual(values('A B=0;C=false\nD=False\tE=no F=FALSE G=off H=anything I='), [
    { flag: 'A', is: true }, { flag: 'B', is: false }, { flag: 'C', is: false },
    { flag: 'D', is: false }, { flag: 'E', is: false }, { flag: 'F', is: true },
    { flag: 'G', is: true }, { flag: 'H', is: true }, { flag: 'I', is: true },
  ]);
});

test('editing one test state preserves raw flags, whitespace, ordering, and duplicate overrides', () => {
  const raw = '  Talked=0;\nDoor=on,invalid-name=1\tTalked=False ; Other = 0';
  assert.equal(updatePlayState(raw, 2, { flag: 'Talked', is: true }),
    '  Talked=0;\nDoor=on,invalid-name=1\tTalked=1 ; Other = 0');
  assert.deepEqual(values(raw).slice(0, 3), [
    { flag: 'Talked', is: false }, { flag: 'Door', is: true }, { flag: 'Talked', is: false },
  ]);
});

test('removing a row keeps unrelated legacy tokens byte-for-byte', () => {
  const raw = 'First=1 ,\tSecond=0;odd-token=yes\nFirst=0';
  assert.equal(removePlayState(raw, 1), 'First=1 ,\t;odd-token=yes\nFirst=0');
  assert.equal(removePlayState(raw, 20), raw);
});

test('new overrides append after previous overrides so the latest value wins', () => {
  assert.equal(appendPlayState('Flag=0', { flag: 'Flag', is: true }), 'Flag=0, Flag=1');
  assert.equal(appendPlayState('Flag=0;\n', { flag: 'Second', is: false }), 'Flag=0;\nSecond=0');
  assert.equal(appendPlayState('', { flag: 'First', is: true }), 'First=1');
});

test('legacy Unicode and numeric names are preserved as the backend accepts them', () => {
  const raw = 'Étage=0, 123=yes, 任務=no';
  assert.deepEqual(values(raw), [{ flag: 'Étage', is: false }, { flag: '123', is: true }, { flag: '任務', is: false }]);
  assert.equal(updatePlayState(raw, 0, { flag: 'Étage', is: true }), 'Étage=1, 123=yes, 任務=no');
});

test('blank or malformed new names cannot silently become test overrides', () => {
  for (const flag of ['', ' ', 'One Two', 'A=0', 'A,B']) {
    assert.throws(() => appendPlayState('Existing=1', { flag, is: false }), /Choose a state/);
  }
  assert.throws(() => updatePlayState('', 0, { flag: 'New', is: true }), /no longer available/);
});

test('structured controls and Advanced edit the same play-test payload', () => {
  const previousDocument = globalThis.document;
  const element = () => ({ children: [], style: {}, append(...nodes) { this.children.push(...nodes); },
    replaceChildren() { this.children = []; }, setAttribute() {} });
  globalThis.document = { createElement: element };
  try {
    const input = element(), list = element(), add = element(), calls = [];
    const host = { querySelector: selector => ({ '#pflags': input, '[data-play-state-list]': list, '[data-play-state-add]': add })[selector] };
    const controller = mountPlayStates(host, { value: 'First=0 ; Legacy=off', mountField: (node, value, options) => {
      const handle = { value, options, destroyed: false, opened: false,
        destroy() { this.destroyed = true; }, open() { this.opened = true; } };
      calls.push(handle); return handle;
    } });
    assert.equal(controller.value, 'First=0 ; Legacy=off');
    calls[0].options.onChange({ flag: 'First', is: true });
    assert.equal(controller.value, 'First=1 ; Legacy=off');
    assert.equal(calls[0].destroyed, true);
    input.value = ' Raw=no\nRepeat=1;Repeat=0 '; input.oninput();
    assert.equal(controller.value, input.value);
    assert.deepEqual(calls.slice(-3).map(call => call.value), [
      { flag: 'Raw', is: false }, { flag: 'Repeat', is: true }, { flag: 'Repeat', is: false },
    ]);
    add.onclick();
    assert.equal(calls.at(-1).opened, true);
    calls.at(-1).options.onChange({ flag: 'Added', is: false });
    assert.equal(controller.value, ' Raw=no\nRepeat=1;Repeat=0 Added=0');
    controller.destroy(); assert.equal(calls.at(-1).destroyed, true);
  } finally { globalThis.document = previousDocument; }
});
