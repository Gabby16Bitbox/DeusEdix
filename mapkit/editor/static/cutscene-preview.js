// A cutscene's events as the editor previews them while its playhead moves (cutscene.js): what the actions of its
// Events lane (the Interactions "When it starts" of the cutscene, each after its seconds) have done to the objects at
// time t, as the game does them (UCLink.DoAct; UCEditorStory's DoorOpen, DoorShut, NpcGo; UCMotion.Play; the engine's
// Mover and ElevatorMover), and the voices of its subtitles sounding then (UCCutscene.ShowLines). No page: app.js
// (previewTarget) says what each object is, cutscene.js shows the result on it and puts it back.
//
// - An animation (UCMotion, the Animation panel): Play its animation / Play it backwards from where its clock is (from
//   its start, or its end, when it is there), Stop its animation; once, in a loop, back and forth.
// - A door, an elevator, a moving block (a Mover): Open goes through its keys to the last one after its DelayTime,
//   Close back to the first, Open or close as the game chooses; one that closes by itself (TriggerOpenTimed,
//   BumpOpenTimed, StandOpenTimed) does after StayOpenTime; Go to a floor (an ElevatorMover) goes straight to that
//   key. Each step takes its MoveTime (an animated one: its keys' times), gliding (eased in and out) or at one speed;
//   a step started between two keys goes straight from there to its key (the engine's InterpolateTo). Play its
//   animation and Play it backwards move it the same way.
// - Vanish / Appear again, Leave / Come back: hidden or shown at that second (in the game a character leaves and comes
//   back when JC does not see).
// - Turn on / Turn off / Turn on or off: a light.
// - Walk / Run to a place: a character goes there at its walking speed (GroundSpeed x WalkingSpeed) or its running
//   speed (GroundSpeed), along the way the caller gives (a straight line unless it gives another); Stand still stops
//   it where it is.
// Events: [{verb, t (its second in the cutscene), name (the object), at (the place of Walk / Run), nav (on the walkable
// area), a (a floor)}], in the order of the rule; those at the same second happen in that order.

const YAW = 65536;
// a place picked for Walk / Run is this far above the floor clicked (app.js lkPicked); the game stands the character on
// the floor under it (UCEditorStory.NpcGo: the floor + its CollisionHeight)
export const PICK_RAISE = 40;
// the door states that close again by themselves, after StayOpenTime (Engine Mover.uc: their Open label sleeps, then
// closes); the others stay open until something closes them
const TIMED = new Set(['TriggerOpenTimed', 'BumpOpenTimed', 'StandOpenTimed']);
// DeusExMover's own values where neither the map nor the class (when it is known) says (Mover.uc, DeusExMover.uc)
const MOVER = { NumKeys: 2, KeyNum: 0, MoveTime: 1, StayOpenTime: 4, DelayTime: 0, InitialState: 'TriggerToggle', MoverGlideType: 'MV_GlideByTime' };
const MAX_KEYS = 8;                        // a Mover's KeyPos[8]
const VEC = ['X', 'Y', 'Z'], ROT = ['Pitch', 'Yaw', 'Roll'];

// what each action shows on: the parts of an object (previewTarget) it acts on; 'any': whatever the editor shows
const ACTS_ON = {
  anim: ['motion', 'mover'], animback: ['motion', 'mover'], animstop: ['motion'],
  open: ['mover'], close: ['mover'], toggle: ['mover'], floor: ['elevator'],
  hide: ['any'], show: ['any'], leave: ['any'], appear: ['any'],
  lighton: ['light'], lightoff: ['light'], lighttoggle: ['light'],
  goto: ['walker'], run: ['walker'], stand: ['walker'],
};
// whether the editor shows this action on that object (target: previewTarget's description, null: none)
export function shows(verb, target) {
  return !!target && (ACTS_ON[verb] || []).some((part) => part === 'any' || !!target[part]);
}

// how long a subtitle shows (UCCutscene.LineLen): its seconds, else as long as its text needs
export function lineLen(ln) { return +ln.d > 0 ? +ln.d : 2 + String(ln.text || '').length * 0.06; }

