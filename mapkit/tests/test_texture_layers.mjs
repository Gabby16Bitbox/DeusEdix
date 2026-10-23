import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { TextureLayers, TEXTURE_LAYER_LIMITS } from '../editor/static/texture-layers.js';

// A small deterministic raster host exercises the model without installing native
// canvas packages. Browser integration tests cover the real Canvas2D renderer.
class Raster {
  constructor(width, height) { this._width = width; this._height = height; this.reset(); }
  get width() { return this._width; }
  get height() { return this._height; }
  set width(value) { this._width = value; this.reset(); }
  set height(value) { this._height = value; this.reset(); }
  reset() { this.pixels = new Uint8ClampedArray(this.width * this.height * 4); this.context = new Context(this); }
  getContext(kind) { assert.equal(kind, '2d'); return this.context; }
  toDataURL(kind) { assert.equal(kind, 'image/png'); return 'data:image/png;base64,' + encodePng(this).toString('base64'); }
}
class Context {
  constructor(canvas) { this.canvas = canvas; this.globalAlpha = 1; this.globalCompositeOperation = 'source-over'; this.stack = []; }
  save() { this.stack.push([this.globalAlpha, this.globalCompositeOperation]); }
  restore() { [this.globalAlpha, this.globalCompositeOperation] = this.stack.pop(); }
  setTransform(...args) { assert.deepEqual(args, [1, 0, 0, 1, 0, 0]); }
  clearRect(x, y, width, height) {
    for (let row = Math.max(0, y); row < Math.min(this.canvas.height, y + height); row++) for (let col = Math.max(0, x); col < Math.min(this.canvas.width, x + width); col++) this.canvas.pixels.fill(0, (row * this.canvas.width + col) * 4, (row * this.canvas.width + col) * 4 + 4);
  }
  drawImage(source, x, y, width = source.width, height = source.height) {
    for (let dy = Math.max(0, y); dy < Math.min(this.canvas.height, y + height); dy++) {
      for (let dx = Math.max(0, x); dx < Math.min(this.canvas.width, x + width); dx++) {
        const sx = Math.floor((dx - x) / width * source.width), sy = Math.floor((dy - y) / height * source.height);
        const si = (sy * source.width + sx) * 4, di = (dy * this.canvas.width + dx) * 4;
        const s = source.pixels, d = this.canvas.pixels;
        const sa = s[si + 3] / 255 * this.globalAlpha, da = d[di + 3] / 255, outAlpha = sa + da * (1 - sa);
        for (let channel = 0; channel < 3; channel++) {
          const sc = s[si + channel] / 255, dc = d[di + channel] / 255;
          const blend = this.globalCompositeOperation === 'multiply' ? sc * dc : this.globalCompositeOperation === 'screen' ? sc + dc - sc * dc : sc;
          d[di + channel] = outAlpha ? ((1 - sa) * da * dc + (1 - da) * sa * sc + sa * da * blend) / outAlpha * 255 : 0;
        }
        d[di + 3] = outAlpha * 255;
      }
    }
  }
}
const factory = (width, height) => new Raster(width, height);
const make = (width = 2, height = 2, source = null) => new TextureLayers(width, height, { canvasFactory: factory, source });
function fill(canvas, rgba) { for (let index = 0; index < canvas.pixels.length; index += 4) canvas.pixels.set(rgba, index); return canvas; }
const pixel = (canvas, x = 0, y = 0) => Array.from(canvas.pixels.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4));
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, crc]);
}
function encodePng(canvas) {
  const header = Buffer.alloc(13); header.writeUInt32BE(canvas.width); header.writeUInt32BE(canvas.height, 4); header[8] = 8; header[9] = 6;
  const rows = [];
  for (let y = 0; y < canvas.height; y++) rows.push(Buffer.from([0]), Buffer.from(canvas.pixels.slice(y * canvas.width * 4, (y + 1) * canvas.width * 4)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
async function decodePng(url) {
  const bytes = Buffer.from(url.split(',')[1], 'base64'), canvas = factory(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  let offset = 8, compressed = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    assert.equal(bytes.readUInt32BE(offset + 8 + length), crc32(bytes.subarray(offset + 4, offset + 8 + length)));
    if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  for (let y = 0; y < canvas.height; y++) {
    assert.equal(raw[y * (canvas.width * 4 + 1)], 0);
    canvas.pixels.set(raw.subarray(y * (canvas.width * 4 + 1) + 1, (y + 1) * (canvas.width * 4 + 1)), y * canvas.width * 4);
  }
  return canvas;
}
const importProject = value => TextureLayers.fromProject(value, { canvasFactory: factory, decodeImage: decodePng });

test('painting and erasing a separate layer preserves Original and reveals it', () => {
  const source = fill(factory(2, 2), [30, 50, 70, 255]), model = make(2, 2, source);
  const paint = model.add('Graffiti');
  assert.deepEqual(pixel(paint.canvas), [0, 0, 0, 0]);
  fill(paint.canvas, [200, 10, 20, 255]);
  assert.deepEqual(pixel(model.flatten()), [200, 10, 20, 255]);
  paint.canvas.getContext('2d').clearRect(0, 0, 1, 1);
  assert.deepEqual(pixel(model.flatten()), [30, 50, 70, 255]);
  assert.deepEqual(pixel(model.layers[0].canvas), [30, 50, 70, 255]);
  fill(source, [0, 0, 0, 0]);
  assert.deepEqual(pixel(model.layers[0].canvas), [30, 50, 70, 255]);
});

test('opacity, visibility, multiply and screen compose in bottom-to-top order', () => {
  const model = make(1, 1, fill(factory(1, 1), [128, 128, 128, 255]));
  const layer = model.add('Detail', { source: fill(factory(1, 1), [128, 128, 128, 255]) });
  model.update(layer.id, { blend: 'multiply' });
  assert.deepEqual(pixel(model.flatten()), [64, 64, 64, 255]);
  model.update(layer.id, { opacity: .5 });
  assert.deepEqual(pixel(model.flatten()), [96, 96, 96, 255]);
  model.update(layer.id, { blend: 'screen', opacity: 1 });
  assert.deepEqual(pixel(model.flatten()), [192, 192, 192, 255]);
  model.update(layer.id, { visible: false });
  assert.deepEqual(pixel(model.flatten()), [128, 128, 128, 255]);
});

test('flatten clears stale pixels, retains target context state and never destroys a layer', () => {
  const model = make(), target = fill(factory(2, 2), [255, 0, 0, 255]);
  target.context.globalAlpha = .4; target.context.globalCompositeOperation = 'screen';
  assert.equal(model.flatten(target), target);
  assert.deepEqual(pixel(target), [0, 0, 0, 0]);
  assert.equal(target.context.globalAlpha, .4); assert.equal(target.context.globalCompositeOperation, 'screen');
  assert.throws(() => model.flatten(model.active.canvas), /separate canvas/);
});

test('duplicate is independent, preserves appearance, and ordering controls the top pixel', () => {
  const model = make(1, 1);
  const red = model.add('Red', { source: fill(factory(1, 1), [255, 0, 0, 255]) });
  const copy = model.duplicate();
  fill(copy.canvas, [0, 0, 255, 255]);
  assert.deepEqual(pixel(red.canvas), [255, 0, 0, 255]);
  assert.deepEqual(pixel(model.flatten()), [0, 0, 255, 255]);
  model.move(red.id, 2);
  assert.deepEqual(pixel(model.flatten()), [255, 0, 0, 255]);
  model.update(red.id, { name: ' Edge wear ' }); assert.equal(red.name, 'Edge wear');
  assert.throws(() => model.move(copy.id, 0), /above Original/);
  assert.throws(() => model.remove('original'), /Keep the Original/);
  model.select(red.id); model.remove(red.id); assert.equal(model.active.id, copy.id);
});

test('normal layer merge retains translucent output over a lower backdrop', () => {
  const model = make(1, 1, fill(factory(1, 1), [20, 40, 60, 255]));
  model.add('First', { source: fill(factory(1, 1), [180, 20, 30, 128]) });
  const top = model.add('Second', { source: fill(factory(1, 1), [30, 200, 60, 128]) });
  const before = pixel(model.flatten());
  assert.equal(model.canMergeDown(top.id), true);
  model.mergeDown();
  const after = pixel(model.flatten());
  after.forEach((value, index) => assert.ok(Math.abs(value - before[index]) <= 1));
  assert.equal(model.layers.length, 2);
});

test('blend merges into Original preserve output; ambiguous interior blends are refused', () => {
  const model = make(1, 1, fill(factory(1, 1), [128, 128, 128, 255]));
  const middle = model.add('Dirt', { source: fill(factory(1, 1), [128, 128, 128, 255]) });
  model.update(middle.id, { blend: 'multiply', opacity: .5 });
  const before = pixel(model.flatten()); model.mergeDown();
  assert.deepEqual(pixel(model.flatten()), before); assert.equal(model.layers.length, 1);
  model.add('Paint'); const top = model.add('More dirt');
  model.update(top.id, { blend: 'multiply' });
  assert.equal(model.canMergeDown(), false);
  assert.throws(() => model.mergeDown(), /preserve their appearance/);
  model.update(top.id, { blend: 'normal', visible: false });
  assert.throws(() => model.mergeDown(), /Show both/);
});

test('locks protect destructive layer actions while retaining visibility controls', () => {
  const model = make(); const layer = model.add('Protected');
  model.update(layer.id, { locked: true, visible: false, opacity: .3 });
  assert.throws(() => model.remove(), /Unlock/);
  assert.throws(() => model.replaceCanvas(layer.id, factory(2, 2)), /Unlock/);
  assert.throws(() => model.mergeDown(), /Unlock/);
  model.update(layer.id, { locked: false });
  model.remove(); assert.equal(model.active.id, 'original');
});

test('snapshots and repeated restores do not alias pixels, properties or layer order', () => {
  const model = make(1, 1); const paint = model.add('Saved'); fill(paint.canvas, [10, 20, 30, 255]);
  const snapshot = model.snapshot();
  assert.equal(snapshot.byteLength, 8);
  fill(paint.canvas, [90, 80, 70, 255]); model.update(paint.id, { name: 'Changed' }); model.add();
  model.restore(snapshot);
  assert.equal(model.layers.length, 2); assert.equal(model.active.name, 'Saved'); assert.deepEqual(pixel(model.active.canvas), [10, 20, 30, 255]);
  fill(model.active.canvas, [50, 40, 30, 255]); model.restore(snapshot);
  assert.deepEqual(pixel(model.active.canvas), [10, 20, 30, 255]);
  model.add(); assert.equal(new Set(model.layers.map(layer => layer.id)).size, model.layers.length);
});

test('resize and crop update every layer and preserve separate pixels and active selection', () => {
  const model = make(2, 2, fill(factory(2, 2), [100, 0, 0, 255]));
  const paint = model.add('Corner'); paint.canvas.pixels.set([0, 200, 0, 255], 12);
  model.resize(4, 4, { smooth: false });
  assert.equal(model.width, 4); assert.ok(model.layers.every(layer => layer.canvas.width === 4));
  model.crop(2, 2, 2, 2);
  assert.equal(model.width, 2); assert.equal(model.active.id, paint.id);
  assert.deepEqual(pixel(model.layers[0].canvas), [100, 0, 0, 255]);
  assert.deepEqual(pixel(model.active.canvas), [0, 200, 0, 255]);
});

test('global transforms include locked and hidden layers without changing layer properties', () => {
  const model = make(2, 2, fill(factory(2, 2), [100, 0, 0, 255]));
  model.update('original', { locked: true });
  const paint = model.add('Locked hidden detail');
  paint.canvas.pixels.set([0, 200, 0, 255], 12);
  model.update(paint.id, { locked: true, visible: false, opacity: .4, blend: 'multiply' });
  const metadata = model.layers.map(({ canvas, ...properties }) => properties);
  model.resize(4, 4, { smooth: false });
  assert.deepEqual(model.layers.map(layer => [layer.canvas.width, layer.canvas.height]), [[4, 4], [4, 4]]);
  model.crop(2, 2, 2, 2);
  assert.deepEqual(pixel(model.layers[0].canvas), [100, 0, 0, 255]);
  assert.deepEqual(pixel(model.active.canvas), [0, 200, 0, 255]);
  let transformed = 0;
  model.transformAll(1, 1, (source, destination) => { destination.getContext('2d').drawImage(source, 0, 0); transformed++; });
  assert.equal(transformed, 2);
  assert.deepEqual(model.layers.map(({ canvas, ...properties }) => properties), metadata);
  assert.equal(model.active.id, paint.id);
  assert.deepEqual(pixel(model.active.canvas), [0, 200, 0, 255]);
  assert.throws(() => model.replaceCanvas(paint.id, factory(1, 1)), /Unlock/);
});

test('failed transforms and malformed undo snapshots leave the current stack intact', () => {
  const model = make(); model.add('Paint'); const old = model.layers.map(layer => layer.canvas);
  assert.throws(() => model.transformAll(4, 4, (_source, _dest, layer) => { if (layer.id !== 'original') throw new Error('draw failed'); }), /draw failed/);
  assert.equal(model.width, 2); assert.deepEqual(model.layers.map(layer => layer.canvas), old);
  const bad = model.snapshot(); bad.layers[1].canvas = factory(9, 9);
  assert.throws(() => model.restore(bad), /snapshot canvas/);
  assert.deepEqual(model.layers.map(layer => layer.canvas), old);
});

test('editable PNG project round trip retains pixels, metadata and active layer', async () => {
  const model = make(2, 2, fill(factory(2, 2), [20, 50, 90, 255]));
  const paint = model.add('Weathered metal'); fill(paint.canvas, [200, 100, 20, 127]);
  model.update(paint.id, { blend: 'screen', opacity: .65, locked: true, visible: false });
  const serialized = model.serialize();
  assert.equal(serialized.layers[0].blendMode, 'source-over');
  const restored = await importProject(JSON.stringify(serialized));
  assert.deepEqual(restored.serialize(), serialized);
  assert.deepEqual(pixel(restored.active.canvas), [200, 100, 20, 127]);
  assert.equal(restored.byteLength, 32);
});

test('invalid project metadata fails before decoding any PNG', async () => {
  const model = make(), project = model.serialize(); let decodeCalls = 0;
  const changes = [
    value => { value.version = 2; }, value => { value.width = 0; }, value => { value.height = 4096; },
    value => { value.activeLayerId = 'missing'; }, value => { value.layers[0].id = '__proto__'; },
    value => { value.layers[0].opacity = '1'; }, value => { value.layers[0].opacity = NaN; },
    value => { value.layers[0].blendMode = 'overlay'; }, value => { value.layers[0].name = 'x'.repeat(81); },
    value => { value.layers.push({ ...value.layers[0] }); }, value => { value.layers[0].locked = 'false'; },
    value => { value.layers[0].name = 'Layer\nname'; },
  ];
  for (const change of changes) {
    const invalid = structuredClone(project); change(invalid);
    await assert.rejects(() => TextureLayers.fromProject(invalid, { canvasFactory: factory, decodeImage: () => { decodeCalls++; return factory(2, 2); } }));
  }
  assert.equal(decodeCalls, 0);
});

test('PNG dimensions and content boundaries are checked before image decoding', async () => {
  const project = make().serialize(); let decodeCalls = 0;
  const cases = ['https://example.com/layer.png', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(80), fill(factory(3, 2), [0, 0, 0, 0]).toDataURL('image/png')];
  for (const png of cases) {
    const invalid = structuredClone(project); invalid.layers[0].png = png;
    await assert.rejects(() => TextureLayers.fromProject(invalid, { canvasFactory: factory, decodeImage: () => { decodeCalls++; return factory(2, 2); } }));
  }
  assert.equal(decodeCalls, 0);
  await assert.rejects(() => TextureLayers.fromProject(project, { canvasFactory: factory, decodeImage: () => factory(3, 2) }), /Decoded/);
});

test('layer count and aggregate texture dimensions are bounded without giant allocations', () => {
  const model = make(1, 1);
  for (let count = 1; count < TEXTURE_LAYER_LIMITS.maxLayers; count++) model.add();
  assert.throws(() => model.add(), /1–32/);
  assert.throws(() => model.resize(2048, 2048), /128 MiB/);
  assert.equal(model.width, 1); assert.equal(model.layers.length, 32);
  for (const value of [0, -1, 1.5, Infinity, 2049, '256']) assert.throws(() => make(value, 1), /dimensions/);
});

test('invalid property edits are atomic', () => {
  const model = make(); const layer = model.active;
  assert.throws(() => model.update(layer.id, { name: 'A valid rename', opacity: 2 }), /opacity/);
  assert.equal(layer.name, 'Original');
  for (const patch of [{ blend: '__proto__' }, { visible: 1 }, { name: '' }, { name: 'Bad\nname' }, { canvas: factory(1, 1) }]) assert.throws(() => model.update(layer.id, patch));
  assert.equal(layer.visible, true); assert.equal(layer.blend, 'normal');
});
