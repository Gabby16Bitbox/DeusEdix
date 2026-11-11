// The inputs and outputs a script declares, as the Ports table of Tools > Scripts shows and changes them (P8 slice 5,
// editor/LOGIC.md "Ports table"). Pure: tests/test_script_ports.mjs.
//
// They are lines of the script's defaultproperties, which the editor reads (editor/scripts.py ports) and the game
// keeps in UCScript.Inputs / Outputs (8 of each):
//   Inputs(0)=(Id="Start",Label="Start it",Args="Seconds:seconds,Who:thing")
//   Outputs(0)=(Id="Done",Label="it is done")
//   Outputs(1)=(Id="Found",Label="it finds coins",Args="Value")    it comes with a number (P8 slice 5b): the
//   script says OutputValue("Found", 3), the rules it starts read the 3 as Value
// An argument says after ':' what kind of value it takes (ARG_TYPES); the game only ever reads the values a rule
// gives ("Seconds=10;Who=Door3": Arg, ArgFloat...), so the kinds are the editor's alone.

export const ARG_TYPES = ['number', 'seconds', 'yesno', 'text', 'thing'];
export const ARG_WORDS = { number: 'a number', seconds: 'seconds', yesno: 'yes or no', text: 'text', thing: 'an object of the map' };
export const MAX_PORTS = 8;                          // UCScript: var UCPort Inputs[8], Outputs[8]
export const PORT_ID = /^[A-Za-z_]\w{0,40}$/;
const ARG_NAME = /^[A-Za-z_]\w{0,30}$/;
const LINE = /^[ \t]*(Inputs|Outputs)[ \t]*\([ \t]*(\d+)[ \t]*\)[ \t]*=[ \t]*\((.*)\)[ \t]*(?:\/\/[^\n]*)?$/i;
const FIELD = /(\w+)\s*=\s*(?:"([^"]*)"|([^,)]*))/g;

// the text with its comments blanked (same length, newlines kept): where a compiler would read code
function masked(text) {
  let out = '', i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === '/' && d === '/') { while (i < n && text[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2), stop = end < 0 ? n : end + 2;
      for (; i < stop; i++) out += text[i] === '\n' ? '\n' : ' ';
      continue;
    }
    if (c === '"') {                                   // a string: as it is, to its end on the line
      out += c; i++;
      while (i < n && text[i] !== '"' && text[i] !== '\n') { if (text[i] === '\\' && i + 1 < n) { out += text[i++]; } out += text[i++]; }
      if (i < n && text[i] === '"') out += text[i++];
      continue;
    }
    out += c; i++;
  }
  return out;
}

// where the class's defaultproperties block is: {start: just after its '{', end: at its '}'} or null
export function defaultsBlock(text) {
  const code = masked(String(text || ''));
  const m = /^[ \t]*defaultproperties\s*\{/im.exec(code);
  if (!m) return null;
  let depth = 1, quoted = false;
  for (let i = m.index + m[0].length; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === '\n') quoted = false;
    else if (!quoted && (ch === '{' || ch === '}')) { depth += ch === '{' ? 1 : -1; if (!depth) return { start: m.index + m[0].length, end: i }; }
  }
  return { start: m.index + m[0].length, end: code.length };
}

const argOf = (s) => {
  const [name, kind = ''] = String(s).split(':').map((x) => x.trim());
  return { name, type: ARG_TYPES.includes(kind.toLowerCase()) ? kind.toLowerCase() : 'text' };
};

// {inputs: [{id, label, args: [{name, type}]}], outputs: [{id, label, carries}]}: as editor/scripts.py ports reads them
// (an argument with no kind is text; a port without a valid Id is left out; carries only on an output with Args="Value")
export function parsePorts(text) {
  const t = String(text || ''), b = defaultsBlock(t), found = { inputs: new Map(), outputs: new Map() };
  if (b) {
    const lines = masked(t).slice(b.start, b.end).split('\n');     // comments blanked, strings kept
    lines.forEach((raw) => {
      const line = raw.replace(/\r$/, ''), m = LINE.exec(line);
      if (!m) return;
      const fields = {};
      for (const f of line.slice(line.indexOf('(', line.indexOf('=')) + 1).matchAll(FIELD)) fields[f[1].toLowerCase()] = f[2] !== undefined ? f[2] : f[3].trim();
      const id = fields.id || '';
      if (!PORT_ID.test(id)) return;
      const kind = m[1].toLowerCase(), entry = { id, label: fields.label || id };
      if (kind === 'inputs') {
        const seen = new Set();
        entry.args = String(fields.args || '').split(',').map((a) => a.trim()).filter(Boolean).map(argOf)
          .filter((a) => /^\w+$/.test(a.name) && !seen.has(a.name) && seen.add(a.name));
      } else if (String(fields.args || '').split(',').some((a) => a.split(':')[0].trim().toLowerCase() === 'value')) entry.carries = true;
      found[kind].set(+m[2], entry);
    });
  }
  const sorted = (m) => [...m.keys()].sort((a, c) => a - c).map((k) => m.get(k));
  return { inputs: sorted(found.inputs), outputs: sorted(found.outputs) };
}

