// The plain fields of the Inspector's Properties (editor/props.py FIELDS kinds): what a field shows of a property's
// value (UnrealEd's text: "quoted", Class'Pkg.Name', 0.500000, True) and the text it stores for what is typed or
// picked. One place for both: app.js renderProps for one object, the multi-object Inspector for several.

// "a text" -> a text (UnrealEd quotes its strings)
export const unquote = (v) => { v = String(v ?? ''); return v.length > 1 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v; };
// Class'DeusEx.Medkit' -> DeusEx.Medkit
export const classRef = (v) => { const m = /Class'([^']+)'/i.exec(String(v || '')); return m ? m[1] : ''; };

const byte = (x) => String(Math.max(0, Math.min(255, Math.round(+x || 0))));
const name = (x) => String(x ?? '').trim().replace(/\W/g, '_') || 'None';
const noneEmpty = (v) => (String(v) === 'None' ? '' : String(v));
// a collision box's half size is shown whole (its full width), a radius as it is; never under 2 shown units
const sized = (factor) => ({
  shown: (v) => Math.round((+v || 0) * factor),
  stored: (x) => { const raw = +x; return (Math.max(2 * factor, Number.isFinite(raw) ? raw : 2 * factor) / factor).toFixed(6); },
  row: 'number', step: 4 * factor, min: 2 * factor,
});
// kind -> shown(value), stored(what is typed or picked), and for several objects at once the row that edits it
// (multi-inspector.js: bool, int, number, text, choice) with its steps; the other kinds are one object at a time
const KINDS = {
  bool: { shown: (v) => String(v).toLowerCase() === 'true', stored: (x) => (x ? 'True' : 'False'), row: 'bool' },
  int: { shown: (v) => +v || 0, stored: (x) => String(Math.round(+x || 0)), row: 'int', step: 1 },
  float: { shown: (v) => +v || 0, stored: (x) => (+x || 0).toFixed(6), row: 'number', step: 0.05 },
  byte: { shown: (v) => +v || 0, stored: byte, row: 'int', step: 1, min: 0, max: 255 },
  lightcolor: { shown: (v) => +v || 0, stored: byte, row: 'int', step: 1, min: 0, max: 255 },     // LightHue
  name: { shown: (v) => (String(v) === 'None' ? '' : unquote(v)), stored: name, row: 'text' },
  string: { shown: unquote, stored: (x) => String(x ?? '').trim(), row: 'text' },
  faction: { shown: noneEmpty, stored: name, row: 'text' },
  choice: { shown: String, stored: String, row: 'choice' },
  enum: { shown: String, stored: String, row: 'choice' },
  item: { shown: classRef, stored: (c) => (c ? `Class'${c}'` : 'None'), row: 'choice' },
  half: sized(2),
  radius: sized(1),
};

// What a field of this kind shows of a value
export function propShown(kind, value) { return (KINDS[kind]?.shown || String)(value); }
// The text a field of this kind stores for what is typed or picked
export function propText(kind, typed) { return (KINDS[kind]?.stored || String)(typed); }
// How several objects edit a field of this kind: {row, step, min, max}, or null (one object at a time)
export function propRow(kind) {
  const k = KINDS[kind];
  return k ? { row: k.row, step: k.step, min: k.min, max: k.max } : null;
}
