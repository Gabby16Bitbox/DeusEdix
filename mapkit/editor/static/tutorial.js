// The interactive tutorial (Help > Interactive tutorial; the server's side is editor/tutorial.py).
// A training map in the look of the game's own, built on the user's PC from a script of ours, and
// Dr. Elias Hale's steps in a panel over the 3D view. Each step says what to do, shows where (the
// camera goes to the room, the button to press glows) and notices when it is done by looking at the
// map's changes, the way the game's own training notices what JC does. The steps are in
// tutorial/tutorial.json; the guide's InfoLinks in the game are the map's story (tutorial/story.json).

import { crateOnStockpile, textureDone, roomCameras, previewedShot, screeningLinked, playerStartInRoom } from './tutorial-checks.js';
import { lessonCues, focusLesson } from './tutorial-focus.js';
import { createTutorialPanel } from './tutorial-panel.js';
import { isTrainingProject } from './projects.js';
import { doctorVoice } from './doctor-voice.js';
import { TUTORIAL_SCRIPT, tutorialSession } from './tutorial-session.js';
import { actorFrontView } from './tutorial-camera.js';

const E = () => window.__editor;
const $ = (s, el = document) => el.querySelector(s);
let T = null, step = 0, done = false, ticker = 0, startCam = null, face = '', clicked = {};
let previews = {};
let startPending = null, guideGeneration = 0, completionTimer = 0, completionRevision = 0;
window.addEventListener('deusedix:cutscene-preview', e => {
  if (E()?.script === T?.script) previews[e.detail.name] = e.detail.keys;
});

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Shared UI-only audio preference survives target/worker switches, never lesson progress.

const style = document.createElement('style');
style.textContent = `
body #tut { position:fixed; z-index:60; top:calc(var(--top-h, 34px) + 14px); right:calc(var(--rw, 280px) + 16px); width:380px; max-width:calc(100vw - 16px);
  background:var(--panel); border:1px solid var(--accent-border); border-radius:var(--radius-window); box-shadow:0 14px 30px #0009;
  color:var(--text); font-size:12px; line-height:1.35; display:none; flex-direction:column;
  max-height:calc(100vh - 16px); overflow:hidden; container-type:inline-size; container-name:tutorial-guide; }
body #tut.open { display:flex; }
body #tut.tut-camera { left:14px; right:auto; width:380px; }
body #tut .tut-head { display:grid; grid-template-columns:40px minmax(0,1fr) auto; flex:none; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--line);
  background:var(--panel); border-radius:var(--radius-window) var(--radius-window) 0 0; }
body #tut .tut-face { width:40px; height:40px; box-sizing:border-box; border:1px solid var(--line); border-radius:var(--radius-card); background:var(--field) center/cover; }
body #tut .tut-who { min-width:0; }
body #tut .tut-who b { display:block; color:var(--heading); font-size:13px; font-weight:600; line-height:18px; }
body #tut .tut-who span { display:block; color:var(--dim); font-size:11px; line-height:1.4; overflow-wrap:break-word; }
body #tut .tut-actions { display:flex; align-items:center; align-self:start; justify-content:flex-end; gap:4px; }
body #tut .tut-actions > button { display:inline-flex; flex:none; align-items:center; justify-content:center; width:24px; height:24px; min-width:24px; min-height:24px; padding:0; margin:0; line-height:1; }
body #tut .tut-mute svg { display:block; flex:none; width:13px; height:13px; }
body #tut .tut-body { flex:1 1 auto; min-width:0; min-height:0; overflow-y:auto; overflow-x:hidden; overflow-wrap:break-word; }
body #tut .tut-footer { flex:none; min-width:0; }
body #tut .tut-room { padding:8px 12px 0; color:var(--acc); font-size:10px; letter-spacing:.1em; text-transform:uppercase; }
body #tut .tut-title { padding:2px 12px 0; color:var(--heading); font-size:13px; font-weight:600; line-height:18px; }
body #tut .tut-text { padding:6px 12px 4px; line-height:1.4; margin:0; }
body #tut .tut-state { margin:6px 12px 0; padding:6px 8px; border-radius:var(--radius-row); background:var(--field); color:var(--dim); font-size:11px; }
body #tut .tut-state.ok { color:var(--ok); border:1px solid var(--ok); background:transparent; }
body #tut .tut-body > .hint { color:var(--dim); font-size:11px; line-height:1.4; }
body #tut .tut-btns { display:flex; flex-wrap:wrap; gap:4px; padding:8px 12px; align-items:center; }
body #tut .tut-btns button { flex:none; height:22px; min-height:22px; padding:0 6px; font-size:12px; line-height:18px; white-space:nowrap; }
body #tut .tut-btns > button:last-child { margin-left:auto; }
body #tut .tut-btns .grow { flex:1; }
body #tut .tut-dots { display:flex; gap:4px; padding:0 12px 8px; }
body #tut .tut-dots i { flex:1; height:3px; border-radius:2px; background:var(--line); }
body #tut .tut-dots i.on { background:var(--acc); } body #tut .tut-dots i.past { background:var(--accent-border); }
body #tut .tut-hint { margin:8px 12px; color:var(--acc); line-height:1.4; font-weight:600; }
@container tutorial-guide (max-width:330px) {
  body #tut .tut-head { grid-template-columns:40px minmax(0,1fr); gap:4px 8px; }
  body #tut .tut-actions { grid-column:1 / -1; justify-self:end; }
}
`;
document.head.appendChild(style);
const box = document.createElement('div');
box.id = 'tut';
document.body.appendChild(box);
const panel = createTutorialPanel(box);

