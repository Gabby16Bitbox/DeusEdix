// Particles in the 3D view (Objects > Effects; in the game a ParticleGenerator, the steam vents' and the smoke's, or one
// of its subclasses): its arrow is the way the particles are thrown (its rotation, as the game's generator ejects along
// it), and while it is selected (or always, as its Particles section says) the particles play: spawned, thrown, rising
// or falling, growing and fading as its settings say, with its own texture. The rules are the generator's as far as
// they are known (UCEffect sets the same settings for its mist, smoke and sparks); the preview is close to the game,
// not the game itself: Rebuild and Play show it for sure.
// The page's part (no three.js): the settings, their values as the map has them, the step of the simulation. Tested in
// tests/test_particles.mjs.

// the classes drawn this way (by their name without the package)
export const isParticleClass = (cls) => /^(ParticleGenerator|UCParticles)$/i.test(String(cls || '').split('.').pop());

// The settings of the Particles section, in its order: key (the game's property), label, type, the fallback default
// (the class's own, read from the game, comes first), the field's range and step, what it does.
export const PARTICLE_FIELDS = Object.freeze([
  { key: 'particleTexture', label: 'Texture', type: 'texture', def: "Texture'Effects.Smoke.SmokePuff1'", tip: 'The picture of each particle (pick one: the Effects package has the game\'s smoke, sparks and flames)' },
  { key: 'frequency', label: 'Chance', type: 'float', def: 1, min: 0, max: 1, step: 0.05, tip: 'The chance of a puff at each check (1: every time)' },
  { key: 'checkTime', label: 'Every (s)', type: 'float', def: 0.1, min: 0.01, max: 10, step: 0.01, tip: 'How often it checks whether to throw particles' },
  { key: 'numPerSpawn', label: 'Particles each time', type: 'int', def: 1, min: 1, max: 50, step: 1, tip: 'How many particles each puff throws' },
  { key: 'ejectSpeed', label: 'Speed', type: 'float', def: 50, min: 0, max: 2000, step: 5, tip: 'How fast they are thrown along the arrow (units a second)' },
  { key: 'riseRate', label: 'Rise', type: 'float', def: 50, min: -1000, max: 1000, step: 5, tip: 'How fast they rise (units a second); below 0 they sink, like cold mist' },
  { key: 'particleLifeSpan', label: 'Life (s)', type: 'float', def: 4, min: 0.05, max: 60, step: 0.1, tip: 'How long each particle lasts' },
  { key: 'particleDrawScale', label: 'Size', type: 'float', def: 0.1, min: 0.01, max: 20, step: 0.05, tip: 'The size of each particle (1: its texture\'s size in units)' },
  { key: 'bRandomEject', label: 'Spread out', type: 'bool', def: false, tip: 'Thrown in directions around the arrow, not all straight along it' },
  { key: 'bGravity', label: 'Gravity', type: 'bool', def: false, tip: 'They fall, like sparks' },
  { key: 'bScale', label: 'Grow', type: 'bool', def: true, tip: 'Each particle grows as it lives, like smoke' },
  { key: 'bFade', label: 'Fade out', type: 'bool', def: true, tip: 'Each particle fades as it lives' },
  { key: 'bParticlesUnlit', label: 'Glow (unlit)', type: 'bool', def: false, tip: 'Full bright whatever the light, like sparks and flames' },
  { key: 'bModulated', label: 'Darkens (modulated)', type: 'bool', def: false, tip: 'Darkens what is behind it (dark smoke, soot) instead of lighting it' },
  // UCParticles' own (DeusEdix's class: damage and switching; group 'hurt'): not the game's ParticleGenerator's
  { key: 'FxDamage', label: 'Damage', type: 'int', def: 0, min: 0, max: 500, step: 1, group: 'hurt', own: 'UCParticles', tip: 'Damage each hit (0: it hurts no one)' },
  { key: 'FxDamageType', label: 'Kind', type: 'name', def: 'Burned', group: 'hurt', own: 'UCParticles', tip: 'The game\'s kind of damage: what JC\'s augmentations and armour resist',
    options: [['Burned', 'Fire (burns)'], ['Shocked', 'Electricity (shocks)'], ['PoisonGas', 'Poison gas'], ['TearGas', 'Tear gas'],
      ['Radiation', 'Radiation'], ['EMP', 'EMP (drains bioenergy)'], ['Exploded', 'Explosion'], ['Shot', 'Shot'], ['Stunned', 'Stun']] },
  { key: 'FxRadius', label: 'Radius', type: 'float', def: 48, min: 1, max: 2000, step: 4, group: 'hurt', own: 'UCParticles', tip: 'How far from its stream it hurts (units)' },
  { key: 'FxReach', label: 'Reach', type: 'float', def: 0, min: 0, max: 4000, step: 8, group: 'hurt', own: 'UCParticles', tip: 'How far along its arrow the stream goes (0: a ball round it)' },
  { key: 'FxEvery', label: 'Hit every (s)', type: 'float', def: 0.5, min: 0.1, max: 30, step: 0.1, group: 'hurt', own: 'UCParticles', tip: 'Seconds between hits' },
  { key: 'bFxHurtAll', label: 'Hurts characters too', type: 'bool', def: false, group: 'hurt', own: 'UCParticles', tip: 'Off: JC only' },
  { key: 'bFxStartOn', label: 'On at the start', type: 'bool', def: true, group: 'switch', own: 'UCParticles', tip: 'Off: it waits for "Switch on" (an interaction, or a trigger through its Tag)' },
  { key: 'FxOnTime', label: 'Stays on (s)', type: 'float', def: 0, min: 0, max: 3600, step: 0.5, group: 'switch', own: 'UCParticles', tip: 'Switched on, it goes off by itself after these seconds (0: until switched off)' },
  { key: 'bFxToggle', label: '"Switch on" also switches it off', type: 'bool', def: false, group: 'switch', own: 'UCParticles', tip: 'A button pressed again turns it off' },
]);
const BY_KEY = Object.fromEntries(PARTICLE_FIELDS.map((f) => [f.key.toLowerCase(), f]));

