// Scalar animation curves for the Studio's explicitly edited channels. Existing
// quaternion pose keys keep their own evaluator; this module has no UI or Three.js dependency.
const MODES = new Set(['smooth', 'linear', 'hold']);

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}
function frame(value, label = 'Key frame') {
  finite(value, label);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}
function duration(frames) {
  frame(frames, 'Animation frame count');
  if (frames < 1) throw new Error('Animation must contain at least one frame.');
  return frames;
}
function checkedKey(key) {
  if (!key || typeof key !== 'object') throw new Error('A curve key must contain a frame and value.');
  const mode = key.mode === undefined ? 'smooth' : key.mode;
  if (!MODES.has(mode)) throw new Error('Interpolation must be smooth, linear, or hold.');
  return { ...key, f: frame(key.f), v: finite(key.v, 'Key value'), mode };
}
function checkedKeys(keys, allowEmpty = false) {
  if (!Array.isArray(keys)) throw new Error('Curve keys must be an array.');
  if (!allowEmpty && !keys.length) throw new Error('A curve must keep at least one key.');
  const out = keys.map(checkedKey).sort((a, b) => a.f - b.f);
  for (let i = 1; i < out.length; i++) {
    if (out[i].f === out[i - 1].f) throw new Error(`Two curve keys occupy frame ${out[i].f + 1}.`);
  }
  return out;
}
function inRange(keys, frames) {
  duration(frames);
  if (keys.some((key) => key.f >= frames)) throw new Error(`Keys must stay within frames 1–${frames}.`);
}
function selection(keys, selectedFrames) {
  if (!Array.isArray(selectedFrames) && !(selectedFrames instanceof Set)) throw new Error('Selected frames must be an array or Set.');
  const selected = new Set([...selectedFrames].map((f) => frame(f, 'Selected frame')));
  if (!selected.size) throw new Error('Select at least one curve key.');
  const existing = new Set(keys.map((key) => key.f));
  for (const f of selected) if (!existing.has(f)) throw new Error(`There is no curve key at frame ${f + 1}.`);
  return selected;
}

// The nonuniform weighted harmonic mean gives a shape-preserving tangent. Local
// extrema and flat segments have zero slope; held endpoints also have zero slope.
function tangent(keys, i, loop, frames) {
  const n = keys.length;
  if (n < 2 || (!loop && (i === 0 || i === n - 1))) return 0;
  const here = keys[i], prev = keys[(i + n - 1) % n], next = keys[(i + 1) % n];
  const h0 = here.f - prev.f + (i === 0 ? frames : 0);
  const h1 = next.f - here.f + (i === n - 1 ? frames : 0);
  const d0 = (here.v - prev.v) / h0, d1 = (next.v - here.v) / h1;
  if (!d0 || !d1 || Math.sign(d0) !== Math.sign(d1)) return 0;
  const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
  return (w1 + w2) / (w1 / d0 + w2 / d1);
}

/** Evaluate a scalar curve. Keys use zero-based integer frames; f may be fractional.
 * The starting key owns each segment's mode. Loops wrap over [0, frames), including
 * the segment before the first key. Non-looping curves hold their endpoint values.
 */
export function sampleCurve(keys, f, { loop = false, frames } = {}) {
  const list = checkedKeys(keys);
  finite(f, 'Sample frame');
  if (frames !== undefined) inRange(list, frames);
  if (loop) {
    frames = frames === undefined ? list[list.length - 1].f + 1 : frames;
    duration(frames);
    f = ((f % frames) + frames) % frames;
  }
  const n = list.length;
  if (n === 1) return list[0].v;
  if (!loop) {
    if (f <= list[0].f) return list[0].v;
    if (f >= list[n - 1].f) return list[n - 1].v;
  }
  let i = 0;
  while (i + 1 < n && list[i + 1].f <= f) i++;
  if (loop && f < list[0].f) { i = n - 1; f += frames; }
  const a = list[i], j = (i + 1) % n, b = list[j];
  if (f === a.f) return a.v;
  const span = b.f - a.f + (j === 0 ? frames : 0), t = (f - a.f) / span;
  if (a.mode === 'hold') return a.v;
  if (a.mode === 'linear') return a.v * (1 - t) + b.v * t;
  const m0 = tangent(list, i, loop, frames), m1 = tangent(list, j, loop, frames);
  const t2 = t * t, t3 = t2 * t;
  const value = (2 * t3 - 3 * t2 + 1) * a.v + (t3 - 2 * t2 + t) * span * m0
    + (-2 * t3 + 3 * t2) * b.v + (t3 - t2) * span * m1;
  // Guard tiny floating-point excursions at extrema, including loop seams.
  return Math.max(Math.min(a.v, b.v), Math.min(Math.max(a.v, b.v), value));
}

/** Add/replace one key without mutating either argument. An omitted mode preserves
 * an existing key's mode and defaults to smooth for a new key.
 */
export function upsertKey(keys, key) {
  const list = checkedKeys(keys, true);
  if (!key || typeof key !== 'object') throw new Error('A curve key must contain a frame and value.');
  const existing = list.find((item) => item.f === key.f);
  const next = checkedKey({ ...existing, ...key, mode: key.mode === undefined ? existing?.mode : key.mode });
  return [...list.filter((item) => item.f !== next.f), next].sort((a, b) => a.f - b.f);
}

/** Move all selected keys together, snapping the frame delta and rejecting collisions. */
export function moveKeys(keys, selectedFrames, deltaFrame, deltaValue, frames) {
  const list = checkedKeys(keys);
  inRange(list, frames);
  const selected = selection(list, selectedFrames);
  const df = Math.round(finite(deltaFrame, 'Frame offset')), dv = finite(deltaValue, 'Value offset');
  const moved = list.map((key) => selected.has(key.f) ? { ...key, f: key.f + df, v: key.v + dv } : key);
  const result = checkedKeys(moved);
  inRange(result, frames);
  return result;
}

/** Remove selected keys, retaining at least one key in the channel. */
export function deleteKeys(keys, selectedFrames) {
  const list = checkedKeys(keys), selected = selection(list, selectedFrames);
  return checkedKeys(list.filter((key) => !selected.has(key.f)));
}

/** Duplicate the selection so its first key lands on targetFrame. Existing keys,
 * including the selected originals, are never overwritten.
 */
export function duplicateKeys(keys, selectedFrames, targetFrame, frames) {
  const list = checkedKeys(keys);
  inRange(list, frames);
  const selected = selection(list, selectedFrames);
  const target = Math.round(finite(targetFrame, 'Duplicate target frame'));
  const delta = target - Math.min(...selected);
  const copies = list.filter((key) => selected.has(key.f)).map((key) => ({ ...key, f: key.f + delta }));
  const result = checkedKeys([...list, ...copies]);
  inRange(result, frames);
  return result;
}

/** Equivalent angle nearest reference, useful when displaying Euler rotations. */
export function continuousAngle(degrees, reference) {
  finite(degrees, 'Angle'); finite(reference, 'Reference angle');
  const delta = ((degrees % 360 - reference % 360 + 180) % 360 + 360) % 360 - 180;
  return reference + delta;
}
