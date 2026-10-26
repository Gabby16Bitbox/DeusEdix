// What the 3D view shows for the moment, as Unity's scene visibility, without the page (app.js gives the keys,
// a:/b:/d:/s:/n:, as nests and the eye name things): Isolate (Shift+H) shows only the selection until it is
// pressed again, Show hidden brings back for a while what the eye hid. Neither is saved: the eye's state
// (kept per map in this browser) and the map stay as they are, and both end with the map.

// What Isolate hides. objects and picked: the keys of each object, its own first, then the structure and the
// nests that hold it. Kept: what was picked, what it holds (the objects of a picked structure) and the
// structures the picked objects stand in (their walls, so they are seen in their place); the rest is hidden.
export function isolationOutside(objects, picked) {
  const keep = new Set(picked.map((keys) => keys[0])), holders = new Set(picked.flatMap((keys) => keys.slice(1)));
  const outside = objects.filter((keys) => keys.length && !holders.has(keys[0]) && !keys.some((k) => keep.has(k)));
  return new Set(outside.map((keys) => keys[0]));
}

export function createSceneVisibility() {
  let outside = null, shown = 0, reveal = false;     // outside: the keys Isolate hides (null: not isolated)
  return {
    get isolated() { return outside ? shown : 0; },   // how many objects the isolation shows, 0 when off
    get reveal() { return reveal; },
    // Isolate: what was there when it began; objects added later are shown (a copy, a paste)
    isolate(objects, picked) {
      outside = isolationOutside(objects, picked);
      shown = objects.length - outside.size;
      return shown;
    },
    exit() {                                          // false when it was not isolated
      const was = !!outside;
      outside = null;
      return was;
    },
    setReveal(on) { reveal = !!on; },
    reset() { outside = null; reveal = false; },      // another map
    // hidden in the 3D view now: outside the isolation, or hidden with the eye (eyeOff) while Show hidden is off
    hides(key, eyeOff) { return !!(outside && outside.has(key)) || (!!eyeOff && !reveal); },
  };
}