// A value as the map or the game writes it ("0.500000", "True", Texture'Pkg.Name', "Pkg.Name") as the field's type
export function parseValue(field, text) {
  if (text === undefined || text === null || text === '') return undefined;
  const s = String(text).trim();
  if (field.type === 'bool') return /^true$/i.test(s.replace(/"/g, ''));
  if (field.type === 'name') return s.replace(/["']/g, '') || undefined;
  if (field.type === 'texture') {
    const m = /^\w*'([^']+)'$/.exec(s);
    const name = (m ? m[1] : s).replace(/"/g, '');
    return /^none$/i.test(name) ? '' : name;
  }
  const n = Number(s.replace(/"/g, ''));
  if (!Number.isFinite(n)) return undefined;
  return field.type === 'int' ? Math.round(n) : n;
}
// A value as the map is given it (the Properties' text)
export function formatValue(field, value) {
  if (field.type === 'bool') return value ? 'True' : 'False';
  if (field.type === 'name') return String(value || '').replace(/[^A-Za-z0-9_]/g, '') || 'None';
  if (field.type === 'texture') return value ? `Texture'${String(value).replace(/'/g, '')}'` : 'None';
  if (field.type === 'int') return String(Math.round(Number(value) || 0));
  return (Number(value) || 0).toFixed(6);
}
// a typed value within the field's range (null: not a value)
export function clampValue(field, value) {
  if (field.type === 'bool') return !!value;
  if (field.type === 'texture') return String(value || '').trim();
  if (field.type === 'name') return field.options && !field.options.some(([k]) => k === value) ? null : String(value || '');
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const v = Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, n));
  return field.type === 'int' ? Math.round(v) : v;
}

// The class's defaults as the game says them (all-props.js classProps: [{name, default}]), by key in lower case
export function defaultsFrom(classProps) {
  const out = {};
  for (const p of (classProps && classProps.props) || []) {
    const f = BY_KEY[String(p.name).toLowerCase()];
    if (f && !p.index) {                                   // (an array's first: none of these is one)
      const v = parseValue(f, p.default);
      if (v !== undefined) out[f.key] = v;
    }
  }
  return out;
}
// the settings the class has (classProps null: not read yet: those it may have by its name: UCParticles' own only on it)
export function fieldsOf(classProps, cls = '') {
  const name = String(cls || '').split('.').pop().toLowerCase();
  if (!classProps || !Array.isArray(classProps.props)) return PARTICLE_FIELDS.filter((f) => !f.own || f.own.toLowerCase() === name);
  const has = new Set(classProps.props.map((p) => String(p.name).toLowerCase()));
  return PARTICLE_FIELDS.filter((f) => has.has(f.key.toLowerCase()));
}
// The settings of one generator now: read(key) gives the map's or the page's text (undefined: not set there), then the
// class's default, then the fallback
export function particleSettings(read, defaults = {}) {
  const out = {};
  for (const f of PARTICLE_FIELDS) {
    const own = parseValue(f, read(f.key));
    out[f.key] = own !== undefined ? own : defaults[f.key] !== undefined ? defaults[f.key] : f.def;
  }
  return out;
}

// ---------------------------------------------------------------- the simulation (no three.js: units, seconds)
// A generator's particles: [{p: [x, y, z], v: [x, y, z], age, life, size}] in its own frame (+X: its arrow, +Z: up in
// the world, given), stepped by dt. rand(): 0..1. What a step does, as the game's generator: every checkTime it may
// (frequency) throw numPerSpawn particles along the arrow at ejectSpeed (around it with bRandomEject); they rise at
// riseRate, fall with bGravity, live particleLifeSpan, grow with bScale.
export const GRAVITY = 950;           // the engine's zones pull at 950 units a second, each second
export const MAX_PARTICLES = 400;     // a preview never has more (a setting typed too big would choke the view)
export function createSimulation(rand = Math.random) {
  return { acc: 0, list: [], rand };
}
export function stepSimulation(sim, s, dt, up = [0, 0, 1]) {
  const rand = sim.rand;
  // those already thrown move first (the new ones start where they are thrown)
  for (const q of sim.list) {
    q.age += dt;
    if (s.bGravity) for (let k = 0; k < 3; k++) q.v[k] -= up[k] * GRAVITY * dt;
    for (let k = 0; k < 3; k++) q.p[k] += (q.v[k] + up[k] * s.riseRate) * dt;
  }
  sim.list = sim.list.filter((q) => q.age < q.life);
  const every = Math.max(0.01, s.checkTime);
  sim.acc += dt;
  let checks = 0;
  while (sim.acc >= every && checks < 200) {
    sim.acc -= every; checks++;
    if (rand() >= s.frequency) continue;
    for (let i = 0; i < Math.max(1, s.numPerSpawn) && sim.list.length < MAX_PARTICLES; i++) {
      let d = [1, 0, 0];
      if (s.bRandomEject) {                 // around the arrow: a random direction added to it
        const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        d = [1 + r * Math.cos(a) * 0.8, r * Math.sin(a) * 0.8, z * 0.8];
        const l = Math.hypot(...d) || 1;
        d = d.map((c) => c / l);
      }
      const speed = s.ejectSpeed * (s.bRandomEject ? 0.6 + 0.4 * rand() : 1);
      sim.list.push({ p: [0, 0, 0], v: d.map((c) => c * speed), age: 0, life: Math.max(0.05, s.particleLifeSpan) });
    }
  }
  if (sim.acc > every) sim.acc = sim.acc % every;
  return sim.list;
}
// how big (times the texture's size and particleDrawScale) and how opaque a particle is at its age
export function particleLook(s, q) {
  const u = Math.min(1, q.age / q.life);
  return { scale: s.bScale ? 1 + 2 * u : 1, alpha: s.bFade ? Math.min(1, u * 8) * (1 - u) : Math.min(1, u * 8) };
}

// where it hurts, for the preview (null: it hurts no one): a stream of radius round its arrow, reach long (0: a ball)
export function hurtZone(s) {
  if (!(s.FxDamage > 0)) return null;
  return { radius: Math.max(1, s.FxRadius || 0), reach: Math.max(0, s.FxReach || 0) };
}
// what is kept of a generator as an effect of your own (Objects > Effects > Yours): its settings that are set, as the
// map writes them (read(key): the map's or the page's text)
export function effectOf(read) {
  const props = {};
  for (const f of PARTICLE_FIELDS) {
    const v = read(f.key);
    if (v !== undefined && v !== null && v !== '') props[f.key] = String(v);
  }
  return props;
}
