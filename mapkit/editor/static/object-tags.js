// Logical scripting tags deliberately do not replace the game's native Tag/Event.
export const COLOR_TAGS = [['red',0],['orange',21],['yellow',43],['green',85],['cyan',128],['blue',170],['purple',191],['magenta',213],['pink',234]];
export const TAG_VERBS = ['open','close','toggle','lock','unlock','blow','attack','hostile','friend','neutral','stand','wander','follow','goto','run','leave','appear','lighton','lightoff','lighttoggle','hide','show','on','off'];
export const validScriptTag = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value);
export const tagMatches = (value, wanted) => !wanted || String(value).toLowerCase() === String(wanted).toLowerCase();
export function lightTag(hue=0, saturation=255) {
  if (Number(saturation) >= 220) return 'white';
  const h = Math.max(0, Math.min(255, Number(hue)||0));
  let nearest = 'red', best = Infinity;
  for (const [name, anchor] of COLOR_TAGS) {
    const d = Math.min(Math.abs(h-anchor), 255-Math.abs(h-anchor));
    if (d < best) { best = d; nearest = name; }
  }
  return nearest;
}
export function automaticTag({kind, disposition, hue, saturation, cls=''}) {
  if (kind === 'light') return lightTag(hue,saturation);
  if (kind === 'character') return disposition === 'hostile' || disposition === 'enemy' ? 'enemy' : disposition === 'friendly' ? 'friendly' : 'neutral';
  return ({door:'door',button:'button',trigger:'trigger',camera:'camera',item:'item',path:'path',player:'player',object:'object'})[kind]
    || String(cls).split('.').pop().toLowerCase().replace(/\W/g,'_') || 'object';
}
export function scriptTag(actor, edits, describe, baked = {}) {
  const explicit = edits.objectTags?.[actor.name] || baked[actor.name];
  if (explicit?.mode === 'manual') return explicit.value;
  const info = describe(actor);
  if ((!explicit || explicit.mode === 'original') && originalTag(info)) return originalTag(info);
  return automaticTag(info);
}
export function originalTag(info) {
  const tag = String(info.legacyTag || '').replace(/^"|"$/g,'');
  const cls = String(info.cls || '').split('.').pop();
  return tag && !['none',cls.toLowerCase()].includes(tag.toLowerCase()) ? tag : '';
}
