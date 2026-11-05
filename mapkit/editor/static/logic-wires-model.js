// The logic's wires in the 3D view, which ones (pure: tests/test_logic_wires.mjs); logic-wires.js draws them.
// Modes as TrenchBroom's entity links: Off, Selected (the selected object's own rules), Chain (every rule reachable
// from it either way), All.
export const WIRE_MODES = [['off', 'Off'], ['selected', 'Selected object'], ['chain', 'Selected chain'], ['all', 'All']];
export const WIRE_COLORS = { act: 0x6fdc8c, actDim: 0x3d7a52, state: 0xe3b96b, stateDim: 0x8a7444 };
const FLOW = new Set(['if', 'else', 'end', 'wait']);       // a list's own steps (action-list.js): no object to wire
export const MAX_LABELS = 40;                                   // more than this: only the wires of the selection say theirs

// ---------------------------------------------------------------- which wires (pure)
// links: edits.links. options:
//   mode       'off' | 'selected' | 'chain' | 'all'
//   selected   the selected object's name ('' none: only All draws)
//   present(n) whether an object is in the map (not deleted or missing)
//   targetsOf(x, l) the objects an action reaches (a tag's or an area's members too); default its target
//   labelOf(l, x, from) a wire's words; default "<when> → <verb>"
// -> [{id, rule, act, from, to, kind: 'act' | 'state', label, delay, lane, lanes, hot}], hot: one of the selection's
export function wiresOf(links, { mode = 'selected', selected = '', present = () => true, targetsOf = (x) => [x.target],
  labelOf = (l, x) => `${l.when} → ${x.verb}` } = {}) {
  if (mode === 'off') return [];
  const rules = (links || []).filter((l) => l && l.id && !l.mute);
  const out = [], seen = new Set();
  const add = (w) => { if (!seen.has(w.id)) { seen.add(w.id); out.push(w); } };
  const causesOf = (l) => [l.when === 'start' || l.when === 'keypress' ? '' : l.src, ...(l.also || []).map((c) => c && c.src)]
    .filter((n) => n && present(n));
  for (const l of rules) {
    const causes = causesOf(l);
    for (const [j, x] of [...(l.do || []).entries(), ...(l.else || []).map((y, k) => [`e${k}`, y])]) {
      if (!x || FLOW.has(x.verb)) continue;
      for (const t of new Set(targetsOf(x, l) || [])) {
        if (!t || !present(t)) continue;
        for (const c of causes) if (c !== t) add({ id: `${l.id}/${j}/${c}>${t}`, rule: l.id, act: j, from: c, to: t, kind: 'act',
          label: labelOf(l, x, c), delay: +x.delay || 0 });
      }
    }
  }
  // a state or a counter one rule sets and another reads: from the setter's object to the reader's
  const key = (kind, name) => `${kind}:${String(name || '').trim().toLowerCase()}`;
  const setters = new Map();
  for (const l of rules) for (const x of l.do || []) {
    const k = x && x.a && (x.verb === 'flag' ? key('flag', x.a) : x.verb === 'count' ? key('count', x.a) : '');
    if (k) for (const c of causesOf(l)) (setters.get(k) || setters.set(k, []).get(k)).push({ rule: l, from: c, name: x.a });
  }
  for (const l of rules) {
    const reads = [...(l.requires || []), ...(l.do || []).filter((x) => x && x.verb === 'if').flatMap((x) => x.requires || []),
      ...(l.do || []).filter((x) => x && x.verb === 'wait' && x.until && !x.until.type).map((x) => x.until)];
    for (const c of reads) {
      const k = c.flag !== undefined && !c.type ? key('flag', c.flag) : c.type === 'counter' ? key('count', c.counter) : '';
      for (const s of (k && setters.get(k)) || []) for (const to of causesOf(l)) {
        // one wire for a state between two objects, however many of their rules set and read it
        if (s.from !== to) add({ id: `state:${k}:${s.from}>${to}`, rule: l.id, from: s.from, to, kind: 'state',
          label: `${s.name}`, delay: 0, setter: s.rule.id });
      }
    }
  }
  let kept = out;
  if (mode !== 'all') {
    if (!selected) return [];
    if (mode === 'selected') kept = out.filter((w) => w.from === selected || w.to === selected);
    else {                                                  // chain: what it sets off, on and on; what sets it off, back
      const reach = (fromKey, toKey) => {
        const got = new Set([selected]);
        for (let grew = true; grew;) {
          grew = false;
          for (const w of out) if (got.has(w[fromKey]) && !got.has(w[toKey])) { got.add(w[toKey]); grew = true; }
        }
        return got;
      };
      const down = reach('from', 'to'), up = reach('to', 'from');
      kept = out.filter((w) => (down.has(w.from) && down.has(w.to)) || (up.has(w.from) && up.has(w.to)));
    }
  }
  // lanes: the wires between the same two objects (either way) side by side
  const count = new Map(), lane = new Map();
  for (const w of kept) { const k = [w.from, w.to].sort().join('\n'); count.set(k, (count.get(k) || 0) + 1); }
  return kept.map((w) => {
    const k = [w.from, w.to].sort().join('\n'), n = lane.get(k) || 0;
    lane.set(k, n + 1);
    return { ...w, lane: n, lanes: count.get(k), hot: !!selected && (w.from === selected || w.to === selected) };
  });
}

// the arc of a wire: from a point above what sets it off to one above what it acts on, its top higher with the
// distance (at most 400 units) and with its lane; [start, control, end] as {x, y, z} (three.js: y is up)
export function arcOf(a, b, lane = 0) {
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const h = Math.min(400, Math.max(24, d * 0.25)) + lane * 28;
  return [a, { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + h, z: (a.z + b.z) / 2 }, b];
}


// which wires say what they do: one label for one action however many objects it reaches (its count, "×9"), one
// for a state however many rules read it; more than MAX_LABELS: only the selected object's. Map wire -> how many
export function labelsOf(wires, max = MAX_LABELS) {
  const groups = new Map();
  for (const w of wires) {
    const key = w.kind === 'state' ? `s|${w.setter}|${w.label}` : `a|${w.rule}|${w.act}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  const firsts = [...groups.values()].map((g) => [g[0], g.length]);
  return new Map(firsts.length <= max ? firsts : firsts.filter(([w]) => w.hot));
}

// a place on the screen for a label w pixels wide whose foot is at x, y: there, or a line (20 px) or two higher,
// else null (it waits until there is room); the place taken goes into placed
export function roomFor(placed, x, y, w, h = 18) {
  for (let k = 0; k < 3; k++) {
    const box = { l: x - w / 2, r: x + w / 2, t: y - h - k * 20, b: y - k * 20 };
    if (!placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) { placed.push(box); return y - k * 20; }
  }
  return null;
}
