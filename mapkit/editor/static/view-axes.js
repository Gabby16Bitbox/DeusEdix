// The 3D view's marks of its own camera. The axis widget in its top right corner, like Unity's scene gizmo: the
// view's X, Y and Z as the camera sees them, red, green and blue as the gizmo's handles (Y is the height, as in
// the Inspector). A click on an end looks from that side toward the middle of the view (Y: down from above);
// Shift+click opens the Top, Front or Side pane instead. Under it, where the camera faces in the game's
// units: its yaw and the letter of the game's compass. And a short note at the bottom of the view (the fly speed,
// changed with the wheel while flying), gone after a moment.
import { VIEW_AXES, axisLayout, heading } from './view-camera.js';

const SIZE = 64, MID = SIZE / 2, REACH = 21;
const COLORS = { X: '#e5534b', Y: '#6cc04a', Z: '#4a8fe7' };
const PANES = { top: 'Top', front: 'Front', side: 'Side' };       // the View menu's names of the orthographic panes
const NOTE_MS = 600;
const CSS = `
#viewaxes { position:fixed; z-index:5; display:flex; flex-direction:column; align-items:center; gap:1px; user-select:none; }
#viewaxes[hidden] { display:none; }
#viewaxes svg { display:block; overflow:visible; }
#viewaxes .va-end { cursor:pointer; }
#viewaxes .va-end circle { fill:var(--axis); stroke:#0008; stroke-width:1; }
#viewaxes .va-end.neg circle { fill:var(--panel); stroke:var(--axis); stroke-width:1.5; }
#viewaxes .va-end:hover circle { stroke:var(--heading); stroke-width:2; }
#viewaxes .va-end text { font:600 9px/1 system-ui, sans-serif; fill:#10131a; text-anchor:middle; dominant-baseline:central; pointer-events:none; }
#viewaxes .va-head { padding:1px 6px; border-radius:var(--radius-control); background:var(--panel); border:1px solid var(--line);
  color:var(--dim); font-size:11px; font-variant-numeric:tabular-nums; white-space:nowrap; }
#viewnote { position:fixed; z-index:5; transform:translateX(-50%); padding:4px 12px; border-radius:var(--radius-control);
  background:var(--panel); border:1px solid var(--accent-border); color:var(--heading); font-size:12px; pointer-events:none;
  box-shadow:0 10px 24px #0008; white-space:nowrap; }
#viewnote[hidden] { display:none; }
`;
let styled = false;
function addStyle() {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}
const svg = (tag, attrs) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// view: the 3D view's canvas. api: look(end, shift) for a click on an end of VIEW_AXES; north() the map's TrueNorth.
// update(yaw, pitch) every frame drawn: the widget changes only when the camera turned.
export function createViewAxes(view, api) {
  addStyle();
  const box = document.createElement('div');
  box.id = 'viewaxes';
  const pic = svg('svg', { width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}`, role: 'group', 'aria-label': 'View axes' });
  const head = document.createElement('div');
  head.className = 'va-head';
  box.append(pic, head);
  document.body.appendChild(box);
  // a line from the middle to each positive end, a dot at every end (the negative ones hollow), each a button
  const lines = {}, ends = {};
  for (const a of VIEW_AXES) {
    const plus = a.id[0] === '+', color = COLORS[a.axis];
    if (plus) lines[a.id] = pic.appendChild(svg('line', { x1: MID, y1: MID, stroke: color, 'stroke-width': 2 }));
    const g = svg('g', { class: 'va-end' + (plus ? '' : ' neg'), role: 'button', tabindex: -1,
      'aria-label': `View from ${a.id}` });
    g.style.setProperty('--axis', color);
    g.appendChild(svg('circle', { r: plus ? 7 : 5 }));
    if (plus) g.appendChild(svg('text', {})).textContent = a.axis;
    const title = g.appendChild(svg('title', {}));
    title.textContent = `${a.id}: look from this side${a.axis === 'Y' ? (plus ? ', down from above' : ', up from below') : ''}. Shift+click: the ${PANES[a.pane]} view`;
    g.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
    g.addEventListener('click', (e) => { e.stopPropagation(); api.look(a, e.shiftKey); });
    ends[a.id] = g;
  }
  // its corner: the view's top right, under the 3D view's toolbar when that reaches it (a narrow view)
  const toolbar = document.getElementById('vptools');
  const place = () => {
    const r = view.getBoundingClientRect(), bar = toolbar?.getBoundingClientRect();
    // held by its right side: the heading under it can be wider than the widget
    const left = r.right - 10 - Math.max(SIZE, box.offsetWidth);
    let top = r.top + 8;
    if (bar && bar.width && bar.right > left - 8 && bar.top < top + SIZE) top = bar.bottom + 6;
    box.hidden = r.width < 240 || top + SIZE + 24 > r.bottom;
    Object.assign(box.style, { right: window.innerWidth - r.right + 10 + 'px', top: top + 'px' });
    shown = null;                                    // drawn again once it shows
  };
  let shown = null;                                  // the camera it was drawn for
  new ResizeObserver(place).observe(view);
  if (toolbar) new ResizeObserver(place).observe(toolbar);
  window.addEventListener('resize', place);
  place();
  function update(yaw, pitch) {
    const north = api.north();
    if (box.hidden || (shown && shown.yaw === yaw && shown.pitch === pitch && shown.north === north)) return;
    shown = { yaw, pitch, north };
    for (const e of axisLayout(yaw, pitch)) {
      const x = MID + e.x * REACH, y = MID + e.y * REACH;
      lines[e.id]?.setAttribute('x2', x);
      lines[e.id]?.setAttribute('y2', y);
      ends[e.id].setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      ends[e.id].style.opacity = e.depth > 0.2 ? 0.55 : 1;       // pointing away: behind the middle
      pic.appendChild(ends[e.id]);                               // the farthest first, the nearest on top
    }
    const h = heading(yaw, north);
    head.textContent = `${h.compass} · yaw ${h.yaw}`;
    head.title = `Where the camera faces: ${h.compass} on the game's compass (the map's North), yaw ${h.yaw} in the game's units (65536 a turn)`;
  }
  return { update, el: box };
}

// a short note at the bottom of the view (the fly speed): shown for NOTE_MS, again from the start at every show
export function createViewNote(view) {
  addStyle();
  const note = document.createElement('div');
  note.id = 'viewnote';
  note.hidden = true;
  document.body.appendChild(note);
  let timer = 0;
  return {
    show(text) {
      const r = view.getBoundingClientRect();
      Object.assign(note.style, { left: r.left + r.width / 2 + 'px', top: r.bottom - 44 + 'px' });
      note.textContent = text;
      note.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => { note.hidden = true; }, NOTE_MS);
    },
  };
}
