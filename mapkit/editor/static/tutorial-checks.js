// Checks use saved editor data, not whether a dialog was merely opened.
import { usablePlayerStarts } from './player-start.js';

export function playerStartInRoom(actors, edits, room) {
  if (!room?.origin || !room?.cells) return false;
  return usablePlayerStarts(actors, edits).some(a => {
    const p = edits.moved?.[a.name]?.loc || a.loc;
    // Accept the reception floor, not just the small suggested placement marker.
    // Keep the spawn clear of the outer walls, the floor and Hale's raised booth.
    return Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
      && p[2] >= 32 && p[2] <= 100
      && room.cells.some(([x0, y0, x1, y1]) => p[0] >= room.origin[0] + x0 + 18
        && p[0] <= room.origin[0] + x1 - 18 && p[1] >= room.origin[1] + y0 + 18
        && p[1] <= room.origin[1] + y1 - 18);
  });
}

export function crateOnStockpile(edits, bounds, top = 2) {
  const [x0, y0, x1, y1] = bounds;
  return (edits.added || []).some(a => {
    if (!/^Crate/.test(a.cls?.split('.').pop() || '') || edits.deleted?.[a.name]) return false;
    const moved = edits.moved?.[a.name], loc = moved?.loc || a.loc;
    const scale = Math.abs(moved?.scale ?? a.scale ?? 1);
    const radius = a.radius * scale, halfHeight = a.height * scale;
    if (!loc?.every(Number.isFinite) || !Number.isFinite(radius) || !Number.isFinite(halfHeight)) return false;
    // Placement adds half a unit above the surface. Floor beside/below it is not the stockpile.
    return loc[0] - radius >= x0 && loc[0] + radius <= x1
      && loc[1] - radius >= y0 && loc[1] + radius <= y1
      && Math.abs(loc[2] - halfHeight - top - .5) <= 1;
  });
}

export function textureDone(edits, name) {
  return !edits.deleted?.[name] && (edits.retexture || []).some(r =>
    r.kind === 'actor' && r.name === name && !!edits.textures?.[r.tex]?.pcx);
}

export function roomCameras(edits, room) {
  if (!room?.origin || !room?.cells) return [];
  const inside = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
    && p[2] >= 16 && p[2] < room.size[2] - 8
    && room.cells.some(([x0, y0, x1, y1]) => p[0] > room.origin[0] + x0 + 8
      && p[0] < room.origin[0] + x1 - 8 && p[1] > room.origin[1] + y0 + 8 && p[1] < room.origin[1] + y1 - 8);
  return (edits.added || []).filter(a => a.cls.split('.').pop() === 'UCCutscene' && !edits.deleted?.[a.name])
    .map(a => ({ name: a.name, cut: edits.cutscenes?.[a.name] }))
    .filter(a => a.cut?.keys?.length && a.cut.keys.every(k => Number.isFinite(k.t) && k.t >= 0 && inside(k.p)));
}

export function movingShot(cut) {
  const keys = cut.keys || [];
  return keys.some((a, i) => keys.slice(i + 1).some(b => b.t > a.t + .1 && (a.s || 0) === (b.s || 0)
    && (a.p.some((v, k) => Math.abs(v - b.p[k]) > 1)
      || (a.r || []).some((v, k) => Math.abs(v - (b.r?.[k] || 0)) > 50)
      || Math.abs((a.fov || 75) - (b.fov || 75)) > 1)));
}

export function previewedShot(edits, room, previews) {
  return roomCameras(edits, room).some(({ name, cut }) => movingShot(cut)
    && previews[name] === JSON.stringify(cut.keys));
}

export function screeningLinked(edits, room, button) {
  if (edits.deleted?.[button]) return false;
  const cameras = new Set(roomCameras(edits, room).filter(a => movingShot(a.cut)).map(a => a.name));
  return (edits.links || []).some(l => l.src === button && l.when === 'used'
    && (l.do || []).some(a => a.verb === 'cutplay' && cameras.has(a.target)));
}
