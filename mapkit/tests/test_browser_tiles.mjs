// The tile size (static/browser-tiles.js mountTileSize, on a stand-in page): read and kept through the editor's own
// storage accessor; with no storage it still works, for this page only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTileSize } from '../editor/static/browser-tiles.js';
import { TILE_SIZES, DEFAULT_TILE_SIZE } from '../editor/static/browser-favourites.js';

const page = () => ({ root: { dataset: {}, addEventListener() {} },
  slider: { value: '', setAttribute() {}, addEventListener(type, f) { this.input = f; } } });

test('the tile size through the storage the editor gives', () => {
  const kept = new Map([['ucmap.tptiles', 'large']]);
  let asked = 0;
  const storage = () => { asked++; return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) }; };
  const { root, slider } = page();
  mountTileSize({ root, slider, grid: '.tp-grid', tile: '.tp-tile', key: 'ucmap.tptiles', storage });
  assert.equal(root.dataset.tiles, 'large');
  assert.equal(slider.value, String(TILE_SIZES.indexOf('large')));
  slider.value = '0'; slider.input();
  assert.equal(kept.get('ucmap.tptiles'), TILE_SIZES[0]);
  assert.equal(asked, 2);
  const none = page();                                  // no storage (a private window): this page only
  mountTileSize({ ...none, grid: '.g', tile: '.t', key: 'k', storage: () => null });
  assert.equal(none.root.dataset.tiles, DEFAULT_TILE_SIZE);
  none.slider.value = '3'; none.slider.input();
  assert.equal(none.root.dataset.tiles, TILE_SIZES[3]);
});
