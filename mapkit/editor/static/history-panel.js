// The History panel (Window > History, Ctrl+U; a tab next to the Inspector), as Unity's Undo History window: the map's
// Ctrl+Z steps by name, newest first, the map as it was opened at the bottom. The step the map is at is marked, the
// steps Redo would bring back are dimmed; a click on a step goes there (app.js undoes or redoes until the map is at it,
// then draws it once). The steps are app.js's (history-names.js), for the map open: a reload or a Rebuild starts with
// none.
//
// root: the panel's element (index.html #history, docked by workspace.js); rows(): history-names.js historyRows of the
// history now; jump(at): go that many steps (below zero: back). refresh() after any change of the history.
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./history-panel.css', import.meta.url).href;
document.head.appendChild(css);

export function createHistoryPanel({ root, rows, jump }) {
  root.innerHTML = `
    <div class="hs-bar"><span class="hs-count hint"></span></div>
    <ol class="hs-list" aria-label="Undo history: newest first"></ol>
    <p class="hs-note hint">A click goes back (or forward) to that step. Not kept after a Rebuild or a reload: your changes are, by Save and autosave.</p>`;
  const list = root.querySelector('.hs-list'), count = root.querySelector('.hs-count');
  let frame = 0;

  function render() {
    const all = rows(), steps = all.filter((r) => !r.bottom), redo = all.filter((r) => r.redo).length;
    count.textContent = !steps.length ? 'No changes yet' : `${steps.length - redo} ${steps.length - redo === 1 ? 'step' : 'steps'}`
      + (redo ? ` · ${redo} to redo` : '');
    // the row focused, by its place from the bottom: a jump changes every row's `at` (it counts from the step the map
    // is at), not the rows under it, so the focus stays on the step gone to (Enter again does nothing)
    const before = [...list.children], had = before.findIndex((li) => li.contains(document.activeElement));
    const fromBottom = had < 0 ? -1 : before.length - 1 - had;
    list.replaceChildren(...all.map((r) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      b.className = 'hs-step' + (r.redo ? ' hs-redo' : '') + (r.bottom ? ' hs-bottom' : '');
      b.dataset.at = String(r.at);
      b.textContent = r.label;                   // names come from the map's objects: text, never markup
      b.title = r.current ? 'The map is here now' : r.redo ? `Redo up to here (${r.at} ${r.at === 1 ? 'step' : 'steps'})`
        : `Undo back to here (${-r.at} ${r.at === -1 ? 'step' : 'steps'})`;
      if (r.current) b.setAttribute('aria-current', 'step');
      li.appendChild(b);
      return li;
    }));
    const current = list.querySelector('[aria-current]');
    if (fromBottom >= 0) (list.children[list.children.length - 1 - fromBottom]?.firstElementChild || current)?.focus();
    if (current && root.offsetParent) current.scrollIntoView({ block: 'nearest' });
  }
  // after any change of the history: drawn once in the next frame, however many changes came first
  function refresh() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
  }
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.hs-step');
    if (b && !b.hasAttribute('aria-current')) jump(+b.dataset.at);
  });
  // Up / Down (Home / End) move between the steps, Enter or Space goes to one (the button's own click); the 3D view does
  // not get them (its Enter renames the folder selected)
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); return; }
    const all = [...list.querySelectorAll('.hs-step')], at = all.indexOf(document.activeElement);
    const to = { ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: all.length - 1 }[e.key];
    if (to === undefined || at < 0) return;
    e.preventDefault(); e.stopPropagation();
    all[Math.max(0, Math.min(all.length - 1, to))].focus();
  });
  render();
  return { refresh };
}
