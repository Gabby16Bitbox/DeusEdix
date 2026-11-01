// Editing light, separate from the engine's baked atlas. Bounded GPU work, no bake or map writes.
export const LIVE_LIGHT_MAX = 32;
export function nearestPreviewLights(lights, eye, limit = LIVE_LIGHT_MAX) {
  return lights.filter(x => x.L[6] > 0 && x.L.slice(3, 6).some(v => v > 0))
    .map(x => ({ ...x, distance: Math.hypot(x.L[0] - eye[0], x.L[1] - eye[1], x.L[2] - eye[2]) / x.L[6] }))
    .sort((a, b) => Number(!!b.selected) - Number(!!a.selected) || a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function createLiveLighting(THREE) {
  const vectors = () => Array.from({ length: LIVE_LIGHT_MAX }, () => new THREE.Vector4());
  const uniforms = { uLiveN: { value: 0 }, uLivePos: { value: vectors() }, uLiveCol: { value: vectors() },
    uLiveDir: { value: vectors() }, uLiveGain: { value: 1 } };
  function update(lights, eye, gain = 1) {
    const near = nearestPreviewLights(lights, eye);
    uniforms.uLiveN.value = near.length; uniforms.uLiveGain.value = gain;
    near.forEach(({ L }, i) => {
      uniforms.uLivePos.value[i].set(L[0], L[2], L[1], L[6]);
      uniforms.uLiveCol.value[i].set(L[3], L[4], L[5], L[7] === 13 ? 1 : 0);
      uniforms.uLiveDir.value[i].set(L[8] || 0, L[10] || 0, L[9] || 0,
        [8, 12].includes(L[7]) ? Math.cos((L[11] || 0) * Math.PI / 512) : 2);
    });
    return near.length;
  }
  function patch(shader) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLiveP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLiveP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vLiveP;
      uniform int uLiveN;
      uniform vec4 uLivePos[${LIVE_LIGHT_MAX}], uLiveCol[${LIVE_LIGHT_MAX}], uLiveDir[${LIVE_LIGHT_MAX}];
      uniform float uLiveGain;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      vec3 liveN = normalize(cross(dFdx(vLiveP), dFdy(vLiveP)));
      vec3 liveLight = vec3(0.08);
      for (int i = 0; i < ${LIVE_LIGHT_MAX}; i++) {
        if (i >= uLiveN) break;
        vec3 delta = uLivePos[i].xyz - vLiveP;
        float dist = length(delta), reach = uLivePos[i].w;
        if (dist >= reach) continue;
        float share = 1.0 - dist / reach;
        if (uLiveCol[i].w < 0.5 && dist > 0.01) share *= max(0.0, dot(liveN, delta) / dist);
        if (uLiveDir[i].w <= 1.0 && dist > 0.01) {
          float cs = -dot(delta, uLiveDir[i].xyz) / dist;
          share *= clamp((cs - uLiveDir[i].w) / max(0.05, 1.0 - uLiveDir[i].w) * 2.0, 0.0, 1.0);
        }
        liveLight += 2.0 * uLiveCol[i].rgb * share;
      }
      reflectedLight.indirectDiffuse = pow(max(liveLight * uLiveGain, vec3(0.0)), vec3(2.2));`);
  }
  return { update, patch, uniforms, cacheKey: 'live-lighting-' + LIVE_LIGHT_MAX };
}
