// The AI paths as thin lines (Gabby, 5 Nov 2026: "stile unreal ed sottili con delle frecce", colours by the kind
// of character). The strips as wide as each link's room (drawn until then) filled the floor of a big map;
// UnrealEd draws a reach spec as a thin line. Here each link is a thin line a little above the floor, following its
// shape (steps, ramps), and says three things at a glance:
//   its colour: who can walk it (ai-paths.js linkWho): green where every character of this map fits, another colour
//     only where someone cannot (the biggest kind that still passes), red where nobody does;
//   its stroke: how (walk: solid, through a door: solid with a gate mark, jump or drop: dashed, swim or fly: dotted,
//     lift or teleporter: dashed with a cross);
//   an arrow: one way only (a line with no arrow is walked both ways, so most of the map has none).
// With a character selected, the links too narrow for it are faint: where that one can go stands out; with a path
// point selected, all but its own links.
// One draw per colour and stroke (LineSegments2), whatever the size of the map.
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { pathStrips, loosePoints, linkWho, fitsLink, PATH_KINDS } from './ai-paths.js';

const STROKES = {                                  // dash and gap in units; 0: solid
  walk: [0, 0], door: [0, 0], jump: [14, 10], water: [3, 7], special: [16, 8],
};
const FAINT = '#6b7280';
const LIFT = 3, STEP = 16, ARROW = 10, WIDTH = 1.5;
const materials = new Set();

// the line of a link: from A to B (three coordinates on the floor), short of both ends by `inset`, its points every
// STEP units taking the floor's height there (field), straight where there is no floor (a jump)
function floorLine(A, B, field, inset) {
  const d = B.clone().sub(A), flat = Math.max(Math.hypot(d.x, d.z), 1);
  const t0 = Math.min(0.4, inset / flat), t1 = 1 - t0;
  const n = Math.max(1, Math.ceil(flat * (t1 - t0) / STEP)), pts = [];
  for (let i = 0; i <= n; i++) {
    const P = A.clone().lerp(B, t0 + (t1 - t0) * i / n);
    if (field && i > 0 && i < n) { const y = field.height(P.x, P.z, P.y + 28, P.y - 48); if (y !== null) P.y = y; }
    P.y += LIFT;
    pts.push(P);
  }
  return pts;
}
// the point at t of a polyline (0..1 of its length) and its direction there
function along(pts, t) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const want = lens[lens.length - 1] * t;
  let i = 1;
  while (i < pts.length - 1 && lens[i] < want) i++;
  const k = (want - lens[i - 1]) / Math.max(lens[i] - lens[i - 1], 1e-6);
  return { at: pts[i - 1].clone().lerp(pts[i], Math.min(1, Math.max(0, k))), dir: pts[i].clone().sub(pts[i - 1]).normalize() };
}