// ---------------------------------------------------------------- the music
// "Pondering the Cosmos" by Ruskerdax (OpenGameArt, CC0), low, only while the training is on. It goes
// quiet while the editor plays or records something else (window.__tutorialMusic.hush), and while the
// editor is not the window in front (the game started from it, another program).
const MUSIC_VOLUME = 0.1;
const music = new Audio('/static/audio/tutorial-music.mp3');
music.loop = true;
music.preload = 'none';
music.volume = 0;
let musicOn = false, fading = 0;
const hushes = new Set();
const muted = () => doctorVoice.muted;
function musicLevel() {
  return musicOn && !muted() && !hushes.size && document.visibilityState === 'visible' && document.hasFocus() ? MUSIC_VOLUME : 0;
}
function playMusic() {
  music.play().catch(() => {                  // the browser waits for a click before it plays anything
    const again = () => { removeEventListener('pointerdown', again, true); removeEventListener('keydown', again, true); if (musicLevel()) playMusic(); };
    addEventListener('pointerdown', again, true);
    addEventListener('keydown', again, true);
  });
}
function musicFade() {
  const want = musicLevel();
  if (want && music.paused) playMusic();
  clearInterval(fading);
  fading = setInterval(() => {
    const d = want - music.volume;
    if (Math.abs(d) <= 0.005) {
      music.volume = want;
      clearInterval(fading);
      fading = 0;
      if (!want && !music.paused) music.pause();       // keeps its place: it goes on from there
      return;
    }
    music.volume = Math.min(1, Math.max(0, music.volume + Math.sign(d) * 0.005));
  }, 40);
}
function musicStart() { if (!musicOn) { musicOn = true; musicFade(); } }
function musicStop() { hushes.delete('away'); if (musicOn) { musicOn = false; musicFade(); } }
addEventListener('focus', musicFade);
addEventListener('blur', musicFade);
document.addEventListener('visibilitychange', musicFade);
const SPEAKER = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/>';
const muteIcon = () => SPEAKER + (muted()
  ? '<path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
  : '<path d="M11 5.6a3.4 3.4 0 0 1 0 4.8M12.8 3.8a6 6 0 0 1 0 8.4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>');
const muteTitle = () => muted() ? 'Unmute tutorial audio' : 'Mute tutorial audio';
function toggleMute() {
  doctorVoice.toggle();
}
doctorVoice.subscribe(() => {
  for (const b of box.querySelectorAll('.tut-mute')) { b.innerHTML = muteIcon(); b.title = muteTitle(); b.setAttribute('aria-label', muteTitle()); b.setAttribute('aria-pressed', String(muted())); }
  if (muted()) { clearInterval(fading); fading = 0; music.volume = 0; music.pause(); }
  else musicFade();
});
window.__tutorialMusic = {
  state: () => ({ on: musicOn, muted: muted(), level: musicLevel(), volume: +music.volume.toFixed(3), playing: !music.paused, hushed: hushes.size }),
  // hush(key, on): quiet while something else is heard (a preview, the microphone)
  hush(key, on) {
    if (on) hushes.add(key); else hushes.delete(key);
    if (on && key !== 'doctor') doctorVoice.stop();
    musicFade();
  },
  // hushWhile(audio): quiet until that audio pauses or ends
  hushWhile(audio) {
    if (!audio) return;
    const done = () => window.__tutorialMusic.hush(audio, false);
    audio.addEventListener('pause', done, { once: true });
    audio.addEventListener('ended', done, { once: true });
    audio.addEventListener('error', done, { once: true });
    window.__tutorialMusic.hush(audio, true);
  },
};

