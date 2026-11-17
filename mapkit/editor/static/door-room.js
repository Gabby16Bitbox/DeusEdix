// Does a library door have room to open (17 Nov 2026, from the modding Discord: a gate between a room and a narrow
// alley, turned the other way, goes into the alley's wall)? The server gives the lines the door sweeps each way
// (/api/door_room, moving_pieces.sweep); the page asks `blocked(a, b)` of each against what is in the map. UCDoorMover
// traces the same lines in the game and never takes a way without room.

// {built, other}: true where nothing is across that way's lines; null when the door does not turn
export function roomOf(lines, blocked) {
  if (!lines?.built?.length || !lines?.other?.length) return null;
  const free = (way) => !lines[way].some(([a, b]) => blocked(a, b));
  return { built: free('built'), other: free('other') };
}

// the way a door set to Opens `opens` takes: 'built' or 'other'; 'away' for both; into: the one whose middle ends
// closer to the into point (as moving_pieces.opening, middles from /api/door_room)
export function wayOf(opens, into, middle) {
  if (opens === 'other') return 'other';
  if (opens === 'into' && Array.isArray(into) && middle?.built && middle?.other) {
    const far = (q) => Math.hypot(q[0] - into[0], q[1] - into[1]);
    return far(middle.other) < far(middle.built) ? 'other' : 'built';
  }
  return opens === 'away' ? 'away' : 'built';
}

// a line for the Inspector (and the assistant): '' when it is fine
export function roomNote(opens, room, into, middle) {
  if (!room) return '';
  const way = wayOf(opens, into, middle);
  if (room.built && room.other) return '';
  if (!room.built && !room.other) return 'It goes into something either way when it opens (a wall, a block): make room, or move the door.';
  if (way === 'away') return `No room to open it ${room.built ? 'the other way' : 'its own way'}: in the game it always opens ${room.built ? 'its own way (One way, as in its map)' : 'the other way (One way, the other side)'}, from both sides.`;
  if (room[way]) return '';
  return `It goes into something when it opens this way (a wall, a block); the other way has room: choose "${way === 'built' ? 'One way, the other side' : 'One way, as in its map'}".`;
}
