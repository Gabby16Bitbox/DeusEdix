// Shared UE1 rotators, including compound rotations. UI uses Three's Y-up axes.
export function createRotations(THREE) {
  const unit = 2 * Math.PI / 65536;
  const signed = r => { const v = ((Math.round(r) % 65536) + 65536) % 65536; return v > 32768 ? v - 65536 : v; };
  const quat = (r = [0, 0, 0]) => new THREE.Quaternion().setFromEuler(new THREE.Euler((r[2] || 0) * unit, -(r[1] || 0) * unit, (r[0] || 0) * unit, 'YZX'));
  const rot = q => { const e = new THREE.Euler().setFromQuaternion(q, 'YZX'); return [signed(e.z / unit), ((Math.round(-e.y / unit) % 65536) + 65536) % 65536, signed(e.x / unit)]; };
  const pose = (p = {}) => quat([p.pitch || 0, p.yaw || 0, p.roll || 0]);
  const fields = q => { const [pitch, yaw, roll] = rot(q); return { pitch, yaw, roll }; };
  const delta = (from, to) => pose(to).multiply(pose(from).invert());
  const carry = (r, from, to) => rot(delta(from, to).multiply(quat(r)));
  return { quat, rot, pose, fields, delta, carry };
}
