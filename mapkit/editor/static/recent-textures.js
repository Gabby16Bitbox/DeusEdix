// Face selection's recent textures, as ProBuilder's Material Palette: the last textures put on faces, newest first,
// kept in the project (app.js: projectStorageKey 'recentTextures'), shown as a strip in the Surface panel
// (surface-ui.js); Alt+1…9 and Alt+0 put one on the selected faces (menubar.js ACTIONS, context faces). No page here.
import { validTextureReference } from './texture-transfer.js';

export const MAX_RECENT = 10;
// the command of each place on the strip, in order (menubar.js ACTIONS: Alt+1…9, then Alt+0)
export const RECENT_ACTIONS = ['facetex1', 'facetex2', 'facetex3', 'facetex4', 'facetex5', 'facetex6', 'facetex7',
  'facetex8', 'facetex9', 'facetex10'];

// the list kept, read back: texture references only (as a face takes them), each once, at most MAX_RECENT; anything
// else (unreadable, hand-edited) is left out
export function readRecent(text) {
  let data = null;
  try { data = JSON.parse(text || 'null'); } catch { /* unreadable: none */ }
  return (Array.isArray(data) ? data : []).filter((ref, i, all) => validTextureReference(ref) && all.indexOf(ref) === i)
    .slice(0, MAX_RECENT);
}

// the list with `ref` first: a texture put from the Texture list, the picker or a drag (put again, it moves to the
// front; one put from the strip itself is not passed here, so the strip's keys stay where they are while it is used)
export function withRecent(list, ref) {
  return [ref, ...list.filter((t) => t !== ref)].slice(0, MAX_RECENT);
}

// the place on the strip of the digit pressed with Alt: 1…9 the first nine, 0 the tenth
export const slotOfDigit = (digit) => (Number(digit) + 9) % 10;
