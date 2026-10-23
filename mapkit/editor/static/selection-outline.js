// A local-space box, carried by the model's full world transform. A world AABB
// grows when a thin panel turns; it is useful for culling, not for selection.
export function createSelectionOutline(THREE, color = 0xffd25a) {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const line = new THREE.LineSegments(new THREE.EdgesGeometry(unit),
    new THREE.LineBasicMaterial({color, depthWrite: false}));
  unit.dispose();
  line.matrixAutoUpdate = false;
  const box = new THREE.Box3(), point = new THREE.Vector3(), relative = new THREE.Matrix4();
  const size = new THREE.Vector3(), centre = new THREE.Vector3(), inverse = new THREE.Matrix4();
  line.setFromObject = root => {
    const frame = root.userData?.model || root;
    root.updateWorldMatrix(true, true);
    inverse.copy(frame.matrixWorld).invert();
    box.makeEmpty();
    frame.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry || mesh.isSprite) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox;
      if (!b || b.isEmpty()) return;
      relative.multiplyMatrices(inverse, mesh.matrixWorld);
      for (let i = 0; i < 8; i++) box.expandByPoint(point.set(
        i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(relative));
    });
    line.visible = !box.isEmpty();
    if (line.visible) {
      box.getCenter(centre); box.getSize(size);
      line.matrix.copy(frame.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(...centre.toArray()))
        .multiply(new THREE.Matrix4().makeScale(...size.toArray()));
      // This helper lives alongside the scene, never inside the measured object.
      if (line.parent) line.matrix.premultiply(line.parent.matrixWorld.clone().invert());
      line.matrixWorldNeedsUpdate = true;
    }
    return line;
  };
  return line;
}
