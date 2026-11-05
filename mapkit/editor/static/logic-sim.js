// The Logic simulator, "Try it" (editor/LOGIC.md; the Logic design, debugging section 2): a map's rules played in the
// editor in milliseconds, with no game and no build. It runs the compiled form the game gets (links.blocks, through
// editor/logic_compile.py: /api/logic/compile) by today's runtime's contract, UCLink.uc with UCLinkGroup, UCScript,
// UCTimer and UCEditorStory.Holds (conditions.js conditionHolds), and writes the logic log the game writes
// (logic-log.js reads its lines). Pure: tests/test_logic_sim.mjs plays every behaviour fixture (tests/fixtures/logic,
// whose README's "The clock" this follows) and checks each line and its time.
//
// The game in ticks of `frame` seconds. In a tick the map's own objects come first (timers, scripts, cutscenes: the
// world's actors, in the map's order), then the rules in their compiled order, then JC: what the user makes happen is
// JC's part. A rule told before its turn acts in that tick, otherwise in the next; each action after its delay; every
// half second each rule looks at what it watches. What only the game knows is either given (the world: classes,
// places, what a script does) or the user's to decide (decisions: a character arriving, an animation ending).
//
// Assumptions beyond the fixtures' README (A1-A9): S1 a door's opened / destroyed is told apart in the rule's Tick
// event, which the engine runs before its state code (UnLevTic.cpp, AActor::Tick), so it acts in that same tick;
// S2 a keypad's right code comes by its UnTriggerEvent (bToggleLock, the default); S3 a sound always loads, a door
// always has its key, a mover has the floors its world actor says (an ElevatorMover 2, a MultiMover 4 when it does
// not); S4 the door that opens and the character who arrives name themselves as what set the rule off; the end of an
// animation names its UCMotion (UCLink.Who: a UCMotion is no UCEditorStory and passes no instigator,
// UCMotion.uc:157-158), the world actor's `motion`, or the animated object itself when the world does not say.
import { conditionHolds, conditionText, kindOf } from './conditions.js';
import { LOGIC_TAG, parseLogicLine, logicSentence, decodeCondition } from './logic-log.js';
import { partsText } from './console-lines.js';
import { fill } from './logic-vocab.js';

// ---------------------------------------------------------------- the game's code, as data
const LOOK = 0.5;                       // every rule looks this often (UCEditorStory.PostBeginPlay: SetTimer(0.5))
const QUEUE = 8;                        // outputs a script keeps while the map loads (UCScript.WaitingOutputs[8])
// How a rule hears its Tag (UCLink.Trigger, UnTrigger): Trigger passes over these and what is heard 'start' or
// 'watch'; UnTrigger runs them, and a keypad's right code (S2)
const BY_UNTRIGGER = new Set(['closed', 'leave', 'hacked']);
const UNTRIGGERED = new Set([...BY_UNTRIGGER, 'code']);
// what a rule watches every half second (UCLink.TickStory, TickWatch): the map's objects (hears 'watch'), a property of
// one (P4 'prop': the camera sees the player, below N% of its health...), a condition ('becomes'), a value ('changes')
const WATCHED = new Set(['watch', 'prop', 'becomes', 'changes']);
// a character's Event fires as it dies; killed or knocked out is told apart on the rule's next Tick (UCLink.PawnTold)
const PAWN_OUTPUTS = new Set(['killed', 'knockedout']);
const RUNS = 8;                          // UCRule: runs at once (RLive[8])
const RATE = 20;                         // UCRule: starts in a second before it stops for that second
const DOOR_OUTPUTS = new Set(['opened', 'destroyed']);     // a door's: told apart on the rule's next Tick (UCLink.Tick)
// the ways of hearing whose rule hooks its object's event as the map loads (UCLink.Hook; 'motion' hooks the object's
// UCMotion and says nothing, the others hook nothing)
const HOOKED = new Set(['event', 'fail', 'keypad', 'option']);
// classes whose Event is their list of targets: a rule cannot hook them (UCLink.AimsItsEvent), nor a MoreTriggers
// but for 'leave'
const AIMS = ['AllianceTrigger', 'OrdersTrigger', 'InterpolateTrigger', 'SequenceTrigger', 'UnTrigger', 'RevStateTrigger',
  'ElevatorTrigger', 'PawnAppearTrigger', 'ActorAppearTrigger', 'AnimTrigger', 'AnimTweenBlendTrigger', 'DamageTriggerDirect',
  'LOSHateTrigger', 'PhysicsTrigger', 'SkinColourTrigger', 'TriggerTrigger', 'UnlitTrigger'];
// the verbs UCLink.DoAct knows (links.py makes navgo / navrun of goto / run on the walkable area): any other "cannot"
const VERBS = new Set(['open', 'close', 'toggle', 'lock', 'unlock', 'blow', 'key', 'attack', 'hostile', 'friend', 'neutral',
  'stand', 'sit', 'standup', 'wander', 'follow', 'goto', 'run', 'navgo', 'navrun', 'leave', 'appear', 'lighton', 'lightoff', 'lighttoggle', 'hide',
  'show', 'on', 'off', 'explode', 'sound', 'anim', 'animback', 'animstop', 'cutplay', 'cutstop', 'message', 'goal', 'note', 'flag',
  'count', 'travel', 'timerstart', 'timerstop', 'timerpause', 'timerresume', 'npcuse', 'effect', 'input', 'floor',
  // P4 (UCLink.DoMore)
  'skillpoints', 'credits', 'health', 'giveitem', 'takeitem', 'shake', 'fade', 'flash', 'flicker', 'lightcolour', 'lightbright',
  'patrol', 'ownorders', 'teleport', 'moveplayer', 'spawn', 'music', 'hurtzone', 'autosave', 'endgame', 'fillcrate', 'nextfloor',
  'animturn', 'cancel']);
// what a verb needs of its target (UCLink.DoAct): a class in its chain, true any object; without it, "cannot"
const NEEDS = { open: 'DeusExMover', close: 'DeusExMover', toggle: 'DeusExMover', key: 'DeusExMover', hide: true, show: true,
  on: true, off: true, effect: true, cutplay: 'UCCutscene', cutstop: 'UCCutscene', timerstart: 'UCTimer', timerstop: 'UCTimer',
  timerpause: 'UCTimer', timerresume: 'UCTimer', sit: 'ScriptedPawn', standup: 'ScriptedPawn',
  flicker: 'Light', lightcolour: 'Light', lightbright: 'Light', patrol: 'ScriptedPawn', ownorders: 'ScriptedPawn',
  fillcrate: 'Decoration' };
// what a tag action reaches (UCLink.TagKind): lights, doors or characters by its verb, else any object but the
// editor's own helpers
const DOOR_VERBS = new Set(['open', 'close', 'toggle', 'lock', 'unlock', 'blow']);
const CHARACTER_VERBS = new Set(['attack', 'hostile', 'friend', 'neutral', 'stand', 'wander', 'follow', 'goto', 'run', 'leave', 'appear']);
const HELPERS = ['UCObjectTag', 'UCLinkGroup', 'UCLink'];
const tagClass = (verb) => (verb.startsWith('light') ? 'Light' : DOOR_VERBS.has(verb) ? 'DeusExMover'
  : CHARACTER_VERBS.has(verb) ? 'ScriptedPawn' : null);
// what an area action reaches (UCLink.AreaKind): its kind's classes
const AREA_KINDS = { light: ['Light'], character: ['ScriptedPawn'], object: ['Decoration', 'Inventory', 'Mover'] };
const FLOORS = { ElevatorMover: 2, MultiMover: 4 };       // when the world does not say (S3)

// ---------------------------------------------------------------- what the user makes happen, as data
// what an output also changes in the world when it happens: the parts of the state it puts the thing in (true) or
// takes it out of (false): a character who dies is dead, an item picked up is owned, a cutscene that starts plays, has
// played (UCCutscene.bDone) and waits no more (bQueued)...
const CHANGES = { dies: [['dead', true]], destroyed: [['destroyed', true]], picked: [['owned', true]], gone: [['missing', true]],
  arrived: [['arrived', true]], cutstart: [['playing', true], ['played', true], ['queued', false]], cutdone: [['playing', false]],
  killed: [['dead', true]], knockedout: [['dead', true]] };