function say(html) {
  box.innerHTML = html;
  // Keep every edition's lesson content unchanged while the instructions scroll
  // independently of the header and navigation controls.
  const head = box.querySelector('.tut-head'), body = document.createElement('div'), footer = document.createElement('div');
  body.className = 'tut-body'; footer.className = 'tut-footer';
  for (const node of [...box.childNodes]) {
    if (node === head) continue;
    (node.nodeType === 1 && node.matches('.tut-btns, .tut-dots') ? footer : body).appendChild(node);
  }
  if (body.childNodes.length) box.appendChild(body);
  if (footer.childNodes.length) box.appendChild(footer);
  box.classList.add('open'); panel.refresh();
}
function head(sub) {
  const g = T ? T.guide : { name: 'Dr. Elias Hale' };
  const mute = musicOn ? `<button class="tut-mute" data-t="mute" title="${esc(muteTitle())}" aria-label="${esc(muteTitle())}" aria-pressed="${muted()}">${muteIcon()}</button>` : '';
  return `<div class="tut-head"><div class="tut-face" style="background-image:url('${face}')"></div>
    <div class="tut-who"><b>${esc(g.name)}</b><span>${esc(sub)}</span></div><div class="tut-actions">${mute}<button class="tut-x" data-t="close" aria-label="Close the tutorial" title="Close the tutorial (Help > Interactive tutorial opens it again)">✕</button></div></div>`;
}
box.addEventListener('click', (e) => {
  const b = e.target.closest('[data-t]');
  if (!b) return;
  const what = b.dataset.t;
  if (what === 'close') stop();
  else if (what === 'mute') toggleMute();
  else if (what === 'next') show(Math.min(T.steps.length - 1, step + 1));
  else if (what === 'back') show(Math.max(0, step - 1));
  else if (what === 'show') { showMe(T.steps[step]); if (!done) narrateLesson(); }
  else if (what === 'advanced') show(T.steps.findIndex((x) => x.advanced));
  else if (what === 'reset') reset();
  else if (what === 'start') start();
  else if (what === 'later') { box.classList.remove('open'); }
});

function narrationContext() {
  const session = T?.session, here = step;
  return { owner: `${session}:${here}`, active: () => !!session && T?.session === session && step === here &&
    box.classList.contains('open') && ![...hushes].some(key => key !== 'doctor') };
}
function narrateLesson() {
  if (T?.steps[step]) void doctorVoice.speak(T.steps[step].text, narrationContext());
}

