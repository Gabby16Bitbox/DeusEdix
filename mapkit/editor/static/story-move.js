// "Move to Logic" (P5): an event of the map's Story made a rule of the Logic window, keeping what it does in the game.
// The logic only, no page code: story.js shows the preview and moves it, app.js keeps both in one step of the history.
//
// A Story event (story.py event_code) is looked at every half second, not during a conversation: when its condition
// (`when`) and all its conditions (`requires`) hold, its actions run (once: then never again). The rule made of it:
//   * hears the map's start, or its condition becoming true ("becomes"), with `watchStart` so that a condition that
//     already holds when the map starts sets it off, as the Story's first look does;
//   * checks the condition and the event's conditions together, and is set off again by each of the event's
//     conditions becoming true ("Or when", `also`): it runs as soon as all hold, in whatever order they came;
//   * waits for a conversation to end before its actions (`talkBusy: wait`), as the Story waits to look;
//   * on the UNATCO route only, as the Story is in the mod's own campaign (`route`).
// What cannot be kept is said (notes) and what cannot be moved at all refuses the move (refused), each in words.
import { conditionProblem, kindOf, MAX_CONDITIONS } from './conditions.js';

// the event's condition (`when`) as the rule's cause: [rule fields] or null (it cannot be moved)
const WHEN = {
  start: () => ({ when: 'start' }),
  flag: (w) => (w.flag ? { when: 'becomes', watch: { flag: w.flag, is: w.is !== false } } : null),
  dead: (w) => (w.actor ? { when: 'becomes', watch: { type: 'alive', actor: w.actor, is: false } } : null),
  item: (w) => (/^\w+\.\w+$/.test(w.item || '') ? { when: 'becomes', watch: { type: 'item', item: w.item, has: true } } : null),
  // the player comes within the radius of the point: the condition "near a point" (UCEditorStory.Near, as the Story)
  near: (w) => (Array.isArray(w.at) && w.at.length === 3 && w.at.every((v) => Number.isFinite(+v))
    ? { when: 'becomes', watch: { type: 'near', at: w.at.map((v) => Math.round(+v)), radius: Math.round(+w.radius || 256), is: true } } : null),
};
const WHY_NOT_WHEN = {
  hostile: 'it starts when a faction turns hostile, and rules have no such condition yet',
};

// a Story character action's act -> the rule's verb (config/logic.json "story": stop, hide, show; the others the same)
const NPC_VERBS = { stop: 'stand', hide: 'leave', show: 'appear', goto: 'goto', run: 'run', attack: 'attack',
  hostile: 'hostile', neutral: 'neutral', friend: 'friend', wander: 'wander', follow: 'follow', sit: 'sit', standup: 'standup' };
const DOOR_VERBS = ['open', 'close', 'lock', 'unlock', 'blow'];

// one Story action (story.py action_code) -> {act} the rule's action, or {why} it has no rule action
export function moveAction(a) {
  const act = (fields) => ({ act: { delay: 0, ...fields } });
  switch (a?.type) {
    case 'flag': return a.flag ? act({ verb: 'flag', a: a.flag, b: a.is === false ? '0' : '1' }) : { why: 'a "Change state" with no state' };
    case 'goal': return act({ verb: 'goal', a: a.goal || '', b: a.text || '', c: a.done ? 'done' : '' });
    case 'note': return act({ verb: 'note', a: a.text || '' });
    case 'message': return act({ verb: 'message', a: a.text || '' });
    case 'signal': return a.signal ? act({ verb: 'signal', a: a.signal }) : { why: 'a "Send a signal" with no signal' };
    case 'talk': return a.dialogue ? act({ verb: 'talk', a: a.dialogue }) : { why: 'a "Start a dialogue" with no dialogue' };
    case 'infolink': return a.infolink ? act({ verb: 'infolink', a: a.infolink }) : { why: 'a "Play an InfoLink" with no InfoLink' };
    case 'travel': return a.map ? act({ verb: 'travel', a: a.map, b: a.tag || '' }) : { why: 'a "Take the player to another map" with no map' };
    case 'cutscene': return a.cutscene ? act({ verb: 'cutplay', target: a.cutscene }) : { why: 'a "Play a cutscene" with no cutscene' };
    case 'door':
      if (!a.actor) return { why: 'a door action with no door' };
      return act({ verb: DOOR_VERBS.includes(a.act) ? a.act : 'open', target: a.actor });
    case 'npc': {
      if (!a.actor) return { why: 'a character action with no character' };
      const verb = NPC_VERBS[a.act || 'stop'];
      if (!verb) return { why: a.act === 'join' ? 'a character joins a faction, which rules cannot do yet' : `a character action "${a.act}"` };
      const x = { verb, target: a.actor };
      if (verb === 'goto' || verb === 'run') { x.at = [...(a.at || [0, 0, 0])]; x.nav = !!a.nav; }
      if ((verb === 'attack' || verb === 'hostile') && a.alone) x.a = 'alone';
      if (verb === 'sit') { if (!a.seat) return { why: 'a character sits with no chair chosen' }; x.a = a.seat; }
      return act(x);
    }
    case 'act':                                  // a Logic action already (P5): as it is
      return a.act && a.act.verb ? act({ ...JSON.parse(JSON.stringify(a.act)), delay: 0 }) : { why: 'an action with nothing to do' };
    case 'trigger': return { why: 'it triggers an event (Tag), which rules cannot do: make it a signal' };
    case 'faction': return { why: 'it changes a whole faction, which rules cannot do yet' };
    default: return { why: `an action "${a?.type}" that rules do not have` };
  }
}