// who set an output off when the user does not say (UCLink.Who, UCLink.uc:224-239): the editor's own actors name
// themselves (a timer, a cutscene), the end of an animation its UCMotion (S4), a character's use nobody; JC otherwise
const SET_OFF_BY = { timer: 'itself', cut: 'itself', motion: 'motion', npcuse: 'nobody' };
// what an action leaves for the game to decide, offered (decisions) while a rule waits for it: the outputs it may lead
// to, of its target or of the object it names (on: 'a'), set off (by, as SET_OFF_BY says it) by that thing, by its
// target or by its motion (S4)
const SENT = ['goto', 'run', 'navgo', 'navrun'];
const LEADS_TO = { ...Object.fromEntries(SENT.map((v) => [v, { outputs: ['arrived'] }])), anim: { outputs: ['animdone'], by: 'motion' },
  animback: { outputs: ['animdone'], by: 'motion' }, open: { outputs: ['opened'] }, close: { outputs: ['closed'] },
  toggle: { outputs: ['opened', 'closed'] }, cutplay: { outputs: ['cutdone'] }, npcuse: { outputs: ['npcused'], on: 'a', by: 'target' },
  animturn: { outputs: ['animdone'], by: 'motion' }, unlock: { outputs: ['unlocked'] }, nextfloor: { outputs: ['atfloor'] } };
// the parts of the state (start, set): names whose values are merged one by one, and lists of names replaced whole
const MERGED = ['flags', 'counters', 'skills', 'at'];
const LISTS = ['dead', 'owned', 'missing', 'destroyed', 'arrived', 'playing', 'played', 'queued'];

const low = (s) => String(s ?? '').toLowerCase();
const int = (v) => parseInt(v, 10) || 0;                  // the game's int() of a text: its leading whole number
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const secs = (t) => `${+(+t).toFixed(2)} s`;

// ---------------------------------------------------------------- reading the compiled actors
// A string property as the game's T3D reader takes it (gametext.t3d undone): between quotes, \\ is one backslash and
// \hh the byte hh (a quote is \22); a name is written bare.
function t3dString(v) {
  const s = String(v ?? '');
  if (!s.startsWith('"')) return s;
  return s.slice(1, -1).replace(/\\(\\|[0-9A-Fa-f]{2})/g, (m, x) => (x === '\\' ? '\\' : String.fromCharCode(parseInt(x, 16))));
}
// an array property (Act(0), Act(1)...) as its `size` slots, '' where the T3D sets none
function slots(props, name, size) {
  const out = Array(size).fill('');
  for (const [key, v] of Object.entries(props)) {
    const m = /^(\w+)\((\d+)\)$/.exec(key);
    if (m && m[1] === name && +m[2] < size) out[+m[2]] = t3dString(v);
  }
  return out;
}
const upToEmpty = (list) => (list.includes('') ? list.slice(0, list.indexOf('')) : list);

// The game's names (FName) ignore case: a table of them keeps the spelling it first met.
function names(init) {
  const m = new Map();
  const table = {
    get: (n) => m.get(low(n))?.[1],
    has: (n) => m.has(low(n)),
    set(n, v) { m.set(low(n), [m.get(low(n))?.[0] ?? String(n), v]); },
    delete: (n) => m.delete(low(n)),
    get size() { return m.size; },
    plain: () => Object.fromEntries(m.values()),
    list: () => [...m.values()].map(([n]) => n),
  };
  for (const [n, v] of Object.entries(init || {})) table.set(n, v);
  return table;
}
const nameSet = (list) => names(Object.fromEntries((list || []).map((n) => [n, true])));

// The rules, groups, usable objects and scripting tags among the compiled actors, and the world, read once.
function setupOf({ actors, outputs, left, world, map, frame }) {
  const rules = [], groups = new Map(), usables = new Map(), tags = new Map();
  for (const a of actors || []) {
    const p = a.props || {};
    if (a.cls === 'UCLink' || a.cls === 'UCRule' || a.cls === 'UCRuleAlso') {
      const when = String(p.When || '');
      rules.push({ index: rules.length, id: t3dString(p.Rule) || a.name, name: a.name, tag: low(p.Tag), when, hears: outputs[when]?.hears || '',
        gameTag: outputs[when]?.hears === 'gametag' ? t3dString(p.Tag) : '',
        source: t3dString(p.Source), port: t3dString(p.Port), option: int(p.Option), near: p.NearDist === undefined ? 256 : +p.NearDist,
        once: p.bOnce === 'True', label: t3dString(p.Label), conds: slots(p, 'Cond', 8).filter(Boolean),
        steps: p.bSteps === 'True', stepConds: slots(p, 'StepCond', 16),
        acts: upToEmpty(slots(p, 'Act', 24)).map((s) => s.split('|')),
        watch: t3dString(p.Watch), watchProp: p.bWatchProp === 'True',
        // the Logic runtime v2 (UCRule): up to 8 runs, its options; a UCRuleAlso sets the UCRule called Main off
        v2: a.cls === 'UCRule', also: a.cls === 'UCRuleAlso', main: t3dString(p.Main), any: p.bAny === 'True',
        elseAt: p.ElseAt === undefined ? -1 : int(p.ElseAt), again: low(p.Again), maxRuns: int(p.MaxRuns),
        cooldown: parseFloat(p.Cooldown) || 0, talkBusy: low(p.TalkBusy), actIds: slots(p, 'ActId', 24) });
    } else if (a.cls === 'UCLinkGroup') groups.set(low(a.name), { members: upToEmpty(slots(p, 'Member', 128)), next: t3dString(p.NextGroup) });
    else if (a.cls === 'UCUsable') usables.set(low(t3dString(p.Target)), t3dString(p.UseEvent));
    // a scripting tag set by hand (UCObjectTag.Of); an automatic or original one is the world actor's own `tag`
    else if (a.cls === 'UCObjectTag' && p.bAuto !== 'True' && p.bOriginal !== 'True') tags.set(low(p.TargetName), t3dString(p.Value));
  }
  const order = (world.actors || []).map((a) => ({ ...a, chain: a.chain || [] }));
  return { rules, groups, usables, tags, outputs, left: left || [], map, frame, player: world.player || 'JC', order,
    byName: new Map(order.map((a) => [low(a.name), a])) };
}