// ---------------------------------------------------------------- the camera and the glow
function roomCentre(i) { return T.layout?.[i]?.origin ? [...T.layout[i].origin, 0] : [i * T.spacing, 0, 0]; }
function look(from, at) {
  const ed = E();
  ed.camera.position.set(from[0], from[2], from[1]);          // Unreal (x, y, z up) -> three (x, z, y)
  const dx = at[0] - from[0], dy = at[1] - from[1], dz = at[2] - from[2];
  ed.cam.yaw = Math.atan2(dy, dx);
  ed.cam.pitch = Math.atan2(dz, Math.hypot(dx, dy));
  if (ed.wake) ed.wake(600);
}
function flyTo(i) {
  const view = T.layout && T.layout[i] && T.layout[i].camera;
  if (view) { look(view.from, view.at); return; }
  const [cx] = roomCentre(i);
  if (i === 0) look([cx - 120, -300, 150], [cx + 40, T.room[1] / 2 + 150, 110]);       // the guide behind the glass
  else look([cx - 340, -260, 190], [cx + 40, 40, 40]);
}
function showMe(s) {
  const placeView = () => {
    const scientist = T.names?.scientist || 'TutorialScientist';
    const front = s.show === 'select:' + scientist ? actorFrontView(E(), scientist) : null;
    if (front) look(front.from, front.at);
    else if (s.camera) look(s.camera.from, s.camera.at);
    else if (s.room !== undefined) flyTo(s.room);
  };
  placeView();
  if (s.show && s.show.startsWith('select:')) setTimeout(() => {
    if (T?.steps[step] !== s || !box.classList.contains('open')) return;
    E().selectActor(s.show.slice(7));
    placeView();  // Keep the authored room view; selection otherwise zooms into the object.
  }, 250);
  if (s.check?.startsWith('cinematic:')) {
    const camera = roomCameras(E().edits || {}, T.layout[s.room])[0];
    if (camera) window.__cutscene?.open(camera.name, { look: true });
  }
  glow(s, true);
}
function glow(s, revealAgain = false) {
  const cues = s && !done ? lessonCues({ ...s, trainingRoom:T.layout[s.room ?? +s.check.split(':').at(-1)],
    aliases:(T.targetAliases || {})[(s.check || '').split(':')[3]] || [] }) : null;
  if (cues) cues.lesson = s;
  const hint = $('.tut-hint', box);
  if (hint) {
    const text = cues?.hint || '';
    if (hint.textContent !== text) hint.textContent = text;
    hint.hidden = !text;
  }
  focusLesson(cues, E(), () => box.classList.contains('open') && E()?.script === T?.script && !done && !window.__cutscene?.playing, revealAgain);
}

// ---------------------------------------------------------------- is the step done?
function check(c) {
  const ed = E();
  if (!ed || !T || ed.script !== T.script) return false;
  const [kind, ...a] = c.split(':');
  const edits = ed.edits || {};
  if (kind === 'playerstart') {
    const actors = ed.cutKit?.allActors?.() || ed.proxies?.children.map(p => p.userData.actor).filter(Boolean) || [];
    return playerStartInRoom(actors, edits, T.layout?.[T.steps[step].room ?? 0]);
  }
  if (kind === 'texture') return textureDone(edits, a[0]);
  if (kind === 'camera') return roomCameras(edits, T.layout[+a[0]]).length > 0;
  if (kind === 'cinematic') return previewedShot(edits, T.layout[+a[0]], previews);
  if (kind === 'cutlink') return screeningLinked(edits, T.layout[+a[1]], a[0]);
  if (kind === 'fly') return !!startCam && ed.camera.position.distanceTo(startCam) > 120;
  if (kind === 'moved') return !!(edits.moved || {})[a[0]];
  if (kind === 'added') {
    return crateOnStockpile(edits, a[0].split(',').map(Number));
  }
  if (kind === 'link') {
    const [src, verb, target] = a;
    const targets = new Set([target, ...((T.targetAliases || {})[target] || [])]);
    return (edits.links || []).some((l) => l.src === src && (l.do || []).some((d) => d.verb === verb && targets.has(d.target)));
  }
  if (kind === 'idle') return String(edits.anims?.[a[0]]?.idle || '').toLowerCase() === 'gestureright' && !edits.anims?.[a[0]]?.own;
  if (kind === 'dialogue') {
    const st = window.__story && window.__story.data && window.__story.data();
    return !window.__story?.dirty && !window.__story?.saving && !!st?.dialogues?.some(d =>
      d.owner === a[0] && ['npc', 'jc'].every(who => d.steps?.some(x =>
        x.type === 'line' && x.who === who && String(x.text || '').trim())));
  }
  if (kind === 'clicked') return !!clicked[a[0]];
  // ---- the advanced wing (optional): dialogue choices, timers, zones, scripts, the Console
  const saved = (owner) => {
    const st = window.__story?.data?.();
    if (window.__story?.dirty || window.__story?.saving || !st) return [];
    return (st.dialogues || []).filter((d) => d.owner === owner);
  };
  const stepsOf = (owner) => saved(owner).flatMap((d) => d.steps || []);
  if (kind === 'choice') {                         // a choice of two answers or more, each with its words
    return stepsOf(a[0]).some((x) => x.type === 'choice' && (x.options || []).filter((o) => String(o.text || '').trim()).length >= 2)
      && stepsOf(a[0]).filter((x) => x.type === 'line' && String(x.text || '').trim()).length >= 2;
  }
  if (kind === 'consequence') {                    // a state set, and the vault opened, in that conversation
    const steps = stepsOf(a[0]);
    return steps.some((x) => x.type === 'choice') && steps.some((x) => x.type === 'flag' && (x.flag || x.requires?.length))
      && JSON.stringify(steps).includes(a[1]);
  }
  if (kind === 'remember') {                       // an If on a state that the conversation also sets
    const steps = stepsOf(a[0]);
    const set = new Set(steps.filter((x) => x.type === 'flag' && x.flag).map((x) => String(x.flag).toLowerCase()));
    return steps.some((x) => x.type === 'if' && (set.has(String(x.flag || '').toLowerCase()) || x.requires?.length));
  }
  const rules = (edits.links || []);
  if (kind === 'linkwhen') {                       // linkwhen:source:when:verb1,verb2:target
    const [src, when, verbs, target] = a, ok = verbs.split(',');
    return rules.some((l) => l.src === src && l.when === when && (l.do || []).some((d) => ok.includes(d.verb) && d.target === target));
  }
  if (kind === 'linkany') {                        // linkany:source:verb1,verb2:target (any When)
    const [src, verbs, target] = a, ok = verbs.split(',');
    return rules.some((l) => l.src === src && (l.do || []).some((d) => ok.includes(d.verb) && d.target === target));
  }
  const scriptPackage = window.__scripts?.package;
  const scriptsPlaced = () => (edits.added || []).filter((x) => scriptPackage && String(x.cls).startsWith(scriptPackage + '.') && !edits.deleted?.[x.name]);
  if (kind === 'scriptplaced') {                   // a script of Tools > Scripts placed in that room
    const room = T.layout[+a[0]];
    return scriptsPlaced().some((x) => {
      const p = (edits.moved?.[x.name]?.loc) || x.loc;
      return room && p && room.cells.some(([x0, y0, x1, y1]) => p[0] > room.origin[0] + x0 && p[0] < room.origin[0] + x1
        && p[1] > room.origin[1] + y0 && p[1] < room.origin[1] + y1);
    });
  }
  if (kind === 'linkscript') {                     // the button sets off a placed script
    const names = new Set(scriptsPlaced().map((x) => x.name));
    return rules.some((l) => l.src === a[0] && (l.do || []).some((d) => names.has(d.target)));
  }
  if (kind === 'console') return !!clicked.console;
  return false;
}
// the Console sends a command to the running game (console.js): the last advanced exercise
window.addEventListener('deusedix:console-command', () => { if (E()?.script === T?.script) clicked.console = true; });
window.addEventListener('deusedix:play-state', e => {
  if (E()?.script === T?.script && e.detail.phase === 'running' && !e.detail.error) clicked.playhere = true;
});
// Re-evaluate after UI handlers finish, including close, cancel, and keyboard actions.
for (const event of ['click', 'change', 'input', 'keyup']) document.addEventListener(event, () => setTimeout(tick, 0));

