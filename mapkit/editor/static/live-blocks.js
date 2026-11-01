// One baked surface owner per editable block. The editor's picking volume never paints over it.
export const blockTransform = b => ({ centre: b.lo.map((v, i) => (v + b.hi[i]) / 2),
  size: b.hi.map((v, i) => v - b.lo[i]), rot: b.rot || [0, 0, 0] });
export function blockShapeKey(b) {
  return JSON.stringify([b.tex, b.shape || 'box', b.verts, b.sides, b.hollow, b.top, !!b.align,
    b.sign, !!b.mover, !!b.hole, b.water, !!b.portal]);
}
export function drawingShapeKey(p) {
  const { name, pts = [], z, rot, ...shape } = p;
  const c = [0, 1].map(k => pts.reduce((s, q) => s + q[k], 0) / Math.max(1, pts.length));
  return JSON.stringify({ ...shape, pts: pts.map(q => q.map((v, k) => Math.round((v - c[k]) * 1000) / 1000)) });
}
export function createLiveBlocks(THREE, rotations) {
  const entries = new Map();
  function matrix(b) {
    const p = blockTransform(b);
    return new THREE.Matrix4().compose(new THREE.Vector3(p.centre[0], p.centre[2], p.centre[1]),
      rotations.quat(p.rot), new THREE.Vector3(p.size[0], p.size[2], p.size[1]));
  }
  function add(name, snapshot, group) {
    group.matrixAutoUpdate = false;
    entries.set(name, { snapshot, group, inverse: matrix(snapshot).invert(), key: blockShapeKey(snapshot) });
  }
  function canFollow(b) { const e = entries.get(b.name); return !!e && e.key === blockShapeKey(b); }
  function addDrawing(name, snapshot, group) {
    const pts = snapshot.pts || [], c = [0, 1].map(k => pts.reduce((s, q) => s + q[k], 0) / Math.max(1, pts.length));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(c[0], snapshot.z || 0, c[1]), rotations.quat(snapshot.rot), new THREE.Vector3(1, 1, 1));
    group.matrixAutoUpdate = false;
    entries.set(name, { snapshot, group, inverse: m.invert(), key: drawingShapeKey(snapshot), drawn: true });
  }
  function canFollowDrawing(p) { const e = entries.get(p.name); return !!e?.drawn && e.key === drawingShapeKey(p); }
  function sync(proxies) {
    const byName = new Map(proxies.map(p => [p.userData.box?.name || p.userData.drawn?.name, p]));
    for (const [name, e] of entries) {
      const p = byName.get(name);
      e.group.visible = !!p && p.visible && (e.drawn ? canFollowDrawing(p.userData.drawn) : canFollow(p.userData.box));
      if (e.group.visible) { p.updateMatrix(); e.group.matrix.multiplyMatrices(p.matrix, e.inverse); e.group.matrixWorldNeedsUpdate = true; }
    }
  }
  return { add, addDrawing, canFollow, canFollowDrawing, sync, clear: () => entries.clear(), get: n => entries.get(n), entries };
}
