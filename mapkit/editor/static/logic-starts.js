// Named starts (P2, final_design.json debugging 2, "start states saved by name, like articy's Journeys"): Try it starts
// from one of the project's Play scenarios (play-scenarios.js), and a moment of Try it is kept as one, so the same start
// is tried in the editor and played in the game ("Play with this start"). A scenario's starting states are
// play-state.js's tokens (State=1, Other=0); its loadout gives the player's items, credits and skills.
//
// What Play can set is what a scenario keeps: Yes/No states, the player's items, credits and skills. A counter, a
// phase, a character killed are not kept (the game's runner sets Yes/No states only), and saying so is part of saving.
// Pure (no DOM): tests/test_logic_starts.mjs.
import { parsePlayStates } from './play-state.js';
import { flagName } from './mover-phases.js';

const low = (s) => String(s ?? '').toLowerCase();
const bare = (cls) => String(cls).split('.').pop();
// a class as a scenario keeps it: with its package (the base game's when it has none)
const withPackage = (cls) => (String(cls).includes('.') ? String(cls) : `DeusEx.${cls}`);

// The states a Phases block keeps (<StateName>_<phase>, logic-sim.js), lower case: the block's own, never a start's.
// world: Try it's ({actors: [{name, block: {statename, phases}}]}).
export function phaseFlags(world = {}) {
  const out = new Set();
  for (const a of world.actors || []) {
    const b = a.block;
    if (!b || !Array.isArray(b.phases)) continue;
    const root = flagName(b.statename ?? 'Phase') || 'Phase';
    for (const p of b.phases) out.add(low(`${root}_${flagName(p)}`));
  }
  return out;
}

// A scenario as Try it's start (logic-sim.js createSession start): its states, the player's items (by the class as the
// scenario names it and by its bare name, as rules may name either), credits and skills (by bare name). null: {}.
export function startOf(s) {
  if (!s) return {};
  const flags = {};
  for (const r of parsePlayStates(s.flags || '')) flags[r.flag] = r.is;
  const items = [];
  for (const r of s.items || []) for (const name of new Set([r.cls, bare(r.cls), withPackage(r.cls)])) items.push(name);
  const skills = Object.fromEntries((s.skills || []).map((r) => [bare(r.cls), r.level]));
  return { flags, items, ...(s.credits !== null && s.credits !== undefined ? { credits: s.credits } : {}),
    ...(Object.keys(skills).length ? { skills } : {}) };
}

// A moment of Try it (session.state()) kept as a scenario named `name`. base: the scenario it is kept over (the one of
// that name, else the start it began from), whose other parts stay as they were (where the player starts, the mission
// preset, augmentations, health...). derived: phaseFlags(world). Returns {scenario, left: [what Play cannot set, in
// words]}.
export function startFromState(state, { name, base = null, derived = new Set() } = {}) {
  const flags = Object.entries(state.flags || {}).filter(([k]) => !derived.has(low(k)))
    .map(([k, v]) => `${k}=${v ? 1 : 0}`).join(', ');
  const items = [], kept = (base && base.items) || [];
  for (const cls of state.items || []) {
    if (items.some((r) => low(bare(r.cls)) === low(bare(cls)))) continue;
    const had = kept.find((r) => low(bare(r.cls)) === low(bare(cls)));
    items.push({ cls: had ? had.cls : withPackage(cls), count: had ? had.count : 1 });
  }
  const skills = [...((base && base.skills) || [])].filter((r) => !Object.keys(state.skills || {}).some((k) => low(k) === low(bare(r.cls))));
  for (const [k, level] of Object.entries(state.skills || {})) if (+level > 0) skills.push({ cls: withPackage(k), level: +level });
  const credits = state.credits > 0 ? state.credits : base ? base.credits ?? null : null;
  const left = [];
  // (a Phases block's own counter, <StateName>, is said as its phase)
  const counters = Object.entries(state.counters || {}).filter(([k, v]) => +v !== 0 && ![...derived].some((f) => f.startsWith(`${low(k)}_`)));
  if (counters.length) left.push(`the counters (${counters.map(([k, v]) => `${k} = ${v}`).join(', ')})`);
  const phases = Object.entries(state.flags || {}).filter(([k, v]) => v && derived.has(low(k))).map(([k]) => k);
  if (phases.length) left.push(`the phases (${phases.join(', ')})`);
  if ((state.dead || []).length) left.push(`who is dead (${state.dead.join(', ')})`);
  return { scenario: { ...(base || {}), name, flags, items, skills, credits }, left };
}

// what a start gives, in a few words, for its tooltip: "3 states · 2 items · 50 credits"
export function startSummary(s) {
  if (!s) return 'The map as it starts: no state set, the player as the game starts him';
  const n = parsePlayStates(s.flags || '').length, items = (s.items || []).reduce((sum, r) => sum + r.count, 0);
  const parts = [n ? `${n} state${n === 1 ? '' : 's'}` : '', items ? `${items} item${items === 1 ? '' : 's'}` : '',
    s.credits !== null && s.credits !== undefined ? `${s.credits} credits` : '',
    (s.skills || []).length ? `${s.skills.length} skill${s.skills.length === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.join(' · ') || 'Nothing set: the map as it starts';
}
