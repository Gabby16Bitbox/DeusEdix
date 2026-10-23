import { tagMatches } from './object-tags.js';
// Pure selection rules shared by the area UI and its regression tests.
export const AREA_VERBS = {
  light: ['lightoff', 'lighton', 'lighttoggle'],
  character: ['friend', 'neutral', 'hostile', 'attack', 'stand', 'wander', 'follow', 'goto', 'run', 'leave', 'appear'],
  object: ['hide', 'show', 'on', 'off'],
};
export function areaContains(area, point) {
  return Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)
    && Math.hypot(...point.map((v, i) => v - area.at[i])) <= area.radius;
}
export function areaMembers(area, actors, source, position, category, excluded = () => false, tagOf = () => '') {
  return actors.filter(a => a.name !== source && !excluded(a.name) && category(a) === area.kind
    && tagMatches(tagOf(a), area.tag) && areaContains(area, position(a.name))).map(a => a.name);
}
export function areaRecipients(area, current, available) {
  return [...new Set([...(area.members || []), ...(area.dynamic ? current : [])])].filter(available);
}
