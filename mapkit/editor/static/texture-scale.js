// Preserve each texture axis's contribution: exact tiling on non-uniform scale,
// reversible toggles, and no accumulating UV drift after repeated transformations.
export function stretchOnResize(piece, previous, scale) {
  if (typeof previous.stretch === 'boolean') return previous.stretch;
  return piece && scale.some((s, i) => Math.abs(s - (previous.scale || [1, 1, 1])[i]) > 1e-6) ? true : undefined;
}

export function createTextureScale(THREE) {
  const owned = new WeakMap();
  const vec = a => new THREE.Vector3(a[0], a[2], a[1]);
  function capture(geometry, group, inverse = new THREE.Quaternion()) {
    const count = geometry.attributes.position.count;
    if (!group.uvFrames || group.uvFrames.length !== count / 3) {
      geometry.userData.textureFramesMissing = count / 3;
      return;
    }
    const u = new Float32Array(count * 3), v = new Float32Array(count * 3);
    let missing = 0;
    for (let t = 0; t < count / 3; t++) {
      const f = group.uvFrames[t];
      if (!f) { missing++; continue; }
      const tu = vec(f.slice(3, 6)).applyQuaternion(inverse), tv = vec(f.slice(6, 9)).applyQuaternion(inverse);
      for (let j = 0; j < 3; j++) {
        const at = t * 9 + j * 3;
        const delta = vec(group.pos.slice(at, at + 3).map((p, k) => p - f[k])).applyQuaternion(inverse);
        u.set([delta.x * tu.x, delta.y * tu.y, delta.z * tu.z], at);
        v.set([delta.x * tv.x, delta.y * tv.y, delta.z * tv.z], at);
      }
    }
    geometry.setAttribute('uvAxisU', new THREE.BufferAttribute(u, 3));
    geometry.setAttribute('uvAxisV', new THREE.BufferAttribute(v, 3));
    geometry.setAttribute('uvBase', geometry.attributes.uv.clone());
    geometry.userData.textureFramesMissing = missing;
  }
  function update(object, built, pose) {
    const axisScale = p => p?.stretch ? [1, 1, 1] : [p?.scale?.[0] || 1, p?.scale?.[2] || 1, p?.scale?.[1] || 1];
    const before = axisScale(built), after = axisScale(pose), factors = after.map((x, i) => x / before[i] - 1);
    const key = factors.join(',');
    object.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.uvBase) return;
      let state = owned.get(mesh);
      if (!state && factors.every(x => Math.abs(x) < 1e-12) && !mesh.geometry.userData.textureScaleEdited) return;
      if (!state || state.geometry !== mesh.geometry) {
        // Mesh.clone shares geometry. Never change another Piece's UVs.
        mesh.geometry = mesh.geometry.clone();
        state = { geometry: mesh.geometry }; owned.set(mesh, state);
      }
      if (state.key === key) return;
      state.key = key;
      mesh.geometry.userData.textureScaleEdited = true;
      const { uv, uvBase, uvAxisU, uvAxisV } = mesh.geometry.attributes;
      for (let i = 0; i < uv.count; i++) {
        let a = uvBase.getX(i), b = uvBase.getY(i);
        for (let k = 0; k < 3; k++) {
          a += uvAxisU.array[i * 3 + k] * factors[k]; b += uvAxisV.array[i * 3 + k] * factors[k];
        }
        uv.setXY(i, a, b);
      }
      uv.needsUpdate = true;
    });
  }
  function incomplete(object) {
    let result = false;
    object.traverse(m => { if (m.geometry?.userData.textureFramesMissing) result = true; });
    return result;
  }
  return { capture, update, incomplete };
}