// ---------------------------------------------------------------- a mover's keys
// the numbers of a T3D struct, "(X=1.0,Z=-64.0)", in the order of its fields (what it leaves out is 0)
function structNumbers(text, fields) {
  const m = new Map();
  for (const pair of String(text ?? '').replace(/^\s*\(|\)\s*$/g, '').split(',')) {
    const i = pair.indexOf('=');
    if (i > 0) m.set(pair.slice(0, i).trim(), +pair.slice(i + 1) || 0);
  }
  return fields.map((f) => m.get(f) || 0);
}
const minus = (a, b) => a.map((v, i) => v - b[i]);
const bool = (v) => String(v ?? '').toLowerCase() === 'true';

// A door's or an elevator's keys as the map has them (read(key): the value of a property, the map's or its class's;
// undefined when neither says): {keys: [{pos, rot}] (offsets from where it stands now, its KeyNum), seg: each step's
// seconds, at: the key it stands at, glide, delay (DelayTime), stay (seconds open before it closes by itself, or null)}
export function moverFromProps(read) {
  const get = (key) => read(key) ?? MOVER[key];
  const n = Math.max(1, Math.min(MAX_KEYS, Math.round(+get('NumKeys')) || MOVER.NumKeys));
  const at = Math.max(0, Math.min(n - 1, Math.round(+get('KeyNum')) || 0));
  const pos = (i) => structNumbers(read(`KeyPos(${i})`), VEC), rot = (i) => structNumbers(read(`KeyRot(${i})`), ROT);
  const p0 = pos(at), r0 = rot(at), move = Math.max(0.05, +get('MoveTime') || 0);
  const timed = TIMED.has(String(get('InitialState'))) && !bool(read('bTriggerOnceOnly'));
  return { keys: Array.from({ length: n }, (_, i) => ({ pos: minus(pos(i), p0), rot: minus(rot(i), r0) })),
    seg: Array(Math.max(0, n - 1)).fill(move), at, glide: String(get('MoverGlideType')) !== 'MV_MoveByTime',
    delay: Math.max(0, +get('DelayTime') || 0), stay: timed ? Math.max(0, +get('StayOpenTime') || 0) : null };
}

// ---------------------------------------------------------------- state at a time
// an animation's clock dt seconds after it was at c going dir (1 or -1), len long: {c, playing} ('once' ends at its
// end or its start)
export function advance(c, dir, dt, len, mode) {
  if (!(len > 0)) return { c: 0, playing: false };
  const x = c + dir * dt;
  if (mode === 'loop') return { c: ((x % len) + len) % len, playing: true };
  if (mode === 'pingpong') { const m = ((x % (2 * len)) + 2 * len) % (2 * len); return { c: m <= len ? m : 2 * len - m, playing: true }; }
  return { c: Math.max(0, Math.min(len, x)), playing: x > 0 && x < len };
}
function clockAt(m, motion, t) {
  return m.playing ? advance(m.c, m.dir, t - m.since, motion.len, motion.mode) : { c: m.c, playing: false };
}

const glided = (u, glide) => (glide ? u * u * (3 - 2 * u) : u);
const lerp = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);
// A mover at time t: {pose: {pos, rot} offsets, key: the key it is at or going to (its KeyNum), moving, opening (as
// DoOpen / DoClose set bOpening)}. mv: where it was (from, key, opening) when its plan began (since): legs, each a wait
// or a step to a key
function moverAt(mv, k, t) {
  let pose = mv.from, key = mv.key, opening = mv.opening, clock = mv.since;
  for (const leg of mv.legs) {
    if (leg.wait !== undefined) {
      if (t < clock + leg.wait) return { pose, key, moving: false, opening };
      clock += leg.wait;
      continue;
    }
    if (leg.opening !== undefined) opening = leg.opening;
    key = leg.to;
    const to = k.keys[leg.to];
    if (t < clock + leg.d) {
      const u = glided(Math.max(0, (t - clock) / leg.d), k.glide);
      return { pose: { pos: lerp(pose.pos, to.pos, u), rot: lerp(pose.rot, to.rot, u) }, key, moving: true, opening };
    }
    pose = to;
    clock += leg.d;
  }
  return { pose, key, moving: false, opening };
}
// Open (Mover's Open label: DelayTime, DoOpen, the keys chained to the last; a timed door: StayOpenTime, then closes)
function openLegs(k, from) {
  const last = k.keys.length - 1, legs = k.delay > 0 ? [{ wait: k.delay }] : [];
  for (let i = from; i < last; i++) legs.push({ to: i + 1, d: k.seg[i], opening: i === from ? true : undefined });
  if (k.stay !== null) legs.push({ wait: k.stay }, ...closeLegs(k, last));
  return legs;
}
// Close (DoClose: to the key below the one it is at or going to, then chained down to the first)
function closeLegs(k, key) {
  const legs = [];
  for (let i = Math.max(0, key - 1); i >= 0; i--) legs.push({ to: i, d: k.seg[i] ?? k.seg[0] ?? 1, opening: legs.length ? undefined : false });
  return legs;
}
function plan(s, t, now, legs) { s.mover = { since: t, from: now.pose, key: now.key, opening: now.opening, legs }; }
function moverNow(s, k, t) {
  return moverAt(s.mover || { since: 0, from: k.keys[k.at], key: k.at, opening: false, legs: [] }, k, t);
}

