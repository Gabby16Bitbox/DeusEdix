import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultLayout, fitLayout, validateLayout } from '../editor/static/workspace.js';

test('invalid persisted data falls back to a complete usable layout', () => {
  for (const value of [null, [], {}, { version: 2 }, 'broken']) assert.deepEqual(validateLayout(value), defaultLayout());
  const layout = validateLayout({ version: 1, panels: { hierarchy: { dock: 'bad', hidden: 'yes', rect: { x: -10, w: NaN } } }, sizes: { left: Infinity, bottom: -100 } });
  assert.equal(layout.panels.hierarchy.dock, 'left');
  assert.equal(layout.panels.hierarchy.hidden, false);
  assert.equal(layout.panels.hierarchy.rect.x, 0);
  assert.equal(layout.panels.hierarchy.rect.w, 360);
  assert.equal(layout.sizes.left, 208);
  assert.equal(layout.sizes.bottom, 140);
});

test('each dock gets a visible active tab even after hiding or moving the remembered tab', () => {
  const layout = defaultLayout();
  layout.panels.inspector.dock = 'left';
  layout.panels.hierarchy.hidden = true;
  layout.active.left = 'browser';
  const result = validateLayout(layout);
  assert.equal(result.active.left, 'inspector');
  assert.equal(result.active.right, null);
  assert.equal(result.active.bottom, 'browser');
  assert.deepEqual(layout.active, { left: 'browser', right: 'inspector', bottom: 'browser' });
});

test('narrow windows retain scene space and constrain every floating frame', () => {
  const layout = defaultLayout();
  layout.sizes.left = 700; layout.sizes.right = 700; layout.sizes.bottom = 800;
  layout.panels.browser.dock = 'float';
  layout.panels.console.dock = 'float';
  layout.panels.browser.rect = { x: 9999, y: 9999, w: 2000, h: 2000 };
  for (const [width, height] of [[1440, 900], [640, 400], [320, 200], [100, 80]]) {
    const fit = fitLayout(layout, width, height);
    assert.ok(fit.sizes.left + fit.sizes.right <= width - Math.min(280, width * .42));
    assert.equal(fit.sizes.bottom, 0);
    for (const rect of Object.values(fit.rects)) {
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.w <= width && rect.h <= height);
      assert.ok(rect.x + rect.w <= width && rect.y + rect.h <= height);
    }
  }
  assert.equal(layout.panels.browser.rect.x, 9999);
});

test('hidden or floating panels do not reserve any scene area', () => {
  const layout = defaultLayout();
  layout.panels.hierarchy.hidden = true;
  layout.panels.inspector.dock = 'float';
  layout.panels.browser.hidden = true;
  layout.panels.console.hidden = true;
  assert.deepEqual(fitLayout(layout, 1280, 720).sizes, { left: 0, right: 0, bottom: 0 });
});

test('layout round trip preserves user docking and does not modify the supplied state', () => {
  const layout = defaultLayout();
  layout.panels.hierarchy.dock = 'right';
  layout.panels.browser.dock = 'float';
  layout.panels.browser.rect = { x: 100, y: 80, w: 500, h: 300 };
  layout.panels.console.hidden = true;
  layout.active.left = null;
  layout.active.right = 'hierarchy';
  layout.active.bottom = null;
  const serialized = JSON.stringify(layout);
  assert.deepEqual(validateLayout(JSON.parse(serialized)), layout);
  fitLayout(layout, 600, 300);
  assert.equal(JSON.stringify(layout), serialized);
});

test('upgrade only the untouched former preset; retain even one customized dimension', () => {
  const old = { version: 1, sizes: { left: 250, right: 300, bottom: 230 },
    active: { left: 'hierarchy', right: 'inspector', bottom: 'browser' },
    panels: Object.fromEntries(['hierarchy', 'inspector', 'browser'].map((id, i) => [id, {
      dock: ['left', 'right', 'bottom'][i], hidden: false,
      rect: { x: 270 + i * 28, y: 45 + i * 28, w: 420, h: 430 },
    }])) };
  const original = JSON.stringify(old);
  assert.deepEqual(validateLayout(old), defaultLayout());
  assert.equal(JSON.stringify(old), original);
  for (const customize of [
    v => { v.sizes.right = 301; },
    v => { v.panels.browser.rect.w = 500; },
    v => { v.panels.hierarchy.hidden = true; },
    v => { v.panels.inspector.dock = 'float'; },
  ]) {
    const custom = JSON.parse(original);
    customize(custom);
    const result = validateLayout(custom);
    assert.deepEqual(result.sizes, custom.sizes);
    for(const [id,panel] of Object.entries(custom.panels))assert.deepEqual(result.panels[id],panel);
    assert.deepEqual(result.panels.console,defaultLayout().panels.console,'New Console panel is added without replacing old customizations');
  }
});

test('a customized Console prevents migration of otherwise legacy-looking panels', () => {
  const old = { version: 1, sizes: { left: 250, right: 300, bottom: 230 },
    active: { left: 'hierarchy', right: 'inspector', bottom: 'browser' },
    panels: Object.fromEntries(['hierarchy', 'inspector', 'browser'].map((id, i) => [id, {
      dock: ['left', 'right', 'bottom'][i], hidden: false,
      rect: { x: 270 + i * 28, y: 45 + i * 28, w: 420, h: 430 },
    }])) };
  old.panels.console={dock:'float',hidden:true,rect:{x:80,y:90,w:500,h:250}};
  const original=JSON.stringify(old),result=validateLayout(old);
  assert.deepEqual(result.sizes,old.sizes);assert.deepEqual(result.panels,old.panels);
  assert.equal(JSON.stringify(old),original);
});

