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
import { conditionHolds, conditionText, kindOf, yesOf, nearHolds, AUGS } from './conditions.js';
import { createPlay } from './story-sim.js';
import { isNanoKey, keyIdError } from './item-options.js';
import { LOGIC_TAG, parseLogicLine, logicSentence, decodeCondition, blockValueText } from './logic-log.js';
import { partsText } from './console-lines.js';
import { fill, gameName } from './logic-vocab.js';
import { evaluate, valueNow } from './logic-numbers.js';

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
// a rule on anyone of a set (P9, UCRule Every): these it notices every frame (LookAtFates), the rest at its half-second
// look (LookAtMembers); 32 members at most (EMember[32])
const EACH_FRAME = new Set(['killed', 'knockedout', 'dies']);
const SET_SLOTS = 32;
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
  'animturn', 'cancel',
  // P3: a signal (UCLink.DoMore: TriggerTag UCS_<a>)
  'signal',
  // P5: a dialogue started, an InfoLink played (UCLink.StoryAction)
  'talk', 'infolink',
  // P9 slice 4 (UCLink.DoMore): the player's energy, an augmentation, two factions, a property of the safe list
  'energy', 'aug', 'allies', 'setprop']);
// P9 slice 4: the augmentations with one level only (their MaxLevel 0), and the safe properties the game writes as a
// number with six decimals (UnrealScript's float to text): the others as a whole number or True / False
const AUG_ONE_LEVEL = new Set(['augdatalink', 'augiff', 'auglight']);
const FLOAT_PROPS = new Set(['groundspeed', 'baseaccuracy', 'surpriseperiod', 'lockstrength', 'doorstrength', 'drawscale', 'scaleglow']);
// the logic blocks (P3: UCBlock's subclasses, placed in the map like a script) and what each is called here
const BLOCKS = [['UCBAllOf', 'allof'], ['UCBGate', 'gate'], ['UCBSwitch', 'switch'], ['UCBPhases', 'phases'],
  ['UCBAtLeast', 'atleast'], ['UCBFirstOf', 'firstof'], ['UCBCounter', 'counter']];
// UCBlock.FlagName: a block's flag or phase name (anything but an ASCII letter, a digit or _ becomes _, a leading
// digit gets X_, 60 at most); a list "a, b, c" (UCBlock.Item)
function flagName(text) {
  let s = [...String(text ?? '').trim()].map((ch) => (/^[A-Za-z0-9_]$/.test(ch) ? ch : '_')).join('');
  if (/^[0-9]/.test(s)) s = 'X_' + s;
  return s.slice(0, 60);
}
const listOf = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim());
const MAX_TICKS = 32;                    // UCBAllOf.Ticked[32]
// what a verb needs of its target (UCLink.DoAct): a class in its chain, true any object; without it, "cannot"
const NEEDS = { open: 'DeusExMover', close: 'DeusExMover', toggle: 'DeusExMover', key: 'DeusExMover', hide: true, show: true,
  on: true, off: true, effect: true, cutplay: 'UCCutscene', cutstop: 'UCCutscene', timerstart: 'UCTimer', timerstop: 'UCTimer',
  timerpause: 'UCTimer', timerresume: 'UCTimer', sit: 'ScriptedPawn', standup: 'ScriptedPawn',
  flicker: 'Light', lightcolour: 'Light', lightbright: 'Light', patrol: 'ScriptedPawn', ownorders: 'ScriptedPawn',
  fillcrate: 'Decoration', setprop: true };
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
  const rules = [], groups = new Map(), usables = new Map(), tags = new Map(), starts = [];
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
        watch: t3dString(p.Watch), watchProp: p.bWatchProp === 'True', watchStart: p.bWatchStart === 'True', phaseGate: t3dString(p.PhaseGate),
        // the Logic runtime v2 (UCRule): up to 8 runs, its options; a UCRuleAlso sets the UCRule called Main off
        v2: a.cls === 'UCRule', also: a.cls === 'UCRuleAlso', main: t3dString(p.Main), any: p.bAny === 'True',
        elseAt: p.ElseAt === undefined ? -1 : int(p.ElseAt), again: low(p.Again), maxRuns: int(p.MaxRuns),
        cooldown: parseFloat(p.Cooldown) || 0, talkBusy: low(p.TalkBusy), actIds: slots(p, 'ActId', 24),
        // anyone of a set (P9, UCRule Every): "class:X", "faction:X", "names:A,B"; EveryArg the % of "hurt below"
        every: t3dString(p.Every), everyArg: int(p.EveryArg),
        // the world (P9 slice 3, UCRule WorldArg): a goal's name ('' any), the kind of noise, a character or a body
        worldArg: t3dString(p.WorldArg) });
    } else if (a.cls === 'UCLinkGroup') groups.set(low(a.name), { members: upToEmpty(slots(p, 'Member', 128)), next: t3dString(p.NextGroup) });
    else if (a.cls === 'UCUsable') usables.set(low(t3dString(p.Target)), t3dString(p.UseEvent));
    // a scripting tag set by hand (UCObjectTag.Of); an automatic or original one is the world actor's own `tag`
    else if (a.cls === 'UCObjectTag' && p.bAuto !== 'True' && p.bOriginal !== 'True') tags.set(low(p.TargetName), t3dString(p.Value));
    // the map's UCLogicHub (P5): its start values, "name|b|1" a state, "name|i|5" a counter
    else if (a.cls === 'UCLogicHub') starts.push(...upToEmpty(slots(p, 'Start', 32)).map((s) => s.split('|')).filter((s) => s.length === 3 && s[0]));
  }
  const order = (world.actors || []).map((a) => ({ ...a, chain: a.chain || [] }));
  // world.story (P5): the map's Story as Try it knows it, {dialogues: [id], infolinks: [{id, once, flag, name, lines:
  // [{text}], do: [actions]}], talks: {id: {id, title, owner, start, once, requires, steps}}} (flag: the state the game
  // sets when it is heard, UCEd<code>_<id>_Heard; talks: the dialogues Try it plays, line by line); none: not known
  return { rules, groups, usables, tags, starts, outputs, left: left || [], map, frame, player: world.player || 'JC', order, story: world.story || null,
    byName: new Map(order.map((a) => [low(a.name), a])) };
}

