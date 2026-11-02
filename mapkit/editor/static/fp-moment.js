// A first-person moment, the page's part without three.js (the editor: fp-moments.js; the build: editor/fpmoments.py;
// in the game UCViewMoment, whose rules these are): the weapon JC holds plays clips of its own animations one after
// another, moves in the view by keys, with sounds and a shake of the view, then goes back to how it was.
//   {weapon, mesh, view: its PlayerViewOffset, clips: [{seq, from, to, frames, secs}], offsets: [{t, x, y, z}],
//    sounds: [{t, sound}], shake: {t, secs, roll, vert}}
// A clip plays its sequence from frame `from` to frame `to` (to before from: backwards) in `secs` seconds; the last
// clip's last frame stays until the moment ends. Offsets go straight from key to key, from 0 before the first.

export const MOMENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
export const MAX_CLIPS = 16, MAX_OFFSETS = 16, MAX_SOUNDS = 8;
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
export function momentLength(m) {
  let t = (m.clips || []).slice(0, MAX_CLIPS).reduce((s, c) => s + Math.max(0.01, num(c.secs, 1)), 0);
  for (const o of (m.offsets || []).slice(0, MAX_OFFSETS)) t = Math.max(t, num(o.t));
  for (const s of (m.sounds || []).slice(0, MAX_SOUNDS)) t = Math.max(t, num(s.t));
  if (num(m.shake?.secs) > 0) t = Math.max(t, num(m.shake.t) + num(m.shake.secs));
  return t;
}
// the weapon's place at t: [x, y, z] added to its PlayerViewOffset
export function offsetAt(offsets, t) {
  const keys = [...(offsets || [])].sort((a, b) => num(a.t) - num(b.t)).slice(0, MAX_OFFSETS);
  const v = (o) => [num(o.x), num(o.y), num(o.z)];
  if (!keys.length) return [0, 0, 0];
  if (t <= num(keys[0].t)) { const u = t / Math.max(0.01, num(keys[0].t)); return v(keys[0]).map((c) => c * u); }
  for (let i = 1; i < keys.length; i++) {
    if (t <= num(keys[i].t)) {
      const u = (t - num(keys[i - 1].t)) / Math.max(0.01, num(keys[i].t) - num(keys[i - 1].t)), a = v(keys[i - 1]), b = v(keys[i]);
      return a.map((c, k) => c + (b[k] - c) * u);
    }
  }
  return v(keys[keys.length - 1]);
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
