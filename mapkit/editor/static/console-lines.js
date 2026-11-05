// The Console's lines as data (G39), for console.js: Collapse (identical lines as one row with how many came, as Unity's
// Console), Time (seconds since Play started), Copy (the rows as they read) and the names of the open map's objects in
// any line, as logic-log.js's parts ({ name }: a click selects that object). No DOM here: tests/test_console_lines.mjs.
//
// A line: { text: as the game wrote it, kind: console.js's kind(), t: seconds since Play started when it came, or null }.
// A row: { line: the first of them, last: the newest, count }: one per line, or with Collapse one per text.
import { LOGIC_TAG, parseLogicLine, logicSentence } from './logic-log.js';

// seconds since Play started for a line that reached the panel at `at` (ms), null when that is not known: no start
// seen, or a line read back from the log when the panel opened (at: null)
export function playSeconds(at, start) {
  if (!Number.isFinite(at) || !Number.isFinite(start) || at < start) return null;
  return (at - start) / 1000;
}
// a time as the Time column reads it: 4.2, 75 -> 1:15.0; '' for none
export function timeText(t) {
  if (t === null || t === undefined) return '';
  const tenths = Math.round(Math.max(0, t) * 10), minutes = Math.floor(tenths / 600), rest = (tenths - minutes * 600) / 10;
  return minutes ? `${minutes}:${rest.toFixed(1).padStart(4, '0')}` : rest.toFixed(1);
}

export const singleRow = (line) => ({ line, last: line, count: 1 });
// Collapse: one more line into the rows by text (a Map, in the order the texts first came): its row counted once
// more, or a new row. The row is returned either way.
export function addLine(rows, line) {
  const row = rows.get(line.text);
  if (!row) { const fresh = singleRow(line); rows.set(line.text, fresh); return fresh; }
  row.last = line;
  row.count++;
  return row;
}
export function collapseLines(lines) {
  const rows = new Map();
  for (const line of lines) addLine(rows, line);
  return rows;
}
// Collapse: a line the panel no longer keeps (the oldest, past its MAX) out of its row: counted once less, and out of
// the Map at none. The row is returned (null for a text it does not have).
export function dropLine(rows, line) {
  const row = rows.get(line.text);
  if (!row) return null;
  row.count--;
  if (row.count <= 0) rows.delete(line.text);
  return row;
}

// the open map's names for nameParts: lower case -> the object's own name (UnrealScript's names do not mind the case)
export function nameIndex(names) {
  return new Map([...names].filter(Boolean).map((n) => [String(n).toLowerCase(), String(n)]));
}
// A line as plain text and { name } parts: every word that is the name of an object of the open map. The log writes
// an object as "Map.Name" (ScriptWarning: DeusExMover 01_Lab.DeusExMover3 (Function ...)): such a name is one of
// this map's only when Map is `map`; a class's "Package.Class" is never one.
export function nameParts(text, names, map) {
  const parts = [], here = String(map || '').toLowerCase();
  let at = 0;
  for (const m of text.matchAll(/\w+(?:\.\w+)*/g)) {
    const path = m[0].split('.'), word = path[path.length - 1], name = names.get(word.toLowerCase());
    if (!name || (path.length > 1 && path[0].toLowerCase() !== here)) continue;
    const start = m.index + m[0].length - word.length;
    if (start > at) parts.push(text.slice(at, start));
    parts.push({ name });
    at = start + word.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

// What a row shows: { parts: text, { name } and { rule } (logic-log.js's), logic: a logic line's kind, map: the map
// its names belong to ('' for the open one), unread: a logic line this editor does not read }. A logic line reads as
// its sentence, a script's line without "ScriptLog: ", any other as it came, with the open map's names in it.
export function lineView(line, names, map) {
  if (line.kind === 'logic') {
    const entry = parseLogicLine(line.text);
    if (!entry) return { parts: [line.text.slice(LOGIC_TAG.length)], map: '', unread: true };
    const { mark, parts } = logicSentence(entry);
    return { parts: [mark + ' ', ...parts], map: entry.map || '', logic: entry.kind };
  }
  return { parts: nameParts(line.kind === 'script' ? line.text.replace(/^ScriptLog: /, '') : line.text, names, map), map: '' };
}
export const partsText = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.rule || p.name)).join('');

// Copy: the rows as they read, one a line: the time first with Time on, how many after a collapsed one
export function copyText(rows, { time = false } = {}) {
  const none = new Map();
  return rows.map((r) => (time && r.line.t !== null ? timeText(r.line.t) + '  ' : '') + partsText(lineView(r.line, none, '').parts)
    + (r.count > 1 ? `  (×${r.count})` : '')).join('\n');
}