// ---------------------------------------------------------------- why didn't it run? (the Whyline idea)
// A rule's answer in sentences, from a log with the compiled logic: Try it's session (createSession's why) or the
// game's own log of the last Play (whyFromLog, play). h: {linesOf(id) -> the rule's lines read [{t: seconds, or null
// when the line has no time (the game's UCLink lines), n: their order, entry}], all() -> every line read, present(name),
// state(i) -> the rule's run now (a session only), at(tick), words, vocab, play}.
// -> [{why, t, text}], why: left, unknown, hook, never, once, running, cond, skip, else, fired, fail, now
function explain(S, id, h) {
  const { words, vocab, play = false } = h;
  const when = (t) => (t === null || t === undefined ? '' : ` at ${secs(t)}`);
  const whenText = (r) => (vocab ? vocab.whenText({ src: r.source, when: r.when, option: r.option, near: r.near, port: r.port }, words)
    : `When ${r.source ? `${words.name(r.source)}: ` : ''}${r.when}`);
  const condText = (c) => conditionText(c, { actor: words.name, item: words.itemName, state: words.state });
  const said = (e) => partsText(logicSentence(e.entry).parts).trim();
  // a line written before another: by their times when both have one, else by their order in the log
  const before = (e, then) => (e.t !== null && e.t !== undefined && then.t !== null && then.t !== undefined ? e.t <= then.t : e.n <= then.n);
  // the rules whose actions set the state (or change the counter) a refused condition reads, and whether they had
  // done it by the time of the refusal
  function setters(c, then) {
    const kind = kindOf(c);
    if (kind !== 'flag' && kind !== 'counter') return play ? ' That is up to the game and the player.' : ' That is up to the game: change it in the State panel to try it.';
    const name = kind === 'flag' ? c.flag : c.counter, verb = kind === 'flag' ? 'flag' : 'count';
    const sets = (f) => f[1] === verb && low(f[3]) === low(name) && (kind === 'counter' || (f[4] !== '0') === (c.is !== false));
    const who = S.rules.filter((r) => r.acts.some(sets)).map((r) => r.id);
    const what = kind === 'flag' ? `${name} to ${c.is === false ? 'No' : 'Yes'}` : `the counter ${name}`;
    const keeper = kind === 'flag' && !who.length ? phaseKeeper(name) : null;
    if (keeper) {
      const was = blockThen(keeper.block, then);
      return ` ${words.name(keeper.block)} keeps it: it is Yes while it is at the phase "${keeper.phase}"${was ? `, and it was at "${was}" then` : ''}.`;
    }
    if (!who.length) return ` No rule sets ${what} (the Story or the game may)${play ? '.' : ': to try it, set it in the State panel.'}`;
    const done = who.flatMap(h.linesOf)
      .filter((e) => before(e, then) && e.entry.kind === 'act' && e.entry.verb === verb && low(e.entry.detail) === low(name));
    const ran = [...new Set(done.map((e) => e.rule || e.entry.rule))].join(', ');
    if (!done.length) return who.length === 1 ? ` Only ${who[0]} sets ${what}, and it had not done it by then.`
      : ` ${who.join(', ')} set ${what}, and none of them had done it by then.`;
    return kind === 'flag' ? ` ${ran} had set ${what} before then: something set it back since.`
      : ` ${ran} had changed ${what} ${done.length} time${done.length === 1 ? '' : 's'} by then: not enough.`;
  }
  // when it was never set off: its object is not there, the map has not started, or what it waits for did not happen
  function never(r, x) {
    if (r.source && !h.present(r.source)) return `${words.name(r.source)} is not in the map.`;
    if (r.hears === 'start') {
      if (play) return 'It wrote nothing when the map started: the game may have run the map from before this rule (Rebuild, then Play).';
      return x.started ? 'It was refused at the start.' : `The map has not started yet: its first look is at ${secs(LOOK)}.`;
    }
    return `"${whenText(r)}" never happened ${play ? 'in the last Play' : 'in this session'}.${WATCHED.has(r.hears)
      ? ' It is looked at every half second, and the first look only notes what is already so: it has to become so after.' : ''}`;
  }
  // the Phases blocks: the name each keeps its phase under (UCBPhases: <StateName> a counter, <StateName>_<phase> a
  // state each), and what a block showed last before a line (its own value lines)
  const phaseBlocks = S.order.filter((a) => a.block && a.chain.includes('UCBPhases'))
    .map((a) => ({ name: a.name, root: flagName(a.block.statename ?? 'Phase') || 'Phase', phases: listOf(a.block.phases).map(flagName) }));
  const phaseKeeper = (flag) => {
    for (const b of phaseBlocks) {
      const phase = b.phases.find((x) => low(`${b.root}_${x}`) === low(flag));
      if (phase) return { block: b.name, phase };
    }
    return null;
  };
  function blockThen(name, then) {
    if (!h.all) return '';
    const v = h.all().filter((e) => e.entry && e.entry.kind === 'value' && low(e.entry.block) === low(name) && before(e, then)).at(-1);
    return v ? blockValueText(v.entry.text) : '';
  }
  // the phase its Phases block was in when the rule was refused for it ("counter|2,3": the block keeps its phase in
  // that counter)
  function phaseThen(r, then) {
    const counter = low(String(r.phaseGate || '').split('|')[0]);
    const block = phaseBlocks.find((b) => low(b.root) === counter || low(b.name) === counter);
    const was = block ? blockThen(block.name, then) : '';
    return was ? ` (${words.name(block.name)} was at "${was}")` : '';
  }
  const i = S.rules.findIndex((r) => r.id === id);
  if (i < 0) {
    const l = S.left.find((x) => x.id === id);
    return [l ? { why: 'left', t: null, text: `${id} is not in the game: ${l.text}.` }
      : { why: 'unknown', t: null, text: `There is no rule ${id} in the compiled logic: rebuild it, or check its id.` }];
  }
  const r = S.rules[i], x = h.state ? h.state(i) : null, mine = h.linesOf(id), out = [];
  const of = (kind, reason) => mine.filter((e) => e.entry.kind === kind && (!reason || e.entry.why === reason));
  const fires = of('fire'), once = of('skip', 'once'), busy = of('skip', 'running'), refused = of('skip', 'cond');
  for (const e of of('hook')) out.push({ why: 'hook', t: e.t ?? null, text: `${said(e)}.` });
  if (!fires.length && !mine.some((e) => e.entry.kind === 'skip' || e.entry.kind === 'else') && !out.length) {
    out.push({ why: 'never', t: null, text: never(r, x || {}) });
  }
  if (once.length) {
    const first = fires[0]?.t, at = play ? (first === null || first === undefined ? '' : ` (at ${secs(first)})`) : ` (at ${secs(first ?? 0)})`;
    out.push({ why: 'once', t: once.at(-1).t ?? null, text: `It had already run${at} and runs only once: `
      + `it was refused ${once.length} time${once.length === 1 ? '' : 's'} after.` });
  }
  if (busy.length) {
    const takes = parseFloat(r.acts.at(-1)?.[0]) || 0;
    out.push({ why: 'running', t: busy.at(-1).t ?? null, text: `It was still doing its actions (they take ${secs(takes)}) when it was set off `
      + `again${when(busy.at(-1).t)}: a rule that is running ignores that.` });
  }
  for (const detail of new Set(refused.map((e) => e.entry.detail))) {
    const e = refused.filter((f) => f.entry.detail === detail).at(-1), c = decodeCondition(detail);
    out.push({ why: 'cond', t: e.t ?? null, text: `It heard it${when(e.t)}, but "${c ? condText(c) : detail}" did not hold.${c ? setters(c, e) : ''}` });
  }
  // the other reasons a rule gives for not running (phases; the Logic runtime v2: at most N, a cooldown, a talk...)
  for (const reason of new Set(of('skip').map((e) => e.entry.why).filter((w) => !['once', 'running', 'cond'].includes(w)))) {
    const all = of('skip', reason), e = all.at(-1);
    const text = said(e).replace(/^.*?did not run: /, '');
    out.push({ why: 'skip', t: e.t ?? null, text: `It did not run${when(e.t)}: ${text}${reason === 'phase' ? phaseThen(r, e) : ''}`
      + `${all.length > 1 ? ` (${all.length} times)` : ''}.` });
  }
  const elses = of('else');
  if (elses.length) {
    out.push({ why: 'else', t: elses.at(-1).t ?? null, text: `It heard it${when(elses.at(-1).t)}, but its conditions did not hold: `
      + `its Otherwise ran${elses.length > 1 ? ` (${elses.length} times)` : ''}.` });
  }
  if (fires.length) {
    const times = fires.length === 1 ? 'once' : `${fires.length} times`, last = fires.at(-1).t;
    out.push({ why: 'fired', t: last ?? null, text: `It ran ${times}${last === null || last === undefined ? '' : `, the last at ${secs(last)}`}.` });
  }
  for (const line of new Set(of('fail').map((e) => e.line))) {
    const e = of('fail').filter((f) => f.line === line).at(-1);
    out.push({ why: 'fail', t: e.t ?? null, text: `An action of it failed${when(e.t)}: ${said(e)}.` });
  }
  if (x && x.running) out.push({ why: 'now', t: null, text: `It is doing its actions now: the next at ${secs(h.at(x.wake))}.` });
  const live = x && r.v2 ? x.slots.filter((q) => q?.running) : [];
  if (live.length) {
    out.push({ why: 'now', t: null, text: `${live.length === 1 ? 'It is doing its actions now' : `${live.length} runs of it are going on now`}: `
      + `the next action at ${secs(h.at(Math.min(...live.map((q) => q.wake))))}.` });
  }
  return out;
}

// Why didn't it run, from the game's own log of the last Play: the lines it wrote (the server's /api/logic_log: the
// tag taken off), read with the compiled logic and the world as createSession takes them. Lines of other maps are
// left out. -> {why(id) (explain's answer), lines (this map's, read), rules (the compiled rules' ids)}
export function whyFromLog({ actors = [], outputs = {}, left = [], world = {}, map = 'Map', lines = [], vocab = null, ctx = {} } = {}) {
  const S = setupOf({ actors, outputs, left, world, map, frame: 0.1 });
  const read = [], byRule = new Map();
  for (const line of lines) {
    const entry = parseLogicLine(LOGIC_TAG + line);
    if (!entry || low(entry.map) !== low(map)) continue;
    const e = { t: entry.time ?? null, n: read.length, line, rule: entry.rule || '', entry };
    read.push(e);
    if (e.rule) { if (!byRule.has(e.rule)) byRule.set(e.rule, []); byRule.get(e.rule).push(e); }
  }
  const words = { name: (n) => n, usable: (n) => S.usables.has(low(n)), portLabel: (n, key) => String(key).split(':')[1] || key, ...ctx };
  const present = (n) => (!!n && low(n) === low(S.player)) || (!!S.byName.get(low(n)) && !S.byName.get(low(n)).absent);
  const h = { linesOf: (id) => byRule.get(id) || [], all: () => read, present, words, vocab, play: true };
  return { why: (id) => explain(S, id, h), lines: read, rules: S.rules.filter((r) => !r.also).map((r) => r.id) };
}

