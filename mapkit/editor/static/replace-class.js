// Replace with... (Edit menu, an object's right click, Alt + a browser item let go on the selection), as Unity's
// prefab Replace: every selected object becomes an object of another class at the same place, turn and size and
// under its own name, so what the editor keeps under that name (its rules, the routes and cutscenes that name it,
// the Story) stays its own. The logic only, without the page: which properties go over to the new class, where the
// new object stands, and which uses of the name the new class no longer answers (app.js reads the classes, asks
// and writes it all as one Ctrl+Z).
import { OWN, baseOf } from './prop-sets.js';

// what the object is in the level's logic, its own over a browser item's preset: the names other objects and the
// Story find it by (prop-sets.js OWN), a character's orders and the patrol route it starts
export const KEEP = new Set([...OWN, 'Orders', 'OrderTag']);
// the old class's look: the new object has its class's own, or its item's (a model's mesh, a character's clothes)
export const LOOK = new Set(['Mesh', 'Skin', 'MultiSkins', 'Texture', 'DrawScale', 'PrePivot', 'LookBody',
  'CollisionRadius', 'CollisionHeight']);

// The properties of the new object: the old object's (old: {key: UnrealEd text}) that the new class also has
// (has(property)), its look left out; the browser item's own (preset: a model's, a character's) over them; the old
// object's KEEP over all. under: what a new object of the item starts with that only fills in (a new light's colour
// and reach under the old light's). lost: the old object's keys the new class has no property for.
export function carryProps(old, preset, has, under = {}) {
  const kept = {}, own = {}, lost = [];
  for (const [key, value] of Object.entries(old || {})) {
    const prop = baseOf(key);
    if (LOOK.has(prop)) continue;
    if (!has(prop)) { lost.push(key); continue; }
    kept[key] = value;
    if (KEEP.has(prop)) own[key] = value;
  }
  return { props: { ...(under || {}), ...kept, ...(preset || {}), ...own }, lost };
}

// Where the new object stands (loc: the middle of its collision, Unreal units): its feet where the old one's were,
// the two half heights in the map's units; where its middle was when the old one was tipped (a lamp on a wall) or
// a height is not known (0: a light or a logic point, which stand on nothing)
export function seatedAt(loc, rot, oldHalf, newHalf) {
  const tipped = (rot?.[0] || 0) % 65536 !== 0 || (rot?.[2] || 0) % 65536 !== 0;
  if (tipped || !(oldHalf > 0) || !(newHalf > 0)) return [...loc];
  return [loc[0], loc[1], loc[2] - oldHalf + newHalf];
}

// Its turn [pitch, yaw, roll]: a character stands, it only keeps the yaw; anything else keeps the whole turn
export const turnOf = (rot, standing) => (standing ? [0, rot[1] || 0, 0] : [rot[0] || 0, rot[1] || 0, rot[2] || 0]);

// What the editor keeps of an object under its name (edits[field][name]), what the new object must be for it to
// still mean something, and how it is called
export const KEPT = [
  ['anims', 'character', 'its animation (Animation)'],
  ['behave', 'character', 'its Movement and Tactics'],
  ['texts', 'computer', 'its emails and bulletins'],
  ['documents', 'text', 'its text'],
  ['cutscenes', 'cutscene', 'its cutscene (keys and subtitles)'],
  ['fxpreview', 'effect', 'its effect preview'],
  ['particlepreview', 'particles', 'its particles preview (always played)'],
];
// what a use the new object does not answer says of it
export const NEEDS = {
  output: 'it never does that', input: 'it cannot do that', character: 'it is no character', talker: 'it cannot talk',
  door: 'it is no door', computer: 'it is no computer', text: 'it has no text', cutscene: 'it is no cutscene camera',
  effect: 'it is no effect point', patrol: 'it is no patrol point', particles: 'it throws no particles',
};

// Where the Story names `name`: [{need, where}], once per need and dialogue or event. A dialogue it owns, or a line
// it says, needs one that talks; an event when it dies, a condition that it lives, an action on a character need a
// character; an action on a door a door.
function storyUses(story, name) {
  const out = new Map();
  const add = (need, where) => out.set(need + '|' + where, { need, where });
  const walk = (o, where) => {
    if (Array.isArray(o)) { for (const x of o) walk(x, where); return; }
    if (!o || typeof o !== 'object') return;
    if (o.owner === name || o.who === 'actor:' + name) add('talker', where);
    if (o.actor === name) add(o.type === 'door' ? 'door' : 'character', where);
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, where);
  };
  for (const d of story?.dialogues || []) walk(d, `dialogue "${d.title || d.id}"`);
  for (const e of story?.events || []) walk(e, `event "${e.title || e.id}"`);
  return [...out.values()];
}

// Every use of the name `name` the editor knows outside the object's own properties: [{need, ...}]. The rules
// (links: edits.links) it sets off (rule), the actions on it (rule, action), their conditions that it lives; the
// Story's (where); what edits keeps under the name (field); the characters whose patrol route goes through it
// (routes: their labels, who)
export function usesOf(name, { links = [], story = null, edits = {}, routes = [] } = {}) {
  const uses = [];
  for (const rule of links) {
    if (rule.src === name) uses.push({ need: 'output', rule });
    for (const action of rule.do || []) if (action.target === name) uses.push({ need: 'input', rule, action });
    if ((rule.requires || []).some((c) => c.type === 'alive' && c.actor === name)) uses.push({ need: 'character', rule });
  }
  uses.push(...storyUses(story, name));
  for (const [field, need, label] of KEPT) if (edits[field]?.[name] !== undefined) uses.push({ need, field, label });
  for (const who of routes) uses.push({ need: 'patrol', who });
  return uses;
}

// The uses the new object no longer answers: fits[need] is true, false, or a test of the use (a rule's output, an
// action's input)
export function misfits(uses, fits) {
  return uses.filter((u) => { const f = fits[u.need]; return !(typeof f === 'function' ? f(u) : f); });
}