function tick() {
  if (!T || !box.classList.contains('open') || !T.steps[step]) return;
  const away = E()?.script !== T.script;                 // the music is the training map's
  if (away !== hushes.has('away')) window.__tutorialMusic.hush('away', away);
  const s = T.steps[step];
  // Let the recruit see the film unobstructed; the instructions return when playback ends.
  const filming = s.check?.startsWith('cinematic:') && window.__cutscene?.playing;
  box.style.visibility = filming ? 'hidden' : '';
  if (filming) return;
  glow(s);
  if (done || !check(s.check || '')) return;
  done = true;
  // Completing the action supersedes its explanation, including queued clips and autoplay retries.
  doctorVoice.stop();
  glow(null);
  const st = $('.tut-state', box);
  if (st) { st.className = 'tut-state ok'; st.textContent = s.complete || (step < T.steps.length - 1 ? 'Done. Next room in a moment...' : 'Done. Training complete.'); }
  const here = step;
  const session = T.session;
  const sameWing = !!T.steps[step + 1] && !!T.steps[step + 1].advanced === !!s.advanced;
  const revision = ++completionRevision, context = narrationContext();
  const current = () => revision === completionRevision && T?.session === session && done && step === here &&
    E()?.script === T.script && box.classList.contains('open');
  const advance = () => {
    if (!current()) return;
    clearTimeout(completionTimer); completionTimer = 0;
    if (sameWing) show(here + 1);
  };
  // Interrupt the instructions, not his acknowledgement. Next/Back/Close cancel
  // this continuation even when returning to the same step in the same session.
  completionTimer = setTimeout(advance, 125000); // bounded fallback for stalled media
  void (async () => {
    try {
      const started = s.complete && await doctorVoice.speak(s.complete, { ...context, active: () => current() && context.active() });
      if (!current()) return;
      if (started) await doctorVoice.whenIdle(context.owner);
      else await new Promise(resolve => setTimeout(resolve, 700)); // muted/missing: still show the green comment
    } finally { advance(); }
  })().catch(() => {});
}

