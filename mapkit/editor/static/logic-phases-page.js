// The Logic window's Phases page (P3, editor/LOGIC.md "The Phases page"): each Phases block of the map as its phases
// from left to right. Each phase says what happens when the mission enters it and leaves it (the rules on its
// Enter_ / Leave_ outputs), the rules that work only in it, and what brings the mission there (the rules that send the
// block Go to). Next / Previous / Reset are drawn between the phases and under them, each with its cause. It reads
// what logic-graph-model.js's logicIndex reads and changes nothing: its clicks open a rule in the List.
//
// phasesPage(ix, blocks)
//   ix      logicIndex(input): its rules (edits.links), its vocabulary's sentences
//   blocks  the map's Phases blocks [{name, label, stateName, phases: [{id, text}], mission: '' | the set's name}]
// returns [{name, label, stateName, mission, phases: [{id, text, flag, first, enter, leave, only, comes}], next,
//           previous, reset, changed, unknown}]; each rule {id, src, cause, sentence, from}
import { escapeHtml as esc } from './shortcut-bar.js';

const low = (s) => String(s ?? '').toLowerCase();
const capital = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };

// A rule as the page shows it: its causes as the sentences say them, without their "When" ("the player uses Button
// 2"), what it does (its first steps: "show the message ..."), its whole sentence for the tooltip
const bare = (t) => String(t || '').replace(/^\s*(when|as soon as)\s+/i, '');
function ruleRef(ix, l, extra = {}) {
  const causes = [l, ...(Array.isArray(l.also) ? l.also : [])].map((c) => bare(ix.vocab.whenText(c, ix.ctx)));
  const steps = (l.do || []).filter((x) => x && !['if', 'else', 'end'].includes(x.verb)).map((x) => ix.vocab.actText(x, ix.ctx));
  const does = steps.slice(0, 3).join('; ') + (steps.length > 3 ? `; and ${steps.length - 3} more` : '');
  return { id: l.id, src: l.src || '', cause: causes.join(' or '), does: does || 'nothing yet', sentence: ix.vocab.sentence(l, ix.ctx), ...extra };
}

export function phasesPage(ix, blocks) {
  const links = (ix.edits && Array.isArray(ix.edits.links) ? ix.edits.links : []).filter((l) => l && l.id && !l.otherwiseOf);
  return (blocks || []).map((b) => {
    const name = low(b.name), ids = (b.phases || []).map((p) => low(p.id));
    const phaseOf = (id) => ids.indexOf(low(id));
    const page = {
      name: b.name, label: b.label || b.name, stateName: b.stateName || 'Phase', mission: b.mission || '',
      phases: (b.phases || []).map((p, k) => ({ id: p.id, text: p.text, flag: `${b.stateName || 'Phase'}_${p.id}`, first: k === 0,
        enter: [], leave: [], only: [], comes: [] })),
      next: [], previous: [], reset: [], changed: [], unknown: [],
    };
    for (const l of links) {
      // a rule on one of the block's outputs (its own cause or one of its "also")
      for (const c of [l, ...(Array.isArray(l.also) ? l.also : [])]) {
        if (low(c.src) !== name || c.when !== 'output') continue;
        const port = String(c.port || ''), m = /^(Enter|Leave)_(.+)$/i.exec(port);
        if (m && phaseOf(m[2]) >= 0) page.phases[phaseOf(m[2])][low(m[1]) === 'enter' ? 'enter' : 'leave'].push(ruleRef(ix, l));
        else if (low(port) === 'changed') page.changed.push(ruleRef(ix, l));
      }
      // a rule kept to some of its phases
      const gate = l.phase && low(l.phase.set) === name ? (l.phase.in || []).map(phaseOf).filter((k) => k >= 0) : null;
      if (gate) for (const k of gate) page.phases[k].only.push(ruleRef(ix, l));
      const from = gate ? gate.map((k) => page.phases[k].text) : null;
      // its steps that move the block (the main ones and the Otherwise's)
      for (const x of [...(l.do || []), ...(l.else || [])]) {
        if (!x || x.verb !== 'input' || low(x.target) !== name) continue;
        const input = String(x.a || ''), go = /^GoTo_(.+)$/i.exec(input);
        if (go) {
          const k = phaseOf(go[1]);
          if (k >= 0) page.phases[k].comes.push(ruleRef(ix, l, { from }));
          else page.unknown.push(ruleRef(ix, l, { from, input }));
        } else if (low(input) === 'next') page.next.push(ruleRef(ix, l, { from }));
        else if (low(input) === 'previous') page.previous.push(ruleRef(ix, l, { from }));
        else if (low(input) === 'reset') page.reset.push(ruleRef(ix, l, { from }));
      }
    }
    return page;
  });
}

