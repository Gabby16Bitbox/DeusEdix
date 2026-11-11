// The Surface panel's Auto U Pan and Auto V Pan (static/surface-ui.js): shown greyed out in part B of batch 6, Look
// flags like the others since 1 Nov 2026 (Gabby switched them on): ticked when every selected face pans that way, mixed
// when some do, and a click queues PF_AutoUPan (0x200) or PF_AutoVPan (0x400) as one undo step. The queue's check
// (texture-slip.js) takes their bits, as surfaces.py and the host's surface edit do.
import test, { THREE } from './three.mjs';
import assert from 'node:assert/strict';
import { createSurfaceTools } from '../editor/static/surface-ui.js';
import { queueProblem } from '../editor/static/texture-slip.js';
import { PF_AUTOUPAN, PF_AUTOVPAN } from '../editor/static/light-effects.js';

// three faces, a triangle each (0: Auto U Pan, 1: both, 2: neither); the Surface panel drawn into #details
function setup() {
  const pos = [];
  for (let id = 0; id < 3; id++) pos.push(id * 100, 0, 0, id * 100 + 64, 0, 0, id * 100, 0, 64);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.userData = { world: true, faces: [0, 1, 2] };
  new THREE.Scene().add(mesh);
  const faces = [PF_AUTOUPAN, PF_AUTOUPAN | PF_AUTOVPAN, 0].map((flags, i) => ({ brush: 'Brush' + i, poly: 0, tex: 'Pkg.Water', flags, structure: '' }));
  // the panel's own lookup in it of the Look boxes (data-sf-flag): a checkbox each, the last ones found kept in `boxes`
  const boxes = [];
  const details = { innerHTML: '', querySelectorAll: (sel) => {
    if (sel !== '[data-sf-flag]') return [];
    boxes.length = 0;
    for (const m of details.innerHTML.matchAll(/data-sf-flag="(\d+)"([^>]*)>/g)) {
      boxes.push({ dataset: { sfFlag: m[1], ...(/data-mixed/.test(m[2]) ? { mixed: '1' } : {}) }, checked: /checked/.test(m[2]) });
    }
    return boxes;
  } }, byId = new Map(), edits = {}, steps = [];
  globalThis.document = { querySelector: (sel) => (sel === '#details' ? details : { scrollTop: 0 }),
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, { id, value: '', hidden: false }); return byId.get(id); } };
  const tools = createSurfaceTools({ THREE, getEdits: () => edits, pushUndo: (label) => steps.push(label), setDirty() {}, deselect() {},
    status() {}, log() {}, escapeHtml: (s) => String(s), textures: () => [], canShowPanel: () => true });
  tools.load(faces, [mesh]);
  const pick = (ids) => ids.forEach((id, k) => tools.pick({ object: mesh, faceIndex: id }, k > 0));
  const box = (label) => new RegExp(`<input type="checkbox" ([^>]*)> ${label}</label>`).exec(details.innerHTML)?.[1];
  const flag = (bit) => boxes.find((c) => +c.dataset.sfFlag === bit);
  return { pick, box, flag, edits, steps, details, boxes };
}

test('Auto U Pan and Auto V Pan show what the selected faces do, ticked, mixed or not, and a click sets or clears them', () => {
  const s = setup();
  s.pick([0]);
  assert.match(s.box('Auto U Pan'), /^data-sf-flag="512" checked/);
  assert.doesNotMatch(s.box('Auto V Pan'), /checked|data-mixed/);
  s.pick([0, 1]);
  assert.match(s.box('Auto U Pan'), /^data-sf-flag="512" checked/);
  assert.match(s.box('Auto V Pan'), /^data-sf-flag="1024"\s+data-mixed="1"/);
  assert.deepEqual(s.boxes.filter((c) => c.indeterminate).map((c) => +c.dataset.sfFlag), [1024]);   // drawn mixed, not unticked
  assert.match(s.details.innerHTML, /title="Moves the texture along U\. Set the zone's Inspector > Texture panning > U speed[^"]*\. View > Effects shows it after Rebuild\."/);
  assert.doesNotMatch(s.details.innerHTML, /disabled|data-sf-shown|cannot set/);        // no greyed box left
  assert.match(s.box('Unlit'), /^data-sf-flag="4194304"/);                             // the others as they were
  // the mixed V box ticked gives both faces Auto V Pan, the U box unticked takes it off both: a row and an undo step
  // each, the panel drawn again with them
  const v = s.flag(1024);
  v.checked = true; v.onchange();
  const u = s.flag(512);
  u.checked = false; u.onchange();
  const both = [{ brush: 'Brush0', poly: 0 }, { brush: 'Brush1', poly: 0 }];
  assert.deepEqual(s.edits.surfaces, [{ op: 'flags', args: [1024, 0], targets: both }, { op: 'flags', args: [0, 512], targets: both }]);
  assert.deepEqual(s.steps, ['Face flags', 'Face flags']);
  assert.match(s.box('Auto V Pan'), /^data-sf-flag="1024" checked/);
  assert.doesNotMatch(s.box('Auto U Pan'), /checked|data-mixed/);
});

test('the queue\'s check takes their bits, as surfaces.py and the host do, and still refuses a bit of no Look flag', () => {
  const row = (args) => ({ op: 'flags', targets: [{ brush: 'Brush0', poly: 0 }], args });
  assert.equal(queueProblem([row([PF_AUTOUPAN, 0])]), '');
  assert.equal(queueProblem([row([0, PF_AUTOVPAN])]), '');
  assert.equal(queueProblem([row([PF_AUTOUPAN | PF_AUTOVPAN | 0x400000, 0])]), '');
  assert.match(queueProblem([row([0x1000, 0])]), /bits of the Look list/);              // BigWavy: no Look flag
  assert.match(queueProblem([row([PF_AUTOUPAN, PF_AUTOUPAN])]), /bits of the Look list/);
});
