// Timed events of an object's animation (the Animation panel's Events row, as Unity's Animation Events): markers at a
// time of its timeline that play a sound at the object, or trigger an Event (every object whose Tag it is: a door, a
// light, an alarm, a sound effect). Kept in edits.motions[name].events, in time order:
//   {t, kind: 'sound', sound: 'Pkg.Group.Name', volume, radius} | {t, kind: 'event', tag}
// editor/motions.py gives them to the object's UCMotion, which plays them as its clock passes them. The logic only, as
// UCMotion does it in the game (its Tick and Passed): app.js draws the row, and its preview plays the sound events.
//
// The clock passes an event when it goes over its time, either way: in every pass of a loop, both ways of Back and
// forth, played backwards. Where a pass turns back (Back and forth, a door that closes again) the pass that reached the
// turn played the event there, and the next one, starting from it, does not play it again; a run that starts where the
// clock was put (a play from the start or the end, each new pass of a loop, the map's start) plays an event right at
// its start. So never twice in one pass. In the editor, dragging the playhead forwards plays the sound events it
// passes; dragging it backwards, nothing.

export const MAX_EVENTS = 16;              // UCMotion's EvT[16]
export const EVENT_KINDS = [['sound', 'Play a sound', 'A sound played at the object, heard within its radius'],
  ['event', 'Trigger an Event', 'Every object whose Tag is this is triggered (a door, a light, an alarm, a sound effect...)']];
export const SOUND_DEFAULTS = { volume: 1, radius: 1024 };   // as a sound effect's

// an event's time on its animation's clock: one after the last key happens at the end
export const eventTime = (e, len) => Math.max(0, Math.min(len, +e.t || 0));

// what an event does, in a few words (its marker's tip, its row)
export function eventText(e) {
  if (e.kind === 'sound') return e.sound ? `Sound ${String(e.sound).split('.').pop()}` : 'Sound (none chosen)';
  return e.tag ? `Event ${e.tag}` : 'Event (no Tag yet)';
}

// The events (their indexes) the clock passes going from a to b, in the order it meets them: one at b is passed, one
// at a only when the clock did not come there by moving (moved: the run that brought it there played it as it arrived)
export function passed(times, a, b, moved) {
  if (a === b) return [];
  const up = b > a, out = [];
  times.forEach((t, i) => {
    const ahead = up ? t > a : t < a, reached = up ? t <= b : t >= b;
    if ((ahead || (!moved && t === a)) && reached) out.push(i);
  });
  return out.sort((i, j) => (up ? times[i] - times[j] : times[j] - times[i]) || (up ? i - j : j - i));
}

// One frame of a played animation as UCMotion.Tick moves an object's clock: the clock {t, dir (1 or -1), moved} after
// dt seconds of an animation len long, its mode 'once', 'loop' or 'pingpong' (a door, an elevator or a moving block
// loops back and forth: the caller says 'pingpong'), with playing (false once a 'once' has ended) and fired: the events
// (indexes of times) passed on the way, in order
export function playStep(clock, dt, len, mode, times) {
  let { t, dir, moved } = clock, playing = true;
  const fired = [];
  const pass = (a, b) => {               // UCMotion.Passed
    if (a === b) return;
    fired.push(...passed(times, a, b, moved));
    moved = true;
  };
  let from = t;
  t += dt * dir;
  if (t >= len || t <= 0) {
    if (mode === 'loop') {
      const end = dir > 0 ? len : 0;
      pass(from, end);                   // its events to the end of this pass...
      from = len - end;                  // ...and from the start of the next one, where the clock is put
      moved = false;
      t -= len * dir;
    } else if (mode === 'pingpong') {
      t = Math.max(0, Math.min(len, t));
      dir = -dir;
    } else {
      t = Math.max(0, Math.min(len, t));
      pass(from, t);
      return { t, dir, moved, playing: false, fired };
    }
  }
  pass(from, t);
  return { t, dir, moved, playing, fired };
}
