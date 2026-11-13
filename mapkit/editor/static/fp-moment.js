// A first-person moment, the page's part without three.js (the editor: fp-moments.js; the build: editor/fpmoments.py;
// in the game UCViewMoment, whose rules these are): the weapon JC holds plays clips of its own animations one after
// another, moves in the view by keys, with sounds and a shake of the view, then goes back to how it was.
//   {weapon, mesh, view: its PlayerViewOffset, clips: [{seq, from, to, frames, secs}], offsets: [{t, x, y, z, ease}],
//    sounds: [{t, sound}], shake: {t, secs, roll, vert}}
// A clip plays its sequence from frame `from` to frame `to` (to before from: backwards) in `secs` seconds; the last
// clip's last frame stays until the moment ends. Offsets go from key to key, from 0 before the first; a key's `ease`
// shapes the way to it (13 Nov 2026): the game goes straight between keys, so an eased way is laid as a few straight
// steps (gameOffsets, the same in editor/fpmoments.py), the 16 keys the game has shared out among the eased ways.

export const MOMENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
export const MAX_CLIPS = 16, MAX_OFFSETS = 16, MAX_SOUNDS = 8;
export const EASES = [['smooth', 'Smooth'], ['linear', 'Straight'], ['in', 'Ease in'], ['out', 'Ease out']];
export const STEPS_MAX = 4;           // straight steps an eased way is laid as, at most
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

export function newMoment(weapon = '', mesh = '', view = null, seqs = []) {
  const first = seqs.find((s) => /^select$/i.test(s.name)) || seqs.find((s) => !/^(all|still)$/i.test(s.name)) || null;
  return { weapon, mesh, view, clips: first ? [clipOf(first)] : [], offsets: [], sounds: [], shake: { t: 0, secs: 0, roll: 200, vert: 4 } };
}
// a clip of a whole sequence, at the game's own speed
export function clipOf(seq) {
  const n = Math.max(1, seq.frames ?? seq.count ?? 1);
  return { seq: seq.name, from: 0, to: n - 1, frames: n, secs: +(n / Math.max(1, seq.rate || 15)).toFixed(2) };
}
// when each clip starts: [{start, secs}] in order
export function clipTimes(m) {
  let at = 0;
  return (m.clips || []).slice(0, MAX_CLIPS).map((c) => { const secs = Math.max(0.01, num(c.secs, 1)), r = { start: at, secs }; at += secs; return r; });
}
export function momentLength(m) {
  let t = (m.clips || []).slice(0, MAX_CLIPS).reduce((s, c) => s + Math.max(0.01, num(c.secs, 1)), 0);
  for (const o of (m.offsets || []).slice(0, MAX_OFFSETS)) t = Math.max(t, num(o.t));
  for (const s of (m.sounds || []).slice(0, MAX_SOUNDS)) t = Math.max(t, num(s.t));
  if (num(m.shake?.secs) > 0) t = Math.max(t, num(m.shake.t) + num(m.shake.secs));
  return t;
}