// a character at time t: {pos, yaw, moving, run, walked (seconds it has walked)}; where it stands while no walk
function walkerAt(w, wk, t) {
  if (!w) return { pos: wk.from, yaw: wk.yaw, moving: false, run: false, walked: 0 };
  let left = Math.max(0, t - w.since) * w.speed, yaw = w.yaw;
  for (let i = 1; i < w.way.length; i++) {
    const a = w.way[i - 1], b = w.way[i], d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.5) yaw = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) * YAW / (2 * Math.PI));
    if (left < d) return { pos: lerp(a, b, left / d), yaw, moving: true, run: w.run, walked: t - w.since };
    left -= d;
  }
  const length = w.way.slice(1).reduce((n, b, i) => n + Math.hypot(...b.map((v, j) => v - w.way[i][j])), 0);
  return { pos: w.way[w.way.length - 1], yaw, moving: false, run: w.run, walked: w.speed > 0 ? length / w.speed : 0 };
}
// where a character sent to a place stands: on the floor under it (PICK_RAISE), its height above it
export function goal(at, height) {
  return Array.isArray(at) && at.length === 3 ? [+at[0], +at[1], +at[2] - PICK_RAISE + (+height || 0)] : null;
}
const straight = (from, to) => [from, to];

// what each action does to an object's state s at its second (e.t); tg: what the object is
const DO = {
  anim: (s, e, tg) => (tg.mover ? moverGo(s, e, tg.mover, false) : play(s, e, tg.motion, 1)),
  animback: (s, e, tg) => (tg.mover ? moverGo(s, e, tg.mover, true) : play(s, e, tg.motion, -1)),
  animstop: (s, e, tg) => {
    const m = s.motion || { c: 0, dir: 1, playing: false, since: 0 };
    s.motion = { c: clockAt(m, tg.motion, e.t).c, dir: m.dir, playing: false, since: e.t };
  },
  open: (s, e, tg) => {                     // DoorOpen: not while it moves, nor when it is not at its first key
    const now = moverNow(s, tg.mover, e.t);
    if (now.key === 0 && !now.moving) plan(s, e.t, now, openLegs(tg.mover, 0));
  },
  close: (s, e, tg) => {                    // DoorShut: not when it rests at its first key
    const now = moverNow(s, tg.mover, e.t);
    if (now.key !== 0 || now.moving) plan(s, e.t, now, closeLegs(tg.mover, now.key));
  },
  toggle: (s, e, tg) => {
    const now = moverNow(s, tg.mover, e.t);
    DO[now.key === 0 && !now.opening ? 'open' : 'close'](s, e, tg);
  },
  floor: (s, e, tg) => {                    // ElevatorMover.SetSeq: not while it moves; straight to that key
    const now = moverNow(s, tg.mover, e.t), n = Math.round(+e.a || 0);
    if (!now.moving && n >= 0 && n < tg.mover.keys.length && n !== now.key) plan(s, e.t, now, [{ to: n, d: tg.mover.seg[0] ?? 1 }]);
  },
  hide: (s) => { s.hidden = true; },
  leave: (s) => { s.hidden = true; },
  show: (s) => { s.hidden = false; },
  appear: (s) => { s.hidden = false; },
  lighton: (s) => { s.light = true; },
  lightoff: (s) => { s.light = false; },
  lighttoggle: (s, e, tg) => { s.light = !(s.light ?? tg.light.on); },
  goto: (s, e, tg, route) => walk(s, e, tg.walker, route),
  run: (s, e, tg, route) => walk(s, e, tg.walker, route),
  stand: (s, e, tg) => {                    // Orders Standing: it stops where it is
    const now = walkerAt(s.walk, tg.walker, e.t);
    s.walk = { since: e.t, way: [now.pos], speed: 0, run: false, yaw: now.yaw };
  },
};
// UCMotion.Play: on from where its clock is; from its start (its end, backwards) when it is at the other end
function play(s, e, motion, dir) {
  const m = s.motion || { c: 0, dir: 1, playing: false, since: 0 };
  let c = clockAt(m, motion, e.t).c;
  if (dir > 0 && c >= motion.len) c = 0;
  if (dir < 0 && c <= 0) c = motion.len;
  s.motion = { c, dir, playing: true, since: e.t };
}
// UCMotion.MoverGo: not while it moves; on to its last key (its door state's Open), or back to its first (Close)
function moverGo(s, e, k, back) {
  const now = moverNow(s, k, e.t);
  if (now.moving) return;
  if (!back && now.key < k.keys.length - 1) plan(s, e.t, now, openLegs(k, now.key));
  if (back && now.key > 0) plan(s, e.t, now, closeLegs(k, now.key));
}
function walk(s, e, wk, route) {
  const to = goal(e.at, wk.height), run = e.verb === 'run';
  if (!to) return;
  const now = walkerAt(s.walk, wk, e.t);
  s.walk = { since: e.t, way: route(now.pos, to, e), speed: run ? wk.run : wk.walk, run, yaw: now.yaw };
}

