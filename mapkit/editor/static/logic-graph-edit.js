// The Logic window's graph as an editor (12 Nov 2026; backup/20261112_graph_edit/PLAN.md L1-L5, the Story Graph's
// gestures on the rules): a side panel with the selected rule's form (or an object's rules), right-click menus on
// empty space, objects, rules, wires, notes and frames, a wire dragged from what happens to an object (a new rule),
// a wire's end moved to another object (its action on that one), the values of a card clicked (graph-value-edit.js),
// Ctrl+C / X / V / D and Delete on rules, notes and frames of the graph's own (edits.logic.view, never in the game).
// Every change is app.js's (logicEditOf: the List's and the Inspector's own edits), one Ctrl+Z each.
//
// createGraphEdit({main, host, edit, status, canvas, graph, edits, busy, commands}) -> the canvas's callbacks
// (context, pinDrop, connect, retarget, value, remove, move, delay, add, command) and decorate(shown), selected(sel),
// sync(), close()
//   main     the element the side panel goes in (the Logic window's .lw-main); host: the graph's (menus, boxes)
//   edit     app.js logicEditOf()
//   canvas() the graph canvas; graph() the model's graph shown (logic-graph-model.js logicGraph, a block's view);
//   edits()  the map's edits now (its links, and edits.logic.view: positions, notes, frames)
//   busy()   why editing waits (the assistant's proposal shown...), or ''
//   commands {why(sel), mute(sel), pause(sel), block(sel), select(name), list(name, rule), whole()}: the window's own
//            (whole: the whole map shown, for a rule made outside what the graph shows)
import { openQuickAdd } from './graph-quick-add.js';
import { openValueEditor } from './graph-value-edit.js';
import { nodeSize, boundsOf } from './graph-geometry.js';

const OBJECT = 'obj:';
const RECENT = 'deusedix.logicQuickAdd';
const ON_OBJECT = 'An object of the map';
const BLOCK_GROUP = 'A new logic block';
// the eyedropper (14 Nov 2026, Gabby: "un'opzione contagocce così selezioni l'oggetto"): the object clicked in the 3D
// view (or the Hierarchy) instead of found in the list; first in every list of the map's objects
const PICK_GROUP = 'Pick in the 3D view';
const PICK = { id: 'pick', label: 'Pick it in the 3D view (eyedropper)', group: PICK_GROUP, hint: 'Click the object in the 3D view or the Hierarchy',
  words: ['pick', 'eyedropper', 'dropper', 'click', 'view', 'select', 'choose'], data: { pick: true } };
// rules on several objects at once (app.js whenSeveral): [label, hint, other words]
const SEVERAL_GROUP = 'Several objects';
const SEVERAL = {
  all: ['When all of these', 'An "All of these" block: the rule runs once each of them has happened', ['all', 'every', 'both', 'and', 'block']],
  any: ['When any of these', 'One rule, set off by any of them', ['any', 'either', 'or']],
  some: ['When at least N of these', 'An "At least N" block: the rule runs once that many have happened', ['some', 'number', 'count', 'block']],
};
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let clipboard = null;                  // rules copied (app.js copy: {rules}), kept from one map to another

// ---------------------------------------------------------------- pure parts (tests/test_logic_graph_edit.mjs)
// the map object a node stands for ('' the map itself), or null (a rule, a block, the Story...)
export const nameOf = (id) => (String(id).startsWith(OBJECT) ? String(id).slice(OBJECT.length) : id === 'world' ? '' : null);
// a thing's pins: what happens ("out:used"), what it can do ("in:open"); the header's ("out", "in"): none
export const whenOfPin = (pin) => (/^out:./.test(pin || '') ? pin.slice(4) : '');
export const verbOfPin = (pin) => (/^in:./.test(pin || '') ? pin.slice(3) : '');
// a wire's id as its rule and part: a simple rule's (rule:L7), its cause's (rule:L7/cause0), a step's (act:L7/a1)
export function wireParts(id) {
  const s = String(id || '');
  let m = /^act:([^/]+)\/(.+)$/.exec(s);
  if (m) return { rule: m[1], act: m[2], part: 'act' };
  m = /^rule:([^/]+)\/cause\d+$/.exec(s);
  if (m) return { rule: m[1], part: 'cause' };
  m = /^rule:([^/]+)$/.exec(s);
  return m ? { rule: m[1], part: 'rule' } : null;
}
// the rules a selection holds (cards, simple rules' wires, a cause's or a step's wire), each once
export function rulesOf(sel, nodes = []) {
  const out = new Set();
  for (const id of (sel && sel.nodes) || []) {
    const n = nodes.find((x) => x.id === id);
    if (n && n.kind === 'rule' && n.rule) out.add(n.rule);
  }
  for (const id of (sel && sel.wires) || []) { const p = wireParts(id); if (p && p.part !== 'act') out.add(p.rule); }
  return [...out];
}
// the steps a selection holds as wires: [{rule, act}]
export const actsOf = (sel) => ((sel && sel.wires) || []).map(wireParts).filter((p) => p && p.part === 'act');
// a simple rule's step (its wire carries it): the model's wire of that id
export function simpleAct(graph, id) {
  const w = (graph.wires || []).find((x) => x.id === id && x.part === 'rule');
  return w && w.act ? { rule: w.rule, act: w.act } : null;
}
// L4: a card's values made clickable: the title (what sets it off), a condition, a step and its time, "Nothing yet"
// (a step to add). card: the model's rule node; values say what they are: when:L7, if:L7:0, act:L7/a1, time:L7/a1, add:L7
export function withValues(node, card) {
  if (!card || card.kind !== 'rule' || card.readOnly) return node;
  const rule = card.rule;
  if (card.causes && card.causes.length === 1) node.titleValue = 'when:' + rule;
  for (const r of node.rows || []) {
    if (/^if:\d+$/.test(r.id)) r.value = `if:${rule}:${r.id.slice(3)}`;
    else if (/^act:/.test(r.id)) { r.value = r.id; if (r.time && r.time !== 'now') r.timeValue = 'time:' + r.id.slice(4); }
    else if (/^cause:\d+$/.test(r.id)) r.value = 'when:' + rule;
    else if (r.id === 'none') r.value = 'add:' + rule;
  }
  return node;
}
// what a value is: {kind: 'when' | 'if' | 'act' | 'time' | 'add', rule, act?, check?}
export function valueOf(v) {
  const s = String(v || '');
  let m = /^(act|time):([^/]+)\/(.+)$/.exec(s);
  if (m) return { kind: m[1], rule: m[2], act: m[3] };
  m = /^if:([^:]+):(\d+)$/.exec(s);
  if (m) return { kind: 'if', rule: m[1], check: +m[2] };
  m = /^(when|add):(.+)$/.exec(s);
  return m ? { kind: m[1], rule: m[2] } : null;
}
// a frame around nodes (their places and sizes), with room for its title
export function frameAround(boxes, pad = 24) {
  const b = boundsOf(boxes);
  return b ? [Math.round(b[0] - pad), Math.round(b[1] - pad - 18), Math.round(b[2] + pad * 2), Math.round(b[3] + pad * 2 + 18)] : null;
}
// the notes and frames of the graph's own, as the canvas draws them
export function decorations(view) {
  const v = view && typeof view === 'object' ? view : {};
  return { frames: (Array.isArray(v.frames) ? v.frames : []).filter((f) => f && f.id && Array.isArray(f.rect)).map((f) => ({ id: f.id, title: f.title || '', rect: f.rect, tone: f.tone })),
    notes: (Array.isArray(v.notes) ? v.notes : []).filter((n) => n && n.id).map((n) => ({ id: n.id, text: n.text || '', at: n.at })) };
}
// the first free id of a list ('N1', 'F2'...)
export function freeId(list, prefix) {
  const used = new Set((list || []).map((x) => x && x.id));
  let k = 1;
  while (used.has(prefix + k)) k++;
  return prefix + k;
}

