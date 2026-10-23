// Preview only the addressed source polygons, even when BSP batches many faces in one mesh.
// Each mesh's shared geometry/material is restored before rebuilding, relighting or Undo.
export function createSurfaceTexturePreview({ THREE, textureInfo, materialFor }) {
  let snapshots = [];
  function restore() {
    for (const state of snapshots) {
      state.mesh.geometry = state.geometry; state.mesh.material = state.material;
      state.preview.dispose();
      for (const material of state.materials) material.dispose();
    }
    snapshots = [];
  }
  function apply(meshes, faces, edits) {
    restore();
    const exact = new Map(), brushes = new Map();
    let order = 0;
    for (const row of edits.surfaces || []) {
      if (row.op !== 'texture') continue;
      order++;
      for (const target of row.targets || []) {
        const entry = { order, ref: row.args[0] };
        if (target.poly === '*') brushes.set(target.brush, entry);
        else exact.set(`${target.brush}|${target.poly}`, entry);
      }
    }
    const byFace = new Map();
    faces.forEach((face, id) => {
      const a = exact.get(`${face.brush}|${face.poly}`), b = brushes.get(face.brush);
      const entry = !a ? b : !b || a.order > b.order ? a : b;
      if (entry) byFace.set(id, entry.ref);
    });
    for (const mesh of meshes) {
      const ids = mesh.userData.faces || [], changes = ids.map(id => byFace.get(id));
      if (!changes.some((ref, triangle) => ref && ref !== faces[ids[triangle]]?.tex && textureInfo(ref)?.url)) continue;
      if (Array.isArray(mesh.material) || mesh.geometry.index) continue;
      const geometry = mesh.geometry, material = mesh.material, preview = geometry.clone();
      const uv = preview.getAttribute('uv'), originalInfo = textureInfo(mesh.userData.tex);
      const materials = [], materialIds = new Map(), indices = [];
      ids.forEach((id, triangle) => {
        const ref = changes[triangle], info = ref && ref !== faces[id]?.tex ? textureInfo(ref) : null;
        if (!info?.url) { indices.push(0); return; }
        if (!materialIds.has(ref)) { materials.push(materialFor(info, mesh)); materialIds.set(ref, materials.length); }
        indices.push(materialIds.get(ref));
        // UE stores U/V axes in texels; the exported preview UVs are normalized by the OLD image.
        if (uv && originalInfo?.w > 0 && originalInfo?.h > 0 && info.w > 0 && info.h > 0) {
          for (let vertex = triangle * 3; vertex < triangle * 3 + 3; vertex++) uv.setXY(vertex,
            uv.getX(vertex) * originalInfo.w / info.w, uv.getY(vertex) * originalInfo.h / info.h);
        }
      });
      preview.clearGroups();
      let start = 0;
      for (let i = 1; i <= indices.length; i++) if (i === indices.length || indices[i] !== indices[start]) {
        preview.addGroup(start * 3, (i - start) * 3, indices[start]); start = i;
      }
      if (uv) uv.needsUpdate = true;
      snapshots.push({ mesh, geometry, material, preview, materials });
      mesh.geometry = preview; mesh.material = [material, ...materials];
    }
  }
  return { restore, apply };
}