// ---------------------------------------------------------------- one run of the map, from its start
function newRun(S) {
  const { rules, map, frame } = S;
  const st = { items: [], credits: 0, jc: null };
  for (const part of [...MERGED, ...LISTS]) st[part] = names();
  const rs = rules.map(() => ({ done: false, running: false, step: 0, waited: 0, wake: 0, asleep: false, hurry: false,
    runs: 0, slept: false, until: null,
    started: false, polled: false, was: false, door: null, deaf: false, streak: 0, last: -1,
    // v2: its runs (8 slots), how often it ran and when, the rate guard; a watched value's base; a pawn told apart
    slots: Array(RUNS).fill(null), fired: 0, lastFire: 0, rateStart: -Infinity, rateCount: 0, cur: null, base: undefined, pawn: null }));
  const pulses = names();                // P4 'prop' outputs the user said happened, for the rules' next look (S5)
  const timers = new Map(), scripts = new Map(), sent = names();
  let pending = [];                     // what is left for the user to decide: [{id, thing, output, by}]
  for (const a of S.order) {
    if (a.chain.includes('UCTimer')) timers.set(low(a.name), { running: false, paused: false, left: 0, total: 0, begun: false });
    if (a.chain.includes('UCScript')) scripts.set(low(a.name), { started: false, waiting: [] });
  }
  const lines = [];
  let tick = 0, turn = { kind: 'load' };

  // ---- the world
  const actorOf = (n) => S.byName.get(low(n));
  const nameOf = (n) => actorOf(n)?.name ?? n;
  const present = (n) => (!!n && low(n) === low(S.player)) || (!!actorOf(n) && !actorOf(n).absent && !st.missing.has(n));
  const isa = (n, cls) => !!actorOf(n)?.chain.includes(cls);
  const placeOf = (n) => st.at.get(n) || actorOf(n)?.at || null;
  const behaviour = (n) => actorOf(n)?.script || {};
  const matches = (n, wanted) => wanted === '' || low(S.tags.has(low(n)) ? S.tags.get(low(n)) : actorOf(n)?.tag) === low(wanted);
  const tagFor = (when, src, option = 0) => fill(S.outputs[when]?.tag || '', { src, option });
  const listens = (thing, output) => rules.some((r) => (low(r.source) === low(thing) && r.when === output)
    || (output === 'arrived' && r.steps && r.acts.some((s) => s[1] === 'until' && s[3] === 'arrived' && low(s[2]) === low(thing))));
  // who set an output of a thing off, as SET_OFF_BY and LEADS_TO say it: the thing itself, the action's target, the
  // thing's UCMotion (the world actor's `motion`, else the thing: S4) or nobody; undefined when they do not say (JC)
  const setOffBy = (how, thing, target) => ({ itself: thing, target, motion: actorOf(thing)?.motion || thing, nobody: '' })[how];
  // what UCEditorStory.Holds reads (conditions.js conditionHolds)
  const game = {
    flag: (n) => !!st.flags.get(n), counter: (n) => st.counters.get(n) || 0, skill: (n) => st.skills.get(n) ?? 0,
    carries: (cls) => st.items.some((i) => low(i) === low(cls)),
    alive: (n) => present(n) && !(isa(n, 'Pawn') && st.dead.has(n)),     // UCEditorStory.Dead: gone, or a pawn with no health
    get credits() { return st.credits; },
  };

  function change(c) {
    for (const [part, v] of Object.entries(c || {})) {
      if (MERGED.includes(part)) for (const [n, x] of Object.entries(v || {})) st[part].set(n, x);
      else if (LISTS.includes(part)) st[part] = nameSet(v);
      else if (part === 'items') st.items = [...(v || [])];
      else if (part === 'credits') st.credits = int(v);
      else if (part === 'jc') st.jc = v ? [...v] : null;
      else throw new Error(`No such part of the state: ${part}`);
    }
  }

  // ---- the log: one line as the game writes it, stamped with the tick (load: t = 0, A6) and the rule that wrote it
  const write = (rule, ...fields) => { lines.push({ t: Math.round(tick * frame * 1e6) / 1e6, line: fields.join('|'), rule }); };
  // UCLink.Report; a UCRule's names the game time and the step a run does (UCRule.Report, TimeText)
  const timeText = () => { const c = Math.floor(tick * frame * 100 + 1e-6); return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`; };
  function report(r, kind, ...rest) {
    if (!r.v2) return write(r.id, kind, map, r.id, ...rest);
    const run = rs[r.index].cur, id = run && kind !== 'fire' && kind !== 'skip' ? r.actIds[run.step] || '' : '';
    return write(r.id, kind, map, `${r.id}@${timeText()}${id ? '#' + id : ''}`, ...rest);
  }
  // each rule's lines, read (logic-log.js), with its counts: brought up to the end of the log when asked, each line read
  // once, so what the page asks after every step costs the new lines, not the whole log
  const mine = new Map(rules.map((r) => [r.id,
    { lines: [], counts: { fired: 0, once: 0, running: 0, cond: 0, acted: 0, failed: 0, last: null } }]));
  let indexed = 0;                      // the lines of the log read so far
  function ofRule(id) {
    for (; indexed < lines.length; indexed++) {
      const e = lines[indexed], m = mine.get(e.rule);
      if (!m) continue;                 // a line of no rule (a script's, a condition the game does not know)
      const entry = parseLogicLine(LOGIC_TAG + e.line), c = m.counts;
      m.lines.push({ ...e, entry });
      if (entry.kind === 'fire') { c.fired++; c.last = e.t; } else if (entry.kind === 'skip') c[entry.why]++;
      else if (entry.kind === 'act') c.acted++;
      else if (entry.kind === 'fail') c.failed++;
    }
    return mine.get(id);
  }

  // ---- telling a rule (UCLink.RunRule): once, then running, then its conditions in order; then it runs
  // a rule told now acts in this tick when its turn is still to come, or it is in its Tick, before its state code
  const before = (i) => turn.kind === 'load' || turn.kind === 'placed'
    || (turn.kind === 'rule' && (turn.index < i || (turn.index === i && turn.tickEvent)));
  function holdsNow(text) {
    const c = decodeCondition(text);
    if (!c) { write('', 'bad', map, '', text); return false; }
    return conditionHolds(c, game);
  }
  // the same, writing nothing (what is due next only asks)
  const holdsQuietly = (text) => { const c = decodeCondition(text); return !!c && conditionHolds(c, game); };
  // a 'changes' rule's value now (UCLink.WatchValue: "flag|Name" or "count|Name")
  function watchValue(watch) {
    const [kind, n] = String(watch).split('|');
    return kind === 'count' ? String(game.counter(n)) : game.flag(n) ? '1' : '0';
  }
  // a P4 'prop' output the user said happened, for the next look of the rules watching that thing (S5)
  const pulseKey = (thing, output) => `${low(thing)}|${output}`;
  function runRule(i, by) {
    const r = rules[i], x = rs[i];
    if (r.also) {                                    // UCRuleAlso.RunRule: its rule starts, with this cause's object
      const m = rules.findIndex((q) => q.v2 && low(q.name) === low(r.main));
      return m < 0 ? report(r, 'hook', r.main, 'missing') : start(m, by, r.source, r.when);
    }
    if (r.v2) return start(i, by, r.source, r.when);
    if (r.once && x.done) return report(r, 'skip', 'once', '');
    if (x.running) return report(r, 'skip', 'running', '');
    const refused = r.conds.find((c) => !holdsNow(c));
    if (refused !== undefined) return report(r, 'skip', 'cond', refused);
    x.done = true;
    report(r, 'fire', r.source, r.when, by || '', r.label);
    Object.assign(x, { running: true, step: 0, waited: 0, asleep: false, hurry: false, runs: 0, slept: false, until: null,
      wake: before(i) ? tick : tick + 1 });
    x.streak = x.last === tick ? x.streak : x.last === tick - 1 ? x.streak + 1 : 1;     // the loop guard's firing rate
    x.last = tick;
  }
  // UCRule.Start: the rate guard, once, max, cooldown, a run going on (again), 8 at most, its conditions (any or all):
  // a new run of its steps, or of its Otherwise, from its turn in this tick or the next; the log names the cause that
  // set it off (it, when: its own, or a UCRuleAlso's)
  const liveRuns = (x) => x.slots.filter(Boolean).length;
  function condsHold(r) {
    let some = false, failed = '';
    for (const c of r.conds) {
      some = true;
      const here = holdsNow(c);
      if (here && r.any) return { ok: true, failed: '' };
      if (!here && !failed) failed = c;
      if (!here && !r.any) return { ok: false, failed };
    }
    return { ok: !r.any || !some, failed };
  }
  function start(i, by, it, when) {
    const r = rules[i], x = rs[i], now = tick * frame;
    if (now - x.rateStart > 1 + 1e-9) { x.rateStart = now; x.rateCount = 0; }
    if (++x.rateCount > RATE) { if (x.rateCount === RATE + 1) report(r, 'fail', 'rule', '', 'fast'); return; }
    if (r.once && x.done) return report(r, 'skip', 'once', '');
    if (r.maxRuns > 0 && x.fired >= r.maxRuns) return report(r, 'skip', 'max', String(r.maxRuns));
    if (r.cooldown > 0 && x.fired > 0 && now - x.lastFire < r.cooldown - 1e-9) return report(r, 'skip', 'cooldown', r.cooldown.toFixed(2));
    const live = liveRuns(x);
    if (live > 0 && r.again !== 'restart' && r.again !== 'each') return report(r, 'skip', 'running', '');
    if (live >= RUNS && r.again === 'each') return report(r, 'skip', 'full', '');
    const { ok, failed } = condsHold(r);
    if (!ok && r.elseAt < 0) return report(r, 'skip', 'cond', failed);
    if (r.again === 'restart' && live > 0) { report(r, 'skip', 'restarted', ''); x.slots.fill(null); }
    const slot = Math.max(0, x.slots.indexOf(null));
    const run = { step: 0, wake: before(i) ? tick : tick + 1, slept: false, until: null, runs: 0, hurry: false, running: true,
      by: by || '', it: it || '' };
    if (ok) {
      x.done = true; x.fired++; x.lastFire = now;
      report(r, 'fire', it || '', when || '', by || '', r.label);
    } else {
      report(r, 'skip', 'cond', failed);
      report(r, 'else', it || '', when || '', by || '');
      run.step = r.elseAt;
    }
    x.slots[slot] = run;
    x.streak = x.last === tick ? x.streak : x.last === tick - 1 ? x.streak + 1 : 1;
    x.last = tick;
  }
  // "Stop a rule" (UCLink.CancelRule, StopRuns): every other rule of that id stops what it is doing
  function cancel(i, id) {
    let any = false;
    rules.forEach((q, j) => {
      if (j === i || q.also || low(q.id) !== low(id)) return;
      any = true;
      const x = rs[j];
      if (q.v2) { if (liveRuns(x)) report(q, 'skip', 'cancelled', ''); x.slots.fill(null); }
      else if (x.running) { report(q, 'skip', 'cancelled', ''); x.running = false; }
    });
    return any;
  }
  // UCLink.Trigger and UnTrigger on every rule waiting on this Tag, in their order (foreach AllActors with the Tag)
  function trigger(tag, other, by, how) {
    rules.forEach((r, i) => {
      if (r.tag !== low(tag) || rs[i].deaf || BY_UNTRIGGER.has(r.when) || r.hears === 'start' || WATCHED.has(r.hears)) return;
      if (DOOR_OUTPUTS.has(r.when) && isa(other, 'DeusExMover')) { rs[i].door = { name: other, by, at: before(i) ? tick : tick + 1 }; return; }
      if (PAWN_OUTPUTS.has(r.when)) { rs[i].pawn = { out: how === 'knockedout', by, at: before(i) ? tick : tick + 1 }; return; }
      if (r.when !== 'destroyed') runRule(i, by);
    });
  }
  function untrigger(tag, other, by) {
    rules.forEach((r, i) => {
      if (r.tag === low(tag) && !rs[i].deaf && (BY_UNTRIGGER.has(r.when) || (r.when === 'code' && isa(other, 'Keypad')))) runRule(i, by);
    });
  }
  // UCLink.Hurry: a skipped cutscene's start rules do what they still had to, at their next turn
  function hurry(tag) {
    rules.forEach((r, i) => {
      if (r.tag === low(tag) && rs[i].running) Object.assign(rs[i], { hurry: true, asleep: false, wake: before(i) ? tick : tick + 1 });
      if (r.tag === low(tag) && r.v2) {                // UCRule.Hurry: each of its runs
        for (const run of rs[i].slots) if (run) Object.assign(run, { hurry: true, wake: before(i) ? tick : tick + 1 });
      }
    });
  }

  // ---- scripts (UCScript): outputs said before the map has started wait (8 at most), then go after Started()'s
  function output(script, name) {
    let n = 0;
    rules.forEach((r, i) => {
      if (r.when === 'output' && low(r.source) === low(script) && low(r.port) === low(name)) { runRule(i, nameOf(script)); n++; }
    });
    write('', 'output', map, nameOf(script), name, String(n));
  }
  function sayOutput(script, name) {
    const s = scripts.get(low(script));
    startScript(script);
    if (s.started) return output(script, name);
    if (s.waiting.length < QUEUE) s.waiting.push(name);
    else write('', 'fail', map, '', 'output', nameOf(script), 'full');
  }
  function startScript(script) {
    const s = scripts.get(low(script));
    if (s.started || turn.kind === 'load') return;          // JC is not in the map yet
    s.started = true;
    for (const o of behaviour(script).started || []) sayOutput(script, o);
    const waiting = s.waiting.splice(0);
    for (const o of waiting) output(script, o);
  }

  // ---- timers (UCTimer), in whole ticks (A3)
  const ticksOf = (seconds) => Math.max(1, Math.round(seconds / frame));
  function timerDo(name, how, seconds) {
    const t = timers.get(low(name));
    if (how === 'start') {
      const total = ticksOf(Math.max(0.1, seconds > 0 ? seconds : actorOf(name).seconds ?? 30));
      Object.assign(t, { running: true, paused: false, total, left: total });
    } else if (how === 'stop' && t.running) {
      Object.assign(t, { running: false, paused: false, left: 0 });
      trigger(tagFor('stopped', name), name, nameOf(name));
    } else if (how === 'pause' && t.running) t.paused = true;
    else if (how === 'resume' && t.running) t.paused = false;
  }
  function timerTick(name) {
    const t = timers.get(low(name));
    if (!t.begun) { t.begun = true; if (actorOf(name).autostart) timerDo(name, 'start', 0); }
    if (!t.running || t.paused || --t.left > 0) return;
    if (actorOf(name).loop) t.left = Math.max(1, t.left + t.total);          // a loop starts again at once
    else Object.assign(t, { running: false, left: 0 });
    trigger(tagFor('finished', name), name, nameOf(name));
  }

  // ---- the actions (UCLink.DoAct): an act line, then what it does or why it cannot
  const drop = (output, thing) => { pending = pending.filter((d) => d.output !== output || low(d.thing) !== low(thing)); };
  // a decision for the user, whether or not a rule waits for it: the same one offered again replaces it
  function pend(thing, output, by) {
    drop(output, thing);
    pending.push({ id: `${output}:${nameOf(thing)}`, thing: nameOf(thing), output, by: nameOf(by) });
  }
  // what an action may lead to, offered only when some rule waits for it (nothing else would come of deciding it)
  function offer(thing, output, by) {
    if (listens(thing, output)) pend(thing, output, by);
  }
  function groupMembers(first) {
    const out = [], seen = new Set();
    for (let g = S.groups.get(low(first)); g && !seen.has(g); g = S.groups.get(low(g.next))) { seen.add(g); out.push(...g.members); }
    return out;
  }
  // UCLink.DoArea: the saved members of its kind, then (area+) what of its kind is within the radius now, each once
  function areaOf(r, f) {
    const kind = f[7] || '', wanted = f[13] || '', found = [];
    const fits = (n) => present(n) && low(n) !== low(r.source) && (AREA_KINDS[kind] || []).some((c) => isa(n, c)) && matches(n, wanted);
    const add = (n) => { if (!found.some((m) => low(m) === low(n))) found.push(nameOf(n)); };
    for (const n of groupMembers(f[12])) if (fits(n)) add(n);
    const radius = parseFloat(f[8]) || 0, center = [9, 10, 11].map((k) => parseFloat(f[k]) || 0);
    if (f[6] === 'area+' && radius > 0) {
      for (const a of S.order) if (fits(a.name) && placeOf(a.name) && dist(placeOf(a.name), center) <= radius) add(a.name);
    }
    return found;
  }
  // UCLink.DoTag: what has the scripting tag and can do the verb, in the map's order, never the rule's own object
  const tagged = (r, verb, wanted) => S.order.map((a) => a.name).filter((n) => present(n) && low(n) !== low(r.source)
    && !HELPERS.some((c) => isa(n, c)) && (!tagClass(verb) || isa(n, tagClass(verb))) && matches(n, wanted));
  function doAct(i, f) {
    const r = rules[i], field = (k) => f[k] ?? '';
    if (field(6) === 'group' || field(6) === 'area+' || field(6) === 'tag') {
      const many = field(6) === 'tag' ? (field(7) ? tagged(r, field(1), field(7)) : []) : areaOf(r, f);
      report(r, 'act', field(1), `${field(6) === 'tag' ? 'tag' : 'area'} ${field(7)}`);
      for (const n of many) doAct(i, ['0', field(1), n, field(3), field(4), field(5)]);       // UCLink.RunRecipients
      return;
    }
    const run = rs[i].cur;                             // UCRule.DoAct: "@by" what set the run off, "@it" what it happened to
    const named = field(2);
    const [verb, target, a, b, c] = [1, 2, 3, 4, 5].map((k) => (k === 2 && run && low(named) === '@by' ? run.by
      : k === 2 && run && low(named) === '@it' ? run.it : field(k)));
    const fail = (why, what = target) => report(r, 'fail', verb, what, why);
    report(r, 'act', verb, target, a);
    if (target !== '' && !present(target)) return fail('missing');
    const T = target === '' ? null : target, need = NEEDS[verb];
    if (!VERBS.has(verb) || (need && !(T && (need === true || isa(T, need))))) return fail('cannot');
    switch (verb) {
      // Path finding and free seat slots are checked by the game, not this logic-only simulation.
      case 'sit': return a && present(a) && isa(a, 'Seat') ? undefined : fail('seat unavailable or unsupported character');
      case 'flag': return a === '' ? fail('noname', '') : st.flags.set(a, b !== '0');
      case 'goal': return a === '' ? fail('noname', '') : undefined;
      case 'count': return a === '' ? fail('noname', '') : st.counters.set(a, (c === 'set' ? 0 : st.counters.get(a) || 0) + int(b));
      case 'timerstart': case 'timerstop': case 'timerpause': case 'timerresume': return timerDo(T, verb.slice(5), parseFloat(a) || 0);
      case 'input': return T && isa(T, 'UCScript') ? scriptInput(T, a, b) : fail('noscript');
      case 'floor': return floor(T, int(a), fail);
      case 'on': case 'off': return switchScript(T, verb);
      case 'blow': return blow(T);
      case 'cutplay': return playCut(T);
      case 'cutstop': return stopCut(T);
      case 'animstop': return drop('animdone', T);
      // P4: what changes what the conditions read; what the game decides; a rule stopped
      case 'credits': st.credits = Math.max(0, st.credits + int(a)); return undefined;
      case 'giveitem': if (a && !game.carries(a)) st.items.push(a); return undefined;
      case 'takeitem': st.items = st.items.filter((x) => low(x) !== low(a)); return undefined;   // (one of each is all it keeps)
      case 'nextfloor': if (!Object.keys(FLOORS).some((k) => T && isa(T, k))) return fail('cannot', T ? nameOf(T) : '');
        return leadsTo(verb, T, a, [a, b, c]);
      case 'cancel': return cancel(i, a) ? undefined : fail('cannot', '');
      default: return leadsTo(verb, T, a, [a, b, c]);
    }
  }
  function scriptInput(script, name, args) {        // UCLink.ScriptInput, then UCScript.Input as the world says (A9)
    write('', 'input', map, nameOf(script), name, args);
    startScript(script);
    const said = behaviour(script).input || {};
    if (!Object.hasOwn(said, name)) return write('', 'noinput', map, nameOf(script), name);
    for (const o of said[name]) sayOutput(script, o);
  }
  function switchScript(T, verb) {                   // Trigger / UnTrigger: a script starts, and says what the world says
    if (!scripts.has(low(T))) return;
    startScript(T);
    for (const o of behaviour(T)[verb === 'on' ? 'triggered' : 'untriggered'] || []) sayOutput(T, o);
  }
  function floor(T, n, fail) {                       // UCLink.Floor: SetSeq on an elevator that has that floor
    const kind = Object.keys(FLOORS).find((k) => T && isa(T, k));
    if (!kind) return fail('cannot', T ? nameOf(T) : '');
    if (n < 0 || n >= (actorOf(T).floors ?? FLOORS[kind])) fail('nofloor', nameOf(T));
  }
  function blow(T) {                                 // DoorDo 4: BlowItUp triggers the door's event, then it is destroyed
    if (!isa(T, 'DeusExMover') || st.destroyed.has(T)) return;
    st.destroyed.set(T, true);
    trigger(tagFor('destroyed', T), T, nameOf(T));
  }
  // ---- cutscenes (UCCutscene)
  // what Play refuses at once (UCCutscene.uc:94-95): a cutscene that plays, one that has played and plays only once
  // (bOnce: the editor's default; the world actor's `once: false` plays again), one with no camera keys (`keys`: 0)
  const playRefused = (T) => st.playing.has(T) || (st.played.has(T) && actorOf(T).once !== false) || actorOf(T).keys === 0;
  // UCCutscene.Play: while another plays it waits (CanStart, Busy: 82-86, 99-104) for its own Tick to start it
  // (cutTick); started, it triggers its start rules (165) and its end is the user's to decide. That end is offered
  // even when no rule waits for it: in the game it comes by itself after the cutscene's length, and a cutscene that
  // waits behind this one starts only then, so without it that one would wait for ever
  function playCut(T) {
    if (playRefused(T)) return;
    if (st.playing.size) { st.queued.set(T, true); return; }
    deliver({ thing: T, output: 'cutstart' });
    pend(T, 'cutdone', T);
  }
  // UCCutscene.Stop (178-183): it waits no more; playing, it ends as skipped (Finish(True, False)): its start rules do
  // what they still had to (Hurry, 242-244), then its end rules are told (290)
  function stopCut(T) {
    st.queued.delete(T);
    if (st.playing.has(T)) deliver({ thing: T, output: 'cutdone', skip: true });
  }
  // UCCutscene.Tick (189-193), in the map's part of the tick: one that waits starts once no other plays
  function cutTick(T) {
    if (st.queued.has(T) && !st.playing.size) playCut(T);
  }
  // whether a cutscene that waits starts in the next tick (nextDue)
  const queuedStarts = () => !st.playing.size && st.queued.list().some((T) => present(T) && isa(T, 'UCCutscene') && !playRefused(T));
  function leadsTo(verb, T, a, abc) {
    const lead = LEADS_TO[verb];
    if (!lead || !T) return;
    if (SENT.includes(verb)) { st.arrived.delete(T); sent.set(T, abc.map((v) => parseFloat(v) || 0)); }
    const thing = lead.on === 'a' ? a : T;
    for (const o of lead.outputs) offer(thing, o, setOffBy(lead.by || 'itself', thing, T));
  }

  // ---- an output of a thing happens, the way the game hears it (config/logic.json hears, tag), in the turn it happens
  // in: what it changes in the world, then the rules waiting for it
  function deliver(h) {
    const e = S.outputs[h.output];
    if (!e) throw new Error(`No output "${h.output}" in the catalogue`);
    // an event of the game itself (a trigger, the console's causeevent): it triggers what has its Tag, no object needed
    if (e.hears === 'gametag') { trigger(h.tag || h.thing, '', h.by ?? S.player); return; }
    if (e.hears === 'start' || !present(h.thing)) return;    // the map starts by itself; what is not there says nothing
    const thing = nameOf(h.thing), by = h.by ?? setOffBy(SET_OFF_BY[e.hears], thing) ?? S.player;
    for (const [part, into] of CHANGES[h.output] || []) { if (into) st[part].set(thing, true); else st[part].delete(thing); }
    if (h.output === 'arrived' && sent.has(thing)) st.at.set(thing, sent.get(thing));
    if (h.output === 'near') st.jc = placeOf(thing) && [...placeOf(thing)];
    if (e.hears === 'timer' && timers.has(low(thing))) Object.assign(timers.get(low(thing)), { running: false, paused: false, left: 0 });
    drop(h.output, thing);
    if (h.skip) hurry(tagFor('cutstart', thing));
    if (e.hears === 'watch') return;                         // its rules' next look notices it
    if (e.hears === 'prop') { pulses.set(pulseKey(thing, h.output), true); return; }   // so does a property's (S5)
    if (e.hears === 'becomes' || e.hears === 'changes') return;   // they read the state, which the user sets
    if (e.hears === 'port') return scripts.has(low(thing)) ? sayOutput(thing, h.port || '') : undefined;
    const tag = (h.output === 'used' && S.usables.get(low(thing))) || tagFor(h.output, thing, int(h.option));
    if (UNTRIGGERED.has(h.output)) untrigger(tag, thing, by);
    else trigger(tag, thing, by, h.output);                  // (a death: killed or knocked out, PAWN_OUTPUTS)
  }

  // ---- the turns
  // the rule's state code (state Running), from where it stopped: each action after its delay, counted from the start
  // (Sleep for what is left, whole ticks; Waited = Delay once the Sleep is over, so a Hurry that cuts it short leaves
  // Waited as it was), then out of Running in the same turn
  // A rule of steps (UCLink bSteps, state Running): each step after its delay from the one before (Sleep), then the
  // step itself: a check goes on or jumps (CheckStep), a jump jumps, a wait has only its delay, an until is looked at
  // every 0.25 s until what it waits for is so or its time is up (UntilDone), any other step is an action; 256 steps
  // in one run end it (a loop with no wait)
  const STEP_LOOK = 0.25;
  // a UCRule: each of its runs in the order of its slots (UCRule.Tick, Advance), the same steps as a UCLink's
  function rulesCode(i) {
    const x = rs[i];
    x.slots.forEach((run, k) => {
      if (!run) return;
      x.cur = run;
      stepsCode(i, run);
      x.cur = null;
      if (!run.running && x.slots[k] === run) x.slots[k] = null;
    });
  }
  function stepsCode(i, x = rs[i]) {
    const r = rules[i];
    while (x.running && x.wake <= tick) {
      const s = r.acts[x.step];
      if (!s || x.step < 0) { x.running = false; return; }
      if (x.until) {
        if (!untilDone(r, x, s)) { x.wake = tick + Math.max(1, Math.round(STEP_LOOK / frame)); return; }
        Object.assign(x, { until: null, slept: false });
        x.step++;
        continue;
      }
      if (!x.slept) {
        if (++x.runs > 256) { report(r, 'fail', 'steps', '', 'loop'); x.running = false; return; }
        x.slept = true;
        const delay = parseFloat(s[0]) || 0;
        if (!x.hurry && delay > 0) { x.wake = tick + Math.max(1, Math.ceil(delay / frame - 1e-6)); continue; }
      }
      x.slept = false;
      if (s[1] === 'until') { x.until = { start: tick }; continue; }
      x.step = doStep(i, r, x, s);
    }
  }
  const stepIndex = (v, r) => (v === '' || v === 'stop' ? r.acts.length : int(v));
  function doStep(i, r, x, s) {
    if (s[1] === 'check') {
      const any = s[2] === 'any', k = int(s[3]), n = int(s[4]);
      let ok = !any || n <= 0, failed = '';
      for (let j = k; j < k + n && j < 16; j++) {
        const c = r.stepConds[j] || '', here = !c || holdsNow(c);
        if (here && any) ok = true;
        if (!here && !failed) failed = c;
        if (!here && !any) ok = false;
      }
      if (ok) { report(r, 'check', 'pass', String(x.step)); return x.step + 1; }
      report(r, 'check', 'fail', String(x.step), failed);
      return stepIndex(s[5], r);
    }
    if (s[1] === 'jump') return stepIndex(s[4], r);
    if (s[1] !== 'wait') doAct(i, s);
    return x.step + 1;
  }
  function untilDone(r, x, s) {
    const most = parseFloat(s[4]) || 0, c = r.stepConds[int(s[5])] || '';
    const done = x.hurry || (s[3] === 'arrived' ? present(s[2]) && !st.dead.has(s[2]) && st.arrived.has(s[2]) : !c || holdsNow(c));
    if (done) { report(r, 'until', 'done', String(x.step), s[2] || ''); return true; }
    if (most > 0 && (tick - x.until.start) * frame >= most - 1e-9) { report(r, 'until', 'timeout', String(x.step), s[2] || ''); return true; }
    return false;
  }
  function stateCode(i) {
    const r = rules[i], x = rs[i];
    if (r.v2) { rulesCode(i); return; }
    if (r.also) return;
    if (r.steps) { stepsCode(i); return; }
    while (x.running && x.wake <= tick) {
      const delay = parseFloat(r.acts[x.step]?.[0]) || 0;
      if (x.asleep) x.waited = delay;
      else {
        if (x.step >= r.acts.length) { x.running = false; return; }
        if (!x.hurry && delay > x.waited) {
          Object.assign(x, { asleep: true, wake: tick + Math.max(1, Math.ceil((delay - x.waited) / frame - 1e-6)) });
          continue;
        }
      }
      x.asleep = false;
      doAct(i, r.acts[x.step]);
      x.step++;
    }
  }
  // what a rule watches is so now (UCLink.TickStory)
  function watching(r) {
    const src = r.source;
    switch (r.when) {
      case 'arrived': return present(src) && !st.dead.has(src) && st.arrived.has(src);
      case 'near': return present(src) && !!st.jc && !!placeOf(src) && dist(st.jc, placeOf(src)) <= r.near;
      case 'picked': return !present(src) || (isa(src, 'Inventory') && st.owned.has(src));
      default: return !present(src);
    }
  }
  // UCEditorStory.Timer: not while a cutscene plays (JC is a camera); the map's start once, then what it watches,
  // the first look only noting it
  function look(i) {
    const r = rules[i], x = rs[i];
    if (st.playing.size) return;
    if (!x.started) { x.started = true; if (r.hears === 'start') runRule(i, ''); }
    if (r.hears === 'prop' || r.hears === 'becomes' || r.hears === 'changes') return lookWatch(i);
    if (r.hears !== 'watch') return;
    const now = watching(r);
    if (!x.polled) {
      Object.assign(x, { polled: true, was: now });
      if (now && r.when !== 'near' && r.when !== 'arrived') report(r, 'hook', r.source, 'missing');
      return;
    }
    if (now && !x.was) runRule(i, '');
    x.was = now;
  }
  // UCLink.TickWatch: a value that changed since the last look ('changes', the first look takes it as the base); a
  // condition that became so ('becomes'); a property's test (P4 'prop': so at the look after the user said it, S5),
  // every look while so for a fall (" down": hurt, damaged at all), else when it becomes so. The first look only notes
  function lookWatch(i) {
    const r = rules[i], x = rs[i];
    if (r.hears === 'changes') {
      const v = watchValue(r.watch);
      if (!x.polled) { Object.assign(x, { polled: true, base: v }); return; }
      if (v !== x.base) { x.base = v; runRule(i, ''); }
      return;
    }
    const thing = r.source || S.player;
    const now = r.hears === 'becomes' ? holdsNow(r.watch) : present(thing) && pulses.has(pulseKey(thing, r.when));
    if (!x.polled) {
      Object.assign(x, { polled: true, was: now });
      if (r.hears === 'prop' && r.source && !present(r.source)) report(r, 'hook', r.source, 'missing');
      return;
    }
    if (now && (!x.was || r.watch.includes(' down'))) runRule(i, r.hears === 'becomes' ? '' : nameOf(thing));
    x.was = now;
  }
  // would a watched rule's next look set it off (what is due next)
  function watchDue(r, x) {
    if (!x.polled) return false;
    if (r.hears === 'changes') return watchValue(r.watch) !== x.base;
    if (r.hears === 'becomes') return holdsQuietly(r.watch) && !x.was;
    return pulses.has(pulseKey(r.source || S.player, r.when));
  }
  const lookTick = (k) => k > 0 && Math.floor(k * frame / LOOK + 1e-6) > Math.floor((k - 1) * frame / LOOK + 1e-6);
  function ruleTurn(i) {
    const r = rules[i], x = rs[i];
    turn = { kind: 'rule', index: i, tickEvent: true };
    if (x.door && x.door.at <= tick) {               // its Tick: which of the door's outputs it was (S1)
      const d = x.door;
      x.door = null;
      if ((r.when === 'destroyed') === st.destroyed.has(d.name)) runRule(i, d.by);
    }
    if (x.pawn && x.pawn.at <= tick) {               // its Tick: killed, or knocked out (UCLink.PawnTold)
      const p = x.pawn;
      x.pawn = null;
      if ((r.when === 'knockedout') === p.out) runRule(i, p.by);
      else report(r, 'skip', 'how', r.when);
    }
    turn.tickEvent = false;
    stateCode(i);
    if (lookTick(tick)) look(i);
  }
  // UCLink.Hook as the map loads: a rule on an object that is not there, or that aims its event, never hears it
  function hook(i) {
    const r = rules[i];
    if (!r.source || !HOOKED.has(r.hears) || (r.when === 'used' && S.usables.has(low(r.source)))) return;
    if (!present(r.source)) { rs[i].deaf = true; report(r, 'hook', r.source, 'missing'); }
    else if (AIMS.some((c) => isa(r.source, c)) || (isa(r.source, 'MoreTriggers') && r.when !== 'leave')) {
      rs[i].deaf = true;
      report(r, 'hook', r.source, 'target');
    }
  }

  const run = {
    st, rs, lines, timers, scripts,
    get pending() { return pending; },
    get tick() { return tick; },
    // PostBeginPlay, in the map's order: what scripts say while it loads, then each rule hooks itself (t = 0, A6)
    load() {
      turn = { kind: 'load' };
      for (const a of S.order) {
        if (scripts.has(low(a.name)) && present(a.name)) for (const o of behaviour(a.name).loading || []) sayOutput(a.name, o);
      }
      rules.forEach((r, i) => hook(i));
    },
    // one tick: the map's objects (scripts start, timers count, a cutscene that waits starts), then the rules; JC's
    // part is what happen() adds
    play(k) {
      tick = k;
      turn = { kind: 'placed' };
      for (const a of S.order) {
        if (!present(a.name)) continue;
        if (scripts.has(low(a.name))) startScript(a.name);
        if (timers.has(low(a.name))) timerTick(a.name);
        if (isa(a.name, 'UCCutscene')) cutTick(a.name);
      }
      rules.forEach((r, i) => ruleTurn(i));
      if (lookTick(k)) for (const key of pulses.list()) pulses.delete(key);   // a property's output: one look (S5)
      turn = { kind: 'jc' };
    },
    change(c) { turn = { kind: 'jc' }; change(c); },
    // an output of a thing happens in JC's part (deliver)
    happen(h) {
      turn = { kind: 'jc' };
      deliver(h);
    },
    // the next tick at which something is due by itself: an action, a timer, a door, the start, a watch that changed,
    // a cutscene that waits
    nextDue() {
      const due = [];
      rs.forEach((x, i) => {
        if (x.running) due.push(Math.max(x.wake, tick + 1));
        for (const s of x.slots) if (s?.running) due.push(Math.max(s.wake, tick + 1));     // a UCRule's runs
        if (x.door) due.push(Math.max(x.door.at, tick + 1));
        if (x.pawn) due.push(Math.max(x.pawn.at, tick + 1));
        const r = rules[i];
        if ((r.hears === 'start' && !x.started) || (r.hears === 'watch' && x.polled && watching(r) !== x.was)
          || ((r.hears === 'prop' || r.hears === 'becomes' || r.hears === 'changes') && watchDue(r, x))) {
          let k = tick + 1;
          while (!lookTick(k)) k++;
          due.push(k);
        }
      });
      for (const t of timers.values()) if (t.running && !t.paused) due.push(tick + Math.max(1, t.left));
      if (queuedStarts()) due.push(tick + 1);
      return due.length ? Math.min(...due) : null;
    },
    present, nameOf, ofRule,
  };
  return run;
}

// ---------------------------------------------------------------- the session
// A Try-it session on a map's compiled logic:
//   actors, outputs, left   what logic_compile.compiled gives (/api/logic/compile): the compiled actors, how each
//                           output is heard (config/logic.json's outputs serve too), the rules left out of the game
//   world                   {player: JC's actor name, actors: [{name, chain (its class first), at, tag, seconds, loop,
//                           autostart, floors, ports, script: {input, started, loading, triggered, untriggered}, once
//                           and keys (a cutscene's bOnce, false to play again, and how many camera keys it has),
//                           motion (an animated object's UCMotion actor, motions.blocks), absent}]} in the map's order
//                           (tests/fixtures/logic/README.md, "Format")
//   start                   the state at t = 0: flags, counters, items, credits, skills, dead, owned, missing, jc,
//                           playing, played and queued (cutscenes)...
//   map, frame              the map's name in the lines, seconds per tick
//   vocab, ctx              logic-vocab.js's vocabulary and the page's context (its ctx), for the sentences of why()
//                           and decisions(); without them things are named plainly
//   loopTicks               the loop guard: a rule that fires in every tick for this many stops step() (0: never)
// It starts played to t = 0. What happens is kept with its tick, so the clock can go back (scrub) and forward again.
export function createSession({ actors = [], outputs = {}, left = [], world = {}, start = {}, map = 'Map', frame = 0.1,
  vocab = null, ctx = {}, loopTicks } = {}) {
  const S = setupOf({ actors, outputs, left, world, map, frame });
  if (S.rules.length && !Object.keys(outputs).length) throw new Error('A session needs how each output is heard (outputs)');
  const guard = loopTicks ?? Math.round(1 / frame);
  // a script's port as it names it ('output:<Id>', 'input:<Id>'), for the sentences
  function portLabel(n, key) {
    const [side, id] = key.split(':'), ports = S.byName.get(low(n))?.ports || {};
    return (ports[side === 'input' ? 'inputs' : 'outputs'] || []).find((p) => p.id === id)?.label || id;
  }
  const words = { name: (n) => n, usable: (n) => S.usables.has(low(n)), portLabel, ...ctx };
  let run, history = [];                // what happened: [{tick, input: {fire} or {set}}]

  const at = (k) => Math.round(k * frame * 1e6) / 1e6;
  const here = () => ({ t: at(run.tick), stopped: null });
  const apply = (input) => (input.fire ? run.happen(input.fire) : run.change(input.set));
  // a tick, then what happened in JC's part of it
  function playTo(k) {
    run.play(k);
    for (const h of history) if (h.tick === k) apply(h.input);
  }
  // the map again from its start (the start state, the loading) up to tick k
  function rebuild(k) {
    run = newRun(S);
    run.change(start);
    run.load();
    for (let j = 0; j <= k; j++) playTo(j);
  }
  // something happens now, in JC's part: what was kept after now (the clock went back) is dropped, a new branch.
  // The lines it wrote.
  function happen(input) {
    const from = run.lines.length;
    history = history.filter((h) => h.tick <= run.tick);
    history.push({ tick: run.tick, input });
    apply(input);
    return run.lines.slice(from).map(({ t, line }) => ({ t, line }));
  }

  // ---- the clock
  // the rules that have just fired in every tick for as long as the guard says
  const looping = () => (guard > 0 ? S.rules.filter((r, i) => run.rs[i].last === run.tick && run.rs[i].streak === guard).map((r) => r.id) : []);
  function step(n = 1) {
    for (let j = 0; j < n; j++) {
      playTo(run.tick + 1);
      const rules = looping();
      if (rules.length) {
        return { t: at(run.tick), stopped: { why: 'loop', rules, text: `${rules.join(', ')} fired in every tick for ${secs(guard * frame)}: `
          + 'rules that set each other off with no delay go round for ever, in the game too. Stopped here: step on to go on.' } };
      }
    }
    return here();
  }
  function scrub(t) {
    const k = Math.max(0, Math.round(t / frame));
    if (k > run.tick) return step(k - run.tick);
    if (k < run.tick) rebuild(k);
    return here();
  }
  // to what is next due by itself (an action, a timer, a door, a look), a minute on at most
  function runToNext() {
    const k = run.nextDue();
    return k === null ? { ...here(), idle: true } : step(Math.min(k, run.tick + Math.round(60 / frame)) - run.tick);
  }

  // ---- what it reads
  function decisions() {
    return run.pending.flatMap((d) => [{ ...d, text: `${words.name(d.thing)}: ${vocab ? vocab.outputLabel(d.output) : d.output}` },
      ...(d.output === 'cutdone' ? [{ ...d, id: `skip:${d.thing}`, skip: true, text: `JC skips ${words.name(d.thing)}` }] : [])]);
  }
  function decide(id) {
    const d = decisions().find((x) => x.id === id);
    return d ? happen({ fire: { thing: d.thing, output: d.output, by: d.by, ...(d.skip ? { skip: true } : {}) } }) : [];
  }
  function state() {
    const st = run.st;
    return { t: at(run.tick), ...Object.fromEntries(MERGED.map((p) => [p, st[p].plain()])),
      ...Object.fromEntries(LISTS.map((p) => [p, st[p].list()])), items: [...st.items], credits: st.credits, jc: st.jc && [...st.jc],
      rules: Object.fromEntries(S.rules.map((r, i) => [r, run.rs[i]]).filter(([r]) => !r.also).map(([r, x]) => {
        if (!r.v2) return [r.id, { done: x.done, running: x.running, step: x.step, next: x.running ? at(x.wake) : null }];
        // a UCRule (its other causes are part of it): its runs going on, the first one's step, the next due
        const live = x.slots.filter((s) => s?.running);
        return [r.id, { done: x.done, running: live.length > 0, step: live[0]?.step ?? 0, runs: live.length,
          next: live.length ? at(Math.min(...live.map((s) => s.wake))) : null }];
      })),
      timers: Object.fromEntries([...run.timers].map(([k, t]) => [run.nameOf(k), { running: t.running, paused: t.paused, left: at(t.left) }])),
      scripts: Object.fromEntries([...run.scripts].map(([k, s]) => [run.nameOf(k), { started: s.started, waiting: [...s.waiting] }])) };
  }
  // the lines a rule wrote, read (logic-log.js), and its counts: the run keeps them (newRun, ofRule)
  const linesOf = (id) => run.ofRule(id)?.lines || [];
  const counts = () => Object.fromEntries(S.rules.map((r) => [r.id, { ...run.ofRule(r.id).counts }]));
  function happenings() {
    const out = [];
    for (const r of S.rules) {
      // the thing that says it: the rule's object; the player for one of his (his health); the game's event by its
      // name. A condition that becomes so, a value that changes: the State panel, not a button
      const thing = r.hears === 'gametag' ? r.gameTag : r.source || (r.hears === 'prop' ? S.player : '');
      if (!thing || r.hears === 'start' || r.hears === 'becomes' || r.hears === 'changes') continue;
      const same = (h) => low(h.thing) === low(thing) && h.output === r.when && h.option === r.option && low(h.port) === low(r.port);
      let h = out.find(same);
      if (!h) out.push(h = { thing, output: r.when, option: r.option, port: r.port, near: r.near, rules: [],
        watched: r.hears === 'watch' || r.hears === 'prop', present: r.hears === 'gametag' || run.present(thing) });
      h.rules.push(r.id);
    }
    return out;
  }

  // ---- why didn't it fire?
  const whenText = (r) => (vocab ? vocab.whenText({ src: r.source, when: r.when, option: r.option, near: r.near, port: r.port }, words)
    : `When ${r.source ? `${words.name(r.source)}: ` : ''}${r.when}`);
  const condText = (c) => conditionText(c, { actor: words.name, item: words.itemName, state: words.state });
  const said = (e) => partsText(logicSentence(e.entry).parts).trim();
  // the rules whose actions set the state (or change the counter) a refused condition reads, and whether they had
  // done it by the time t
  function setters(c, t) {
    const kind = kindOf(c);
    if (kind !== 'flag' && kind !== 'counter') return ' That is up to the game: change it in the State panel to try it.';
    const name = kind === 'flag' ? c.flag : c.counter, verb = kind === 'flag' ? 'flag' : 'count';
    const sets = (f) => f[1] === verb && low(f[3]) === low(name) && (kind === 'counter' || (f[4] !== '0') === (c.is !== false));
    const who = S.rules.filter((r) => r.acts.some(sets)).map((r) => r.id);
    const what = kind === 'flag' ? `${name} to ${c.is === false ? 'No' : 'Yes'}` : `the counter ${name}`;
    if (!who.length) return ` No rule sets ${what} (the Story or the game may): to try it, set it in the State panel.`;
    const done = who.flatMap(linesOf)
      .filter((e) => e.t <= t && e.entry.kind === 'act' && e.entry.verb === verb && low(e.entry.detail) === low(name));
    const ran = [...new Set(done.map((e) => e.rule))].join(', ');
    if (!done.length) return who.length === 1 ? ` Only ${who[0]} sets ${what}, and it had not done it by then.`
      : ` ${who.join(', ')} set ${what}, and none of them had done it by then.`;
    return kind === 'flag' ? ` ${ran} had set ${what} before then: something set it back since.`
      : ` ${ran} had changed ${what} ${done.length} time${done.length === 1 ? '' : 's'} by then: not enough.`;
  }
  // when it was never set off: its object is not there, the map has not started, or what it waits for did not happen
  function never(r, x) {
    if (r.source && !run.present(r.source)) return `${words.name(r.source)} is not in the map.`;
    if (r.hears === 'start') {
      return x.started ? 'It was refused at the start.' : `The map has not started yet: its first look is at ${secs(LOOK)}.`;
    }
    return `"${whenText(r)}" never happened in this session.${WATCHED.has(r.hears)
      ? ' It is looked at every half second, and the first look only notes what is already so: it has to become so after.' : ''}`;
  }
  // [{why, t, text}], why: left, unknown, hook, never, once, running, cond, fired, fail, now
  function why(id) {
    const i = S.rules.findIndex((r) => r.id === id);
    if (i < 0) {
      const l = S.left.find((x) => x.id === id);
      return [l ? { why: 'left', t: null, text: `${id} is not in the game: ${l.text}.` }
        : { why: 'unknown', t: null, text: `There is no rule ${id} in the compiled logic: rebuild it, or check its id.` }];
    }
    const r = S.rules[i], x = run.rs[i], mine = linesOf(id), out = [];
    const of = (kind, reason) => mine.filter((e) => e.entry.kind === kind && (!reason || e.entry.why === reason));
    const fires = of('fire'), once = of('skip', 'once'), busy = of('skip', 'running'), refused = of('skip', 'cond');
    for (const e of of('hook')) out.push({ why: 'hook', t: e.t, text: `${said(e)}.` });
    if (!fires.length && !mine.some((e) => e.entry.kind === 'skip') && !out.length) out.push({ why: 'never', t: null, text: never(r, x) });
    if (once.length) {
      out.push({ why: 'once', t: once.at(-1).t, text: `It had already run (at ${secs(fires[0]?.t ?? 0)}) and runs only once: `
        + `it was refused ${once.length} time${once.length === 1 ? '' : 's'} after.` });
    }
    if (busy.length) {
      const takes = parseFloat(r.acts.at(-1)?.[0]) || 0;
      out.push({ why: 'running', t: busy.at(-1).t, text: `It was still doing its actions (they take ${secs(takes)}) when it was set off `
        + `again at ${secs(busy.at(-1).t)}: a rule that is running ignores that.` });
    }
    for (const detail of new Set(refused.map((e) => e.entry.detail))) {
      const t = refused.filter((e) => e.entry.detail === detail).at(-1).t, c = decodeCondition(detail);
      out.push({ why: 'cond', t, text: `It heard it at ${secs(t)}, but "${c ? condText(c) : detail}" did not hold.${c ? setters(c, t) : ''}` });
    }
    if (fires.length) {
      const times = fires.length === 1 ? 'once' : `${fires.length} times`;
      out.push({ why: 'fired', t: fires.at(-1).t, text: `It ran ${times}, the last at ${secs(fires.at(-1).t)}.` });
    }
    for (const line of new Set(of('fail').map((e) => e.line))) {
      const e = of('fail').filter((f) => f.line === line).at(-1);
      out.push({ why: 'fail', t: e.t, text: `An action of it failed at ${secs(e.t)}: ${said(e)}.` });
    }
    if (x.running) out.push({ why: 'now', t: null, text: `It is doing its actions now: the next at ${secs(at(x.wake))}.` });
    const live = r.v2 ? x.slots.filter((s) => s?.running) : [];
    if (live.length) {
      out.push({ why: 'now', t: null, text: `${live.length === 1 ? 'It is doing its actions now' : `${live.length} runs of it are going on now`}: `
        + `the next action at ${secs(at(Math.min(...live.map((s) => s.wake))))}.` });
    }
    return out;
  }

  rebuild(0);
  return {
    get t() { return at(run.tick); },
    frame, map,
    // an output of a thing happens now ({thing, output, by, option, port}; by: JC when not said); a watched one changes
    // the world (JC comes near it, picks it up...) and its rules notice at their next look. The lines it wrote.
    fire: (h) => happen({ fire: { ...h } }),
    // the world changes now: the parts of the state given (flags, counters, skills and places merged name by name)
    set: (c) => happen({ set: c }),
    // what only the game decides, offered after an action: [{id, thing, output, by, text}]; decide(id) makes it happen
    decisions, decide,
    // the clock: n ticks on, seconds on, to what is next due by itself, to any time (back too), a tick back, the start
    step, run: (seconds) => step(Math.max(1, Math.round(seconds / frame))), runToNext, scrub,
    back: () => scrub(at(run.tick - 1)),
    restart() { history = []; rebuild(0); return here(); },
    // the log as the game writes it, [{t, line}] (logic-log.js: parseLogicLine(LOGIC_TAG + line))
    log: () => run.lines.map(({ t, line }) => ({ t, line })),
    // the state now, each block's own too: {flags, counters, skills, at, dead, owned, missing, destroyed, arrived,
    // playing, played, queued, items, credits, jc, rules: {id: {done, running, step, next}}, timers: {name: {running,
    // paused, left}}, scripts: {name: {started, waiting}}}
    state,
    // per rule: {fired, once, running, cond (refused for each), acted, failed, last (when it last fired)}
    counts,
    // what the rules wait for, thing by thing (the world's buttons): [{thing, output, option, port, near, rules, watched,
    // present}]
    happenings,
    // "Why didn't it fire?" in sentences, from this session's log and the compiled logic
    why,
  };
}
