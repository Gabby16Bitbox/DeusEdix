// Tools > 2D Shape Editor: UnrealEd's 2D Shape Editor. A profile drawn on a grid (X across, Z up) is extruded (a depth
// along Y) or revolved about the axis at X = 0 (sides, how far round). The profile may be concave (an arch, a
// moulding, a vase): it is cut into convex pieces (ear clipping, then triangles joined while still convex) and each
// piece of each step round is one block with its own corners (block-shapes.js / blocks.py verts_of), a convex brush
// as the game's CSG wants; the blocks go in one nest, placed where the view looks, standing on the floor there.
// Solid adds, Hole cuts (an arched doorway in a wall). Click: a point; drag a point: move it (on the grid);
// double-click on a side: a point in it; right-click on a point: take it away; wheel: zoom; right drag: pan.
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./shape-editor.css', import.meta.url).href;
document.head.appendChild(css);

const $ = (s, root) => root.querySelector(s);
const MAX_BLOCKS = 256;

// ---------------------------------------------------------------- geometry of the profile
const area2 = (P) => P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
const crossAt = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segmentsCross(a, b, c, d) {
  const d1 = crossAt(c, d, a), d2 = crossAt(c, d, b), d3 = crossAt(a, b, c), d4 = crossAt(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
export function simple(P) {
  const n = P.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsCross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return false;
  }
  return new Set(P.map((p) => p.join())).size === n;
}
function inTri(p, a, b, c) {
  return crossAt(a, b, p) >= -1e-9 && crossAt(b, c, p) >= -1e-9 && crossAt(c, a, p) >= -1e-9;
}
// triangles of a simple polygon given counter-clockwise (indices)
function earClip(P) {
  const idx = P.map((_, i) => i), out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = P[i0], b = P[i1], c = P[i2];
      if (crossAt(a, b, c) <= 1e-9) continue;                     // reflex or flat: no ear
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inTri(P[j], a, b, c))) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) {                  // points in a straight line left: a fan over them
      for (let k = 1; k + 1 < idx.length; k++) out.push([idx[0], idx[k], idx[k + 1]]);
      return out;
    }
  }
  if (idx.length === 3) out.push(idx.slice());
  return out;
}
const convex = (P, poly) => poly.every((_, k) => crossAt(P[poly[k]], P[poly[(k + 1) % poly.length]], P[poly[(k + 2) % poly.length]]) >= -1e-9);
// the convex pieces (Hertel-Mehlhorn: triangles joined along their shared sides while the result stays convex)
export function convexPieces(points) {
  let P = points.map((p) => [p[0], p[1]]);
  if (area2(P) < 0) P = P.reverse();
  let pieces = earClip(P);
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) {
      const A = pieces[a], B = pieces[b];
      for (let i = 0; i < A.length; i++) {
        const u = A[i], v = A[(i + 1) % A.length], j = B.findIndex((x, k) => x === v && B[(k + 1) % B.length] === u);
        if (j < 0) continue;
        // A ... u v ..., B ... v u ...: A with B's points between u and v put in
        const rest = [];
        for (let k = 2; k < B.length; k++) rest.push(B[(j + k) % B.length]);
        const joined = [...A.slice(0, i + 1), ...rest, ...A.slice(i + 1)];
        if (!convex(P, joined)) continue;
        pieces[a] = joined;
        pieces.splice(b, 1);
        merged = true;
        break outer;
      }
    }
  }
  return pieces.map((poly) => poly.map((i) => P[i]));
}

// the pieces in the game's axes, round the profile's own origin (the block's floor point is added later)
function solids(points, opts) {
  const pieces = convexPieces(points);
  if (opts.mode === 'revolve') {
    const n = Math.max(3, Math.min(64, Math.round(opts.sides))), turn = Math.max(1, Math.min(360, opts.angle)) * Math.PI / 180;
    const steps = Math.max(1, Math.round(n * turn / (2 * Math.PI))), out = [];
    for (const piece of pieces) for (let s = 0; s < steps; s++) {
      const a0 = turn * s / steps, a1 = turn * (s + 1) / steps;
      const pts = [];
      for (const a of [a0, a1]) for (const [x, z] of piece) pts.push([x * Math.cos(a), x * Math.sin(a), z]);
      out.push(pts);
    }
    return out;
  }
  const d = Math.max(1, opts.depth);
  return pieces.map((piece) => piece.flatMap(([x, z]) => [[x, -d / 2, z], [x, d / 2, z]]));
}