// why a table of ports cannot be written ('' when it can)
export function portsProblem(ports) {
  for (const [kind, word] of [['inputs', 'input'], ['outputs', 'output']]) {
    const list = (ports && ports[kind]) || [], seen = new Set();
    if (list.length > MAX_PORTS) return `A script has at most ${MAX_PORTS} ${word}s.`;
    for (const p of list) {
      if (!PORT_ID.test(String(p.id || ''))) return `An ${word}'s name has letters, digits and _ only, and starts with a letter: "${p.id || ''}".`;
      if (seen.has(p.id.toLowerCase())) return `Two ${word}s are called "${p.id}".`;
      seen.add(p.id.toLowerCase());
      const names = new Set();
      for (const a of p.args || []) {
        if (!ARG_NAME.test(String(a.name || ''))) return `The ${word} "${p.id}" has a value with a name that is not letters, digits and _: "${a.name || ''}".`;
        if (names.has(a.name.toLowerCase())) return `The ${word} "${p.id}" has two values called "${a.name}".`;
        names.add(a.name.toLowerCase());
      }
    }
  }
  return '';
}

const quoted = (s) => String(s ?? '').replace(/["\r\n]/g, "'");
// one declaration line
export function portLine(kind, i, p) {
  if (kind === 'inputs') {
    const args = (p.args || []).map((a) => (a.type && a.type !== 'text' ? `${a.name}:${a.type}` : a.name)).join(',');
    return `Inputs(${i})=(Id="${p.id}",Label="${quoted(p.label || p.id)}"${args ? `,Args="${args}"` : ''})`;
  }
  return `Outputs(${i})=(Id="${p.id}",Label="${quoted(p.label || p.id)}"${p.carries ? ',Args="Value"' : ''})`;
}

// The text with these ports declared: the Inputs/Outputs lines of defaultproperties replaced (at the place of the
// first one, else at its top), the rest of the text as it was; a defaultproperties block added at the end when there
// is none. Throws portsProblem's words.
export function writePorts(text, ports) {
  const why = portsProblem(ports);
  if (why) throw new Error(why);
  const t = String(text || ''), eol = t.includes('\r\n') ? '\r\n' : '\n';
  const lines = [...(ports.inputs || []).map((p, i) => portLine('inputs', i, p)), ...(ports.outputs || []).map((p, i) => portLine('outputs', i, p))];
  const b = defaultsBlock(t);
  if (!b) {
    if (!lines.length) return t;
    const body = t.replace(/\s*$/, '');
    return `${body}${eol}${eol}defaultproperties${eol}{${eol}${lines.map((l) => '\t' + l).join(eol)}${eol}}${eol}`;
  }
  const inside = t.slice(b.start, b.end), code = masked(t).slice(b.start, b.end);
  const real = inside.split(/\n/), codes = code.split('\n');
  const keep = [];
  let at = -1, indent = null;
  real.forEach((line, k) => {
    if (LINE.test(codes[k].replace(/\r$/, ''))) { if (at < 0) at = keep.length; if (indent === null) indent = /^[ \t]*/.exec(line)[0]; return; }
    keep.push(line);
  });
  if (indent === null) indent = (keep.map((l) => /^([ \t]+)\S/.exec(l)).find(Boolean) || [null, '\t'])[1];
  const cr = eol === '\r\n' ? '\r' : '';
  const fresh = lines.map((l) => indent + l + cr);
  if (at < 0) at = keep.length && keep[0].trim() === '' ? 1 : 0;     // just under the '{' line
  keep.splice(at, 0, ...fresh);
  return t.slice(0, b.start) + keep.join('\n') + t.slice(b.end);
}

// a port's words in the table: "Start it (Seconds: seconds, Who: an object of the map)", "it finds coins (with a number)"
export function portWords(p) {
  const args = p.carries ? ['with a number'] : (p.args || []).map((a) => `${a.name}: ${ARG_WORDS[a.type] || 'text'}`);
  return `${p.label || p.id}${args.length ? ` (${args.join(', ')})` : ''}`;
}