// a way's shape: u (0..1 of the time) -> how far along
export function ease(kind, u) {
  u = Math.min(1, Math.max(0, u));
  if (kind === 'smooth') return u * u * (3 - 2 * u);
  if (kind === 'in') return u * u;
  if (kind === 'out') return 1 - (1 - u) * (1 - u);
  return u;
}
const easeOf = (o) => (EASES.some(([k]) => k === o.ease) ? o.ease : 'linear');
// The keys as the game has them: straight from one to the next, an eased way laid as steps. A key without `ease` (a
// moment made before 13 Nov 2026) goes straight. Steps are shared out among the eased ways within the game's 16 keys.
export function gameOffsets(offsets) {
  const keys = [...(offsets || [])].filter((o) => o && typeof o === 'object').sort((a, b) => num(a.t) - num(b.t)).slice(0, MAX_OFFSETS);
  const eased = keys.filter((o) => easeOf(o) !== 'linear').length;
  const steps = eased ? Math.min(STEPS_MAX, Math.floor((MAX_OFFSETS - keys.length) / eased)) : 0;
  const out = [];
  let prev = { t: 0, x: 0, y: 0, z: 0 };
  for (const o of keys) {
    const k = { t: num(o.t), x: num(o.x), y: num(o.y), z: num(o.z) }, kind = easeOf(o);
    if (kind !== 'linear' && steps > 0 && k.t - prev.t > 0.02) {
      for (let j = 1; j <= steps; j++) {
        const u = j / (steps + 1), f = ease(kind, u);
        out.push({ t: round(prev.t + (k.t - prev.t) * u), x: round(prev.x + (k.x - prev.x) * f), y: round(prev.y + (k.y - prev.y) * f), z: round(prev.z + (k.z - prev.z) * f) });
      }
    }
    out.push(k);
    prev = k;
  }
  return out;
}
const round = (x) => Math.round(x * 1e6) / 1e6;
// the weapon's place at t, as the game puts it: [x, y, z] added to its PlayerViewOffset
export function offsetAt(offsets, t) {
  const keys = gameOffsets(offsets);
  const v = (o) => [o.x, o.y, o.z];
  if (!keys.length) return [0, 0, 0];
  if (t <= keys[0].t) { const u = t / Math.max(0.01, keys[0].t); return v(keys[0]).map((c) => c * u); }
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const u = (t - keys[i - 1].t) / Math.max(0.01, keys[i].t - keys[i - 1].t), a = v(keys[i - 1]), b = v(keys[i]);
      return a.map((c, k) => c + (b[k] - c) * u);
    }
  }
  return v(keys[keys.length - 1]);
}
// the authored key at t (within `near` seconds), its index or -1
export function keyNear(offsets, t, near = 0.02) {
  return (offsets || []).findIndex((o) => Math.abs(num(o.t) - t) <= near);
}
// what the weapon shows at t: {clip (its index), seq, frame (within its sequence, a fraction between two frames)}; null
// when it has no clips
export function frameAt(m, t) {
  const clips = (m.clips || []).slice(0, MAX_CLIPS);
  let at = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i], secs = Math.max(0.01, num(c.secs, 1));
    if (t < at + secs || i === clips.length - 1) {
      const u = Math.min(1, Math.max(0, (t - at) / secs));
      return { clip: i, seq: c.seq, frame: num(c.from) + (num(c.to) - num(c.from)) * u };
    }
    at += secs;
  }
  return null;
}
// the sounds that start after t0 and by t1 (a step of the preview)
export function soundsBetween(m, t0, t1) {
  return (m.sounds || []).slice(0, MAX_SOUNDS).filter((s) => s.sound && num(s.t) > t0 && num(s.t) <= t1);
}
// The view's shake at t, about as the game's ShakeView makes it (PlayerPawn: the roll flips side every frame within
// shakemag x the time left, the eye goes up and down by 1.1 x vert, both dying away): {roll (degrees), up (units)}.
// The weapon stays where it is on the screen: the world round it shakes.
export function shakeAt(m, t, frame = 0) {
  const s = m.shake || {}, secs = num(s.secs);
  if (secs <= 0 || t < num(s.t) || t >= num(s.t) + secs) return { roll: 0, up: 0 };
  const left = num(s.t) + secs - t, side = frame % 2 ? 1 : -1;
  return { roll: side * Math.min(num(s.roll, 200) * left, num(s.roll, 200)) * 360 / 65536, up: (Math.floor(frame / 3) % 2 ? 1 : -1) * 1.1 * num(s.vert, 4) * (left / secs) };
}
// '' or what to say of the end: the last move not back at 0 0 0 makes the weapon jump back when the moment ends
export function endJump(m) {
  const keys = [...(m.offsets || [])].sort((a, b) => num(a.t) - num(b.t));
  const last = keys[keys.length - 1];
  if (!last || Math.hypot(num(last.x), num(last.y), num(last.z)) < 0.01) return '';
  return 'Its last move does not bring the weapon back (0 0 0): in the game it jumps back when the moment ends.';
}
// the rules of the map that play the moment called name
export function rulesPlaying(edits, name) {
  return (edits?.links || []).filter((l) => l && [...(l.do || []), ...(l.else || [])].some((a) => a && a.verb === 'fpmoment' && a.a === name));
}
// what is wrong with it for the game ('' nothing)
export function momentProblem(m, seqNames = null) {
  if (!(m.clips || []).length && !(m.offsets || []).length) return 'It does nothing yet: add a clip or a move.';
  if ((m.clips || []).length > MAX_CLIPS) return `At most ${MAX_CLIPS} clips.`;
  if ((m.offsets || []).length > MAX_OFFSETS) return `At most ${MAX_OFFSETS} moves.`;
  if ((m.sounds || []).length > MAX_SOUNDS) return `At most ${MAX_SOUNDS} sounds.`;
  const missing = seqNames ? (m.clips || []).find((c) => !seqNames.includes(c.seq)) : null;
  if (missing) return `The weapon's model has no animation ${missing.seq}.`;
  return '';
}