// ---------------------------------------------------------------- the editor
export function createGraphEdit({ main, host, edit: given, status = () => {}, canvas, graph, edits = () => ({}), busy = () => '', commands = {} }) {
  // when the graph was last changed from here (its own gestures, its panel, a value's box): the window keeps its view
  // then instead of fitting the graph again (recent())
  let touched = 0;
  const touch = () => { touched = Date.now(); };
  const READS = new Set(['whens', 'inputs', 'free', 'objects', 'blocks', 'panel', 'value', 'undoCount', 'copy', 'pick']);
  const edit = new Proxy(given, { get: (t, k) => (typeof t[k] === 'function' && !READS.has(k) ? (...a) => { touch(); return t[k](...a); } : t[k]) });
  let menuEl = null, quick = null, vbox = null, shownNow = { nodes: [], wires: [] }, pending = null, pendingObj = null;
  // the side panel (L1): the rule or the object selected, its form as the List's
  const panel = document.createElement('aside');
  panel.className = 'lw-edit';
  panel.tabIndex = -1;                 // keeps the keys when the field that had them is drawn again
  panel.setAttribute('aria-label', 'Edit the selection');
  let lostAt = 0;                      // when a field of it last gave the keys away (Enter in a name field blurs it)
  panel.addEventListener('focusout', (e) => { if (!panel.contains(e.relatedTarget)) lostAt = Date.now(); });
  panel.hidden = true;
  panel.innerHTML = '<div class="lw-edith"><b></b><button type="button" class="lw-editlist" title="Its rules in the List">List</button><button type="button" class="lw-editx" title="Close (Esc)">✕</button></div><div class="lw-editb"></div>';
  main.appendChild(panel);
  const body = panel.querySelector('.lw-editb');
  for (const type of ['change', 'click', 'input']) body.addEventListener(type, touch, true);
  let target = null, hiddenFor = '', drawnSig = '';
  let held = null, drawing = 0;        // showPanel: the field that had the keys, which drawing is the last
  // the map the panel's target belongs to: another map opened closes it (13 Nov 2026: Rule L2 of the warehouse stayed
  // open on the docks and showed the docks' own L2, another rule under the same id)
  let mapOf = null;
  const mapNow = () => (typeof given.map === 'function' ? given.map() : '');
  function sameMap() {
    const m = mapNow();
    if (mapOf === null || m === mapOf) { mapOf = m; return true; }
    mapOf = m; target = null; hiddenFor = ''; drawnSig = ''; pending = null; pendingObj = null; hide();
    return false;
  }
  panel.querySelector('.lw-editx').addEventListener('click', () => { hiddenFor = targetKey(target); hide(); });
  panel.querySelector('.lw-editlist').addEventListener('click', () => { if (target) commands.list?.(target.name ?? '', target.rule || null); });
  // typed here, not the editor's keys nor the graph's (Esc closes the panel)
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.target.closest('select')) { hiddenFor = targetKey(target); hide(); canvas().focus(); }
    else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) tabOut(e);
    e.stopPropagation();
  });
  // Tab out of a field: its change draws the form again at once, the field it left is gone and the browser lost its
  // place, so the keys went to the page and the next key was the editor's (13 Nov 2026). The next field is known
  // before the change and has the keys after it (the same one, or the one at its place in the form drawn again).
  const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusables = () => [...body.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length);
  function tabOut(e) {
    const list = focusables(), at = list.indexOf(e.target);
    if (at < 0) return;
    const index = at + (e.shiftKey ? -1 : 1), to = list[index];
    if (!to) return;                     // out of the panel: the browser's own Tab
    e.preventDefault();
    const key = focusKey(to);
    const pick = (el) => { if (el.tagName === 'INPUT' && /^(text|search|number|)$/.test(el.type || '')) el.select?.(); };   // as the browser's Tab
    to.focus({ preventScroll: false });  // the change of the field left fires here
    if (document.activeElement === to) pick(to);
    const again = () => {
      const now = document.activeElement;
      if (now && now !== document.body && now !== panel && panel.contains(now)) return;
      if (now && now !== document.body && now !== panel) return;   // the keys went somewhere on purpose
      let el = null;
      try { el = key ? body.querySelector(key) : null; } catch { el = null; }
      el = el || focusables()[index];
      if (!el) return;
      el.focus({ preventScroll: false });
      pick(el);
    };
    setTimeout(again, 0);
    setTimeout(again, 150);              // the form is drawn again after the rule is saved (edit.panel is async)
  }
  const targetKey = (t) => (t ? (t.rule ? 'rule:' + t.rule : 'obj:' + t.name) : '');
  function hide() { panel.hidden = true; drawnSig = ''; dock(false); }
  // beside the graph, not over it, when the window has room: the graph narrows and what is selected stays in sight
  // (12 Nov 2026: the panel covered the cards on the right); a narrow window keeps it over the graph
  // (13 Nov 2026) a narrow window that is tall enough has it below the graph, the forms at a width they read at
  function dock(on) {
    const mode = !on ? '' : main.clientWidth >= 640 ? 'side' : main.clientHeight >= 520 ? 'below' : '';
    const now = main.classList.contains('with-edit') ? 'side' : main.classList.contains('with-edit-below') ? 'below' : '';
    if (mode === now) return;
    main.classList.toggle('with-edit', mode === 'side');
    main.classList.toggle('with-edit-below', mode === 'below');
    if (mode) setTimeout(() => { const s = canvas().selection(); if ((s.nodes || []).length) canvas().reveal?.(s.nodes); }, 260);
  }
  const nodes = () => graph().nodes || [];
  const ready = () => { const why = busy(); if (why) status(why, 'warn'); return !why; };

  // which rules of the map the panel shows: drawn again when they change
  function sigOf(t) {
    const links = (edits() || {}).links || [];
    const mine = t.rule ? links.filter((l) => l.id === t.rule || l.otherwiseOf === t.rule)
      : links.filter((l) => (t.name ? l.src === t.name : !l.src) || (l.do || []).some((x) => x.target === t.name));
    // the object's own properties the form shows (a keypad's code): an undo of one draws it again (12 Nov 2026)
    const props = (edits() || {}).props || {};
    const own = [...new Set(t.rule ? mine.map((l) => l.src) : [t.name])].filter(Boolean).map((n) => props[n] || null);
    return JSON.stringify([targetKey(t), mine, own]);
  }
  async function showPanel(force = false) {
    sameMap();
    if (!target || hiddenFor === targetKey(target)) { hide(); return; }
    const sig = sigOf(target);
    const n = target.rule ? nodes().find((x) => x.kind === 'rule' && x.rule === target.rule) : null;
    const said = target.rule ? (n && n.sentence) || ((graph().wires || []).find((w) => w.id === 'rule:' + target.rule) || {}).sentence : '';
    const head = panel.querySelector('.lw-edith b');
    head.textContent = target.rule ? `Rule ${target.rule}${said ? ': ' + said : ''}` : target.label || 'The map';
    head.title = head.textContent;
    if (!force && sig === drawnSig && !panel.hidden) return;
    drawnSig = sig;
    panel.hidden = false;
    dock(true);
    // two drawings can overlap (the rule's own change, then the graph's): the field that had the keys when the first
    // began is kept for the last one, which alone gives them back (13 Nov 2026: the second found no field with the
    // keys and gave them to the panel, so the next Tab left the form and the goal's name typed after it was lost)
    const cur = document.activeElement;
    if (cur && cur !== panel && body.contains(cur)) held = { el: cur, at: Date.now() };
    const was = held && Date.now() - held.at < 1500 ? held.el : panel.contains(cur) ? cur : null;
    const gen = ++drawing;
    const keep = was ? body.scrollTop : 0, again = was && focusKey(was);
    await edit.panel(body, target.rule ? { rule: target.rule } : { name: target.name }, () => { drawnSig = ''; showPanel(true); });
    if (gen !== drawing) return;                 // a later drawing gives the keys back
    held = null;
    body.scrollTop = keep;
    // the form drawn again took the field that had the keys: the same field (or the panel) has them again, or the
    // next key went to the editor (12 Nov 2026: Tab out of a message, then Esc, put the maximized layout back).
    // What was being typed in it and not yet taken (no change yet) goes on in the new field (13 Nov 2026: the rule
    // saved after a slow change was drawn again while the next field was typed in, and its text was lost).
    const now = document.activeElement, typing = was && !was.isConnected && /^(INPUT|TEXTAREA)$/.test(was.tagName)
      && !/^(checkbox|radio|button|range|color|file)$/.test(was.type) && was.value !== was.defaultValue
      ? { value: was.value, start: was.selectionStart, end: was.selectionEnd } : null;
    const free = !now || now === document.body;
    if (was && (free || now === panel)) {        // not when the keys went elsewhere on purpose (a click in the 3D view)
      let el = null;
      try { el = again ? body.querySelector(again) : null; } catch { el = null; }
      (el || panel).focus({ preventScroll: true });
      if (el && typing && el.value !== typing.value) {
        el.value = typing.value;
        try { el.setSelectionRange(typing.start, typing.end); } catch { /* a number field */ }
        // the browser fires change only for what was typed in this field: the value carried over is taken when it
        // loses the keys, as if typed here
        let took = false;
        el.addEventListener('change', () => { took = true; }, { once: true });
        el.addEventListener('blur', () => { if (!took && el.value !== el.defaultValue) el.dispatchEvent(new Event('change', { bubbles: true })); }, { once: true });
      }
    } else if (!was && free && Date.now() - lostAt < 1500 && !panel.hidden) panel.focus({ preventScroll: true });
  }
  // a field as a selector by its tag and its data- attributes (the List's forms name their fields so)
  function focusKey(el) {
    const data = Object.entries(el.dataset || {});
    if (!data.length) return '';
    const attr = (k) => 'data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    // within its rule's card: a rule's "If not" has fields of the same marks (13 Nov 2026: Tab out of the If not's
    // message went to the rule's own "+ Add a step" above it)
    const card = el.closest('.lk-rule[data-lk]');
    const within = card && card !== el ? `.lk-rule[data-lk="${CSS.escape(card.dataset.lk)}"] ` : '';
    return within + el.tagName.toLowerCase() + data.map(([k, v]) => `[${attr(k)}="${CSS.escape(v)}"]`).join('');
  }
  // the selection changed: a rule (a card, a simple rule's wire, a wire of a rule), else one object, else nothing
  function selected(sel) {
    const rules = rulesOf(sel, nodes()), acts = actsOf(sel);
    const ids = (sel && sel.nodes) || [];
    let t = null;
    if (rules.length === 1 && ids.length <= 1) t = { rule: rules[0] };
    else if (!rules.length && acts.length === 1 && !ids.length) t = { rule: acts[0].rule };
    else if (ids.length === 1 && nameOf(ids[0]) !== null) {
      const n = nodes().find((x) => x.id === ids[0]);
      t = { name: nameOf(ids[0]), label: n ? (n.kind === 'world' ? 'The map' : n.label || n.name) : nameOf(ids[0]) };
    }
    if (targetKey(t) !== targetKey(target)) { target = t; hiddenFor = ''; drawnSig = ''; }
    showPanel();
  }

  // ---------------------------------------------------------------- menus and the quick add
  function closeMenu() { menuEl?.remove(); menuEl = null; const q = quick; quick = null; q?.close(); }
  function menuAt(screen, items, onPick) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'lw-menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.innerHTML = items.map((m) => (m === '-' ? '<hr>' : `<button type="button" role="menuitem" data-pick="${esc(m[0])}"${m[2] ? ` title="${esc(m[2])}"` : ''}>${esc(m[1])}</button>`)).join('');
    host.appendChild(menuEl);
    const x = Math.max(4, Math.min(host.clientWidth - menuEl.offsetWidth - 6, screen ? screen[0] : 20));
    const y = Math.max(4, Math.min(host.clientHeight - menuEl.offsetHeight - 6, screen ? screen[1] : 20));
    menuEl.style.left = x + 'px'; menuEl.style.top = y + 'px';
    menuEl.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { const v = b.dataset.pick; closeMenu(); onPick(v); }));
    menuEl.querySelector('button')?.focus();
  }
  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuEl) { closeMenu(); canvas().focus(); e.stopPropagation(); } }, true);
  // the menus' lists made ready when the mouse comes on the graph, before its right-click (13 Nov 2026: the first menu
  // of a map opened about a second late, its objects' classes asked for then); once per map
  let warmFor = null;
  host.addEventListener('pointerenter', () => {
    const m = mapNow();
    if (warmFor === m) return;
    warmFor = m;
    Promise.resolve().then(() => Promise.all([edit.objects(), edit.whens('')])).catch(() => { warmFor = null; });
  });
  function quickAdd(screen, title, items, onPick, { lead = [], placeholder = 'Search' } = {}) {
    closeMenu();
    const groups = [...new Set(items.map((it) => it.group).filter(Boolean))];
    // each kind of list remembers its own picks (its search words tell them apart; 12 Nov 2026: one Recent for all, so
    // a cause picked in one list came first in the list of what a rule does)
    quick = openQuickAdd({ host, at: screen || [20, 20], items, groups, lead, recent: `${RECENT}:${placeholder}`, title, placeholder,
      onPick: (it) => { quick = null; onPick(it.data || {}, it); },
      onClose: () => { quick = null; canvas().focus(); } });
  }
  // what a rule does: a step with no object, or one an object takes (picked from the map's objects, then its inputs)
  async function actPicker(screen, title, done) {
    const objects = (await edit.objects()).map((o) => ({ ...o, group: ON_OBJECT, hint: 'Then what it does' }));
    quickAdd(screen, title, [PICK, ...edit.free(), ...objects], async (d, it) => {
      if (d.verb) return done(d.target ? { target: d.target, verb: d.verb } : { verb: d.verb });   // a phase: its block
      const o = await chosen(d, it, 'Click the object that does it');
      if (o) return inputPicker(screen, `What does ${o.label} do?`, o.object, done);
    }, { placeholder: 'Search what it does, or an object', lead: [PICK_GROUP] });
  }
  // the object of a list's pick: the one picked, or the one clicked with the eyedropper ({object, label}, or null)
  async function chosen(d, it, hint) {
    if (d.object) return { object: d.object, label: it.label };
    if (!d.pick || !edit.pick) return null;
    return edit.pick(hint);
  }
  const pickedOne = (d, it, hint) => chosen(d, it, hint);
  async function inputPicker(screen, title, name, done) {
    const items = await edit.inputs(name);
    if (!items.length) { status('That object takes no steps: pick another one.', 'warn'); return; }
    quickAdd(screen, title, items, (d) => done({ target: d.target, verb: d.verb }), { placeholder: 'Search what it does' });
  }
  async function whenPicker(screen, title, name, done) {
    const items = await edit.whens(name);
    if (!items.length) { status('Nothing happens to it that can start a rule: it is acted on by others.', 'warn'); return; }
    quickAdd(screen, title, items, (d) => done(d.when), { placeholder: 'Search what happens' });
  }
  // a rule made: selected and in sight once the graph has it (its card, or its wire when it is a simple one)
  let pendingTries = 0;
  function made(id) {
    if (!id) return;
    pending = id; pendingTries = 0;
    target = { rule: id }; hiddenFor = ''; drawnSig = '';
  }
  async function newRule(name, when, act, screen) {
    if (act) return made(await edit.addRule(name, when, act));
    actPicker(screen, 'Then…', async (a) => made(await edit.addRule(name, when, a)));
  }

  // on empty space: a rule of the map, of the player, of the world or of an object; a note, a frame, Paste, Fit
  async function emptyMenu(at) {
    if (!ready()) return;
    const sel = canvas().selection();
    const objects = (await edit.objects()).map((o) => ({ ...o, group: ON_OBJECT, hint: 'Then what happens to it' }));
    const extra = [
      { id: 'note', label: 'Add a note', group: 'Edit', hint: 'A note on the graph, for you: the game never sees it', words: ['note', 'comment', 'text'], data: { note: true } },
      ...((sel.nodes || []).length ? [{ id: 'frame', label: 'Frame the selection', group: 'Edit', hint: 'A frame with a title around the selected nodes', words: ['frame', 'box', 'group', 'comment'], data: { frame: true } }] : []),
      ...(clipboard ? [{ id: 'paste', label: clipboard.rules.length > 1 ? `Paste ${clipboard.rules.length} rules` : 'Paste the rule', group: 'Edit', hint: 'Ctrl+V', words: ['paste'], data: { paste: true } }] : []),
      { id: 'fit', label: 'See the whole graph', group: 'View', hint: 'Home', words: ['fit', 'zoom', 'all'], data: { fit: true } },
      { id: 'tidy', label: 'Tidy the graph', group: 'View', hint: 'Lay every card out again (pinned ones stay)', words: ['arrange', 'layout', 'tidy', 'order'], data: { tidy: true } },
      ...Object.entries(SEVERAL).map(([kind, [label, hint, words]]) => ({ id: 'several:' + kind, label: label + '…', group: SEVERAL_GROUP, hint, words, data: { several: kind } })),
    ];
    const whens = await edit.whens('');
    const blocks = (edit.blocks ? edit.blocks() : []).map((b) => ({ ...b, group: BLOCK_GROUP }));
    quickAdd(at.screen, 'Add a rule', [PICK, ...extra, ...whens, ...objects, ...blocks], async (d, it) => {
      if (d.block !== undefined) {
        if (!ready()) return;
        const name = edit.addBlock(d.block);
        if (name) { pendingObj = name; pendingTries = 0; target = { name, label: it.label }; hiddenFor = ''; drawnSig = ''; }
        return;
      }
      if (d.note) return noteAt(at);
      if (d.frame) return frameSelection();
      if (d.paste) return paste();
      if (d.fit) return canvas().fit();
      if (d.tidy) { canvas().arrange(); return canvas().fit(); }
      if (d.several) return severalPicker(at.screen, d.several, []);
      if (d.object || d.pick) {
        const o = await chosen(d, it, 'Click the object the rule starts from');
        if (o) whenPicker(at.screen, `When ${o.label}…`, o.object, (when) => newRule(o.object, when, null, at.screen));
        return;
      }
      if (d.when) newRule('', d.when, null, at.screen);
    }, { lead: ['Edit', PICK_GROUP], placeholder: 'Search what sets the rule off' });
  }
  // "When all of these…": the objects picked one by one, then "That's all" makes the rule (a block for all and at
  // least N, one rule with "Or when..." for any)
  async function severalPicker(screen, kind, chosen) {
    const left = (await edit.objects()).filter((o) => !chosen.some((c) => c.name === o.data.object));
    const done = chosen.length >= 2 ? [{ id: 'done', label: `That's all: make the rule (${chosen.length} objects)`, group: 'Edit', data: { done: true } }] : [];
    const title = `${SEVERAL[kind][0]}: ${chosen.length ? chosen.map((c) => c.label).join(', ') + ', and…' : 'pick the first one'}`;
    quickAdd(screen, title, [...done, PICK, ...left.map((o) => ({ ...o, group: ON_OBJECT, hint: chosen.length ? 'One more' : 'The first one' }))], async (d, it) => {
      if (d.done) { if (ready()) Promise.resolve(edit.several(kind, chosen.map((c) => c.name))).then(made); return; }
      const o = await pickedOne(d, it, chosen.length ? 'Click one more object' : 'Click the first object');
      if (o && !chosen.some((c) => c.name === o.object)) severalPicker(screen, kind, [...chosen, { name: o.object, label: o.label }]);
      else if (o) severalPicker(screen, kind, chosen);
    }, { lead: ['Edit', PICK_GROUP], placeholder: 'Search the objects' });
  }
  // on a map object (or the map): a rule on what happens to it, its rules at the side, the 3D view, Why not?
  function objectMenu(id, at) {
    const name = nameOf(id), sel = canvas().selection();
    const picked = [...new Set((sel.nodes || []).map(nameOf).filter(Boolean))];
    const items = [['when', name ? 'When it…' : 'When…', 'A new rule on what happens to it'],
      ...(name ? [['by', 'Another object makes it…', 'What it does (open, close...), then what sets it off: a switch, a button... picked in the list or the 3D view']] : []),
      ...(picked.length >= 2 && picked.includes(name) ? Object.entries(SEVERAL).map(([kind, [label, hint]]) => ['several:' + kind, `${label} (${picked.length})…`, hint]) : []),
      ['side', 'Its rules at the side'], ...(name ? [['select', 'Select in the 3D view']] : []),
      ['why', 'Why not?', 'What the last Play and Try it say of it (W)'], '-',
      ['block', 'Make a block', 'Ctrl+G: the selection in a block of its own']];
    if (clipboard) items.push(['paste', 'Paste']);
    menuAt(at.screen, items, (what) => {
      if (what === 'when') whenPicker(at.screen, name ? 'When it…' : 'When…', name, (when) => newRule(name, when, null, at.screen));
      else if (what === 'by') inputPicker(at.screen, 'What does it do?', name, (a) => madeBy(name, a.verb, at.screen));
      else if (what === 'side') { target = { name, label: name || 'The map' }; hiddenFor = ''; drawnSig = ''; showPanel(true); }
      else if (what === 'select') commands.select?.(name);
      else if (what === 'why') commands.why?.(sel);
      else if (what === 'block') commands.block?.(sel);
      else if (what === 'paste') paste();
      else if (String(what).startsWith('several:') && ready()) Promise.resolve(edit.several(what.slice(8), picked)).then(made);
    });
  }
  // on a rule (its card, or with others selected: all of them)
  function ruleMenu(rules, at) {
    const n = rules.length, sel = canvas().selection(), one = rules[0];
    const items = [['edit', n > 1 ? `Edit ${one}` : 'Edit', 'Its form at the side'], ['step', 'Add a step…'], '-',
      ['dup', n > 1 ? `Duplicate ${n} rules` : 'Duplicate'], ['copy', n > 1 ? `Copy ${n} rules` : 'Copy'], ['cut', 'Cut']];
    if (clipboard) items.push(['paste', 'Paste']);
    items.push('-', ['why', 'Why not?', 'W'], ['mute', 'Mute while playing', 'M: the game skips it until you press it again'],
      ['pause', 'Pause here while playing', 'F9: the game stops when it runs'], ['block', 'Make a block', 'Ctrl+G'], '-',
      ['delete', n > 1 ? `Delete ${n} rules` : 'Delete']);
    menuAt(at.screen, items, (what) => {
      if (what === 'edit') { target = { rule: one }; hiddenFor = ''; drawnSig = ''; showPanel(true); }
      else if (what === 'step') actPicker(at.screen, 'Add a step', (a) => edit.addAct(one, a));
      else if (what === 'dup') duplicate(rules);
      else if (what === 'copy') copy(rules);
      else if (what === 'cut') { if (copy(rules)) edit.remove(rules); }
      else if (what === 'paste') paste();
      else if (what === 'why') commands.why?.(sel);
      else if (what === 'mute') commands.mute?.(sel);
      else if (what === 'pause') commands.pause?.(sel);
      else if (what === 'block') commands.block?.(sel);
      else if (what === 'delete') edit.remove(rules);
    });
  }
  // on a wire of a rule: the rule's form, the step's time, a Wait before it, Delete (the step, or the simple rule)
  function wireMenu(id, at) {
    const p = wireParts(id);
    if (!p) return;
    const step = p.part === 'act' ? { rule: p.rule, act: p.act } : p.part === 'rule' ? simpleAct(graph(), id) : null;
    const items = [['edit', 'Edit the rule', 'Its form at the side']];
    if (step) items.push(['delay', 'Add a delay…', 'When it happens, in seconds'], ['wait', 'Insert a Wait', 'A Wait before it: the rule becomes a list of steps']);
    items.push('-', ['delete', p.part === 'act' ? 'Delete the step' : 'Delete the rule']);
    menuAt(at.screen, items, (what) => {
      if (what === 'edit') { target = { rule: p.rule }; hiddenFor = ''; drawnSig = ''; showPanel(true); }
      else if (what === 'delay') delayBox(step.rule, step.act, at);
      else if (what === 'wait') { const r = edit.wait(step.rule, step.act); if (r !== true) status(r, 'warn'); }
      else if (what === 'delete') { if (p.part === 'act') edit.removeAct(p.rule, p.act); else edit.remove([p.rule]); }
    });
  }
  function noteMenu(id, at) {
    menuAt(at.screen, [['edit', 'Edit the note'], '-', ['delete', 'Delete the note']], (what) => {
      if (what === 'edit') noteBox(id, at);
      else removeLayout({ notes: [id] });
    });
  }
  function frameMenu(id, at) {
    menuAt(at.screen, [['edit', 'Rename the frame'], '-', ['delete', 'Delete the frame']], (what) => {
      if (what === 'edit') frameBox(id, at);
      else removeLayout({ frames: [id] });
    });
  }
  function context(hit, at) {
    if (!ready()) return;
    if (hit.kind === 'wire') return wireMenu(hit.id, at);
    if (hit.kind === 'note') return noteMenu(hit.id, at);
    if (hit.kind === 'frame') return frameMenu(hit.id, at);
    if (hit.kind !== 'node') return emptyMenu(at);
    const name = nameOf(hit.id);
    if (hit.pin && name !== null && hit.pin.side === 'out') return pinDrop({ node: hit.id, pin: hit.pin.pin, side: 'out' }, at);
    const sel = canvas().selection();
    const rules = rulesOf(sel, nodes());
    const n = nodes().find((x) => x.id === hit.id);
    if (n && n.kind === 'rule') return ruleMenu(rules.includes(n.rule) ? [n.rule, ...rules.filter((r) => r !== n.rule)] : [n.rule], at);
    if (name !== null) return objectMenu(hit.id, at);
  }

  // ---------------------------------------------------------------- wires dragged
  // let go on empty space: from what happens to an object, a new rule (what it does, then on what); from a rule's
  // card, a step; from what an object can do, what makes it do so
  function pinDrop(from, at) {
    if (!ready()) return;
    const name = nameOf(from.node), n = nodes().find((x) => x.id === from.node);
    if (n && n.kind === 'rule' && from.side === 'out') return actPicker(at.screen, 'Add a step', (a) => edit.addAct(n.rule, a));
    if (name === null) return;
    if (from.side === 'out') {
      const when = whenOfPin(from.pin);
      if (when) return newRule(name, when, null, at.screen);
      return whenPicker(at.screen, name ? 'When it…' : 'When…', name, (w) => newRule(name, w, null, at.screen));
    }
    const verb = verbOfPin(from.pin);
    if (verb) return madeBy(name, verb, at.screen);
    if (name) inputPicker(at.screen, 'What does it do?', name, (a) => madeBy(name, a.verb, at.screen));
  }
  // what makes `name` do `verb`: another object (from the list, or clicked with the eyedropper), then what happens to it
  async function madeBy(name, verb, screen) {
    const objs = await edit.objects();
    quickAdd(screen, 'What makes it do this?', [PICK, ...objs.filter((o) => o.data.object !== name).map((o) => ({ ...o, group: ON_OBJECT }))], async (d, it) => {
      const o = await chosen(d, it, 'Click the object that makes it do this (a switch, a button...)');
      if (!o) return;
      if (o.object === name) { status('Pick another object: this one is what it acts on.', 'warn'); return; }
      whenPicker(screen, `When ${o.label}…`, o.object, (w) => newRule(o.object, w, { target: name, verb }, screen));
    }, { placeholder: 'Search an object', lead: [PICK_GROUP] });
  }
  // onto a node: an object's happening onto another object (a new rule doing what that one can), a rule's card onto
  // an object (a step on it)
  function connect(from, to) {
    if (busy()) return busy();
    const a = nameOf(from.node), b = nameOf(to.node), card = nodes().find((x) => x.id === from.node && x.kind === 'rule');
    if (b === null || b === '') return to.node === from.node ? 'Drop it on another object.' : 'Drop it on an object of the map: it is what the rule acts on.';
    const screen = lastScreen();
    const withVerb = (go) => { const v = verbOfPin(to.pin); if (v) go({ target: b, verb: v }); else inputPicker(screen, 'What does it do?', b, go); };
    if (card) { withVerb((act) => edit.addAct(card.rule, act)); return true; }
    if (a === null) return 'Start from what happens to an object, or from a rule.';
    if (a === b) return 'Drop it on another object.';
    const when = whenOfPin(from.pin);
    withVerb((act) => (when ? newRule(a, when, act) : whenPicker(screen, a ? 'When it…' : 'When…', a, (w) => newRule(a, w, act))));
    return true;
  }
  // a wire's end moved: a step's object changed (only to one that can do it; else what it does is asked)
  function retarget(ids, end, to) {
    if (busy()) return busy();
    if (end !== 'to') return 'Move the end at the object it acts on: what sets a rule off is chosen in its form.';
    const name = nameOf(to.node);
    if (!name) return 'Drop it on an object of the map.';
    const steps = ids.map((id) => (wireParts(id)?.part === 'act' ? wireParts(id) : simpleAct(graph(), id))).filter(Boolean);
    if (!steps.length) return 'Only the wires of rules can be moved.';
    const verb = verbOfPin(to.pin);
    (async () => {
      const r = await edit.retarget(steps.map((s) => ({ rule: s.rule, act: s.act })), name, verb);
      if (r === true) return;
      status(r, 'warn');
      // what it does on that object, asked (all of them do that)
      inputPicker(lastScreen(), 'What does it do?', name, async (a) => {
        const again = await edit.retarget(steps.map((s) => ({ rule: s.rule, act: s.act })), name, a.verb);
        if (again !== true) status(again, 'warn');
      });
    })();
    return true;
  }
  let pointer = [20, 20];
  host.addEventListener('pointermove', (e) => { const r = host.getBoundingClientRect(); pointer = [e.clientX - r.left, e.clientY - r.top]; }, true);
  const lastScreen = () => [...pointer];

  // ---------------------------------------------------------------- values (L4)
  function value(node, v, at) {
    if (!ready()) return;
    const p = valueOf(v);
    if (!p) return;
    if (p.kind === 'time') return delayBox(p.rule, p.act, at);
    if (p.kind === 'add') return actPicker(at.screen, 'Add a step', (a) => edit.addAct(p.rule, a));
    if (focusInPanel(p)) return;                 // the rule is open beside the graph: its field there, no box over it
    const key = p.kind === 'when' ? 'when' : p.kind === 'if' ? 'if:' + p.check : 'act:' + p.act;
    const title = p.kind === 'when' ? 'What sets it off' : p.kind === 'if' ? 'Only if' : 'The step';
    const again = (el) => edit.value(el, p.rule, key, () => again(el));
    openBox(at, title, again, { more: () => { target = { rule: p.rule }; hiddenFor = ''; drawnSig = ''; showPanel(true); } });
  }
  // a value of a rule whose form the side panel shows: that field gets the keys, in sight (13 Nov 2026: a click on a
  // card's row opened a small box over the panel, the same field twice). -> false when the panel has no such field
  function focusInPanel(p) {
    if (panel.hidden) return false;
    const card = body.querySelector(`.lk-rule[data-lk="${CSS.escape(p.rule)}"]`);
    if (!card) return false;
    let el = null;
    if (p.kind === 'when') el = card.querySelector('select[data-lkw]');
    else if (p.kind === 'if') {
      const row = card.querySelector(`[data-ci="${p.check}"]`);
      el = row && row.querySelector('input:not([type=checkbox]), select, button');
    } else if (p.kind === 'act') {
      const l = ((edits() || {}).links || []).find((x) => x.id === p.rule);
      const j = l ? (l.do || []).findIndex((x) => x && x.id === p.act) : -1;
      const step = j < 0 ? null : card.querySelector(`select[data-lkv="${j}"]`)?.closest('.lk-act');
      el = step && (step.querySelector('input:not([type=checkbox]):not([type=hidden]), textarea') || step.querySelector('select'));
    }
    if (!el || el.offsetParent === null) return false;
    el.scrollIntoView({ block: 'nearest' });
    el.focus({ preventScroll: true });
    // the caret at the end, the text kept (a key typed at once does not replace the whole message)
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|)$/.test(el.type || ''))) { const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* no caret */ } }
    return true;
  }
  // a small box under the value (graph-value-edit.js): Esc gives back what changed in it (the undo steps it made),
  // or done(cancelled) for a box of the graph's own (a note, a frame's title)
  function openBox(at, title, render, { more = null, done = null } = {}) {
    closeMenu();
    vbox?.close();
    const n = edit.undoCount ? edit.undoCount() : 0;
    vbox = openValueEditor({ host, at: at?.screen || [20, 20], title,
      render: (el) => { el.classList.add('lw-vbox'); Promise.resolve(render(el)).then((f) => { f?.focus?.(); if (f?.select && f.type !== 'checkbox') f.select(); }); return null; },
      cancel: () => { if (!done && edit.undoTo) edit.undoTo(n); },
      onClose: (cancelled) => { vbox = null; if (done) done(cancelled); canvas().focus(); },
      more: more ? { label: 'All of it', run: more } : null });
    for (const type of ['change', 'click', 'input', 'keydown']) vbox.el.addEventListener(type, touch, true);
    return vbox;
  }
  // a step's time, in seconds (from the rule's start; from the step before in a list of steps)
  function delayBox(rule, act, at) {
    const w = (graph().wires || []).find((x) => x.part === 'do' && x.rule === rule && x.act === act);
    const card = nodes().find((x) => x.kind === 'rule' && x.rule === rule);
    const row = card && [...(card.sections || []).flatMap((s) => s.rows), ...(card.otherwise || [])].find((r) => r.act === act);
    const now = row ? row.time : w ? w.delay || 0 : 0;
    openBox(at, 'When it happens', (el) => {
      el.innerHTML = `<div class="row"><label style="width:auto">After</label><input type="number" class="lw-delay" min="0" step="0.5" value="${+now || 0}" style="width:72px"><span class="hint" style="margin:0">s</span></div>
        <div class="hint" style="margin:4px 0 0">${card && card.sections && row && row.pause !== undefined ? 'From the step before it.' : 'From when the rule starts.'}</div>`;
      const f = el.querySelector('.lw-delay');
      f.addEventListener('change', () => edit.delay(rule, act, +f.value || 0));
      return f;
    });
  }
  function delay(id, seconds) {
    const p = wireParts(id);
    if (p && p.part === 'act') edit.delay(p.rule, p.act, seconds);
  }

  // ---------------------------------------------------------------- notes, frames, places (edits.logic.view)
  const view = () => { const l = (edits() || {}).logic; return (l && l.view) || {}; };
  function noteAt(at) {
    const id = freeId(view().notes, 'N');
    textBox(at, 'A note', '', 'Write the note', (text) => {
      if (!text.trim()) return;
      edit.view('Add a note to the Logic graph', (v) => { (v.notes ||= []).push({ id, text: text.trim(), at: at.world.map(Math.round) }); });
    });
  }
  function noteBox(id, at) {
    const n = (view().notes || []).find((x) => x.id === id);
    if (!n) return;
    textBox(at, 'The note', n.text, 'Write the note', (text) => {
      if (text.trim() === n.text) return;
      edit.view('Edit a note of the Logic graph', (v) => { const x = (v.notes || []).find((y) => y.id === id); if (x) x.text = text.trim(); });
    });
  }
  function frameSelection() {
    const sel = canvas().selection(), at = canvas().positions();
    const boxes = (sel.nodes || []).filter((id) => at[id]).map((id) => {
      const n = shownNow.nodes.find((x) => x.id === id) || {};
      return [...at[id], ...nodeSize(n)];
    });
    const rect = frameAround(boxes);
    if (!rect) { status('Select the nodes to frame first.', 'warn'); return; }
    const id = freeId(view().frames, 'F');
    edit.view('Frame nodes in the Logic graph', (v) => { (v.frames ||= []).push({ id, title: 'Frame', rect }); });
    pendingFrame = id;
  }
  let pendingFrame = null;
  function frameBox(id, at) {
    const f = (view().frames || []).find((x) => x.id === id);
    if (!f) return;
    textBox(at, 'The frame', f.title, 'Its title', (text) => {
      if (text.trim() === f.title) return;
      edit.view('Rename a frame of the Logic graph', (v) => { const x = (v.frames || []).find((y) => y.id === id); if (x) x.title = text.trim(); });
    }, true);
  }
  // Enter (Ctrl+Enter in a note) or a click elsewhere keeps what was written, Esc does not
  function textBox(at, title, text, placeholder, done, line = false) {
    let field = null;
    openBox(at, title, (el) => {
      el.innerHTML = line ? `<input type="text" class="lw-text" maxlength="80" placeholder="${esc(placeholder)}" value="${esc(text)}" style="width:100%;box-sizing:border-box">`
        : `<textarea class="lw-text" rows="4" maxlength="2000" placeholder="${esc(placeholder)}" style="width:100%;box-sizing:border-box;resize:vertical">${esc(text)}</textarea>`;
      field = el.querySelector('.lw-text');
      return field;
    }, { done: (cancelled) => { if (!cancelled && field) done(field.value); } });
  }
  function removeLayout({ notes = [], frames = [] }) {
    if (!notes.length && !frames.length) return;
    edit.view(notes.length + frames.length > 1 ? 'Delete notes and frames of the Logic graph' : notes.length ? 'Delete a note of the Logic graph' : 'Delete a frame of the Logic graph', (v) => {
      if (notes.length) v.notes = (v.notes || []).filter((n) => !notes.includes(n.id));
      if (frames.length) v.frames = (v.frames || []).filter((f) => !frames.includes(f.id));
    });
  }
  // nodes, notes and frames moved: kept (the map's edits, one Ctrl+Z)
  function move(moves) {
    if (busy()) return;
    const ns = moves.nodes || {}, fr = moves.frames || {}, no = moves.notes || {};
    if (!Object.keys(ns).length && !Object.keys(fr).length && !Object.keys(no).length) return;
    edit.view('Move in the Logic graph', (v) => {
      const pos = v.pos && typeof v.pos === 'object' ? v.pos : (v.pos = {});
      for (const [id, p] of Object.entries(ns)) if (Array.isArray(p)) pos[id] = p.map(Math.round);
      for (const [id, r] of Object.entries(fr)) { const f = (v.frames || []).find((x) => x.id === id); if (f && Array.isArray(r)) f.rect = r.map(Math.round); }
      for (const [id, p] of Object.entries(no)) { const n = (v.notes || []).find((x) => x.id === id); if (n && Array.isArray(p)) n.at = p.map(Math.round); }
    });
  }

  // ---------------------------------------------------------------- copy, paste, duplicate, delete (L5)
  function copy(rules) {
    const clip = rules.length ? edit.copy(rules) : null;
    if (clip) { clipboard = clip; status(rules.length > 1 ? `${rules.length} rules copied.` : 'Rule copied.'); }
    return !!clip;
  }
  function paste(clip = clipboard, verb = 'Paste') {
    if (!clip || !ready()) return;
    const { ids, skipped } = edit.paste(clip, verb);
    if (skipped.length) status(`${skipped.length} rule${skipped.length === 1 ? '' : 's'} left out: ${skipped.length === 1 ? 'its object is' : 'their objects are'} not in this map.`, 'warn');
    if (ids.length) { pending = ids; pendingTries = 0; target = ids.length === 1 ? { rule: ids[0] } : null; hiddenFor = ''; drawnSig = ''; }
  }
  function duplicate(rules) { const clip = rules.length ? edit.copy(rules) : null; if (clip) paste(clip, 'Duplicate'); }
  function remove(sel) {
    if (!ready()) return;
    const rules = rulesOf(sel, nodes()), acts = actsOf(sel).filter((a) => !rules.includes(a.rule));
    const things = (sel.nodes || []).filter((id) => nameOf(id));
    if (rules.length) edit.remove(rules);
    for (const a of acts) edit.removeAct(a.rule, a.act);
    removeLayout({ notes: sel.notes || [], frames: sel.frames || [] });
    if (!rules.length && !acts.length && !(sel.notes || []).length && !(sel.frames || []).length && things.length)
      status('The graph deletes rules, steps, notes and frames: delete map objects in the 3D view or the Hierarchy.', 'warn');
  }
  // the canvas's commands this editor does (true: done)
  function command(name, d) {
    const sel = (d && d.selection) || canvas().selection();
    // N, C, F2 and a double click on a note or a frame: the graph's own notes and frames
    if (name === 'note') { if (ready()) noteAt(d && d.at || { screen: [40, 40], world: [0, 0] }); return true; }
    if (name === 'frame-around') { if (ready()) frameSelection(); return true; }
    if (name === 'rename') {
      const frame = d && d.frame || (!(sel.nodes || []).length && (sel.frames || []).length === 1 ? sel.frames[0] : '');
      const note = d && d.note || (!(sel.nodes || []).length && (sel.notes || []).length === 1 ? sel.notes[0] : '');
      if (!frame && !note) return false;            // a block or a port: the window renames it
      if (ready()) { if (frame) frameBox(frame, d && d.at); else noteBox(note, d && d.at); }
      return true;
    }
    if (!['copy', 'cut', 'paste', 'duplicate'].includes(name)) return false;
    if (name === 'paste') { paste(); return true; }
    const rules = rulesOf(sel, nodes());
    if (!rules.length) { status('Select rules to copy (their cards, or the wires of simple ones).', 'warn'); return true; }
    if (name === 'copy') copy(rules);
    else if (name === 'cut') { if (copy(rules) && ready()) edit.remove(rules); }
    else if (ready()) duplicate(rules);
    return true;
  }

  return {
    context, pinDrop, connect, retarget, value, remove, move, delay, command,
    add: (at) => emptyMenu(at),
    selected,
    recent: () => Date.now() - touched < 4000,
    settle() { touched = 0; },                     // another view chosen: it is fitted again
    // the graph as the canvas draws it: values on the cards, the notes and frames, the places kept
    decorate(shown, model) {
      const cards = new Map((model.nodes || []).filter((n) => n.kind === 'rule').map((n) => [n.id, n]));
      for (const n of shown.nodes) withValues(n, cards.get(n.id));
      Object.assign(shown, decorations(view()));
      shownNow = shown;
      return shown;
    },
    // after the canvas has the graph: a rule just made or pasted selected and in sight, the side panel drawn again
    sync() {
      if (pending) {
        const want = [].concat(pending), ids = want.map((r) => 'rule:' + r);
        const cards = ids.filter((id) => shownNow.nodes.some((n) => n.id === id)), wires = ids.filter((id) => shownNow.wires.some((w) => w.id === id));
        if (cards.length || wires.length) {
          pending = null;
          requestAnimationFrame(() => { canvas().select({ nodes: cards, wires }); canvas().reveal(cards.length ? cards : wires.map((id) => shownNow.wires.find((w) => w.id === id).to.node)); });
        } else if (((edits() || {}).links || []).some((l) => want.includes(l.id))) {
          // in the map but not in what is shown (another object's chain): the whole map, once
          if (pendingTries++ === 0) commands.whole?.(); else pending = null;
        }
      }
      if (pendingFrame) { const id = pendingFrame; pendingFrame = null; requestAnimationFrame(() => canvas().select({ frames: [id] })); }
      if (pendingObj) {                            // a block just placed: its node selected and in sight
        const id = OBJECT + pendingObj;
        if (shownNow.nodes.some((n) => n.id === id)) { pendingObj = null; requestAnimationFrame(() => { canvas().select({ nodes: [id] }); canvas().reveal([id]); }); }
        else if (pendingTries++ === 0) commands.whole?.(); else pendingObj = null;
      }
      showPanel();
    },
    hide() { target = null; hide(); closeMenu(); vbox?.close(); },
    close() { closeMenu(); vbox?.close(); },
  };
}