// ---------------------------------------------------------------- the page's HTML
// A rule is a button (data-rule, data-src) the window opens in the List; its whole sentence is its tooltip.
// A rule is said by its cause, or by what it does (does: the rules on the phase's own outputs, whose cause the title says)
function ruleHtml(r, how = '', does = false) {
  const from = r.from && r.from.length ? ` <i>in ${esc(r.from.join(' or '))}</i>` : '';
  return `<button type="button" class="lp-rule" data-rule="${esc(r.id)}" data-src="${esc(r.src)}" title="${esc(`Rule ${r.id}: ${r.sentence}`)}">`
    + `${esc(capital(does ? r.does : r.cause))}${how ? ` <b>${esc(how)}</b>` : ''}${from}</button>`;
}
function listHtml(title, rules, empty = '', how = '', does = false) {
  if (!rules.length && !empty) return '';
  return `<div class="lp-part"><h5>${esc(title)}</h5>${rules.length ? rules.map((r) => ruleHtml(r, how, does)).join('') : `<p class="lp-none">${esc(empty)}</p>`}</div>`;
}

// live: Play runs (P7): each phase has "Go here now", the block's GoTo_<phase> sent to the game (logic-window.js)
export function phasesHtml(pages, { live = false } = {}) {
  if (!pages.length) {
    return '<p class="hint">This map has no phases yet. Add a Phases block from Objects &gt; Logic, or right click a door &gt; Give it phases….</p>';
  }
  return pages.map((p) => {
    const head = `<div class="lp-head"><h3>${esc(p.label)}</h3><span title="The states conditions and dialogues read: ${esc(p.stateName)} is the phase's number, ${esc(p.stateName)}_&lt;phase&gt; is Yes during it">${esc(p.stateName)}</span>`
      + (p.mission ? `<span class="lp-mission" title="Shared by the maps of the project that use it (Map &gt; Mission phases...)">Mission phases: ${esc(p.mission)}</span>` : '')
      + `<button type="button" class="lp-open" data-block="${esc(p.name)}" title="Select the Phases block and show its rules">Its rules</button></div>`;
    if (!p.phases.length) return `<section class="lp-set">${head}<p class="hint">It has no phases: write them in its Phases setting.</p></section>`;
    const boxes = p.phases.map((ph, k) => {
      const box = `<div class="lp-phase${ph.first ? ' lp-first' : ''}" data-phase="${esc(ph.id)}">`
        + `<div class="lp-name"><b>${esc(ph.text)}</b><span>${k + 1}</span></div>`
        + `<div class="lp-flag" title="Yes during this phase: conditions and dialogues can read it">${esc(ph.flag)}</div>`
        + (live ? `<button type="button" class="lp-go" data-block="${esc(p.name)}" data-phase="${esc(ph.id)}" title="In the game now: the mission goes to this phase, as a rule's Go to phase would">Go here now</button>` : '')
        + (ph.first ? `<div class="lp-start">${p.mission ? 'The first map starts here; the others go on from where the player is' : 'The map starts here'}</div>` : '')
        + listHtml('Comes here when', ph.comes)
        + listHtml('When it starts', ph.enter, 'Nothing yet', '', true)
        + `<button type="button" class="lp-add" data-block="${esc(p.name)}" data-port="Enter_${esc(ph.id)}">+ When it starts…</button>`
        + listHtml('When it ends', ph.leave, '', '', true)
        + (ph.only.length ? `<details class="lp-only"><summary>${ph.only.length} rule${ph.only.length === 1 ? '' : 's'} only in this phase</summary>${ph.only.map((r) => ruleHtml(r)).join('')}</details>` : '')
        + '</div>';
      // between two phases: the arrow, with what moves the mission on ("next phase")
      const arrow = k < p.phases.length - 1
        ? `<div class="lp-arrow" title="${esc(p.next.length ? 'Next phase: ' + p.next.map((r) => r.cause).join('; ') : 'Nothing sends it to the next phase')}">`
          + `<span>→</span>${p.next.length ? `<i>${esc(p.next.length === 1 ? capital(p.next[0].cause) : `${p.next.length} rules`)}</i>` : ''}</div>`
        : '';
      return box + arrow;
    }).join('');
    const moves = listHtml('Next phase', p.next, '', '') + listHtml('Back a phase', p.previous) + listHtml('Back to the first phase', p.reset)
      + listHtml('Whenever the phase changes', p.changed, '', '', true)
      + (p.unknown.length ? `<div class="lp-part lp-bad"><h5>Go to a phase it does not have</h5>${p.unknown.map((r) => ruleHtml(r, r.input.replace(/^GoTo_/i, ''))).join('')}</div>` : '');
    return `<section class="lp-set">${head}<div class="lp-flow">${boxes}</div>${moves ? `<div class="lp-moves">${moves}</div>` : ''}</section>`;
  }).join('');
}
