// "Give it phases" (P3 slice 8, editor/LOGIC.md "Phases of a door"): a door, a bridge, a lift or a platform gets two
// phases, kept by a Phases block (UCBPhases) that two rules of its own move: "it has opened" goes to the second phase,
// "it starts closing" to the first. Its states (Bridge1_Lowered...) are then offered by every condition picker,
// dialogue answers included, as any Phases block's are. The words come from config/logic.json "movers": each word has
// its two phases (a bridge: Raised, then Lowered; a door: Closed, then Open).

const DEFAULT = ['Closed', 'Open'];

// a name as the game's flags keep it (UCBlock.FlagName; app.js blockFlagName does the same)
export function flagName(text) {
  let s = [...String(text ?? '').trim()].map((ch) => (/^[A-Za-z0-9_]$/.test(ch) ? ch : '_')).join('');
  if (/^[0-9]/.test(s)) s = 'X_' + s;
  return s.slice(0, 60);
}

// [the phase while it is closed, the phase once it has opened], by the mover's word (a door's when it has none)
export function moverPhaseWords(words, word) {
  const list = Array.isArray(words) ? words : [];
  const pick = (id) => list.find((w) => w && w.id === id && Array.isArray(w.phases) && w.phases.length === 2);
  const w = (word && pick(word)) || pick('door');
  return w ? w.phases.map(String) : DEFAULT.slice();
}

// a state name no other Phases block of the map and no mission phase set has (letters' case does not count, as for
// the game's flags): the mover's name, else with 2, 3... after it
export function freeStateName(base, taken) {
  const root = flagName(base).slice(0, 56) || 'Door';
  const low = new Set((taken || []).map((t) => flagName(t).toLowerCase()));
  if (!low.has(root.toLowerCase())) return root;
  let i = 2;
  while (low.has((root + i).toLowerCase())) i++;
  return root + i;
}

// The Phases block a mover's own rules move ('' none): a rule on it ("has opened", "starts closing") with a step that
// sends one of the blocks a Go to. blocks: the names of the map's Phases blocks.
export function phasesOfMover(name, links, blocks) {
  const low = String(name || '').toLowerCase(), names = new Set((blocks || []).map((b) => String(b).toLowerCase()));
  for (const l of links || []) {
    if (!l || String(l.src || '').toLowerCase() !== low || (l.when !== 'opened' && l.when !== 'closed')) continue;
    const step = (l.do || []).find((x) => x && x.verb === 'input' && names.has(String(x.target || '').toLowerCase()) && /^GoTo_/i.test(String(x.a || '')));
    if (step) return (blocks || []).find((b) => String(b).toLowerCase() === String(step.target).toLowerCase()) || step.target;
  }
  return '';
}

// What "Give it phases" makes: the block's settings (edits' property texts), its state name and phases, and the two
// rules of the mover ({when, input}: the output it waits for and the block's input it calls).
export function moverPhasesPlan({ label, name, word, words, taken }) {
  const phases = moverPhaseWords(words, word);
  const stateName = freeStateName(label || name, taken);
  const ids = phases.map(flagName);
  return {
    stateName, phases,
    props: { Phases: `"${phases.join(', ')}"`, StateName: `"${stateName}"` },
    rules: [{ when: 'opened', input: 'GoTo_' + ids[1] }, { when: 'closed', input: 'GoTo_' + ids[0] }],
  };
}