// The state of the objects at time t of the cutscene: name -> {clock (its animation's), pose (a mover's {pos, rot}
// offsets), hidden, light (on), walk ({pos, yaw, moving, run, walked})}, for the objects an event has acted on by then
// (the others are as the editor shows them). targets: name -> what the object is (previewTarget: {motion: {len, mode},
// mover (moverFromProps' shape), elevator, light: {on}, walker: {from, yaw, walk, run, height}}); route(from, to, e):
// the way a character goes for event e, a list of places from where it is to where it goes.
export function stateAt(events, t, targets, route = straight) {
  const states = new Map();
  for (const e of [...events].sort((x, y) => x.t - y.t)) {
    if (e.t > t) break;
    const tg = targets.get(e.name);
    if (!shows(e.verb, tg)) continue;
    if (!states.has(e.name)) states.set(e.name, {});
    DO[e.verb](states.get(e.name), e, tg, route);
  }
  const out = new Map();
  for (const [name, s] of states) {
    const tg = targets.get(name), now = {};
    if (s.motion) now.clock = clockAt(s.motion, tg.motion, t).c;
    if (s.mover) now.pose = moverAt(s.mover, tg.mover, t).pose;
    if (s.hidden !== undefined) now.hidden = s.hidden;
    if (s.light !== undefined) now.light = s.light;
    if (s.walk) now.walk = walkerAt(s.walk, tg.walker, t);
    out.set(name, now);
  }
  return out;
}

// The voices of the subtitles sounding at time t, as UCCutscene.ShowLines plays them: a line's sound starts when that
// line becomes the one shown (of the lines with a text, the last in time order whose time it is), and plays to its end.
// [{line (its index in lines), sound, from (seconds into it)}]; lengthOf(sound): its seconds, undefined while not known
// (left out until then).
export function voicesAt(lines, t, lengthOf) {
  const shown = lines.map((ln, i) => ({ ln, i })).filter((x) => String(x.ln.text || '').trim()).sort((x, y) => +x.ln.t - +y.ln.t);
  const marks = [...new Set([0, ...shown.flatMap((x) => [+x.ln.t, +x.ln.t + lineLen(x.ln)])])].filter((m) => m <= t).sort((x, y) => x - y);
  const out = [];
  let now = -1;
  for (const m of marks) {
    let n = -1;
    shown.forEach((x, k) => { if (m >= +x.ln.t && m < +x.ln.t + lineLen(x.ln)) n = k; });
    if (n === now) continue;
    now = n;
    const x = shown[n], len = x && x.ln.snd ? lengthOf(x.ln.snd) : undefined;
    if (len !== undefined && t < m + len) out.push({ line: x.i, sound: x.ln.snd, from: t - m });
  }
  return out;
}
