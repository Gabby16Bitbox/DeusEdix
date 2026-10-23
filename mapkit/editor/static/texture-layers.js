// Raster layers for the texture editor. The game still receives one flattened image.
// Canvas factories and image decoders can be injected for tests and non-DOM hosts.
export const TEXTURE_LAYER_LIMITS = Object.freeze({
  maxSide: 2048, maxLayers: 32, maxPixels: 32 * 1024 * 1024,
  maxProjectBytes: 192 * 1024 * 1024, maxPngBytes: 16 * 1024 * 1024,
});
const FORMAT = 'deusedix-texture-project';
const BLENDS = Object.freeze({ normal: 'source-over', multiply: 'multiply', screen: 'screen' });
const PNG_PREFIX = 'data:image/png;base64,';
const own = (value, name) => Object.prototype.hasOwnProperty.call(value, name);

function dimensions(width, height, count = 1) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > TEXTURE_LAYER_LIMITS.maxSide || height > TEXTURE_LAYER_LIMITS.maxSide) {
    throw new Error(`Texture dimensions must be whole numbers from 1 to ${TEXTURE_LAYER_LIMITS.maxSide}.`);
  }
  if (!Number.isInteger(count) || count < 1 || count > TEXTURE_LAYER_LIMITS.maxLayers) {
    throw new Error(`A texture can have 1–${TEXTURE_LAYER_LIMITS.maxLayers} layers.`);
  }
  if (width * height * count > TEXTURE_LAYER_LIMITS.maxPixels) {
    throw new Error('These layers exceed the 128 MiB texture memory limit. Reduce the size or merge layers.');
  }
}
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f]/.test(value)) throw new Error('Layer names must contain 1–80 printable characters.');
  return value.trim();
}
function metadata(value, serialized = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid layer.');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id)) throw new Error('Invalid layer ID.');
  if (typeof value.visible !== 'boolean') throw new Error('Layer visibility must be true or false.');
  if (typeof value.opacity !== 'number' || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1) throw new Error('Layer opacity must be between 0 and 1.');
  const blend = serialized ? Object.keys(BLENDS).find(key => BLENDS[key] === value.blendMode) : value.blend;
  if (!own(BLENDS, blend)) throw new Error('Unsupported layer blend mode.');
  if (value.locked !== undefined && typeof value.locked !== 'boolean') throw new Error('Layer lock must be true or false.');
  return { id: value.id, name: label(value.name), visible: value.visible, opacity: value.opacity, blend, locked: value.locked ?? false };
}
function validateStack(width, height, layers, activeId, serialized = false) {
  if (!Array.isArray(layers)) throw new Error('Texture layers are missing.');
  dimensions(width, height, layers.length);
  const meta = layers.map(layer => metadata(layer, serialized));
  if (meta[0].id !== 'original') throw new Error('The first texture layer must be Original.');
  if (new Set(meta.map(layer => layer.id)).size !== meta.length) throw new Error('Texture layer IDs must be unique.');
  if (!meta.some(layer => layer.id === activeId)) throw new Error('The active texture layer is missing.');
  return meta;
}
function defaultCanvas(width, height) {
  if (typeof document === 'undefined') throw new Error('A canvas factory is required outside the browser.');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}
