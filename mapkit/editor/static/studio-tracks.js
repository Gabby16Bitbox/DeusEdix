// Independent quaternion/position tracks. Frames and rotations stay in the Studio's
// existing format; conversion does not replace imported motion with Euler curves.
const MODES = new Set(['smooth', 'linear', 'hold']);
const IDENTITY = [0, 0, 0, 1], ZERO = [0, 0, 0];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const defaultMode = (anim) => anim.interp === 'linear' || anim.source === 'import' ? 'linear' : 'smooth';

function frame(f, anim) {
  if (!Number.isInteger(f) || f < 0 || (anim?.frames !== undefined && f >= anim.frames)) {
    throw new Error('Key frame must be an integer inside the animation.');
  }
  return f;
}
function vector(value, size) {
  if (!Array.isArray(value) || value.length !== size || value.some((x) => !Number.isFinite(x))) {
    throw new Error(`A track value must contain ${size} finite numbers.`);
  }
  // Do not normalize here: legacy quaternions were rounded to five decimals and
  // normalizing them would subtly change existing poses and their interpolation.
  return value.slice();
}
function checkedKey(key, name, anim, previous) {
  const field = name === '$root' ? 'v' : 'q', size = field === 'v' ? 3 : 4;
  const mode = key.mode ?? previous?.mode ?? defaultMode(anim);
  if (!MODES.has(mode)) throw new Error('Interpolation must be smooth, linear, or hold.');
  return { ...previous, ...key, f: frame(key.f, anim), [field]: vector(key[field], size), mode };
}

/** Split legacy whole-pose keys into independent tracks, without touching keys or
 * curves. Missing rotation entries mean identity at THAT frame, not a held pose.
 * Existing tracks (including empty tracks) remain authoritative and untouched.
 */
export function migrateTracks(anim, boneNames = []) {
  const names = new Set([...boneNames, ...Object.keys(anim.keys?.reduce((all, k) => Object.assign(all, k.rot), {}) || {}), '$root']);
  const additions = {};
  for (const name of names) {
    if (own(anim.tracks || {}, name)) continue;
    const keys = (anim.keys || []).map((key) => checkedKey(name === '$root'
      ? { f: key.f, v: key.root || ZERO }
      : { f: key.f, q: key.rot?.[name] || IDENTITY }, name, anim)).sort((a, b) => a.f - b.f);
    for (let i = 1; i < keys.length; i++) if (keys[i].f === keys[i - 1].f) throw new Error('Two pose keys occupy the same frame.');
    additions[name] = { keys };
  }
  anim.tracks = Object.assign(anim.tracks || {}, additions);
  return anim.tracks;
}

// Match THREE.Quaternion.slerp, including antipodal keys, rounded input and its
// normalized linear fallback near zero angle. Exact keys retain their values.
function slerp(a, b, t) {
  if (t === 0) return a.slice();
  if (t === 1) return b.slice();
  let dot = a.reduce((sum, x, i) => sum + x * b[i], 0), end = b;
  if (dot < 0) { dot = -dot; end = b.map((x) => -x); }
  if (dot >= 1) return a.slice();
  const sinSq = 1 - dot * dot;
  if (sinSq <= Number.EPSILON) {
    const result = a.map((x, i) => x * (1 - t) + end[i] * t);
    const length = Math.hypot(...result);
    return length ? result.map((x) => x / length) : IDENTITY.slice();
  }
  const sin = Math.sqrt(sinSq), angle = Math.atan2(sin, dot);
  const wa = Math.sin((1 - t) * angle) / sin, wb = Math.sin(t * angle) / sin;
  return a.map((x, i) => x * wa + end[i] * wb);
}

/** Evaluate a sorted track; f may be fractional. As with legacyPoseAt, the first
 * pose is held before its key, even in loops. The loop's last-to-first segment
 * ends at first.f + frames. The caller wraps its playback frame, as before.
 * Pass name='$root' to distinguish an empty position track from an empty bone.
 */
export function sampleTrack(track, f, anim = {}, name = '') {
  if (!Number.isFinite(f)) throw new Error('Sample frame must be finite.');
  const keys = track?.keys || [], position = name === '$root' || keys[0]?.v !== undefined;
  const field = position ? 'v' : 'q', rest = position ? ZERO : IDENTITY;
  if (!keys.length) return rest.slice();
  let i = 0;
  while (i < keys.length && keys[i].f <= f) i++;
  const a = keys[Math.max(0, i - 1)], b = keys[Math.min(keys.length - 1, i)];
  if (i === 0) return b[field].slice();
  let next = b, nextFrame = b.f;
  if (i >= keys.length) {
    if (!anim.loop || keys.length < 2) return a[field].slice();
    next = keys[0]; nextFrame = next.f + anim.frames;
  }
  const span = nextFrame - a.f;
  if (span <= 0 || next === a || f === a.f) return a[field].slice();
  let t = (f - a.f) / span;
  const mode = a.mode ?? defaultMode(anim);
  if (mode === 'hold') return a[field].slice();
  if (mode === 'smooth') t = t * t * (3 - 2 * t);
  return position ? a.v.map((x, j) => x + (next.v[j] - x) * t) : slerp(a.q, next.q, t);
}

/** Plain-array pose, ready to load into the Studio's Three.js objects. */
export function sampleTracks(anim, f, boneNames = []) {
  const names = new Set([...boneNames, ...Object.keys(anim.tracks || {})]);
  const rot = {};
  for (const name of names) if (name !== '$root') rot[name] = sampleTrack(anim.tracks?.[name], f, anim, name);
  return { rot, root: sampleTrack(anim.tracks?.$root, f, anim, '$root') };
}

export function keyTrackFrames(anim, name) {
  return (anim.tracks?.[name]?.keys || []).map((key) => key.f);
}

/** Add/replace ONLY this bone (or root). Migrate the animation before editing it. */
export function upsertTrackKey(anim, name, key) {
  const keys = anim.tracks?.[name]?.keys || [];
  const previous = keys.find((item) => item.f === key.f);
  const next = checkedKey(key, name, anim, previous);
  const result = [...keys.filter((item) => item.f !== next.f), next].sort((a, b) => a.f - b.f);
  anim.tracks ||= {};
  anim.tracks[name] = { ...anim.tracks[name], keys: result };
  return next;
}

/** Moving onto another key is rejected, without losing either pose. */
export function moveTrackKey(anim, name, from, to) {
  frame(from, anim); frame(to, anim);
  const keys = anim.tracks?.[name]?.keys || [], key = keys.find((item) => item.f === from);
  if (!key || from === to) return false;
  if (keys.some((item) => item.f === to)) throw new Error(`A key already occupies frame ${to + 1}.`);
  const result = keys.map((item) => item === key ? { ...item, f: to } : item).sort((a, b) => a.f - b.f);
  anim.tracks[name] = { ...anim.tracks[name], keys: result };
  return true;
}

/** Keep the last pose by default. Explicitly allowing empty tracks resets ONLY
 * that bone to rest; the empty track prevents old whole-pose keys reappearing.
 */
export function deleteTrackKey(anim, name, f, { allowEmpty = false } = {}) {
  frame(f, anim);
  const keys = anim.tracks?.[name]?.keys || [];
  if (!keys.some((key) => key.f === f) || (keys.length < 2 && !allowEmpty)) return false;
  anim.tracks[name] = { ...anim.tracks[name], keys: keys.filter((key) => key.f !== f) };
  return true;
}