// AI paths of pathData as thin lines. floorAt(threeVector): the floor under a point; field: floorField() or null;
// characters: [{radius, height}] of the map (who must get through); focus: the selected character ({radius, height,
// label}) or path point ({node, label}), or null
export function buildPathLines(THREE, pathData, T, floorAt, field, { characters = [], focus = null } = {}) {
  materials.clear();                               // one network at a time: app.js disposes the last one first
  const grp = new THREE.Group();
  grp.name = 'ai-path-lines';
  const pts = (pathData && pathData.points) || {};
  const floor = new Map();
  const at = (n) => { if (!floor.has(n)) floor.set(n, floorAt(T(pts[n].slice(1)))); return floor.get(n); };
  const batches = new Map();                       // colour|stroke|faint -> segment positions
  const push = (key, a, b) => { if (!batches.has(key)) batches.set(key, []); batches.get(key).push(a.x, a.y, a.z, b.x, b.y, b.z); };
  const used = { who: new Map(), kinds: new Set(), oneWay: 0, tooNarrow: 0 };
  for (const s of pathStrips(pathData)) {
    const who = linkWho(s, characters);
    const faint = !!focus && (focus.node ? s.a !== focus.node && s.b !== focus.node : !fitsLink(focus, s));
    const color = faint ? FAINT : who.color;
    if (faint) used.tooNarrow++;
    else used.who.set(who.key, who);
    used.kinds.add(s.kind);
    const line = floorLine(at(s.a), at(s.b), field, 10);
    const key = `${color}|${s.kind}|${faint ? 1 : 0}`;
    for (let i = 1; i < line.length; i++) push(key, line[i - 1], line[i]);
    const solid = `${color}|walk|${faint ? 1 : 0}`;
    const mark = (t, draw) => { const { at: p, dir } = along(line, t); const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize(); draw(p, dir, side); };
    if (s.kind === 'door') mark(0.5, (p, dir, side) => push(solid, p.clone().addScaledVector(side, 9), p.clone().addScaledVector(side, -9)));
    if (s.kind === 'special') mark(0.5, (p, dir, side) => {
      const u = side.clone().add(dir).multiplyScalar(6), v = side.clone().sub(dir).multiplyScalar(6);
      push(solid, p.clone().add(u), p.clone().sub(u)); push(solid, p.clone().add(v), p.clone().sub(v));
    });
    if (!s.two) {                                  // one way: chevrons pointing the way (two on a long link)
      used.oneWay++;
      const len = line[0].distanceTo(line[line.length - 1]);
      for (const t of len > 160 ? [0.45, 0.8] : [0.6]) mark(t, (p, dir, side) => {
        const back = p.clone().addScaledVector(dir, -ARROW);
        push(solid, p, back.clone().addScaledVector(side, ARROW * 0.6));
        push(solid, p, back.clone().addScaledVector(side, -ARROW * 0.6));
      });
    }
  }
  for (const [key, flat] of batches) {
    const [color, kind, faint] = key.split('|');
    const [dash, gap] = STROKES[kind] || [0, 0];
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(flat);
    const material = new LineMaterial({ color, linewidth: faint === '1' ? 1 : WIDTH, transparent: true, depthWrite: false,
      opacity: faint === '1' ? 0.35 : 0.9, dashed: dash > 0, dashSize: dash || 1, gapSize: gap || 1 });
    materials.add(material);
    const lines = new LineSegments2(geometry, material);
    if (dash > 0) lines.computeLineDistances();
    lines.renderOrder = faint === '1' ? 4 : 5;
    grp.add(lines);
  }
  // the points: a small dot each, a red ring round those with no link
  const dot = new THREE.CircleGeometry(3.5, 12).rotateX(-Math.PI / 2);
  const ring = new THREE.RingGeometry(11, 15, 24).rotateX(-Math.PI / 2);
  const dotMat = new THREE.MeshBasicMaterial({ color: '#cfd6df', transparent: true, opacity: 0.8, depthWrite: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: PATH_KINDS.problem.color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const loose = new Set(loosePoints(pathData));
  for (const n of Object.keys(pts)) {
    const m = new THREE.Mesh(loose.has(n) ? ring : dot, loose.has(n) ? ringMat : dotMat);
    m.position.copy(at(n)); m.position.y += LIFT;
    m.renderOrder = 6;
    grp.add(m);
  }
  grp.userData.used = used;
  return grp;
}

// each frame: the lines keep their width in pixels (the view's size)
export function stepPathLines(canvas) {
  for (const m of materials) m.resolution.set(canvas.clientWidth || 1, canvas.clientHeight || 1);
}
// what the colours and strokes mean, for the status line
export function pathLinesLegend(used, focus) {
  if (!used) return '';
  const parts = [...used.who.values()].map((w) => `${colorName(w.color)}: ${w.label}`);
  const strokes = [['door', 'a door (a mark across)'], ['jump', 'jump or drop (dashed)'], ['water', 'swim or fly (dotted)'],
    ['special', 'lift or teleporter (a cross)']].filter(([k]) => used.kinds.has(k)).map(([, t]) => t);
  return (parts.length ? ' Colours: who can walk it, ' + parts.join('; ') + '.' : '')
    + (strokes.length ? ' Lines: ' + strokes.join(', ') + '.' : '')
    + (used.oneWay ? ' An arrow: one way only (no arrow: both ways).' : '')
    + (focus && used.tooNarrow ? (focus.node ? ` Grey: the links of other points.` : ` Grey: too narrow for ${focus.label} (${used.tooNarrow}).`) : '');
}
function colorName(c) {
  return { '#5fd38a': 'green', '#89b9e8': 'blue', '#7fd6c8': 'teal', '#e3b96b': 'amber', '#ff9a3c': 'orange', '#f28780': 'red' }[c] || c;
}