function defaultDecode(png) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A texture layer PNG could not be read.'));
    image.src = png;
  });
}
function checkPng(png, width, height) {
  if (typeof png !== 'string' || !png.startsWith(PNG_PREFIX)) throw new Error('Texture layers must contain PNG image data.');
  const data = png.slice(PNG_PREFIX.length);
  const maximum = Math.min(TEXTURE_LAYER_LIMITS.maxPngBytes * 4 / 3 + 4, width * height * 8 + 65536);
  if (data.length > maximum || data.length < 44 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid or oversized texture layer PNG.');
  // Read IHDR before the browser decoder allocates an image (avoid huge embedded dimensions).
  const header = Uint8Array.from(atob(data.slice(0, 44)), char => char.charCodeAt(0));
  if (![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every((value, index) => header[index] === value)) throw new Error('Invalid texture layer PNG header.');
  const view = new DataView(header.buffer);
  if (view.getUint32(16) !== width || view.getUint32(20) !== height) throw new Error('Every layer PNG must match the texture dimensions.');
  return png;
}

export class TextureLayers {
  constructor(width, height, { source = null, canvasFactory = defaultCanvas } = {}) {
    dimensions(width, height);
    this.width = width; this.height = height;
    this._canvasFactory = canvasFactory;
    const canvas = this._canvas(width, height);
    if (source) canvas.getContext('2d').drawImage(source, 0, 0, width, height);
    this._layers = [{ id: 'original', name: 'Original', visible: true, opacity: 1, blend: 'normal', locked: false, canvas }];
    this.activeId = 'original';
    this._nextId = 1;
  }
  get layers() { return this._layers.slice(); }
  get active() { return this._layer(this.activeId); }
  get byteLength() { return this.width * this.height * 4 * this._layers.length; }
  _canvas(width = this.width, height = this.height) {
    const canvas = this._canvasFactory(width, height);
    if (!canvas || typeof canvas.getContext !== 'function') throw new Error('The canvas factory did not return a canvas.');
    canvas.width = width; canvas.height = height;
    if (!canvas.getContext('2d')) throw new Error('A 2D canvas is required for texture layers.');
    return canvas;
  }
  _copy(source) {
    const canvas = this._canvas(source.width, source.height);
    canvas.getContext('2d').drawImage(source, 0, 0);
    return canvas;
  }
  _layer(id) {
    const layer = this._layers.find(item => item.id === id);
    if (!layer) throw new Error('The texture layer no longer exists.');
    return layer;
  }
  _id() {
    let id;
    do { id = 'layer-' + this._nextId++; } while (this._layers.some(layer => layer.id === id));
    return id;
  }
  select(id) { this._layer(id); this.activeId = id; return this.active; }
  add(name = 'Paint layer', { source = null, aboveId = this.activeId } = {}) {
    dimensions(this.width, this.height, this._layers.length + 1);
    const index = this._layers.indexOf(this._layer(aboveId));
    const layer = { id: this._id(), name: label(name), visible: true, opacity: 1, blend: 'normal', locked: false, canvas: this._canvas() };
    if (source) layer.canvas.getContext('2d').drawImage(source, 0, 0, this.width, this.height);
    this._layers.splice(index + 1, 0, layer);
    this.activeId = layer.id;
    return layer;
  }
  duplicate(id = this.activeId) {
    const original = this._layer(id);
    const layer = this.add((original.name.slice(0, 75) + ' copy'), { source: original.canvas, aboveId: id });
    Object.assign(layer, { visible: original.visible, opacity: original.opacity, blend: original.blend });
    return layer;
  }
  update(id, changes) {
    const layer = this._layer(id);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid layer properties.');
    const fields = ['name', 'visible', 'opacity', 'blend', 'locked'];
    if (Object.keys(changes).some(key => !fields.includes(key))) throw new Error('Unsupported layer property.');
    Object.assign(layer, metadata({ ...layer, ...changes }));
    return layer;
  }
  remove(id = this.activeId) {
    const layer = this._layer(id);
    if (id === 'original') throw new Error('Keep the Original layer; hide it to paint on transparency.');
    if (layer.locked) throw new Error('Unlock this layer before removing it.');
    const index = this._layers.indexOf(layer);
    this._layers.splice(index, 1);
    if (this.activeId === id) this.activeId = this._layers[Math.min(index, this._layers.length - 1)].id;
    return this.active;
  }
  move(id, index) {
    const layer = this._layer(id);
    if (id === 'original' || !Number.isInteger(index) || index < 1 || index >= this._layers.length) throw new Error('Paint layers must stay above Original.');
    this._layers.splice(this._layers.indexOf(layer), 1);
    this._layers.splice(index, 0, layer);
    return layer;
  }
  replaceCanvas(id, canvas) {
    const layer = this._layer(id);
    if (layer.locked) throw new Error('Unlock this layer before painting.');
    if (canvas?.width !== this.width || canvas?.height !== this.height) throw new Error('A replacement layer must match the texture dimensions.');
    layer.canvas = this._copy(canvas);
    return layer;
  }
  _draw(layers, canvas) {
    const context = canvas.getContext('2d');
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const layer of layers) {
        if (!layer.visible || layer.opacity === 0) continue;
        context.globalAlpha = layer.opacity;
        context.globalCompositeOperation = BLENDS[layer.blend];
        context.drawImage(layer.canvas, 0, 0);
      }
    } finally { context.restore(); }
    return canvas;
  }
  flatten(canvas = this._canvas()) {
    if (this._layers.some(layer => layer.canvas === canvas)) throw new Error('Flatten into a separate canvas to keep editable layers.');
    if (canvas.width !== this.width) canvas.width = this.width;
    if (canvas.height !== this.height) canvas.height = this.height;
    return this._draw(this._layers, canvas);
  }
  mergeDownReason(id = this.activeId) {
    const index = this._layers.indexOf(this._layer(id));
    if (!index) return 'Original has no layer below it.';
    const above = this._layers[index], below = this._layers[index - 1];
    if (above.locked || below.locked) return 'Unlock both layers before merging.';
    if (!above.visible || !below.visible) return 'Show both layers before merging.';
    if (index > 1 && (above.blend !== 'normal' || below.blend !== 'normal')) return 'Merge these blend layers down to Original first to preserve their appearance.';
    return '';
  }
  canMergeDown(id = this.activeId) { return !this.mergeDownReason(id); }
  mergeDown(id = this.activeId) {
    const reason = this.mergeDownReason(id);
    if (reason) throw new Error(reason);
    const index = this._layers.indexOf(this._layer(id));
    const below = this._layers[index - 1];
    const canvas = this._draw(this._layers.slice(index - 1, index + 1), this._canvas());
    Object.assign(below, { canvas, opacity: 1, blend: 'normal' });
    this._layers.splice(index, 1);
    this.activeId = below.id;
    return below;
  }
  // Callback receives an untouched source and a new destination. The stack changes
  // only after every draw succeeds, so failures cannot leave mixed layer dimensions.
  // Canvas geometry changes apply to locked and hidden layers too. A lock protects
  // painting on a layer, not its alignment with the rest of the texture document.
  transformAll(width, height, draw) {
    dimensions(width, height, this._layers.length);
    if (typeof draw !== 'function') throw new Error('A layer transform callback is required.');
    const canvases = this._layers.map(layer => {
      const canvas = this._canvas(width, height);
      const result = draw(layer.canvas, canvas, { ...layer, canvas: undefined });
      if (result && typeof result.then === 'function') throw new Error('Layer transforms must draw synchronously.');
      if (canvas.width !== width || canvas.height !== height) throw new Error('Layer transforms must keep the requested dimensions.');
      return canvas;
    });
    this._layers.forEach((layer, index) => { layer.canvas = canvases[index]; });
    this.width = width; this.height = height;
    return this;
  }
  resize(width, height, { smooth = true } = {}) {
    return this.transformAll(width, height, (source, canvas) => {
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = !!smooth;
      context.drawImage(source, 0, 0, width, height);
    });
  }
  crop(x, y, width, height) {
    if (![x, y].every(Number.isInteger) || Math.abs(x) > 4096 || Math.abs(y) > 4096) throw new Error('Invalid texture crop position.');
    return this.transformAll(width, height, (source, canvas) => canvas.getContext('2d').drawImage(source, -x, -y));
  }
  snapshot() {
    return { width: this.width, height: this.height, activeId: this.activeId, byteLength: this.byteLength,
      layers: this._layers.map(layer => ({ ...layer, canvas: this._copy(layer.canvas) })) };
  }
  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid texture undo snapshot.');
    const meta = validateStack(snapshot.width, snapshot.height, snapshot.layers, snapshot.activeId);
    const layers = snapshot.layers.map((layer, index) => {
      if (layer.canvas?.width !== snapshot.width || layer.canvas?.height !== snapshot.height) throw new Error('Invalid texture snapshot canvas.');
      return { ...meta[index], canvas: this._copy(layer.canvas) };
    });
    this.width = snapshot.width; this.height = snapshot.height;
    this._layers = layers; this.activeId = snapshot.activeId;
    return this;
  }
  serialize() {
    return { format: FORMAT, version: 1, width: this.width, height: this.height, activeLayerId: this.activeId,
      layers: this._layers.map(({ id, name, visible, opacity, blend, locked, canvas }) => ({
        id, name, visible, opacity, blendMode: BLENDS[blend], locked, png: canvas.toDataURL('image/png'),
      })) };
  }
  static async fromProject(input, { canvasFactory = defaultCanvas, decodeImage = defaultDecode } = {}) {
    if (typeof input === 'string') {
      if (input.length > TEXTURE_LAYER_LIMITS.maxProjectBytes) throw new Error('This texture project is too large.');
      try { input = JSON.parse(input); } catch { throw new Error('This file is not a texture project.'); }
    }
    if (!input || typeof input !== 'object' || input.format !== FORMAT || input.version !== 1) throw new Error('Unsupported texture project format.');
    const { width, height, activeLayerId } = input;
    const meta = validateStack(width, height, input.layers, activeLayerId, true);
    let total = 0;
    for (const layer of input.layers) {
      checkPng(layer.png, width, height);
      total += layer.png.length;
      if (total > TEXTURE_LAYER_LIMITS.maxProjectBytes) throw new Error('This texture project is too large.');
    }
    const model = new TextureLayers(width, height, { canvasFactory });
    const layers = [];
    for (let index = 0; index < input.layers.length; index++) {
      const image = await decodeImage(input.layers[index].png);
      if ((image.naturalWidth ?? image.width) !== width || (image.naturalHeight ?? image.height) !== height) throw new Error('Decoded texture layer dimensions do not match.');
      const canvas = model._canvas();
      canvas.getContext('2d').drawImage(image, 0, 0);
      layers.push({ ...meta[index], canvas });
    }
    model._layers = layers; model.activeId = activeLayerId;
    return model;
  }
}
