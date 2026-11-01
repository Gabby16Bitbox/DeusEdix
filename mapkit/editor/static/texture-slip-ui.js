// Texture Slip in the 3D view, as Premiere's slip tool (texture-slip.js does the sums, surface-texture-preview.js draws
// it): with faces selected, Y over one of them starts it (Edit > Slip the texture, or Y away from them: it starts when
// the pointer comes over one). Moving the pointer rolls their texture in any direction, the texel under the pointer
// staying under it; the wheel makes it larger (up) or smaller round that point; Shift is finer, Ctrl snaps, the arrows
// nudge it a texel the way they point, P gives every face one pan (offered when each its own would take too many
// queued changes). A click (or letting go after a drag) or Enter queues it, one undo step "Slip the texture"; Esc, the
// right button, Alt, a click elsewhere (a menu, a panel), leaving the page, and the page's own Undo, Redo, Save, Rebuild,
// closing or opening a map (cancel) end it with nothing changed. While it goes on it has the pointer, the wheel and the
// keys: it listens first, on the window, and keeps them from the 3D view's tools. A slip kept after others starts from
// the exact mappings they left the faces (their pans not rounded), and parts a ring again where they parted it (each
// face's mapping before the first of them), which go with the map's state: the page's Undo history keeps them with each
// step's edits (held) and gives them back with them (hold), so an Undo, a Redo or a jump in the History panel finds
// those of the state it puts in place; a Pan queued since moves a face's as much, a Rebuild keeps them, any other
// change to a face drops its own (an alignment, One Tile, Around a cylinder on a side, Rotate or a flip counted in the
// queue, a Scale by value) and Revert all changes drops them all. After a reload, or in another map (forget), a slip
// starts from the pans queued, whole texels.
import { startSlip, slipPan, slipScale, slipNudge, slipMods, slipResult, slipHud, slipSummary, rayPoint, arrowNudge,
  wheelNotches, learnNotch, piecesNormal, roomNote, exactsNow, exactsKept, keptBefore, keptSlip, ROW_LIMIT } from './texture-slip.js';

const typing = (t) => !!t && (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable);
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const UE = (v) => [v.x, v.z, v.y];            // three -> Unreal, unrounded (the slip's sums)
// two frames' matrices (three.js elements, column by column) the same: within a thousandth of a unit, a millionth of a turn
export function sameFrame(a, b) { return a.every((x, i) => Math.abs(x - b[i]) <= (i >= 12 && i <= 14 ? 1e-3 : 1e-6)); }