// ---------------------------------------------------------------- presets (UnrealEd's shapes)
function preset(kind, g) {
  if (kind === 'rect') return [[-128, 0], [128, 0], [128, 128], [-128, 128]];
  if (kind === 'tri') return [[-128, 0], [128, 0], [0, 192]];
  if (kind === 'circle') return Array.from({ length: 16 }, (_, i) => { const a = 2 * Math.PI * i / 16; return [Math.round(96 * Math.cos(a) / g) * g || 0, Math.round(96 + 96 * Math.sin(a))]; });
  if (kind === 'arch') {         // a doorway: straight sides, a round top (a hole in a wall, usually)
    const pts = [[-64, 0], [64, 0], [64, 128]];
    for (let i = 1; i < 8; i++) { const a = Math.PI * i / 8; pts.push([Math.round(64 * Math.cos(a)), Math.round(128 + 64 * Math.sin(a))]); }
    pts.push([-64, 128]);
    return pts;
  }
  return [];
}

export function createShapeEditor(api) {
  let el = null, cv = null, ctx = null;
  const S = { pts: preset('rect', 16), grid: 16, scale: 1, center: [0, 96], hover: -1, drag: null, sel: -1 };

  function ensure() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'shapeed';
    el.innerHTML = `
      <div class="se-top"><b>2D Shape Editor</b><span class="se-sp"></span><button type="button" class="se-close">Close</button></div>
      <canvas class="se-grid" tabindex="0"></canvas>
      <div class="se-side">
        <div class="se-h">Shape</div>
        <div class="se-row se-presets"><button type="button" data-p="rect">Rectangle</button><button type="button" data-p="arch">Arch</button>
          <button type="button" data-p="circle">Circle</button><button type="button" data-p="tri">Triangle</button><button type="button" data-p="clear">Clear</button></div>
        <label class="se-row">Grid <select class="se-gridsel">${[4, 8, 16, 32, 64].map((g) => `<option ${g === 16 ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <div class="se-h">Make</div>
        <label class="se-row">As <select class="se-mode"><option value="extrude">Extruded</option><option value="revolve">Revolved round X = 0</option></select></label>
        <label class="se-row se-ex">Depth <input type="number" class="se-depth" value="128" min="1" step="16"></label>
        <label class="se-row se-rev">Sides <input type="number" class="se-sides" value="16" min="3" max="64" step="1"></label>
        <label class="se-row se-rev">Angle ° <input type="number" class="se-angle" value="360" min="1" max="360" step="15"></label>
        <label class="se-row">Kind <select class="se-kind"><option value="solid">Solid (adds)</option><option value="hole">Hole (cuts)</option></select></label>
        <label class="se-row">Texture <input class="se-tex" list="texlist" spellcheck="false"></label>
        <div class="se-info"></div>
        <button type="button" class="se-add primary">Add to map</button>
      </div>`;
    document.body.appendChild(el);
    cv = $('.se-grid', el);
    ctx = cv.getContext('2d');
    $('.se-close', el).onclick = close;
    for (const b of el.querySelectorAll('[data-p]')) b.onclick = () => { S.pts = b.dataset.p === 'clear' ? [] : preset(b.dataset.p, S.grid); S.sel = -1; draw(); };
    $('.se-gridsel', el).onchange = () => { S.grid = +$('.se-gridsel', el).value; draw(); };
    $('.se-mode', el).onchange = () => { el.classList.toggle('revolve', $('.se-mode', el).value === 'revolve'); draw(); };
    for (const s of ['.se-depth', '.se-sides', '.se-angle']) $(s, el).oninput = draw;
    $('.se-add', el).onclick = add;
    wire();
    new ResizeObserver(draw).observe(cv);
  }
  const opts = () => ({ mode: $('.se-mode', el).value, depth: +$('.se-depth', el).value || 128, sides: +$('.se-sides', el).value || 16,
    angle: +$('.se-angle', el).value || 360 });

  // grid <-> canvas: X right, Z up
  const toScreen = ([x, z]) => [cv.clientWidth / 2 + (x - S.center[0]) / S.scale, cv.clientHeight / 2 - (z - S.center[1]) / S.scale];
  const toWorld = (sx, sy) => [S.center[0] + (sx - cv.clientWidth / 2) * S.scale, S.center[1] - (sy - cv.clientHeight / 2) * S.scale];
  const snap = (p) => p.map((v) => Math.round(v / S.grid) * S.grid);
  function near(sx, sy) {
    let best = -1, bd = 8;
    S.pts.forEach((p, i) => { const [x, y] = toScreen(p); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function nearSide(sx, sy) {
    let best = -1, bd = 7;
    S.pts.forEach((p, i) => {
      const [ax, ay] = toScreen(p), [bx, by] = toScreen(S.pts[(i + 1) % S.pts.length]);
      const L = Math.hypot(bx - ax, by - ay) || 1, t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / (L * L)));
      const d = Math.hypot(ax + t * (bx - ax) - sx, ay + t * (by - ay) - sy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function check() {
    const o = opts(), P = S.pts;
    if (P.length < 3) return { ok: false, text: 'Click on the grid to put the shape\'s points (3 at least).' };
    if (!simple(P)) return { ok: false, text: 'The sides cross each other: move a point so the outline does not cross itself.' };
    if (Math.abs(area2(P)) < 1) return { ok: false, text: 'The shape is flat.' };
    if (o.mode === 'revolve' && P.some((p) => p[0] < 0)) return { ok: false, text: 'Revolved: keep the shape on the right of the axis (X = 0).' };
    const pieces = convexPieces(P), steps = o.mode === 'revolve' ? Math.max(1, Math.round(Math.max(3, Math.min(64, o.sides)) * Math.min(360, o.angle) / 360)) : 1;
    const blocks = pieces.length * steps;
    if (blocks > MAX_BLOCKS) return { ok: false, text: `${blocks} blocks: too many (${MAX_BLOCKS} at most); fewer sides or a simpler shape.`, pieces };
    return { ok: true, text: `${P.length} points · ${pieces.length} convex piece${pieces.length === 1 ? '' : 's'} · ${blocks} block${blocks === 1 ? '' : 's'}`, pieces };
  }

  function draw() {
    if (!el || el.style.display === 'none') return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(el).getPropertyValue('--viewport') || '#070e18';
    ctx.fillRect(0, 0, w, h);
    // the grid, the axes
    let step = S.grid;
    while (step / S.scale < 6) step *= 2;
    const [x0, z1] = toWorld(0, 0), [x1, z0] = toWorld(w, h);
    ctx.lineWidth = 1;
    const lines = (alpha, every) => {
      ctx.strokeStyle = `rgba(160,190,230,${alpha})`;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / every) * every; x <= x1; x += every) { const s = Math.round(toScreen([x, 0])[0]) + 0.5; ctx.moveTo(s, 0); ctx.lineTo(s, h); }
      for (let z = Math.ceil(z0 / every) * every; z <= z1; z += every) { const s = Math.round(toScreen([0, z])[1]) + 0.5; ctx.moveTo(0, s); ctx.lineTo(w, s); }
      ctx.stroke();
    };
    lines(0.07, step);
    if (128 / S.scale >= 16) lines(0.16, 128);
    const [ox, oy] = toScreen([0, 0]);
    ctx.strokeStyle = 'rgba(160,190,230,0.45)';
    ctx.beginPath(); ctx.moveTo(0, Math.round(oy) + 0.5); ctx.lineTo(w, Math.round(oy) + 0.5); ctx.stroke();
    ctx.strokeStyle = opts().mode === 'revolve' ? '#4c9eff' : 'rgba(160,190,230,0.45)';
    ctx.beginPath(); ctx.moveTo(Math.round(ox) + 0.5, 0); ctx.lineTo(Math.round(ox) + 0.5, h); ctx.stroke();
    const c = check();
    // the convex pieces, faintly; the outline; the points
    if (c.pieces) for (const piece of c.pieces) {
      ctx.beginPath();
      piece.forEach((p, i) => { const [x, y] = toScreen(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.fillStyle = 'rgba(137,185,232,0.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(137,185,232,0.25)';
      ctx.stroke();
    }
    if (S.pts.length) {
      ctx.beginPath();
      S.pts.forEach((p, i) => { const [x, y] = toScreen(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      if (S.pts.length > 2) ctx.closePath();
      ctx.strokeStyle = c.ok ? '#89b9e8' : '#f28780';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    S.pts.forEach((p, i) => {
      const [x, y] = toScreen(p);
      ctx.fillStyle = i === S.sel ? '#ffa040' : i === S.hover ? '#ffffff' : '#dce6f1';
      ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
    });
    const info = $('.se-info', el);
    info.textContent = c.text;
    info.className = 'se-info' + (c.ok ? '' : ' bad');
    $('.se-add', el).disabled = !c.ok;
  }

  function wire() {
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.focus();
      cv.setPointerCapture(e.pointerId);
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, i = near(sx, sy);
      if (e.button === 2 && i >= 0) { S.pts.splice(i, 1); S.sel = -1; draw(); return; }
      if (e.button !== 0) { S.drag = { pan: true, x: e.clientX, y: e.clientY, c: S.center.slice() }; return; }
      if (i >= 0) { S.sel = i; S.drag = { point: i }; draw(); return; }
      S.pts.push(snap(toWorld(sx, sy)));                  // a new point, the last one
      S.sel = S.pts.length - 1;
      S.drag = { point: S.sel };
      draw();
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (S.drag?.pan) { S.center = [S.drag.c[0] - (e.clientX - S.drag.x) * S.scale, S.drag.c[1] + (e.clientY - S.drag.y) * S.scale]; draw(); return; }
      if (S.drag) { S.pts[S.drag.point] = snap(toWorld(sx, sy)); draw(); return; }
      const h = near(sx, sy);
      if (h !== S.hover) { S.hover = h; draw(); }
    });
    const up = () => { S.drag = null; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', (e) => {             // a point in the side clicked
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, s = nearSide(sx, sy);
      if (s < 0 || near(sx, sy) >= 0) return;
      // the click itself put a point at the end: it goes there instead
      if (S.pts.length && S.sel === S.pts.length - 1) S.pts.pop();
      S.pts.splice(s + 1, 0, snap(toWorld(sx, sy)));
      S.sel = s + 1;
      draw();
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, at = toWorld(sx, sy);
      S.scale = Math.max(0.05, Math.min(20, S.scale * Math.pow(1.0015, e.deltaY)));
      const now = toWorld(sx, sy);
      S.center = [S.center[0] + at[0] - now[0], S.center[1] + at[1] - now[1]];
      draw();
    }, { passive: false });
    cv.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel >= 0) { S.pts.splice(S.sel, 1); S.sel = -1; draw(); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Escape') { close(); e.stopPropagation(); }
    });
  }

  function add() {
    const c = check();
    if (!c.ok) return;
    const o = opts(), pieces = solids(S.pts, o);
    // standing on the floor where the view looks, the profile's middle there
    const all = pieces.flat(), lo = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]))), hi = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k])));
    const at = api.floorAhead(Math.max(hi[0] - lo[0], hi[1] - lo[1]));
    const shift = [at[0] - (lo[0] + hi[0]) / 2, at[1] - (lo[1] + hi[1]) / 2, at[2] - lo[2]];
    const placed = pieces.map((piece) => piece.map((p) => p.map((v, k) => Math.round((v + shift[k]) * 100) / 100)));
    const tex = $('.se-tex', el).value.trim();
    api.addShapeBlocks(placed, { hole: $('.se-kind', el).value === 'hole', tex, label: o.mode === 'revolve' ? 'Revolved shape' : 'Extruded shape' });
    close();
  }

  function open() {
    ensure();
    el.style.display = 'grid';
    if (!$('.se-tex', el).value) $('.se-tex', el).value = api.lastTexture() || '';
    requestAnimationFrame(() => { draw(); cv.focus(); });
  }
  function close() { if (el) el.style.display = 'none'; }
  return { open, close, get state() { return S; }, check, convexPieces };
}
