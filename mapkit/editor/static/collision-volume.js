// Custom collision volumes share the same actor/tag/events in either shape.
import * as THREE from 'three';

export const COLLISION_SIDES = 32;
export const isCylinder = (a, read) => String(read(a, 'bCylinder') ?? 'False').toLowerCase() === 'true';
const dimension = value => Number.isFinite(+value) ? Math.max(2, +value) : 64;

export function collisionSize(a, read) {
  const scale = Number.isFinite(+a.scale) && +a.scale > 0 ? +a.scale : 1;
  const cylinder = isCylinder(a, read);
  const props = cylinder ? ['CylinderRadius', 'CylinderHeight', 'CylinderRadius'] : ['BoxX', 'BoxZ', 'BoxY'];
  return { cylinder, half: props.map(key => dimension(read(a, key) ?? 64) * scale) };
}

export function updateCollisionVolume(p, read) {
  const a = p?.userData.actor;
  if (a?.cls !== 'UCTriggerBox') return;
  const { cylinder, half } = collisionSize(a, read);
  let box = p.children.find(c => c.userData.tbox);
  if (!box) {
    box = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ color: 0xc58cff, transparent: true, opacity: 0.14, depthWrite: false }));
    box.add(new THREE.LineSegments(undefined, new THREE.LineBasicMaterial({ color: 0xc58cff })));
    box.userData.tbox = true;
    p.add(box);
  }
  if (box.userData.cylinder !== cylinder) {
    const geometry = cylinder ? new THREE.CylinderGeometry(1, 1, 2, COLLISION_SIDES) : new THREE.BoxGeometry(2, 2, 2);
    box.geometry.dispose(); box.children[0].geometry.dispose();
    box.geometry = geometry;
    box.children[0].geometry = new THREE.EdgesGeometry(geometry);
    box.userData.cylinder = cylinder;
  }
  // Both shapes stay upright/axis-aligned in the engine, also during a live drag.
  p.getWorldScale(box.scale);
  box.scale.set(half[0] / (box.scale.x || 1), half[1] / (box.scale.y || 1), half[2] / (box.scale.z || 1));
  p.getWorldQuaternion(box.quaternion).invert();
  const solid = String(read(a, 'bSolidBox') ?? 'False').toLowerCase() === 'true';
  box.material.color.set(solid ? 0xff9a3a : 0xc58cff);
  box.children[0].material.color.copy(box.material.color);
  return box;
}