// api: { THREE, win: the window, canvas: the 3D view's, camera, label: the HUD's element (shown and placed here),
//   ray(e): the pointer's ray in the view (a THREE.Ray); pointed(e): the built face under the pointer, { id, mesh, point,
//   normal: its triangle's, both in the view (THREE.Vector3) }, or { why } (none, or a block not built in front of it);
//   frameOf(mesh): { toBuilt: a THREE.Matrix4 from the view to where the last Rebuild built the mesh, moved, resized };
//   faces: { selected(): [{ id, face, tex: its texture now }], canEdit(face) }; preview: { current(id): a face's
//   mapping now, asBuilt(id): as the last Rebuild built it, shapeOf(id): { pieces: where the last Rebuild built them },
//   trianglesOf(id): [{ mesh, triangle }], slip(Map id -> mapping) };
//   refresh(): the preview drawn again from the queue; queue(rows, label, line): surface-ui.js queueRows; room(): the
//   rows the map can still take; queued(): the rows queued (edits.surfaces), which a slip's rows fold into; can(): '' or why
//   it cannot start now (no face selected too, with the page's keys); status(text, kind); wake(); frame(fn): fn at the
//   next frame (requestAnimationFrame) }
export function createTextureSlip(api) {
  const { THREE, win, canvas } = api;
  const frame = api.frame || ((fn) => win.requestAnimationFrame(fn));
  // the session (texture-slip.js startSlip's), waiting for the pointer over a face, one pan for all, the left button
  // down on the view, a Ctrl+wheel's part of a notch, the map's room and queue at the start, the face's frame (view ->
  // built), the pointer's last event (where the HUD goes), a frame asked for; the wheel's notch in pixels, learnt while
  // the page is open (learnNotch), and when the last wheel event came (its timeStamp)
  let s = null, armed = false, plain = false, pressed = false, part = 0, room = ROW_LIMIT, queue = [], toBuilt = null, last = null, asked = false;
  let notch = null, wheeled = -Infinity;
  // what the slips kept know of the faces of the map as it is now, the next slip's start (none before the first): kept,
  // texture-slip.js keptSlip's (each face's mappings before the first of them and as built then: keptBefore), and
  // exacts, the exact mappings they left the faces (exactsKept's; exactsNow), so slips kept one after the other are
  // rounded once. A new value for each slip kept, never changed: the page's Undo history keeps it with each state of
  // the edits (held) and gives it back with them (hold), so an Undo knows what the slips of the state it puts in place
  // knew, no more (a page that undid slips is a page that never made them); made: those this page made, the only ones
  // it takes back
  let slips = null;
  const made = new WeakSet();
  const mods = (e) => ({ shift: !!e.shiftKey, ctrl: !!e.ctrlKey });

  // why the selected faces cannot slip together: a locked one, one of a structure resized since the Rebuild, or one in
  // another frame than the face under the pointer's (a structure moved or turned since the Rebuild, otherwise than it)
  function refusal(list, mesh) {
    if (list.some(({ face }) => !api.faces.canEdit(face))) return 'Unlock the target structure before editing its surfaces.';
    const frames = new Map(), frameOf = (m) => { if (!frames.has(m)) frames.set(m, api.frameOf(m)); return frames.get(m); };
    const own = frameOf(mesh).toBuilt.elements;
    let resized = 0, other = 0;
    for (const { id } of list) {
      const at = api.preview.trianglesOf(id)[0], f = at && frameOf(at.mesh);
      if (f?.resized) resized++;
      else if (f && !sameFrame(f.toBuilt.elements, own)) other++;
    }
    const faces = (n) => `${n} of the selected faces ${n === 1 ? 'is' : 'are'}`;
    if (resized) return `${faces(resized)} on a structure resized since the Rebuild: Rebuild first, then slip its texture.`;
    // (the face under the pointer the one moved: those counted are the ones not moved with it)
    if (other && frameOf(mesh).moved) {
      return `The face under the pointer is on a structure moved or turned since the Rebuild and ${faces(other)} not moved with it: `
        + 'Rebuild first, or slip them apart.';
    }
    if (other) return `${faces(other)} on a structure moved or turned since the Rebuild, otherwise than the face under the pointer: Rebuild first, or slip them apart.`;
    return '';
  }
  // the slip on the face under the pointer (e: a pointer event, or the last one over the view): false while it is not
  // over a selected face (it waits), true once started, or refused (it ends)
  function begin(e) {
    const at = api.pointed(e);
    if (at.why) { api.status(`${at.why} The slip starts over one of the selected faces (Esc cancels).`, 'warn'); return false; }
    const list = api.faces.selected(), ref = list.findIndex(({ id }) => id === at.id);
    if (ref < 0) { api.status('Point at one of the selected faces: the slip starts over one (Esc cancels).', 'warn'); return false; }
    const why = refusal(list, at.mesh);
    if (why) { end(false); api.status(why, 'warn'); return true; }
    toBuilt = api.frameOf(at.mesh).toBuilt;
    // the plane: the face's pieces' (the triangle's: the rounded corners of a sliver face anyhow), where it was built;
    // every face's pieces, where they were built, join the faces that share an edge
    const normal = piecesNormal(api.preview.shapeOf(at.id)?.pieces) || UE(at.normal.clone().transformDirection(toBuilt));
    // each face as it is now, with its pieces where they were built (whether Around a cylinder queued on its brush
    // changes it too), and what the slips kept before know of it (none: its mapping as built and now)
    const now = list.map(({ id, face }) => ({ brush: face.brush, poly: face.poly, mapping: api.preview.current(id),
      pieces: api.preview.shapeOf(id)?.pieces }));
    const exact = exactsNow(slips?.exacts, now, api.queued());
    const faces = list.map(({ id, tex }, i) => ({ id, ...now[i], tex, exact: exact[i], ...keptBefore(slips?.kept, now[i], api.preview.asBuilt(id)) }));
    const started = startSlip({ faces, ref, point: UE(at.point.clone().applyMatrix4(toBuilt)), normal });
    if (started.error) { end(false); api.status(started.error, 'warn'); return true; }
    s = started; armed = false; plain = false; part = 0; room = api.room(); queue = api.queued(); last = e;
    api.status('Texture Slip: move to roll it, the wheel sizes it (Shift finer, Ctrl snaps); click or Enter keeps it, Esc cancels.');
    draw();
    return true;
  }
  // Y, or Edit > Slip the texture: at the face under the pointer (at: the pointer's last event over the view, or none),
  // else once the pointer comes over one of the selected faces. Whether it started or waits.
  function start(at) {
    if (s || armed) return true;
    const why = api.can();
    if (why) { api.status(why, 'warn'); return false; }
    listen(true);
    armed = true;
    if (!at || !begin(at)) api.status('Texture Slip: point at one of the selected faces (Esc cancels).');
    return !!s || armed;
  }

  // the slip's result now: in the map's room, folded into its queue, one pan for all or each face its own; exact: each
  // face's exact mapping too (the slip kept: a frame draws the mappings alone)
  const result = (exact = false) => slipResult(s, { room, plain, queue, exact });
  // what the faces show now, once a frame however many events: the preview of their rows, the HUD
  function schedule() {
    if (asked) return;
    asked = true;
    frame(() => { asked = false; draw(); });
  }
  function draw() {
    if (!s) return;
    const r = result();
    api.preview.slip(new Map(r.preview.map((p) => [p.id, p.mapping])));
    show(r);
    api.wake();
  }
  function show(r) {
    const offer = plain ? ' · P: each face its own pan' : r.plainFits ? ' · P: one pan for all' : '';
    api.label.textContent = slipHud(s, r, room) + offer;
    api.label.style.display = 'block';
    if (last) { api.label.style.left = `${last.clientX + 16}px`; api.label.style.top = `${last.clientY + 18}px`; }
  }
  // the ray of the pointer where the face was built: the plane's point under it
  function pointAt(e) {
    const ray = api.ray(e);
    return rayPoint(s, UE(ray.origin.clone().applyMatrix4(toBuilt)), UE(ray.direction.clone().transformDirection(toBuilt)));
  }
  // the view's right and up where the face was built
  const screenAxis = (x, y) => UE(new THREE.Vector3(x, y, 0).applyQuaternion(api.camera.quaternion).transformDirection(toBuilt));

  // Queues it (one undo step), or says why not: then it goes on (P, or Esc)
  function commit() {
    const r = result(true), slipped = s.faces;
    if (r.error) { api.status(r.error, 'warn'); show(r); return; }
    end(false);
    if (!r.rows.length) { api.refresh(); api.status('Nothing slipped: the texture is where it was.'); return; }
    const done = api.queue(r.rows, 'Slip the texture', slipSummary(r));
    if (!done) { api.refresh(); return; }
    // what the slips know with this one (after the queue: its step keeps what they knew before, held): each face's
    // mapping before the first slip kept on it and as built then, and the exact mappings of the state it made, counted
    // against the queue with its rows
    slips = { kept: keptSlip(slips?.kept, slipped), exacts: exactsKept(slips?.exacts, slipped, r.preview, api.queued()) };
    made.add(slips);
    const note = roomNote(done.left), n = r.targets.length;
    api.status(`Texture slipped on ${n} face${n === 1 ? '' : 's'}: Rebuild to see it in the game${note ? ` · ${note}` : ''}.`, note ? 'warn' : 'ok');
  }
  function end(refresh = true) {
    const was = !!s;
    s = null; armed = false; pressed = false;
    listen(false);
    api.label.style.display = 'none';
    if (refresh && was) api.refresh();
    api.wake();
  }
  // nothing changed: true when there was a slip (or one waiting) to cancel
  function cancel() {
    if (!s && !armed) return false;
    end();
    api.status('Texture slip cancelled: nothing changed.');
    return true;
  }
  // another map opened (the page calls it): what the slips kept knew of the faces goes, their exact mappings too, their
  // brushes and polygons being another map's (the same map opened again by a Rebuild keeps it: its faces are read back
  // from the dump, by value the mappings the slips left)
  function forget() { slips = null; }
  // the edits put in place wholesale by the page (app.js travel: a step of the Undo history taken back or forward; or
  // Revert all changes): a slip going on ends first, nothing changed (cancel), then what the slips knew is what the
  // step held for them (held), none for null or anything this page did not make (in memory only: never saved)
  function hold(state) { cancel(); slips = made.has(state) ? state : null; }

  // ---------------------------------------------------------------- the window's events, first (capture)
  function move(e) {
    last = e;
    if (armed) { if (e.target === canvas) begin(e); return; }
    if (pressed && !(e.buttons & 1)) { pressed = false; commit(); return; }       // let go away from the page
    s = slipPan(s, pointAt(e), mods(e));
    schedule();
  }
  function down(e) {
    if (e.target !== canvas) { cancel(); return; }        // a menu, a panel, a button: the slip ends, the click goes on
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.button === 2) { cancel(); return; }
    if (e.button !== 0) return;
    if (armed) { begin(e); return; }
    pressed = true;
    last = e;
  }
  function up(e) {
    if (e.target !== canvas && !pressed) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!pressed || e.button !== 0) return;
    pressed = false;
    commit();
  }
  function wheel(e) {
    // the milliseconds since the wheel event before (every one heard: a swipe's steps come close together)
    const quiet = e.timeStamp - wheeled;
    wheeled = e.timeStamp;
    if (!s || e.target !== canvas) return;
    e.preventDefault(); e.stopImmediatePropagation();      // (Ctrl+wheel: no page zoom)
    notch = learnNotch(notch, e, quiet);
    let notches = wheelNotches(e, notch);
    if (e.ctrlKey) { part += notches; notches = Math.trunc(part); part -= notches; } else part = 0;
    last = e;
    s = slipScale(s, notches, mods(e));
    schedule();
  }
  function menu(e) { if (e.target === canvas) { e.preventDefault(); e.stopImmediatePropagation(); } }
  function keydown(e) {
    if (e.key === 'Shift' || e.key === 'Control') { if (s) { s = slipMods(s, mods(e)); schedule(); } return; }
    if (typing(e.target)) { cancel(); return; }
    e.stopImmediatePropagation();
    if (e.key === 'Alt' || e.altKey || e.metaKey) { cancel(); return; }
    e.preventDefault();
    // Esc; Ctrl+Z, Ctrl+S...: the slip ends first, and nothing else happens (Ctrl+arrows are the slip's)
    if (e.key === 'Escape' || (e.ctrlKey && !ARROWS.has(e.key))) { cancel(); return; }
    if (!s) return;
    if (e.key === 'Enter') commit();
    else if (ARROWS.has(e.key)) {
      const step = arrowNudge(s, e.key, screenAxis(1, 0), screenAxis(0, 1));
      if (step) { s = slipNudge(s, step[0], step[1], mods(e)); schedule(); }
    } else if (e.code === 'KeyP') {
      if (!plain && !result().plainFits) {
        api.status("One pan for all is offered when each face's own pan would need more queued changes than one slip may add.", 'warn');
      } else { plain = !plain; schedule(); }
    }
  }
  function keyup(e) { if (s && (e.key === 'Shift' || e.key === 'Control')) { s = slipMods(s, mods(e)); schedule(); } }
  function blur(e) { if (e.target === win || !e.target) cancel(); }      // the page left (the window's own blur)
  const LISTENERS = [['pointermove', move, true], ['pointerdown', down, true], ['pointerup', up, true], ['wheel', wheel, { capture: true, passive: false }],
    ['contextmenu', menu, true], ['keydown', keydown, true], ['keyup', keyup, true], ['blur', blur, false]];
  let listening = false;
  function listen(on) {
    if (on === listening) return;
    listening = on;
    for (const [type, fn, options] of LISTENERS) {
      if (on) win.addEventListener(type, fn, options);
      else win.removeEventListener(type, fn, typeof options === 'object' ? options.capture : options);
    }
  }
  // held: what the slips kept know of the map as it is now (its exact mappings among it), which the page's Undo history
  // keeps with the edits of each step (history-names.js page)
  return { start, cancel, forget, hold, get held() { return slips; }, get active() { return !!s || armed; } };
}
