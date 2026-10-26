// Geometry-only bounds/contact: no selection outlines, icons or transform handles.
export function createSurfacePlacement(THREE) {
  const meshes = root => {
    const result = [], d = root.userData || {};
    const model = d.model || (d.actor ? d.body : root);
    model?.traverse(o => { if (o.isMesh && o.geometry && !o.isSprite) result.push(o); });
    return result;
  };
  function points(root, visit) {
    root.updateWorldMatrix(true, true);
    const v = new THREE.Vector3();
    for (const m of meshes(root)) {
      const a = m.geometry.getAttribute('position');
      if (a) for (let i = 0; i < a.count; i++) visit(v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld));
    }
  }
  const bounds = root => { const box = new THREE.Box3(); points(root, v => box.expandByPoint(v)); return box; };
  // how far along the normal the roots go together for the lowest of their points (a root without a mesh: its pivot)
  // to touch the plane through hit, a gap above it
  function lift(roots, hit, normal, gap = 0.5) {
    let low = Infinity;
    for (const root of roots) {
      let own = Infinity;
      points(root, v => { own = Math.min(own, v.dot(normal)); });
      low = Math.min(low, Number.isFinite(own) ? own : root.position.dot(normal));
    }
    return hit.dot(normal) + gap - low;
  }
  function contact(root, hit, normal, gap = 0.5) {
    root.position.addScaledVector(normal, lift([root], hit, normal, gap));
  }
  function align(root, normal) {
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
      .map(v => v.applyQuaternion(root.quaternion));
    const face = axes.sort((a, b) => Math.abs(b.dot(normal)) - Math.abs(a.dot(normal)))[0];
    if (face.dot(normal) < 0) face.negate();
    root.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(face, normal));
  }
  const belongs = (object, roots) => { for (let p = object; p; p = p.parent) if (roots.has(p)) return true; return false; };
  return { points, bounds, lift, contact, align, belongs };
}