// ---------------------------------------------------------------- the steps
function show(i) {
  completionRevision++;
  clearTimeout(completionTimer); completionTimer = 0;
  doctorVoice.stop();
  musicStart();
  box.style.visibility = '';
  if (T.steps[i]?.check?.startsWith('cutlink:') && window.__cutscene?.isOpen()) window.__cutscene.close();
  step = i;
  done = false;
  clicked = {};
  const s = T.steps[i];
  box.classList.toggle('tut-camera', /^(added|camera|cinematic):/.test(s.check || ''));
  const room = s.room !== undefined ? `Room ${s.room} · ${T.rooms[s.room]}` : '';
  // the basic training and the optional advanced wing: each counted on its own
  const wing = T.steps.map((x, k) => k).filter((k) => !!T.steps[k].advanced === !!s.advanced);
  const firstAdvanced = T.steps.findIndex((x) => x.advanced);
  const last = i === wing[wing.length - 1];
  const offer = !s.advanced && firstAdvanced >= 0
    ? `<button data-t="advanced" title="Optional: dialogues with choices and consequences, timers and keypads, an ambush, your own scripts and the Console">${last ? 'Advanced wing' : 'Advanced ›'}</button>` : '';
  say(head(`${T.game || 'DeusEdix'} ${s.advanced ? 'advanced wing' : 'training'} · step ${wing.indexOf(i) + 1} of ${wing.length}`)
    + `<div class="tut-room">${esc(room)}</div><div class="tut-title">${esc(s.title)}</div><p class="tut-text">${esc(s.text)}</p>`
    + '<p class="tut-hint" aria-live="polite" hidden></p>'
    + `<div class="tut-state">${s.check === 'end' ? 'Done. Training complete.' : 'Watching from the booth...'}</div><div class="hint" style="margin:6px 14px">Temporary training. Close map discards your changes; hiding this guide keeps the session.</div>`
    + `<div class="tut-btns"><button data-t="back" ${i ? '' : 'disabled'}>Back</button><button data-t="show">Show me</button><span class="grow"></span>`
    + `${offer}${last ? '<button data-t="reset">Start over</button>' : ''}<button data-t="${last ? 'close' : 'next'}" class="primary">${last ? 'Finish' : 'Next'}</button></div>`
    + `<div class="tut-dots">${wing.map((k) => `<i class="${k === i ? 'on' : k < i ? 'past' : ''}"></i>`).join('')}</div>`);
  if (s.show || (s.check?.startsWith('cinematic:') && !window.__cutscene?.isOpen())) showMe(s);
  else glow(s);
  narrateLesson();
  const generation = guideGeneration;
  setTimeout(() => { if (generation === guideGeneration && T && E()?.script === T.script) startCam = E().camera.position.clone(); }, 400);
  if (!ticker) ticker = setInterval(tick, 150);
}

// his picture: the Character Creator's portrait of his recipe, kept in the browser so it is there at once
// the next time (made again when the recipe changes)
const FACE_KEY = 'deusedix.tutorial.face';
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
function setFace(png) {
  face = png;
  for (const f of box.querySelectorAll('.tut-face')) f.style.backgroundImage = `url('${face}')`;
}
async function makeFace(recipe, upload, session = tutorialSession.token) {
  if (!recipe) return;
  try {
    if (!face) {
      const h = hash(JSON.stringify(recipe));
      let kept = null;
      try { kept = JSON.parse(localStorage.getItem(FACE_KEY)); } catch (e) { /* no storage */ }
      if (kept && kept.h === h && kept.png) setFace(kept.png);
      else {
        setFace(await window.__characters.portrait(recipe, { size: 256 }));
        try { localStorage.setItem(FACE_KEY, JSON.stringify({ h, png: face })); } catch (e) { /* no storage */ }
      }
    }
    if (upload && session && tutorialSession.token === session && E()?.script === TUTORIAL_SCRIPT)
      await api('/api/tutorial_portrait', { png: face, session });    // his InfoLink portrait in the game
  } catch (e) { console.warn('tutorial: no portrait of the guide', e); }
}

