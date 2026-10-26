// Several objects edited together in the Inspector, as Unity's multi-object editing (EditorGUI.showMixedValue,
// "Set to Value of", Narrow the Selection): a field shows the value its objects share, or a dim "—" when they
// differ, and what is typed is set on each of them. The logic only: multi-inspector.js draws the fields and
// app.js says what they are (number-expr.js works out the sums, L and R over the objects).

export const MIXED = '—';                 // what a field shows when its objects differ (Unity's mixed value)

// The Transform of several objects: each field by what a member has (app.js transformOf), with the labels of one
// object's Transform: the game's X, then its Z as Y (the height) and its Y as Z, the axes of the 3D view; a place
// in units and tenths, turns in whole degrees and a size in whole % (as one object's Transform shows them)
export const TRANSFORM = [
  { key: 'x', label: 'X', title: 'X position', row: 'number' },
  { key: 'z', label: 'Y', title: 'Y position (height)', row: 'number' },
  { key: 'y', label: 'Z', title: 'Z position', row: 'number' },
  { key: 'yaw', label: 'Rotation °', title: 'Rotation (yaw) in degrees', row: 'int' },
  { key: 'pitch', label: 'Pitch °', title: 'Pitch in degrees: 90 points the front straight up', row: 'int' },
  { key: 'roll', label: 'Roll °', title: 'Roll in degrees: turns it about its front', row: 'int' },
  { key: 'scale', label: 'Scale %', title: 'Size in % (objects with a model: blocks and structures keep theirs)', row: 'int' },
];

// The value all of them have ({mixed: false, value}), or {mixed: true}; compared as the field shows them (0 and "0")
export function shared(values) {
  const first = String(values[0]);
  return values.every((v) => String(v) === first) ? { mixed: false, value: values[0] } : { mixed: true };
}

// Narrow the selection: each kind of thing selected with how many there are, the most first (then by name)
export function kindCounts(kinds) {
  const counts = new Map();
  for (const k of kinds) counts.set(k, (counts.get(k) || 0) + 1);
  return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

// Right click > Set all to: one choice for each value the objects have, named by the first one that has it, in
// their order (at most `most`; a number that is not one, NaN, is no value); none when they all have the same
export function valueChoices(names, values, most = 12) {
  const seen = new Set(), out = [];
  values.forEach((v, i) => {
    const k = String(v);
    if (Number.isNaN(v) || seen.has(k) || out.length >= most) return;
    seen.add(k);
    out.push({ name: names[i], value: v });
  });
  return out.length > 1 ? out : [];
}

// A value as a menu or the status bar says it
export function valueText(v) {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return v === '' || v == null ? '(empty)' : String(v);
}

// The values typed in a field of several objects, as the status bar says them: the one value, a few, or from the
// lowest to the highest
export function valuesText(values) {
  const texts = values.map(valueText), distinct = new Set(texts);
  if (distinct.size === 1) return texts[0];
  if (values.length <= 5) return texts.join(', ');
  return values.every(Number.isFinite) ? `${Math.min(...values)} to ${Math.max(...values)}` : `${distinct.size} different values`;
}
