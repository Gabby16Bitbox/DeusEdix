// Floating tutorial chrome only: this module never changes a lesson or map data.
const MARGIN = 8;
const GAP = 12;

export function clampTutorialPosition(position, size, viewport, margin = MARGIN) {
  const top = Math.max(0, Number.isFinite(viewport.topInset) ? viewport.topInset : 0) + margin;
  return {
    left: Math.max(margin, Math.min(Math.max(margin, viewport.width - size.width - margin), position.left)),
    top: Math.max(top, Math.min(Math.max(top, viewport.height - size.height - margin), position.top)),
  };
}

function rectangles(rects, viewport) {
  return rects.flatMap(r => {
    const left = Math.max(0, r.left), top = Math.max(0, r.top);
    const right = Math.min(viewport.width, r.right), bottom = Math.min(viewport.height, r.bottom);
    return [left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top
      ? [{ left: left - GAP, top: top - GAP, right: right + GAP, bottom: bottom + GAP }] : [];
  });
}

function overlapScore(position, size, rects) {
  return rects.reduce((score, r) => {
    const area = Math.max(0, Math.min(position.left + size.width, r.right) - Math.max(position.left, r.left))
      * Math.max(0, Math.min(position.top + size.height, r.bottom) - Math.max(position.top, r.top));
    // Covering a small button matters as much as covering an entire world cue.
    return score + area / Math.max(1, Math.min(size.width * size.height, (r.right - r.left) * (r.bottom - r.top)));
  }, 0);
}

export function chooseTutorialPosition(position, size, viewport, avoidRects = []) {
  const current = clampTutorialPosition(position, size, viewport);
  const rects = rectangles(avoidRects, viewport);
  const initial = overlapScore(current, size, rects);
  if (!initial) return current;
  const xs = [current.left, MARGIN, viewport.width - size.width - MARGIN];
  const ys = [current.top, (viewport.topInset || 0) + MARGIN, viewport.height - size.height - MARGIN];
  for (const r of rects) {
    xs.push(r.left - size.width, r.right);
    ys.push(r.top - size.height, r.bottom);
  }
  let best = current, score = initial, distance = 0;
  for (const left of new Set(xs)) for (const top of new Set(ys)) {
    const candidate = clampTutorialPosition({ left, top }, size, viewport);
    const nextScore = overlapScore(candidate, size, rects);
    const nextDistance = (candidate.left - current.left) ** 2 + (candidate.top - current.top) ** 2;
    if (nextScore < score - 0.0001 || (Math.abs(nextScore - score) < 0.0001 && nextDistance < distance)) {
      best = candidate; score = nextScore; distance = nextDistance;
    }
  }
  // Do not shuffle between equally obstructed positions when the screen is full.
  return initial - score > 0.01 ? best : current;
}

const CSS = `
body #tut.tut-floating { right:auto; bottom:auto; width:380px; max-width:calc(100vw - 16px);
  max-height:calc(100vh - var(--tutorial-viewport-top, 0px) - 16px); overflow:hidden; flex-direction:column; }
body #tut.open.tut-floating { display:flex; }
body #tut.tut-floating .tut-head { position:sticky; top:0; z-index:1; cursor:grab; touch-action:none; user-select:none; }
body #tut.tut-floating.tut-dragging .tut-head { cursor:grabbing; }
body #tut.tut-floating .tut-head:focus-visible { outline:2px solid var(--acc); outline-offset:-3px; }
body #tut.tut-floating .tut-who { flex:1; min-width:0; }
body #tut.tut-floating .tut-who b { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
body #tut.tut-floating .tut-actions > button { flex:0 0 24px; align-self:flex-start; width:24px; min-width:24px; height:24px; min-height:24px; padding:0; margin-left:0; cursor:pointer; touch-action:manipulation; }
body #tut.tut-floating .tut-head > .tut-mute { display:inline-flex; align-items:center; justify-content:center; padding:0; line-height:1; }
body #tut.tut-floating .tut-panel-toggle { display:inline-flex; align-items:center; justify-content:center; }
body #tut.tut-floating .tut-panel-toggle svg { width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:1.5; }
body #tut.tut-minimized { width:260px; }
body #tut.tut-minimized > :not(.tut-head) { display:none; }
body #tut.tut-minimized .tut-head { grid-template-columns:28px minmax(0,1fr) auto; gap:6px; padding:6px; border-bottom:0; }
body #tut.tut-minimized .tut-actions { grid-column:auto; }
body #tut.tut-minimized .tut-face { width:28px; height:28px; }
body #tut.tut-minimized .tut-who span { display:none; }
@media (max-height:320px) {
  body #tut.open.tut-floating { overflow-y:auto; }
  body #tut.tut-floating .tut-body { flex:none; overflow:visible; }
}
`;

export function createTutorialPanel(box) {
  const doc = box.ownerDocument, win = doc.defaultView;
  if (!doc.getElementById('tutorial-panel-style')) {
    const style = doc.createElement('style');
    style.id = 'tutorial-panel-style'; style.textContent = CSS; doc.head.appendChild(style);
  }
  let position = null, minimized = false, drag = null, graceUntil = 0, lastAvoidKey = '';
  const original = { left: box.style.left, top: box.style.top, right: box.style.right };
  const originalInset = box.style.getPropertyValue('--tutorial-viewport-top');
  const now = () => win.performance.now();
  const viewport = () => {
    const bar = doc.getElementById('menubar') || doc.getElementById('top');
    const topInset = bar?.getClientRects().length ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
    return { width: doc.documentElement.clientWidth || win.innerWidth, height: doc.documentElement.clientHeight || win.innerHeight, topInset };
  };
  const open = () => box.classList.contains('open') && box.getClientRects().length > 0;
  const size = () => { const r = box.getBoundingClientRect(); return { width: r.width, height: r.height }; };
  function place(next) {
    position = next;
    if (box.style.left !== `${next.left}px`) box.style.left = `${next.left}px`;
    if (box.style.top !== `${next.top}px`) box.style.top = `${next.top}px`;
  }
  function refresh() {
    const head = box.querySelector('.tut-head');
    if (head) {
      head.tabIndex = 0;
      head.setAttribute('role', 'group');
      head.setAttribute('aria-label', 'Tutorial panel. Drag to move, or use arrow keys. Shift moves farther.');
      head.title = 'Drag to move · Arrow keys when focused · Shift for larger steps';
      let button = head.querySelector('[data-tutorial-minimize]');
      if (!button) {
        button = doc.createElement('button');
        button.type = 'button'; button.className = 'tut-panel-toggle'; button.dataset.tutorialMinimize = '';
        const actions = head.querySelector('.tut-actions') || head;
        actions.insertBefore(button, actions.querySelector('.tut-x'));
      }
      button.title = minimized ? 'Restore tutorial' : 'Minimize tutorial';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-expanded', String(!minimized));
      const glyph = minimized ? '<rect x="2.5" y="2.5" width="9" height="9"/><path d="M3 5h8"/>' : '<path d="M3 10h8"/>';
      const icon = `<svg viewBox="0 0 14 14" aria-hidden="true">${glyph}</svg>`;
      if (button.innerHTML !== icon) button.innerHTML = icon;
    }
    box.classList.toggle('tut-minimized', minimized);
    if (!open()) return;
    const r = box.getBoundingClientRect();
    position ||= { left: r.left, top: r.top };
    box.classList.add('tut-floating');
    const view = viewport(), inset = `${view.topInset}px`;
    if (box.style.getPropertyValue('--tutorial-viewport-top') !== inset) box.style.setProperty('--tutorial-viewport-top', inset);
    place(clampTutorialPosition(position, size(), view));
    lastAvoidKey = '';
  }
  function avoid(rects = []) {
    if (!open() || drag || now() < graceUntil) return;
    const dimensions = size(), view = viewport();
    const key = JSON.stringify([dimensions, view, minimized, rects.map(r => [r.left, r.top, r.right, r.bottom].map(Math.round))]);
    if (key === lastAvoidKey) return;
    lastAvoidKey = key;
    const next = chooseTutorialPosition(position || box.getBoundingClientRect(), dimensions, view, rects);
    if (!position || next.left !== position.left || next.top !== position.top) place(next);
  }
  function toggle(e) {
    if (!e.target.closest('[data-tutorial-minimize]')) return;
    e.preventDefault(); e.stopPropagation();
    minimized = !minimized; refresh();
  }
  function begin(e) {
    const head = e.target.closest('.tut-head');
    if (!head || e.button !== 0 || e.target.closest('button, a, input, select, textarea, [contenteditable=true]')) return;
    e.preventDefault(); e.stopPropagation();
    head.focus({ preventScroll: true });
    const r = box.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    box.classList.add('tut-dragging'); box.setPointerCapture(e.pointerId);
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault(); e.stopPropagation();
    place(clampTutorialPosition({ left: drag.left + e.clientX - drag.x, top: drag.top + e.clientY - drag.y }, size(), viewport()));
  }
  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const id = drag.id; drag = null;
    box.classList.remove('tut-dragging');
    if (box.hasPointerCapture(id)) box.releasePointerCapture(id);
    graceUntil = now() + 800; lastAvoidKey = '';
  }
  function keys(e) {
    if (!e.target.matches('.tut-head') || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const amount = e.shiftKey ? 40 : 10, r = position || box.getBoundingClientRect();
    place(clampTutorialPosition({ left: r.left + (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0),
      top: r.top + (e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0) }, size(), viewport()));
    graceUntil = now() + 800; lastAvoidKey = '';
  }
  box.addEventListener('click', toggle);
  box.addEventListener('pointerdown', begin);
  box.addEventListener('pointermove', move);
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('lostpointercapture', end);
  box.addEventListener('keydown', keys);
  win.addEventListener('resize', refresh);
  const observer = win.ResizeObserver ? new win.ResizeObserver(refresh) : null;
  observer?.observe(box);
  return { avoid, refresh, destroy() {
    observer?.disconnect(); win.removeEventListener('resize', refresh);
    box.removeEventListener('click', toggle); box.removeEventListener('pointerdown', begin);
    box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', end);
    box.removeEventListener('pointercancel', end); box.removeEventListener('lostpointercapture', end); box.removeEventListener('keydown', keys);
    box.classList.remove('tut-floating', 'tut-minimized', 'tut-dragging');
    Object.assign(box.style, original);
    if (originalInset) box.style.setProperty('--tutorial-viewport-top', originalInset);
    else box.style.removeProperty('--tutorial-viewport-top');
  } };
}
