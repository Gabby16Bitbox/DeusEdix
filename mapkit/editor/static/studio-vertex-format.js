// UE1 vertex animation stores signed 16-bit model coordinates. Saturating an
// out-of-range vertex flattens the body; refuse the bake before it can be saved.
export function encodeRawVertices(info, positions, out, at) {
  const [kx, ky, kz] = info.scale, [ox, oy, oz] = info.origin;
  const yaw = info.rot[1] * 2 * Math.PI / 65536, cs = Math.cos(yaw), sn = Math.sin(yaw);
  const raw = (v, axis, vertex) => {
    const n = Math.round(v);
    if (!Number.isFinite(n) || n < -32768 || n > 32767) {
      const frame = Math.floor(at / positions.length) + 1;
      throw new RangeError(`Frame ${frame}, vertex ${vertex + 1} exceeds the game's animation range on ${axis}. Reduce body travel or move the actor separately; this animation was not baked.`);
    }
    return n;
  };
  for (let i = 0; i < positions.length / 3; i++) {
    const X = positions[3*i], Y = positions[3*i+2], Z = positions[3*i+1];
    out[at+3*i] = raw((X*cs+Y*sn)/kx+ox, 'X', i);
    out[at+3*i+1] = raw((-X*sn+Y*cs)/ky+oy, 'Y', i);
    out[at+3*i+2] = raw(Z/kz+oz, 'Z', i);
  }
}
