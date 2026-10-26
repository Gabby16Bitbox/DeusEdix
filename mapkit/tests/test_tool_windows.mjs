import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// attachToolWindow (tool-window.js) only adds the maximize button before a tool window's close button: each window
// wires its own Close. Scripts once had none (its Close did nothing).
const dir = new URL('../editor/static/', import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'tool-window.js');

test('every tool window wires the close button it gives attachToolWindow', () => {
  let windows = 0;
  for (const f of files) {
    const source = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of source.matchAll(/attachToolWindow\(([^;]*)\);/g)) {
      const close = m[1].match(/\$\((['"`])(.+?)\1/g)?.at(-1)?.slice(3, -1);     // the last $('...') given: the button
      assert.ok(close, `${f}: no close button in ${m[0]}`);
      const sel = close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(source, new RegExp(`\\$\\((['"\`])${sel}\\1[^)]*\\)\\.(onclick\\s*=|addEventListener\\(\\s*['"]click)`),
        `${f}: ${close} is never wired to close the window`);
      windows++;
    }
  }
  assert.ok(windows >= 5, 'the tool windows were found');
});