async function waitFor(test, ms) {
  const t0 = performance.now();
  while (!test()) {
    if (performance.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
  return true;
}

function start() {
  if (startPending) return startPending;
  const promise = startHere().finally(() => { if (startPending === promise) startPending = null; });
  startPending = promise;
  return promise;
}
async function startHere() {
  if (!isTrainingProject(window.__projectContext)) return window.__projects?.training();
  const ed = E();
  if (!ed) return;
  if (T?.session && T.session === tutorialSession.token && ed.script === TUTORIAL_SCRIPT) {
    show(Math.min(step, T.steps.length - 1)); window.__tutorialLoading?.hide(); return;
  }
  if (ed.script !== TUTORIAL_SCRIPT && ed.confirmLeave && !(await ed.confirmLeave())) { window.__tutorialLoading?.hide(); return; }
  const generation = ++guideGeneration;
  if (ticker) { clearInterval(ticker); ticker = 0; }
  musicStart();
  done = false;
  glow(null);
  say(head('DeusEdix training') + `<p class="tut-text">Preparing the training wing. The first time it is built on your PC from DeusEdix's script, with your game's textures: about a minute. Long enough for a coffee.</p>
    <div class="tut-state">Building...</div>`);
  window.__tutorialLoading?.show('Preparing the training map. The first build can take a minute…');
  try {
    const previous = tutorialSession.token;
    const data = await tutorialSession.requestStart();
    if (generation !== guideGeneration || tutorialSession.token !== data.session) return;
    const fresh = !!data.fresh || previous !== data.session;
    T = data;
    if (fresh) { step = 0; previews = {}; clicked = {}; startCam = null; ed.resetTutorialView?.(); }
    if (ed.script !== T.script || fresh || T.rebuilt || T.restored) {
      window.__tutorialLoading?.show('Loading the training scene and its textures…');
      const loaded = await ed.loadMaps(T.script);
      if (generation !== guideGeneration || tutorialSession.token !== data.session) return;
      if (loaded === false || !(await waitFor(() => E()?.script === data.script && $('#busy')?.style.display === 'none', 120000)))
        throw new Error('The training map could not be loaded. Close the map and try again.');
    }
    if (generation !== guideGeneration || tutorialSession.token !== data.session) return;
    makeFace(T.recipe, T.standalone, data.session);
    show(fresh ? 0 : Math.min(step, T.steps.length - 1));
    window.__tutorialLoading?.hide();
  } catch (e) {
    if (generation !== guideGeneration || e.name === 'AbortError') return;
    window.__tutorialLoading?.fail(e, start);
    say(head('DeusEdix training') + `<p class="tut-text">The training map could not be prepared.</p><div class="tut-state">${esc(e.message)}</div>
      <div class="tut-btns"><span class="grow"></span><button data-t="close">Close</button></div>`);
  }
}

function stop() {
  completionRevision++;
  clearTimeout(completionTimer); completionTimer = 0;
  doctorVoice.stop();
  musicStop();
  box.style.visibility = '';
  box.classList.remove('open');
  glow(null);
  if (ticker) { clearInterval(ticker); ticker = 0; }
}

async function reset() {
  if (!confirm('Start the training over? What you did in the training map (its changes and its story) is forgotten. The paperwork too.')) return;
  const ed = E();
  // Close successfully before forgetting progress: a running game may still
  // hold this session's files. Reopening then creates a clean session.
  if (ed?.script === TUTORIAL_SCRIPT && !(await ed.closeMap())) return;
  if (tutorialSession.token) await ed?.endTutorialSession?.();
  forget();
  await start();
}
function forget() {
  stop(); guideGeneration++; startPending = null;
  T = null; step = 0; done = false; clicked = {}; previews = {}; startCam = null;
}

// The start screen offers training. Opening a map no longer interrupts with an offer popup.

window.__tutorial = { start, stop, reset, forget, avoid: rects => panel.avoid(rects), get step() { return step; }, get data() { return T; } };