// e: the Story event; ctx: {route: the Story's ('unatco': the mod's own campaign, only on the UNATCO route),
// standalone: a project of its own (no route), max: the conditions a rule takes (8)}
// -> {rule: the rule without its id (app.js gives it), notes: what is not quite the same, refused: why it cannot move}
export function moveEvent(e, { route = 'unatco', standalone = false, max = MAX_CONDITIONS } = {}) {
  const refused = [], notes = [];
  const w = e?.when || {};
  const cause = WHEN[w.type] ? WHEN[w.type](w) : null;
  if (!cause) refused.push(WHY_NOT_WHEN[w.type] || (WHEN[w.type] ? 'its condition is not filled in' : `it starts on "${w.type}"`));
  const acts = [];
  for (const a of e?.do || []) {
    const m = moveAction(a);
    if (m.why) refused.push(m.why); else acts.push(m.act);
  }
  if (!acts.length && !(e?.do || []).length) refused.push('it has no actions');
  const own = (e?.requires || []).filter((c) => c && kindOf(c));
  if (own.some((c) => conditionProblem(c))) refused.push('one of its conditions is not filled in');
  const requires = JSON.parse(JSON.stringify(own));
  if (!standalone && route === 'unatco') requires.push({ flag: 'UNATCORouteCommitted', is: true });
  const rule = { src: '', ...(cause || { when: 'start' }), once: e?.once !== false, at: [0, 0, 0], do: acts, talkBusy: 'wait',
    origin: { story: e?.id || '', title: e?.title || '' } };
  if (cause?.when === 'becomes') {
    rule.watchStart = true;                     // the Story's first look: it already holds when the map starts
    // set off again by another condition, the rule checks its own too (alone, its becoming true says it holds)
    if (requires.length) {
      rule.requires = [JSON.parse(JSON.stringify(cause.watch)), ...requires];
      rule.also = requires.map((c) => ({ when: 'becomes', watch: JSON.parse(JSON.stringify(c)) }));
    }
  } else if (requires.length) rule.requires = requires;
  if ((rule.requires || []).length > max) refused.push(`it has ${(rule.requires || []).length} conditions with its own, and a rule takes ${max}`);
  if (w.type !== 'start') {
    if (e?.once === false) notes.push('The Story does its actions again every half second while it holds; the rule does them each time it becomes true.');
    notes.push('The Story does not look during a conversation; the rule waits for the conversation to end before its actions.');
    if (e?.once !== false) notes.push('In a game saved before the move, where it has happened already, it can happen once more.');
  }
  if (!standalone && route === 'unatco') notes.push('It runs only on the UNATCO route, as the Story does (the state UNATCORouteCommitted).');
  return { rule, notes, refused };
}

// Put back: the rule as it is in the map now (or null: gone) against the rule as it was moved (both without ids and
// labels): what is lost by putting the event back, in words ('' nothing)
export function putBackLoss(now, moved) {
  if (!now) return 'The rule is no longer in the map: the event comes back as it was.';
  const plain = (r) => { const x = JSON.parse(JSON.stringify(r || {})); delete x.id; delete x.label; for (const a of x.do || []) delete a.id; return JSON.stringify(x); };
  return plain(now) === plain(moved) ? '' : 'The rule was changed in Logic since it was moved: those changes go with it.';
}