// ---------------------------------------------------------------- one run of the map, from its start
function newRun(S) {
  const { rules, map, frame } = S;
  // the player's own (P9 slice 2): full health and energy, the skill points of a new game (DeusExPlayer's 5000, both
  // games), the augmentations given (name -> {has, on, level 1-4}), not in water, in no zone of the map
  const st = { items: [], credits: 0, jc: null, health: 100, energy: 100, skillPoints: 5000, augs: new Map(), water: false, zone: '' };
  for (const part of [...MERGED, ...LISTS]) st[part] = names();
  const rs = rules.map(() => ({ done: false, running: false, step: 0, waited: 0, wake: 0, asleep: false, hurry: false,
    runs: 0, slept: false, until: null,
    started: false, polled: false, was: false, door: null, deaf: false, streak: 0, last: -1,
    // v2: its runs (8 slots), how often it ran and when, the rate guard; a watched value's base; a pawn told apart
    slots: Array(RUNS).fill(null), fired: 0, lastFire: 0, rateStart: -Infinity, rateCount: 0, cur: null, base: undefined, pawn: null,
    // a set's members as it looked at them (P9: UCRule EMember, EWas; bEveryLooked, bEveryFull), the bodies found, the
    // members gone down for its next Tick
    members: new Map(), looked: false, full: false, found: new Set(), fates: [] }));
  const pulses = names();                // P4 'prop' outputs the user said happened, for the rules' next look (S5)
  const hostile = names();               // the characters a rule made hostile to the player (P9: "they turn hostile")
  const timers = new Map(), scripts = new Map(), sent = names();
  const blocks = new Map();             // a logic block's memory (UCBAllOf's ticks, UCBGate open or not, UCBSwitch's next way)
  let seed = 20261107;                  // "At random" here: always the same picks, so going back and forth replays them
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let pending = [];                     // what is left for the user to decide: [{id, thing, output, by}]
  for (const a of S.order) {
    if (a.chain.includes('UCTimer')) timers.set(low(a.name), { running: false, paused: false, left: 0, total: 0, begun: false });
    if (a.chain.includes('UCScript')) scripts.set(low(a.name), { started: false, waiting: [] });
  }
  const lines = [];
  let tick = 0, turn = { kind: 'load' };
  let came = 0;                         // Value now (UCEditorStory.CameWith, P8 slice 5b): what the output that set the
                                        // acting rule's run off came with; each run keeps its own (run.came)
  // the Story's conversations (P5): the one playing now, the dialogues played, what was said ({t, at: the log's lines
  // before it, kind, ...}: the lines and answers are no part of the game's log)
  const talk = { now: null, played: new Set(), said: [] };

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
  // an amount as the game works it out (UCEditorStory.NumberOf, P9 slice 5): a number, or '=' and a formula's tokens
  // read with the counters now; typed: as the Story's actions keep it (a number or a formula as written)
  const amount = (s) => evaluate(String(s ?? ''), (n) => st.counters.get(n) || 0, came);
  const typed = (s) => valueNow(s, (n) => st.counters.get(n) || 0, came);
  // what UCEditorStory.Holds reads (conditions.js conditionHolds)
  const game = {
    flag: (n) => !!st.flags.get(n), counter: (n) => st.counters.get(n) || 0, skill: (n) => st.skills.get(n) ?? 0,
    get value() { return came; },                         // Value in a condition's number (CameWith)
    carries: (cls) => st.items.some((i) => low(i) === low(cls)),
    alive: (n) => present(n) && !(isa(n, 'Pawn') && st.dead.has(n)),     // UCEditorStory.Dead: gone, or a pawn with no health
    get credits() { return st.credits; },
    get player() { return st.jc; },                       // where the player is (near a point: UCEditorStory.Near)
    get health() { return st.health; }, get energy() { return st.energy; }, get skillPoints() { return st.skillPoints; },
    aug: (n) => st.augs.get(low(n)) || null, get water() { return st.water; }, get zone() { return st.zone; },
    // UCEditorStory.ItemsOf: the class or one under it (an item of the map tells its chain; another one only itself);
    // here one of each thing
    countOf: (cls) => { const want = low(String(cls).split('.').pop()); return st.items.filter((i) => itemChain(i).includes(want)).length; },
  };
  function itemChain(cls) {
    const bare = low(String(cls).split('.').pop()), a = S.order.find((x) => low(x.chain[0]) === bare);
    return a ? a.chain.map(low) : [bare];
  }

  function change(c) {
    for (const [part, v] of Object.entries(c || {})) {
      if (MERGED.includes(part)) for (const [n, x] of Object.entries(v || {})) st[part].set(n, x);
      else if (LISTS.includes(part)) st[part] = nameSet(v);
      else if (part === 'items') st.items = [...(v || [])];
      else if (part === 'credits') st.credits = int(v);
      else if (part === 'jc') st.jc = v ? [...v] : null;
      else if (part === 'health') st.health = Math.max(0, Math.min(100, int(v)));
      else if (part === 'energy') st.energy = Math.max(0, Math.min(100, int(v)));
      else if (part === 'skillpoints') st.skillPoints = Math.max(0, int(v));
      else if (part === 'water') st.water = !!v;
      else if (part === 'zone') st.zone = String(v || '');
      else if (part === 'augs') {                           // {AugSpeed: {has, on, level}} merged; null: not had
        for (const [n, x] of Object.entries(v || {})) {
          if (!x || !x.has) st.augs.delete(low(n));
          else st.augs.set(low(n), { has: true, on: !!x.on, level: Math.max(1, Math.min(4, int(x.level) || 1)) });
        }
      }
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
      m.lines.push({ ...e, n: indexed, entry });
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
      if (m >= 0) { rs[m].heard = x.heard || 0; x.heard = 0; }      // an output's number goes with it
      return m < 0 ? report(r, 'hook', r.main, 'missing') : start(m, by, r.source, r.when);
    }
    if (r.v2) return start(i, by, r.source, r.when);
    if (!inPhase(r)) return report(r, 'skip', 'phase', r.phaseGate);
    if (r.once && x.done) return report(r, 'skip', 'once', '');
    if (x.running) return report(r, 'skip', 'running', '');
    came = x.came = x.heard || 0;                    // UCLink.RunRule: CameWith = HeardValue
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
  // UCLink.InPhase (P3): the phase now (a Phases block's counter, its first before it starts) is one of the gate's
  function inPhase(r) {
    if (!r.phaseGate) return true;
    const [root, list = ''] = r.phaseGate.split('|');
    const k = Math.max(1, st.counters.get(root) || 0);
    return list.split(',').includes(String(k));
  }
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
    const r = rules[i], x = rs[i], now = tick * frame, heard = x.heard || 0;
    x.heard = 0;                                     // UCRule.Start: this start's Value only
    if (now - x.rateStart > 1 + 1e-9) { x.rateStart = now; x.rateCount = 0; }
    if (++x.rateCount > RATE) { if (x.rateCount === RATE + 1) report(r, 'fail', 'rule', '', 'fast'); return; }
    if (!inPhase(r)) return report(r, 'skip', 'phase', r.phaseGate);
    if (r.once && x.done) return report(r, 'skip', 'once', '');
    if (r.maxRuns > 0 && x.fired >= r.maxRuns) return report(r, 'skip', 'max', String(r.maxRuns));
    if (r.cooldown > 0 && x.fired > 0 && now - x.lastFire < r.cooldown - 1e-9) return report(r, 'skip', 'cooldown', r.cooldown.toFixed(2));
    const live = liveRuns(x);
    if (live > 0 && r.again !== 'restart' && r.again !== 'each') return report(r, 'skip', 'running', '');
    if (live >= RUNS && r.again === 'each') return report(r, 'skip', 'full', '');
    came = heard;
    const { ok, failed } = condsHold(r);
    if (!ok && r.elseAt < 0) return report(r, 'skip', 'cond', failed);
    if (r.again === 'restart' && live > 0) { report(r, 'skip', 'restarted', ''); x.slots.fill(null); }
    const slot = Math.max(0, x.slots.indexOf(null));
    const run = { step: 0, wake: before(i) ? tick : tick + 1, slept: false, until: null, runs: 0, hurry: false, running: true,
      by: by || '', it: it || '', came: heard };
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
    // the Story's end (a dialogue's UCD_<id>, an InfoLink's UCI_<id>): the story remembers when (UCEditorStory.Seen),
    // for the steps "Wait until" it (P5)
    if (/^uc[di]_/i.test(tag)) (st.seen ||= new Map()).set(low(tag), tick);
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
  // value: the number it came with (UCScript.OutputValue, P8 slice 5b), undefined for a plain Output (the log has none)
  function output(script, name, value) {
    let n = 0;
    rules.forEach((r, i) => {
      if (r.when === 'output' && low(r.source) === low(script) && low(r.port) === low(name)) {
        rs[i].heard = Math.trunc(+value || 0);       // UCLink.Trigger: HeardValue
        runRule(i, nameOf(script));
        n++;
      }
    });
    write('', 'output', map, nameOf(script), name, String(n), ...(value === undefined ? [] : [String(Math.trunc(+value || 0))]));
  }
  function sayOutput(script, name, value) {
    const s = scripts.get(low(script));
    startScript(script);
    if (s.started) return output(script, name, value);
    if (s.waiting.length < QUEUE) s.waiting.push({ name, value });
    else write('', 'fail', map, '', 'output', nameOf(script), 'full');
  }
  function startScript(script) {
    const s = scripts.get(low(script));
    if (s.started || turn.kind === 'load') return;          // JC is not in the map yet
    s.started = true;
    if (blockKind(script)) blockStarted(script);             // a block's Started(): what it holds, to the log
    for (const o of behaviour(script).started || []) sayOutput(script, o);
    const waiting = s.waiting.splice(0);
    for (const o of waiting) output(script, o.name, o.value);
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
  // UCLink.DoMembers: a named group's saved members (field 8 the first UCLinkGroup) that can do the verb (TagKind)
  const membersOf = (r, verb, first) => [...new Set(groupMembers(first).map(low))].map(nameOf).filter((n) => present(n)
    && low(n) !== low(r.source) && !HELPERS.some((c) => isa(n, c)) && (!tagClass(verb) || isa(n, tagClass(verb))));
  // ---- anyone of a set (P9, UCRule): who is in it (InSet: its class or a subclass, its faction, its name), living
  // (Down: gone, or dead); its members, as AllActors finds the characters
  const down = (n) => !present(n) || st.dead.has(n);
  function inSet(set, n) {
    const k = String(set).indexOf(':'), kind = String(set).slice(0, k), v = String(set).slice(k + 1);
    if (k < 0) return false;
    if (kind === 'class') return (actorOf(n)?.chain || []).some((c) => low(c) === low(v));
    if (kind === 'faction') return low(actorOf(n)?.alliance || '') === low(v);
    if (kind === 'names') return v.split(',').some((x) => low(x) === low(n));
    return false;
  }
  const setMembers = (set) => S.order.map((a) => a.name).filter((n) => isa(n, 'ScriptedPawn') && !down(n) && inSet(set, n));
  // UCRule.MemberHolds: what the rule's happening is on a member now (the user said so: a pulse for one look; hostile
  // since a rule made it so; below N% once hurt so: it does not heal)
  function memberHolds(r, m) {
    if (down(m.name)) return false;
    const said = pulses.has(pulseKey(m.name, r.when));
    if (r.when === 'turnshostile') return said || hostile.has(m.name);
    if (r.when === 'hurt' && r.everyArg > 0) return (m.below ||= said);
    return said;
  }
  // UCRule.LookAtMembers, every half second: newcomers take a slot (the first look takes how things are), then each
  // one whose happening has become so starts a run (@it the member; @by the player, none for a wound); a body found:
  // @by unknown here (the game: the body), not at the first look
  function lookAtMembers(i) {
    const r = rules[i], x = rs[i], first = !x.looked;
    for (const n of setMembers(r.every)) {
      let m = x.members.get(low(n)), fresh = false;
      if (!m) {
        if (x.members.size >= SET_SLOTS) {
          if (!x.full) report(r, 'fail', 'every', r.every, 'full');
          x.full = true;
          continue;
        }
        x.members.set(low(n), m = { name: n, was: false });
        fresh = true;
        if (first && r.when !== 'hurt') m.was = memberHolds(r, m);
      }
      if (EACH_FRAME.has(r.when)) continue;
      if (r.when === 'findsbody') {
        if (!first && pulses.has(pulseKey(n, 'findsbody'))) start(i, '', n, r.when);
        continue;
      }
      const now = fresh && r.when === 'hurt' ? false : memberHolds(r, m);
      if (now && (!m.was || (r.when === 'hurt' && !r.everyArg))) start(i, r.when === 'hurt' ? '' : S.player, n, r.when);
      m.was = now;
    }
    if (!EACH_FRAME.has(r.when)) for (const [k, m] of [...x.members]) if (down(m.name)) x.members.delete(k);
    x.looked = true;
  }
  // a member going down: the rules on its sets that notice it every frame, at their next Tick
  function fates(thing, how) {
    rules.forEach((r, i) => {
      const x = rs[i];
      if (!r.every || !EACH_FRAME.has(r.when) || !x.members.has(low(thing))) return;
      x.members.delete(low(thing));
      x.fates.push({ name: nameOf(thing), out: how === 'knockedout', at: before(i) ? tick : tick + 1 });
    });
  }
  // UCRule.LookAtFates: killed or knocked out, as UCFateWatch tells them apart; the other its "skip how"
  function lookAtFates(i) {
    const r = rules[i], x = rs[i], due = x.fates.filter((f) => f.at <= tick);
    x.fates = x.fates.filter((f) => f.at > tick);
    for (const f of due) {
      if (r.when === 'dies' || (r.when === 'knockedout') === f.out) start(i, '', f.name, r.when);
      else report(r, 'skip', 'how', r.when, f.name);
    }
  }
  function doAct(i, f) {
    const r = rules[i], field = (k) => f[k] ?? '';
    if (field(6) === 'every') {                        // UCRule.DoEvery (P9): each living one of the set that can do it
      report(r, 'act', field(1), `every ${field(8)}`);
      for (const n of setMembers(field(7))) if (!HELPERS.some((c) => isa(n, c)) && (!tagClass(field(1)) || isa(n, tagClass(field(1))))) doAct(i, ['0', field(1), n, field(3), field(4), field(5)]);
      return;
    }
    if (field(6) === 'group' || field(6) === 'area+' || field(6) === 'tag' || field(6) === 'members') {
      const many = field(6) === 'tag' ? (field(7) ? tagged(r, field(1), field(7)) : [])
        : field(6) === 'members' ? membersOf(r, field(1), field(8)) : areaOf(r, f);
      report(r, 'act', field(1), `${field(6) === 'tag' ? 'tag' : field(6) === 'members' ? 'group' : 'area'} ${field(7)}`);
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
    if (T && (verb === 'hostile' || verb === 'attack')) hostile.set(nameOf(T), true);      // (P9: "they turn hostile")
    else if (T && (verb === 'friend' || verb === 'neutral')) hostile.delete(nameOf(T));
    switch (verb) {
      // Path finding and free seat slots are checked by the game, not this logic-only simulation.
      case 'sit': return a && present(a) && isa(a, 'Seat') ? undefined : fail('seat unavailable or unsupported character');
      case 'flag': return a === '' ? fail('noname', '') : st.flags.set(a, b !== '0');
      case 'goal': return a === '' ? fail('noname', '') : undefined;
      case 'count': return a === '' ? fail('noname', '') : st.counters.set(a, (c === 'set' ? 0 : st.counters.get(a) || 0) + amount(b));
      case 'timerstart': case 'timerstop': case 'timerpause': case 'timerresume': return timerDo(T, verb.slice(5), parseFloat(a) || 0);
      case 'input': return T && isa(T, 'UCScript') ? scriptInput(T, a, b, r) : fail('noscript');
      case 'signal': if (a === '') return fail('noname', '');          // every rule on "the signal a is sent"
        trigger(`UCS_${a}`, r.name, r.name); return undefined;
      case 'talk': case 'infolink': return storyDo(verb, a, fail, r);
      case 'floor': return floor(T, int(a), fail);
      case 'on': case 'off': return switchScript(T, verb);
      case 'blow': return blow(T);
      case 'cutplay': return playCut(T);
      case 'cutstop': return stopCut(T);
      case 'animstop': return drop('animdone', T);
      // P4: what changes what the conditions read; what the game decides; a rule stopped
      case 'credits': st.credits = Math.max(0, st.credits + amount(a)); return undefined;
      case 'skillpoints': st.skillPoints = Math.max(0, st.skillPoints + amount(a)); return undefined;
      case 'health': { const n = amount(a); st.health = n < 0 && st.health + n <= 0 ? 0 : Math.max(1, Math.min(100, st.health + n)); return undefined; }
      // P9 slice 4 (UCLink.ChangeAug, Allies, SetSafeProp)
      case 'energy': st.energy = Math.max(0, Math.min(100, st.energy + amount(a))); return undefined;
      case 'aug': { const why = augDo(a, b, c); return why ? report(r, 'fail', 'aug', a, why) : undefined; }
      case 'allies': return a === '' || b === '' ? fail('noname', '') : allies(a, b, c);
      case 'setprop': if (a === '') return fail('noprop', nameOf(T));
        report(r, 'prop', nameOf(T), a, propText(T, a, b)); return undefined;
      case 'giveitem': { const why = giveItem(a, c, field(7)); return why ? fail(why, a) : undefined; }
      case 'takeitem': st.items = st.items.filter((x) => low(x) !== low(a)); return undefined;   // (one of each is all it keeps)
      case 'nextfloor': if (!Object.keys(FLOORS).some((k) => T && isa(T, k))) return fail('cannot', T ? nameOf(T) : '');
        return leadsTo(verb, T, a, [a, b, c]);
      case 'cancel': return cancel(i, a) ? undefined : fail('cannot', '');
      default: return leadsTo(verb, T, a, [a, b, c]);
    }
  }
  function giveItem(cls, id, description) {
    if (isNanoKey(cls)) {
      const error = keyIdError(id);
      if (error) return error;
      id = String(id).trim();
      st.keyring ||= {};
      st.keyring[id.toLowerCase()] ??= description || `Key ${id}`;
    } else if (cls && !game.carries(cls)) st.items.push(cls);
    return '';
  }
  // An augmentation of the player (UCLink.ChangeAug): give (nothing when had), raise one level, set a level, on, off;
  // given when needed for raise and level ("raise" then stops at its first level). A slot full is the game's alone.
  // Its fail word, or ''
  function augDo(a, how, lv) {
    const n = low(a);
    if (!AUGS.some(([c]) => low(c) === n)) return 'noaug';
    let x = st.augs.get(n);
    if (!x && ['give', 'raise', 'level'].includes(how)) {
      st.augs.set(n, x = { has: true, on: false, level: 1 });
      if (how === 'raise') return '';
    }
    if (!x) return 'nothad';
    const most = AUG_ONE_LEVEL.has(n) ? 1 : 4;
    if (how === 'raise') x.level = Math.min(most, x.level + 1);
    else if (how === 'level') x.level = Math.max(1, Math.min(most, int(lv)));
    else if (how === 'on') x.on = true;
    else if (how === 'off') x.on = false;
    return '';
  }
  // two factions (UCLink.Allies): what this simulation follows is who is hostile to the player
  function allies(a, b, c) {
    const toPlayer = (f) => S.order.map((x) => x.name).filter((n) => isa(n, 'ScriptedPawn') && low(actorOf(n)?.alliance || '') === low(f));
    const set = (n) => (String(c).includes('hostile') ? hostile.set(n, true) : hostile.delete(n));
    if (low(b) === 'player') toPlayer(a).forEach(set);
    if (low(a) === 'player' && String(c).includes('both')) toPlayer(b).forEach(set);
    return undefined;
  }
  // what the game's GetPropertyText says of a safe property just set (UCLink.SetSafeProp: a character's health at
  // least 1)
  function propText(T, a, v) {
    if (FLOAT_PROPS.has(low(a))) return (+v || 0).toFixed(6);
    if (/^(true|false)$/i.test(v)) return /^true$/i.test(v) ? 'True' : 'False';
    return String(low(a) === 'health' && isa(T, 'ScriptedPawn') ? Math.max(1, int(v)) : int(v));
  }
  // P5 (UCLink.StoryAction, UCEditorStory.RunStoryAction): the Story's dialogue or InfoLink. A dialogue whose steps
  // the world gives (world.story.talks) plays here as the game plays it (startTalk), and the rules waiting for its end
  // (the game's UCD_<id>) run when it ends; one it does not give ends at once. An InfoLink says its lines and is heard
  // at once (UCI_<id>); played once only, it is "heard" the next time.
  function storyDo(verb, id, fail, r) {
    if (id === '') return fail('noname', '');
    const story = S.story;
    // (the player heard it: UCLink.Who)
    const ended = () => { trigger(`${verb === 'talk' ? 'UCD' : 'UCI'}_${gameName(id)}`, r.name, S.player); return undefined; };
    if (!story) return ended();
    if (verb === 'talk') {
      if (talkOf(id)) { const why = startTalk(id, r.name); return why ? fail(why, id) : undefined; }
      return (story.dialogues || []).some((d) => low(d) === low(id)) ? ended() : fail('missing', id);
    }
    const why = playInfo(id, r.name);
    return why ? fail(why, id) : undefined;
  }
  // an InfoLink plays (UCEditorStory's PlayInfo_<id>): '' played, else why not. Its actions at its start (story.py: an
  // interrupted InfoLink counts as heard), its lines, then the rules waiting for it to be heard
  function playInfo(id, by) {
    const il = (S.story?.infolinks || []).find((x) => low(x.id) === low(id));
    if (!il) return 'missing';
    const heard = il.flag ? !!st.flags.get(il.flag) : (st.heard ||= new Set()).has(low(id));
    if (il.once !== false && heard) return 'heard';
    if (il.flag) st.flags.set(il.flag, true); else st.heard.add(low(id));
    for (const a of il.do || []) storyAction(a);
    for (const l of il.lines || []) if (String(l.text || '').trim()) say({ kind: 'line', infolink: il.id, who: il.name || '', text: l.text });
    trigger(`UCI_${gameName(id)}`, by, S.player);
    return '';
  }

  // ---- the Story's conversations played (P5): story-sim.js on the session's state
  const storyBy = `UCEd_${String(map).replace(/\W/g, '_')}0`;      // the story class, as the log names who set it off
  const talkOf = (id) => {
    const all = S.story?.talks || {}, k = Object.keys(all).find((x) => low(x) === low(id));
    return k === undefined ? null : all[k];
  };
  const say = (e) => { talk.said.push({ t: Math.round(tick * frame * 1e6) / 1e6, at: lines.length, ...e }); };
  // UCEditorStory.TalkNow: '' it can start, else why not (the log's reasons). An owner the world does not list (no rule
  // names it) is there unless the state says it is missing.
  function talkWhyNot(id) {
    const d = talkOf(id);
    if (!d) return 'missing';
    if (talk.now) return 'busy';
    if (d.owner && (actorOf(d.owner) ? !game.alive(d.owner) : st.missing.has(d.owner))) return 'missing';
    if (!(d.requires || []).every((c) => !c.flag || !!st.flags.get(gameName(c.flag)) === yesOf(c, 'is'))) return 'unmet';
    if (d.once !== false && talk.played.has(low(id))) return 'played';
    return '';
  }
  function startTalk(id, by) {
    const why = talkWhyNot(id);
    if (why) return why;
    const d = talkOf(id), steps = gameSteps(d.steps);
    talk.now = { id: d.id || id, owner: d.owner || '', by, steps, dos: [], shown: null, play: createPlay(steps, {}, { random }) };
    say({ kind: 'start', dialogue: talk.now.id, who: talk.now.owner, by });
    talkOn();
    return '';
  }
  // on to the next line or choice: the steps between change the state, send their signals, trigger their events (the
  // conversation's own events, which name nobody: UCLink.Who); its end when there is no more
  function talkOn() {
    const c = talk.now;
    for (let guard = 0; c && talk.now === c && guard < 4096; guard++) {
      const p = c.play;
      Object.assign(p.state, { flags: st.flags.plain(), credits: st.credits, items: new Set(st.items) });
      const x = p.next();
      for (const [k, v] of Object.entries(p.state.flags)) if (!!st.flags.get(k) !== !!v) st.flags.set(k, !!v);
      st.credits = Math.max(0, int(p.state.credits));
      for (const i of p.state.items) if (!game.carries(i)) st.items.push(i);
      if (p.state.keyring) st.keyring = { ...p.state.keyring, ...st.keyring };
      if (x.type === 'end') { endTalk(x.why); return; }
      if (x.type === 'line') {                        // (who says it: the owner, the player or another BindName)
        c.shown = { ...x, who: x.who === 'npc' ? c.owner : x.who === 'jc' ? S.player : x.who };
        say({ kind: 'line', dialogue: c.id, who: c.shown.who, text: x.text });
        return;
      }
      if (x.type === 'choice') { c.shown = x; return; }
      const s = c.steps[x.id] || {};
      if (s.type === 'do') { c.dos.push(...(s.do || [])); continue; }
      say({ kind: 'effect', dialogue: c.id, step: s });
      if (s.type === 'signal' && gameName(s.signal)) trigger(`UCS_${gameName(s.signal)}`, '', '');
      else if (s.type === 'trigger' && s.tag) trigger(s.tag, '', '');
    }
  }
  // the dialogue has ended: the rules waiting for it (UCEditorStory.TickEnds), then its "do" steps' actions
  // (TickStory, the same tick)
  function endTalk(why) {
    const c = talk.now;
    talk.now = null;
    talk.played.add(low(c.id));
    say({ kind: 'end', dialogue: c.id, why });
    trigger(`UCD_${gameName(c.id)}`, S.player, S.player);
    for (const a of c.dos) storyAction(a);
  }
  // the player's part: on to the next line (k < 0, or a line shown), or answer k of the choice shown
  function talkSay(k) {
    const c = talk.now;
    if (!c) return;
    if (c.shown?.type === 'choice') {
      const o = c.shown.options.find((x) => x.k === k);
      if (!o || !o.shown) return;
      say({ kind: 'answer', dialogue: c.id, who: S.player, text: o.text });
      c.play.choose(k);
    }
    talkOn();
  }
  // a Story action (story.py action_code) at a dialogue's end or an InfoLink's start: what the rules hear is done, the
  // rest said
  function storyAction(a) {
    say({ kind: 'effect', action: a });
    if (a.type === 'flag' && a.flag) st.flags.set(gameName(a.flag), yesOf(a, 'is'));
    else if (a.type === 'signal' && gameName(a.signal)) trigger(`UCS_${gameName(a.signal)}`, storyBy, storyBy);
    else if (a.type === 'trigger' && a.tag) trigger(a.tag, storyBy, storyBy);
    else if (a.type === 'talk' && a.dialogue && talkOf(a.dialogue)) startTalk(a.dialogue, storyBy);
    else if (a.type === 'infolink' && a.infolink) playInfo(a.infolink, storyBy);
    else if (a.type === 'act' && a.act) storyAct(a.act);
  }
  // a Logic action of the Story (P5, UCEditorStory.RunAct: a rule's verb): what the rules hear and the conditions
  // read is done (the names as links.act_string writes them); the rest is the game's
  function storyAct(x) {
    const v = x.verb, a = String(x.a ?? '').trim(), b = String(x.b ?? '').trim();
    if (v === 'flag' && gameName(a)) st.flags.set(gameName(a), b !== '0');
    else if (v === 'count' && gameName(a)) {
      const n = gameName(a);
      st.counters.set(n, (x.c === 'set' ? 0 : st.counters.get(n) || 0) + (b === '' ? 1 : typed(b)));
    } else if (v === 'signal' && gameName(a)) trigger(`UCS_${gameName(a)}`, storyBy, storyBy);
    else if (v === 'credits') st.credits = Math.max(0, st.credits + typed(a));
    else if (v === 'skillpoints') st.skillPoints = Math.max(0, st.skillPoints + typed(a));
    else if (v === 'energy') st.energy = Math.max(0, Math.min(100, st.energy + typed(a)));
    else if (v === 'aug' && a) augDo(a, String(x.b || 'give'), String(x.c ?? '2'));
    else if (v === 'giveitem') giveItem(a, x.keyId, x.keyDescription);
    else if (v === 'takeitem' && a) st.items = st.items.filter((y) => low(y) !== low(a));
    else if (v === 'talk' && a && talkOf(a)) startTalk(a, storyBy);
    else if (v === 'infolink' && a) playInfo(a, storyBy);
  }
  function scriptInput(script, name, args, r) {     // UCLink.ScriptInput, then UCScript.Input as the world says (A9)
    write('', 'input', map, nameOf(script), name, args);
    startScript(script);
    if (blockKind(script)) return blockInput(script, name, r);
    const said = behaviour(script).input || {};
    if (!Object.hasOwn(said, name)) return write('', 'noinput', map, nameOf(script), name);
    for (const o of said[name]) sayOutput(script, o);
  }
  function switchScript(T, verb) {                   // Trigger / UnTrigger: a script starts, and says what the world says
    if (!scripts.has(low(T))) return;
    startScript(T);
    for (const o of behaviour(T)[verb === 'on' ? 'triggered' : 'untriggered'] || []) sayOutput(T, o);
  }
  // ---- logic blocks (P3: UCBlock): their settings are the world actor's `block` (need, again, closed, choices, mode,
  // weights: the Inspector's, else the class's defaults); what each holds goes to the log as the game writes it
  const blockKind = (n) => (BLOCKS.find(([c]) => isa(n, c)) || [])[1] || '';
  const settingOf = (n) => actorOf(n)?.block || {};
  function blockOf(n) {
    if (!blocks.has(low(n))) blocks.set(low(n), { ticked: [], done: false, need: 0, closed: !!settingOf(n).closed, next: 0,
      now: 0, holding: 0, enough: false, over: false, clock: 0, count: 0, atGoal: false });
    return blocks.get(low(n));
  }
  const value = (n, text) => write('', 'value', map, nameOf(n), text);
  // UCBlock.WhoOf: who calls a block, the object its rule is on, else the rule; RulesCalling: how many of them (each
  // once) have a rule with an action calling that input of the block
  const whoOf = (r) => (r ? r.source || r.id : '');
  const rulesCalling = (n, input) => new Set(rules.filter((q) => !q.also
    && q.acts.some((f) => f[1] === 'input' && low(f[2]) === low(n) && low(f[3]) === low(input))).map((q) => low(whoOf(q)))).size;
  const ways = (n) => Math.min(6, Math.max(2, int(settingOf(n).choices ?? 2) || 2));
  const modeOf = (n) => low(settingOf(n).mode || 'In turn');
  function blockStarted(n) {
    const b = blockOf(n), kind = blockKind(n);
    if (kind === 'allof') {
      b.need = int(settingOf(n).need) > 0 ? int(settingOf(n).need) : Math.max(1, rulesCalling(n, 'Add'));
      value(n, `${b.ticked.length}/${b.need}`);
    } else if (kind === 'gate') value(n, b.closed ? 'closed' : 'open');
    else if (kind === 'phases') {                    // UCBPhases.Started: the phase the flags say, else the first
      const k = st.counters.get(phaseRoot(n)) || 0, count = phasesOf(n).length;
      if (count) mirror(n, k >= 1 && k <= count ? k : 1);
    } else if (kind === 'atleast') {
      b.holding = holdNow(n);
      b.enough = b.holding >= needNow(n);
      keep(n);
      value(n, `${b.holding}/${needNow(n)} hold`);
    } else if (kind === 'counter') {               // UCBCounter.Started: the number its counter has, says nothing
      b.count = st.counters.get(counterRoot(n)) || 0;
      b.atGoal = goalOf(n) > 0 && b.count >= goalOf(n);
      showCount(n);
    } else if (kind === 'firstof') {
      value(n, 'waiting');
      if (settingOf(n).clockatstart) startClock(n);
    } else value(n, `next ${b.next + 1}`);
  }
  // ---- UCBPhases: the phase now, kept in the flags (<StateName> a counter, <StateName>_<phase> a state each)
  const phasesOf = (n) => listOf(settingOf(n).phases).map(flagName);
  const phaseRoot = (n) => flagName(settingOf(n).statename ?? 'Phase') || 'Phase';
  function mirror(n, k) {
    const b = blockOf(n), list = phasesOf(n);
    b.now = k;
    st.counters.set(phaseRoot(n), k);
    list.forEach((p, i) => st.flags.set(`${phaseRoot(n)}_${p}`, i + 1 === k));
    value(n, list[k - 1]);
  }
  function setPhase(n, k) {
    const b = blockOf(n), list = phasesOf(n), was = b.now;
    if (k < 1 || k > list.length || k === was) return;
    mirror(n, k);
    if (was > 0) sayOutput(n, `Leave_${list[was - 1]}`);
    sayOutput(n, `Enter_${list[k - 1]}`);
    sayOutput(n, 'Changed');
  }
  // ---- UCBAtLeast: how many of its states hold ("!Name": while it is No); Need 0: all of them
  const needNow = (n) => (int(settingOf(n).need) > 0 ? int(settingOf(n).need)
    : Math.max(1, listOf(settingOf(n).states).length));
  const holdNow = (n) => listOf(settingOf(n).states).filter((x) => (x.startsWith('!') ? !st.flags.get(flagName(x.slice(1)))
    : x !== '' && !!st.flags.get(flagName(x)))).length;
  function keep(n) {
    const name = flagName(settingOf(n).statename);
    if (name) st.flags.set(name, blockOf(n).enough);
  }
  function atLeastLook(n) {                         // UCBAtLeast.Repeat, every half second
    const b = blockOf(n), h = holdNow(n);
    if (h === b.holding) return;
    b.holding = h;
    value(n, `${h}/${needNow(n)} hold`);
    if ((h >= needNow(n)) === b.enough) return;
    b.enough = !b.enough;
    keep(n);
    sayOutput(n, b.enough ? 'Reached' : 'Lost');
  }
  // ---- UCBCounter: a number kept in a counter (StateName, else the block's name); Goal 0: none
  const counterRoot = (n) => flagName(settingOf(n).statename) || flagName(nameOf(n));
  const goalOf = (n) => (settingOf(n).goal === undefined || settingOf(n).goal === '' ? 3 : int(settingOf(n).goal));
  const showCount = (n) => value(n, goalOf(n) > 0 ? `count ${blockOf(n).count}/${goalOf(n)}` : `count ${blockOf(n).count}`);
  function setCount(n, k) {                          // UCBCounter.SetCount: the counter first, then what it says
    const b = blockOf(n), goal = goalOf(n), was = b.atGoal;
    if (k === b.count) return;
    b.count = k;
    st.counters.set(counterRoot(n), k);
    showCount(n);
    b.atGoal = goal > 0 && k >= goal;
    sayOutput(n, 'Changed');
    if (b.atGoal && !was) sayOutput(n, 'Reached');
    else if (was && !b.atGoal) sayOutput(n, 'Lost');
    if (b.atGoal && !was && settingOf(n).again) {
      Object.assign(b, { count: 0, atGoal: false });
      st.counters.set(counterRoot(n), 0);
      showCount(n);
    }
  }
  const counterLook = (n) => {                       // UCBCounter.Repeat: a rule or a dialogue changed the counter
    const k = st.counters.get(counterRoot(n)) || 0;
    if (k !== blockOf(n).count) setCount(n, k);
  };
  // ---- UCBFirstOf: a race, with a clock (TimeLimit seconds, in whole ticks)
  function startClock(n) {
    const b = blockOf(n), limit = parseFloat(settingOf(n).timelimit) || 0;
    if (b.over || limit <= 0) return;
    b.clock = ticksOf(limit);
    value(n, `clock ${Math.round(limit)}`);
  }
  function blockTick(n) {
    const b = blockOf(n), kind = blockKind(n);
    if (kind === 'atleast' && lookTick(tick)) atLeastLook(n);
    if (kind === 'counter' && lookTick(tick)) counterLook(n);
    if (kind === 'firstof' && b.clock > 0 && --b.clock === 0 && !b.over) {
      b.over = true;
      value(n, 'timed out');
      sayOutput(n, 'TimedOut');
    }
  }
  // UCBSwitch.WeightOf: "2,1,1", a missing or empty one 1
  function weightOf(n, k) {
    const part = String(settingOf(n).weights ?? '').split(',')[k];
    return part === undefined || part.trim() === '' ? 1 : Math.max(0, parseFloat(part) || 0);
  }
  function randomWay(n) {
    const w = Array.from({ length: ways(n) }, (_, k) => weightOf(n, k)), total = w.reduce((s, x) => s + x, 0);
    if (total <= 0) return Math.floor(random() * ways(n));
    let pick = random() * total;
    for (let k = 0; k < w.length - 1; k++) { pick -= w[k]; if (pick < 0) return k; }
    return w.length - 1;
  }
  // UCBAllOf / UCBGate / UCBSwitch.Input; an input it does not have: UCScript.Input's noinput
  function blockInput(n, input, r) {
    const b = blockOf(n), kind = blockKind(n), who = whoOf(r);
    const has = (list) => list.some((x) => low(x) === low(input));
    if (kind === 'allof' && has(['Add', 'TakeBack', 'Reset'])) {
      const at = b.ticked.findIndex((x) => low(x) === low(who));
      if (low(input) === 'add') {
        if (b.done || at >= 0 || b.ticked.length >= MAX_TICKS) return;
        b.ticked.push(who);
        value(n, `${b.ticked.length}/${b.need}`);
        if (b.ticked.length >= b.need) {
          b.done = true;
          if (settingOf(n).again) Object.assign(b, { ticked: [], done: false });
          sayOutput(n, 'Done');
        }
      } else if (low(input) === 'takeback') {
        if (at < 0) return;
        b.ticked.splice(at, 1);
        value(n, `${b.ticked.length}/${b.need}`);
        if (b.done) { b.done = false; sayOutput(n, 'Undone'); }
      } else { Object.assign(b, { ticked: [], done: false }); value(n, `0/${b.need}`); }
      return;
    }
    if (kind === 'gate' && has(['Pass', 'Open', 'Close', 'Toggle'])) {
      if (low(input) === 'pass') return sayOutput(n, b.closed ? 'Blocked' : 'Out');
      b.closed = low(input) === 'toggle' ? !b.closed : low(input) === 'close';
      return value(n, b.closed ? 'closed' : 'open');
    }
    if (kind === 'switch' && has(['Next', 'Reset'])) {
      if (low(input) === 'reset') { b.next = 0; return value(n, 'next 1'); }
      let way;
      if (modeOf(n) === 'at random') way = randomWay(n);
      else if (modeOf(n) === 'in order' && b.next >= ways(n)) { value(n, 'over'); return sayOutput(n, 'Over'); }
      else {
        if (b.next >= ways(n)) b.next = 0;
        way = b.next++;
        if (modeOf(n) !== 'in order' && b.next >= ways(n)) b.next = 0;
      }
      value(n, `picked ${way + 1}`);
      return sayOutput(n, `Out${way + 1}`);
    }
    if (kind === 'phases') {
      if (/^goto_/i.test(input)) {
        const k = phasesOf(n).findIndex((p) => low(p) === low(flagName(input.slice(5)))) + 1;
        return k ? setPhase(n, k) : write('', 'fail', map, nameOf(n), 'phase', input.slice(5), 'nophase');
      }
      if (has(['Next', 'Previous', 'Reset'])) return setPhase(n, low(input) === 'next' ? b.now + 1 : low(input) === 'previous' ? b.now - 1 : 1);
    }
    if (kind === 'counter' && has(['Add', 'Take', 'Reset'])) {
      if (low(input) === 'take' && b.count <= 0) return;   // (not under 0)
      return setCount(n, low(input) === 'add' ? b.count + 1 : low(input) === 'take' ? b.count - 1 : 0);
    }
    if (kind === 'firstof') {
      const m = /^In(\d)$/i.exec(input);
      if (m && +m[1] >= 1) {
        if (b.over || +m[1] > ways(n)) return;
        Object.assign(b, { over: true, clock: 0 });
        value(n, `first ${m[1]}`);
        return sayOutput(n, `First${m[1]}`);
      }
      if (has(['Start'])) return startClock(n);
      if (has(['Reset'])) { Object.assign(b, { over: false, clock: 0 }); return value(n, 'waiting'); }
    }
    write('', 'noinput', map, nameOf(n), input);
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
    if (e.hears === 'world') { worldHeard(h); return; }      // the world (P9 slice 3): the rules hear it themselves
    if (e.hears === 'start' || !present(h.thing)) return;    // the map starts by itself; what is not there says nothing
    const thing = nameOf(h.thing), by = h.by ?? setOffBy(SET_OFF_BY[e.hears], thing) ?? S.player;
    for (const [part, into] of CHANGES[h.output] || []) { if (into) st[part].set(thing, true); else st[part].delete(thing); }
    if (h.output === 'arrived' && sent.has(thing)) st.at.set(thing, sent.get(thing));
    if (h.output === 'near') st.jc = placeOf(thing) && [...placeOf(thing)];
    if (e.hears === 'timer' && timers.has(low(thing))) Object.assign(timers.get(low(thing)), { running: false, paused: false, left: 0 });
    drop(h.output, thing);
    if (CHANGES[h.output]?.some(([part]) => part === 'dead')) fates(thing, h.output);
    if (h.output === 'turnshostile') hostile.set(thing, true);
    if (e.hears === 'every') { pulses.set(pulseKey(thing, h.output), true); return; }   // the game rules' next look
    if (h.skip) hurry(tagFor('cutstart', thing));
    if (e.hears === 'watch') return;                         // its rules' next look notices it
    if (e.hears === 'prop') { pulses.set(pulseKey(thing, h.output), true); return; }   // so does a property's (S5)
    if (e.hears === 'becomes' || e.hears === 'changes') return;   // they read the state, which the user sets
    if (e.hears === 'port') return scripts.has(low(thing)) ? sayOutput(thing, h.port || '', h.value) : undefined;
    const tag = (h.output === 'used' && S.usables.get(low(thing))) || tagFor(h.output, thing, int(h.option));
    if (UNTRIGGERED.has(h.output)) untrigger(tag, thing, by);
    else trigger(tag, thing, by, h.output);                  // (a death: killed or knocked out, PAWN_OUTPUTS)
  }

  // ---- the world (P9 slice 3): UCRule.LookAtWorld / HearNoise / HearSpawn. h: {output, goal (its name, '' any), noise
  // (loud, gunshot, alarm, cry), what (character, body), thing (who made the noise, who appeared), by}. Each rule of
  // that output whose argument fits starts: "@by" and "@it" the one, a goal's name "it"; a rule on "loud" hears a shot.
  function worldHeard(h) {
    rules.forEach((r, i) => {
      if (!r.v2 || r.when !== h.output) return;
      const arg = low(r.worldArg);
      if (h.output === 'goaldone') {
        if (arg && arg !== low(h.goal)) return;
        return start(i, S.player, h.goal || '', r.when);
      }
      if (h.output === 'noise' && !(arg === low(h.noise) || (arg === 'loud' && low(h.noise) === 'gunshot'))) return;
      if (h.output === 'appears' && (arg || 'character') !== low(h.what || 'character')) return;
      const one = h.thing || '';
      start(i, h.output === 'loaded' || h.output === 'back' ? S.player : one, h.output === 'loaded' || h.output === 'back' ? '' : one, r.when);
    });
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
      came = run.came || 0;                          // UCRule.Advance: CameWith = RCame
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
    // ended / heard (P5, UCLink.StorySeen): the Story's end since the wait began
    const done = x.hurry || (s[3] === 'arrived' ? present(s[2]) && !st.dead.has(s[2]) && st.arrived.has(s[2])
      : s[3] === 'ended' || s[3] === 'heard' ? (st.seen?.get(low(s[2])) ?? -1) >= x.until.start : !c || holdsNow(c));
    if (done) { report(r, 'until', 'done', String(x.step), s[2] || ''); return true; }
    if (most > 0 && (tick - x.until.start) * frame >= most - 1e-9) { report(r, 'until', 'timeout', String(x.step), s[2] || ''); return true; }
    return false;
  }
  function stateCode(i) {
    const r = rules[i], x = rs[i];
    if (r.v2) { rulesCode(i); return; }
    if (r.also) return;
    came = x.came || 0;
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
    if (r.every) return lookAtMembers(i);            // UCRule.TickStory: a rule on a set looks at its members
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
      if (now && r.watchStart && r.hears === 'becomes') runRule(i, '');      // a "while" that holds from the start
      return;
    }
    if (now && (!x.was || r.watch.includes(' down'))) runRule(i, r.hears === 'becomes' ? '' : nameOf(thing));
    x.was = now;
  }
  // would a watched rule's next look set it off (what is due next)
  function watchDue(r, x) {
    if (!x.polled) return r.watchStart && r.hears === 'becomes' && holdsQuietly(r.watch);
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
    if (x.fates.length) lookAtFates(i);              // its Tick: a member of its set gone down (UCRule.LookAtFates)
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
    if (r.every) return;                             // UCRule.Hook: a rule on a set looks, it hooks itself to nothing
    if (!r.source || !HOOKED.has(r.hears) || (r.when === 'used' && S.usables.has(low(r.source)))) return;
    if (!present(r.source)) { rs[i].deaf = true; report(r, 'hook', r.source, 'missing'); }
    else if (AIMS.some((c) => isa(r.source, c)) || (isa(r.source, 'MoreTriggers') && r.when !== 'leave')) {
      rs[i].deaf = true;
      report(r, 'hook', r.source, 'target');
    }
  }

  const run = {
    st, rs, lines, timers, scripts, blocks,
    get pending() { return pending; },
    get tick() { return tick; },
    // PostBeginPlay, in the map's order: what scripts say while it loads, then each rule hooks itself (t = 0, A6)
    load() {
      turn = { kind: 'load' };
      for (const a of S.order) {
        if (scripts.has(low(a.name)) && present(a.name)) for (const o of behaviour(a.name).loading || []) sayOutput(a.name, o);
      }
      rules.forEach((r, i) => hook(i));
      // the hub's start values (UCLogicHub.ApplyStarts): each one not set yet is set, one set already is kept; the
      // game does it as the player comes in, before the rules' first look
      for (const [n, kind, v] of S.starts) {
        const table = kind === 'i' ? st.counters : st.flags, had = table.has(n);
        if (!had) table.set(n, kind === 'i' ? int(v) : v === '1');
        const now = table.get(n);
        write('', 'start', map, n, kind === 'i' ? String(int(now)) : now ? 'true' : 'false', had ? 'kept' : 'set');
      }
    },
    // one tick: the map's objects (scripts start, timers count, a cutscene that waits starts), then the rules; JC's
    // part is what happen() adds
    play(k) {
      tick = k;
      turn = { kind: 'placed' };
      for (const a of S.order) {
        if (!present(a.name)) continue;
        if (scripts.has(low(a.name))) startScript(a.name);
        if (blockKind(a.name) && scripts.get(low(a.name))?.started) blockTick(a.name);
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
        for (const f of x.fates) due.push(Math.max(f.at, tick + 1));
        const r = rules[i];
        if (r.every && !EACH_FRAME.has(r.when) && [...pulses.list()].some((k) => k.endsWith('|' + r.when))) {
          let k = tick + 1;
          while (!lookTick(k)) k++;
          due.push(k);
        }
        if ((r.hears === 'start' && !x.started) || (r.hears === 'watch' && x.polled && watching(r) !== x.was)
          || ((r.hears === 'prop' || r.hears === 'becomes' || r.hears === 'changes') && watchDue(r, x))) {
          let k = tick + 1;
          while (!lookTick(k)) k++;
          due.push(k);
        }
      });
      for (const t of timers.values()) if (t.running && !t.paused) due.push(tick + Math.max(1, t.left));
      for (const [n, b] of blocks) {                 // a race's clock; At least N whose next look sees a change
        if (!present(n)) continue;
        if (blockKind(n) === 'firstof' && b.clock > 0 && !b.over) due.push(tick + b.clock);
        if ((blockKind(n) === 'atleast' && holdNow(n) !== b.holding)
          || (blockKind(n) === 'counter' && (st.counters.get(counterRoot(n)) || 0) !== b.count)) {
          let k = tick + 1;
          while (!lookTick(k)) k++;
          due.push(k);
        }
      }
      if (queuedStarts()) due.push(tick + 1);
      return due.length ? Math.min(...due) : null;
    },
    present, nameOf, ofRule,
    // the Story's conversations (P5): the player starts one; on to the next line or answer k; why one cannot start;
    // the one playing now; what was said
    talk(id) { turn = { kind: 'jc' }; return startTalk(id, S.player); },
    say(k) { turn = { kind: 'jc' }; talkSay(k); },
    talkWhyNot,
    talking: () => (talk.now ? { id: talk.now.id, owner: talk.now.owner, by: talk.now.by, shown: talk.now.shown } : null),
    said: () => talk.said.map((e) => ({ ...e })),
    isBlock: (n) => !!blockKind(n),            // a logic block: what it says is its own to work out, not the user's
    setMembers,                                // anyone of a set (P9): its living members now
    holds: (c) => conditionHolds(c, game),     // a condition now (Try it's player rows: P9 slice 2)
    itemChain,
  };
  return run;
}

// The player's own conditions (P9 slice 2), for Try it's rows: what to set so that one holds (yes) or does not.
const PLAYER_KINDS = new Set(['health', 'energy', 'skillpoints', 'aug', 'water', 'zone', 'items']);
const OPPOSITE = { '>=': '<', '<': '>=', '>': '<=', '<=': '>', '==': '!=', '!=': '==' };
function aimAt(op, v, yes) {
  const o = yes ? op : OPPOSITE[op];
  return { '<': v - 1, '<=': v, '==': v, '!=': v + 1, '>=': v, '>': v + 1 }[o] ?? v;
}
function makeHold(c, yes, st, chain) {
  const v = int(c.value);
  switch (c.type) {
    case 'health': case 'energy': return { [c.type]: Math.max(0, Math.min(100, aimAt(c.op, v, yes))) };
    case 'skillpoints': return { skillpoints: Math.max(0, aimAt(c.op, v, yes)) };
    case 'water': return { water: yesOf(c, 'is') === yes };
    case 'zone': return { zone: yesOf(c, 'is') === yes ? c.zone : '' };
    case 'aug': {
      const want = yesOf(c, 'is') === yes, n = int(c.level) || 1;
      if (c.how === 'on') return { augs: { [c.aug]: want ? { has: true, on: true, level: 1 } : { has: true, on: false, level: 1 } } };
      if (c.how === 'level') return { augs: { [c.aug]: want ? { has: true, level: n } : n > 1 ? { has: true, level: n - 1 } : null } };
      return { augs: { [c.aug]: want ? { has: true, level: 1 } : null } };
    }
    case 'items': {                          // the things of that kind taken away, then as many as it needs of the kind
      const want = Math.max(0, Math.min(20, aimAt(c.op, v, yes))), kind = low(String(c.item).split('.').pop());
      return { items: [...st.items.filter((i) => !chain(i).includes(kind)), ...Array(want).fill(c.item)] };
    }
    default: return null;
  }
}

// ---------------------------------------------------------------- the session
// A Try-it session on a map's compiled logic:
//   actors, outputs, left   what logic_compile.compiled gives (/api/logic/compile): the compiled actors, how each
//                           output is heard (config/logic.json's outputs serve too), the rules left out of the game
//   world                   {player: JC's actor name, actors: [{name, chain (its class first), at, tag, seconds, loop,
//                           autostart, floors, ports, script: {input, started, loading, triggered, untriggered}, once
//                           and keys (a cutscene's bOnce, false to play again, and how many camera keys it has),
//                           motion (an animated object's UCMotion actor, motions.blocks), block (a logic block's settings:
//                           need, again, closed, choices, mode, weights), absent}]} in the map's order
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
  const apply = (input) => (input.fire ? run.happen(input.fire) : input.talk ? run.talk(input.talk)
    : input.say !== undefined ? run.say(input.say) : run.change(input.set));
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
      health: st.health, energy: st.energy, skillpoints: st.skillPoints, water: st.water, zone: st.zone,
      ...(st.keyring ? { keyring: { ...st.keyring } } : {}),
      augs: Object.fromEntries([...st.augs].map(([k, x]) => [k, { ...x }])),
      rules: Object.fromEntries(S.rules.map((r, i) => [r, run.rs[i]]).filter(([r]) => !r.also).map(([r, x]) => {
        if (!r.v2) return [r.id, { done: x.done, running: x.running, step: x.step, next: x.running ? at(x.wake) : null }];
        // a UCRule (its other causes are part of it): its runs going on, the first one's step, the next due
        const live = x.slots.filter((s) => s?.running);
        return [r.id, { done: x.done, running: live.length > 0, step: live[0]?.step ?? 0, runs: live.length,
          next: live.length ? at(Math.min(...live.map((s) => s.wake))) : null }];
      })),
      timers: Object.fromEntries([...run.timers].map(([k, t]) => [run.nameOf(k), { running: t.running, paused: t.paused, left: at(t.left) }])),
      scripts: Object.fromEntries([...run.scripts].map(([k, s]) => [run.nameOf(k), { started: s.started, waiting: s.waiting.map((w) => w.name) }])),
      // the logic blocks: what each holds (P3)
      blocks: Object.fromEntries([...run.blocks].map(([k, b]) => [run.nameOf(k), { ticked: [...b.ticked], done: b.done, need: b.need,
        closed: b.closed, next: b.next, now: b.now, holding: b.holding, enough: b.enough, over: b.over, clock: at(b.clock),
        count: b.count, atGoal: b.atGoal }])) };
  }
  // the lines a rule wrote, read (logic-log.js), and its counts: the run keeps them (newRun, ofRule)
  const linesOf = (id) => run.ofRule(id)?.lines || [];
  const counts = () => Object.fromEntries(S.rules.map((r) => [r.id, { ...run.ofRule(r.id).counts }]));
  function happenings() {
    const out = [];
    for (const r of S.rules) {
      // a rule on anyone of a set (P9): each member there now, what can happen to it (killed or knocked out: both)
      if (r.every) {
        for (const n of run.setMembers(r.every)) {
          for (const o of r.when === 'dies' ? ['killed', 'knockedout'] : [r.when]) {
            let h = out.find((q) => low(q.thing) === low(n) && q.output === o);
            if (!h) out.push(h = { thing: n, output: o, option: 0, port: '', near: 0, rules: [], watched: !EACH_FRAME.has(o), present: true });
            if (!h.rules.includes(r.id)) h.rules.push(r.id);
          }
        }
        continue;
      }
      // the thing that says it: the rule's object; the player for one of his (his health); the game's event by its
      // name. A condition that becomes so, a value that changes: the State panel, not a button
      // the world's own (P9 slice 3): one button for each, as the rule asks for it (a goal of its name, a noise of its
      // kind, a character or a body)
      if (r.hears === 'world') {
        const world = r.when === 'goaldone' ? { goal: r.worldArg || 'AnyGoal' } : r.when === 'noise' ? { noise: low(r.worldArg) || 'loud' }
          : r.when === 'appears' ? { what: low(r.worldArg) || 'character' } : {};
        const key = JSON.stringify([r.when, world]);
        let h = out.find((q) => q.key === key);
        if (!h) out.push(h = { key, thing: '', output: r.when, option: 0, port: '', near: 0, world, rules: [], watched: false, present: true });
        if (!h.rules.includes(r.id)) h.rules.push(r.id);
        continue;
      }
      const thing = r.hears === 'gametag' ? r.gameTag : r.source || (r.hears === 'prop' ? S.player : '');
      if (!thing || r.hears === 'start' || r.hears === 'becomes' || r.hears === 'changes') continue;
      if (r.when === 'output' && run.isBlock(r.source)) continue;      // a logic block says its outputs by itself
      const same = (h) => low(h.thing) === low(thing) && h.output === r.when && h.option === r.option && low(h.port) === low(r.port);
      let h = out.find(same);
      if (!h) out.push(h = { thing, output: r.when, option: r.option, port: r.port, near: r.near, rules: [],
        ...(r.when === 'output' && (S.byName.get(low(thing))?.ports?.outputs || []).some((p) => low(p.id) === low(r.port) && p.carries)
          ? { carries: true } : {}),                 // it comes with a number (P8 slice 5b): Try it asks for it
        ...(r.when === 'signal' ? { signal: String(r.gameTag).replace(/^UCS_/i, '') } : {}),
        ...(r.when === 'ended' ? { dialogue: String(r.gameTag).replace(/^UCD_/i, '') } : {}),
        ...(r.when === 'heard' ? { infolink: String(r.gameTag).replace(/^UCI_/i, '') } : {}),
        watched: r.hears === 'watch' || r.hears === 'prop', present: r.hears === 'gametag' || run.present(thing) });
      h.rules.push(r.id);
    }
    // a step "Wait until" the Story's end (P5): its end, as the game's event the dialogue / InfoLink sets off
    for (const r of S.rules) {
      for (const s of r.steps ? r.acts : []) {
        if (s[1] !== 'until' || (s[3] !== 'ended' && s[3] !== 'heard') || !s[2]) continue;
        let h = out.find((o) => low(o.thing) === low(s[2]) && o.output === s[3]);
        if (!h) out.push(h = { thing: s[2], output: s[3], option: 0, port: '', rules: [], watched: false, present: true,
          ...(s[3] === 'ended' ? { dialogue: s[2].replace(/^UCD_/i, '') } : { infolink: s[2].replace(/^UCI_/i, '') }) });
        if (!h.rules.includes(r.id)) h.rules.push(r.id);
      }
    }
    return out;
  }

  function asks() {
    const out = [];
    for (const r of S.rules) {
      for (const text of [r.watch, ...r.conds, ...r.stepConds]) {
        const c = text ? decodeCondition(text) : null;
        if (!c || !PLAYER_KINDS.has(c.type)) continue;
        let p = out.find((x) => x.text === text);
        if (!p) out.push(p = { text, c, rules: [] });
        if (!p.rules.includes(r.id)) p.rules.push(r.id);
      }
    }
    for (const p of out) p.holds = run.holds(p.c);
    return out;
  }

  function places() {
    const out = [];
    for (const r of S.rules) {
      for (const text of [r.watch, ...r.conds, ...r.stepConds]) {
        const c = text ? decodeCondition(text) : null;
        if (!c || c.type !== 'near') continue;
        let p = out.find((x) => x.at.every((v, k) => v === c.at[k]) && x.radius === c.radius);
        if (!p) out.push(p = { at: c.at, radius: c.radius, rules: [] });
        if (!p.rules.includes(r.id)) p.rules.push(r.id);
      }
    }
    const jc = run.st.jc;
    for (const p of out) p.here = nearHolds(p, jc);
    return out;
  }

  // ---- why didn't it fire? (explain: this session's log)
  const why = (id) => explain(S, id, { linesOf, present: run.present, state: (i) => run.rs[i], at, words, vocab,
    all: () => run.lines.map((e, n) => ({ ...e, n, entry: parseLogicLine(LOGIC_TAG + e.line) })) });

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
    // paused, left}}, scripts: {name: {started, waiting}}, blocks: {name: {ticked, done, need, closed, next, now, holding, enough, over, clock}}}
    state,
    // per rule: {fired, once, running, cond (refused for each), acted, failed, last (when it last fired)}
    counts,
    // what the rules wait for, thing by thing (the world's buttons): [{thing, output, option, port, near, rules, watched,
    // present}]
    happenings,
    // the points the rules' conditions ask the player to be near (or not), their watch, conditions and steps':
    // [{at, radius, rules, here: the player is within it now}]; the player goes there with set({jc: at}), away with
    // set({jc: null})
    places,
    // the player's own conditions the rules ask about (P9 slice 2: health, energy, skill points, an augmentation, in
    // water, in a zone, things of a kind), their watch, conditions and steps': [{text, c, rules, holds}]; make(i, yes)
    // sets what makes the i-th hold (or not): its lines
    asks,
    makeAsk: (i, yes) => { const p = asks()[i], parts = p && makeHold(p.c, yes, run.st, run.itemChain); return parts ? happen({ set: parts }) : []; },
    // "Why didn't it fire?" in sentences, from this session's log and the compiled logic
    why,
    // the Story's conversations (P5, world.story.talks): the dialogues the player can start, [{id, title, owner, start
    // (talk, near), why ('' it can start now, else the log's reason: busy, unmet, played, missing)}]; the one playing
    // now, {id, owner, by, shown: a line {who, text} or a choice {options: [{k, text, shown}]}} or null; what was said,
    // [{t, at (the log's lines before it), kind (start, line, answer, effect, end), dialogue or infolink, who, text,
    // step or action (an effect's), by (a start's), why (an end's)}]. talk(id): the player starts one; say(k): on to
    // the next line (k < 0), or the player's answer k. Each is kept with its tick, as what happens is.
    talks: () => Object.entries(S.story?.talks || {}).filter(([, d]) => d.owner)
      .map(([id, d]) => ({ id, title: d.title || id, owner: d.owner, start: d.start || 'talk', why: run.talkWhyNot(id) })),
    talking: () => run.talking(),
    said: () => run.said(),
    talk: (id) => happen({ talk: id }),
    say: (k) => happen({ say: k }),
  };
}

// a dialogue's steps as the game names its states (story.py: conditions.ident), each step's id its place (what the
// conversation reads back after an effect)
function gameSteps(steps) {
  const named = (c) => (c && c.flag ? { ...c, flag: gameName(c.flag) } : c);
  const reqs = (x) => (Array.isArray(x.requires) ? { requires: x.requires.map(named) } : {});
  return (steps || []).map((s, k) => ({ ...named(s), ...reqs(s), id: k,
    ...(Array.isArray(s.options) ? { options: s.options.map((o) => ({ ...named(o), ...reqs(o) })) } : {}) }));
}
