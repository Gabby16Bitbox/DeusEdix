// File > Main menu... (editor/static/main-menu.js): the preview chooses and places the buttons as UCMainMenu does.
import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleButtons, layout, ACTION_LABELS, SHOW_LABELS, FONT_LABELS, FONT_CSS } from '../editor/static/main-menu.js';

const buttons = [
  { label: 'New', action: 'new', shows: 'always', map: '' },
  { label: 'Back', action: 'back', shows: 'game', map: '' },
  { label: 'Save', action: 'save', shows: 'always', map: '' },
  { label: 'Main', action: 'mainmenu', shows: 'always', map: '' },
  { label: 'Extra', action: 'map', shows: 'menu', map: 'Lab' },
  { label: 'Exit', action: 'exit', shows: 'always', map: '' },
];
const menu = { buttons, align: 'left', x: 0.1, y: 0.3, look: 'game', buttonWidth: 245, logoScale: 1, title: '' };

test('the buttons of each place, as UCMainMenu chooses them', () => {
  const atMenu = visibleButtons(menu, 'menu');
  assert.deepEqual(atMenu.map((b) => b.label), ['New', 'Save', 'Extra', 'Exit']);        // no Back, no main menu
  assert.equal(atMenu.find((b) => b.label === 'Save').enabled, false);                   // nothing to save there
  const inGame = visibleButtons(menu, 'game');
  assert.deepEqual(inGame.map((b) => b.label), ['New', 'Back', 'Save', 'Main', 'Exit']);
  assert.ok(inGame.every((b) => b.enabled));
});

test('the block is placed from the side and the top, and kept on the screen', () => {
  const L = layout(menu, 1000, 600, 4);
  assert.equal(L.blockX, 100);
  assert.equal(L.blockY, 180);
  assert.deepEqual(L.buttons.map((b) => b.y), [180, 216, 252, 288]);                    // 27 high, 9 apart
  const right = layout({ ...menu, align: 'right' }, 1000, 600, 1);
  assert.equal(right.buttons[0].x + right.buttons[0].w, 900);
  const centre = layout({ ...menu, align: 'centre', title: 'T' }, 1000, 600, 1, { titleW: 400, titleH: 30 });
  assert.equal(centre.blockX, 300);
  assert.equal(centre.buttons[0].x, 300 + (400 - 245) / 2);
  assert.equal(centre.buttons[0].y, 180 + 44);                                           // under the title
  const low = layout({ ...menu, y: 0.85 }, 1000, 600, 10);
  const last = low.buttons.at(-1);
  assert.ok(last.y + last.h <= 600 - 40 && low.blockY >= 10);
  const logo = layout(menu, 1000, 600, 1, { logoW: 200, logoH: 100 });
  assert.equal(logo.buttons[0].y, 180 + 112);
});

test('every choice of the server has its words and its font', () => {
  for (const a of ['new', 'load', 'save', 'settings', 'back', 'mainmenu', 'exit', 'map']) assert.ok(ACTION_LABELS[a]);
  for (const s of ['always', 'menu', 'game']) assert.ok(SHOW_LABELS[s]);
  for (const f of ['menu', 'title', 'headers', 'large', 'bold', 'location', 'small']) assert.ok(FONT_LABELS[f] && /\d+px/.test(FONT_CSS[f]));
});
