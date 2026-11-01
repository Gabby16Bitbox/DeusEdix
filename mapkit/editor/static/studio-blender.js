/* A project-scoped exchange, separate from Save/bake and generic motion imports. */
import * as THREE from 'three';
import { gameTriangles } from './studio-props.js';

const clone = value => JSON.parse(JSON.stringify(value));
const near = (a, b, epsilon = 0.0002) => a?.length === b?.length && a.every((v, i) => Math.abs(v - b[i]) < epsilon);
const sameQ = (a, b) => near(a, b) || near(a, b?.map(x => -x));
const changedPose = (a, b) => !near(a.root, b.root) || Object.keys(a.rot).some(n => !sameQ(a.rot[n], b.rot[n]));

export function hasBlenderKeys(animation) {
  if (!animation) return false;
  const keyed = value => Array.isArray(value) ? value.some(k => k && Number.isFinite(k.f))
    : value && typeof value === 'object' && Object.values(value).some(keyed);
  if (['curves', 'ik', 'grip'].some(k => keyed(animation[k]))) return true;
  const keys = animation.keys || [];
  // Older New drafts carried one untouched identity key automatically.
  const seed = animation.source === 'made' && keys.length === 1 && keys[0].f === 0
    && near(keys[0].root || [0,0,0], [0,0,0])
    && Object.values(keys[0].rot || {}).every(q => sameQ(q, [0,0,0,1]));
  if (keyed(animation.tracks)) {
    const seedTracks = seed && Object.entries(animation.tracks).every(([name, track]) =>
      (track.keys || []).length <= 1 && (track.keys || []).every(k => k.f === 0 &&
        (name === '$root' ? near(k.v, [0,0,0]) : sameQ(k.q, [0,0,0,1]))));
    if (!seedTracks) return true;
  }
  return keys.length > 0 && !seed;
}

async function pngOf(texture) {
  if (!texture) return null;
  const start = performance.now();
  while (!texture.image?.width) {
    if (performance.now() - start > 10000) throw new Error('A character texture did not load. Wait for the preview and try again.');
    await new Promise(r => setTimeout(r, 30));
  }
  const image = texture.image, canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

async function urlPNG(url) {
  const image = new Image(); image.src = url; await image.decode();
  return pngOf({ image });
}

export async function makeBlenderPayload(state, kit, {includeKeys = hasBlenderKeys(state.anim)} = {}) {
  if (!state.anim || !state.rig || !state.m) throw new Error('New or Copy an animation first.');
  if (state.pending || state.saving) throw new Error('Finish the current edit first.');
  const animation = clone(state.anim), mesh = state.mesh, m = state.m, rig = state.rig;
  if (animation.frames > 10000) throw new Error('Blender exchanges support up to 10,000 frames.');
  const P = kit.framePos(m, rig.ref), seams = kit.seamsOf(rig, m), shapes = kit.gripsOf(rig, m);
  const seamAt = new Map(Array.from(seams.v, (v, i) => [v, i]));
  const body = { position: [], uv: [], index: [], bones: [], weights: [], seams: [], groups: [], materials: [], grip: {} };
  const sourceVertices = [], wedges = new Map();
  for (const [name, list] of Object.entries(kit.facesBySlot(m))) {
    const [slot, flags] = name.split('|').map(Number), material = kit.skinMaterial(slot, flags);
    const materialIndex = body.materials.length, start = body.index.length;
    // Await after copying all frame/rig data; never consult a subsequently selected model.
    body.materials.push({ color: material.color.toArray(), alpha: !!(flags & (2 | 4)), texture: material.map });
    for (const face of list) for (const corner of [0, 2, 1]) {
      const wedge = m.faces[4 * face + corner];
      if (!wedges.has(wedge)) {
        const v = m.wedges[wedge] + m.SV, s = seamAt.get(v);
        const [b1, w1, b2, w2] = s !== undefined ? [seams.p[s], 1-seams.w[s], seams.c[s], seams.w[s]] : rig.weights[v];
        // Studio turns seam vertices partway around the joint (slerp), rather
        // than blending two positions. Keep this correction for every UV wedge.
        if (s !== undefined) body.seams.push([wedges.size, seams.p[s], seams.c[s], seams.w[s]]);
        wedges.set(wedge, wedges.size); sourceVertices.push(v);
        body.position.push(P[v*3], P[v*3+1], P[v*3+2]);
        body.uv.push(m.uvs[wedge*2], 1-m.uvs[wedge*2+1]);
        body.bones.push(b1, w2 > 0 ? b2 : b1, 0, 0); body.weights.push(w2 > 0 ? w1 : 1, w2 > 0 ? w2 : 0, 0, 0);
      }
      body.index.push(wedges.get(wedge));
    }
    body.groups.push({ start, count: body.index.length-start, materialIndex });
  }
  for (const side of ['l', 'r']) if (shapes[side]) {
    const shape = shapes[side], at = new Map(Array.from(shape.idx, (v, i) => [v, i]));
    body.grip[side] = { rest: shape.rest, delta: sourceVertices.map(v => at.has(v) ? Array.from(shape.dir.slice(at.get(v)*3, at.get(v)*3+3)) : [0,0,0]) };
  }
  const bones = kit.BONES.map(([name, parent], i) => ({ name, parent, head: rig.joints[i], tail: rig.tails[i] }));
  const samples = Array.from({ length: animation.frames }, (_, f) => {
    const pose = kit.fullPose(rig, animation, f);
    return { root: pose.root.toArray(), rot: Object.fromEntries(kit.BONES.map(([n], i) => [n, pose.rot[i].clone().normalize().toArray()])), grip: pose.grip };
  });
  const controls={schema:1,fkSamples:Array.from({length:animation.frames},(_,f)=>{
    const pose=kit.poseAt(animation,f);
    return {root:pose.root.toArray(),rot:Object.fromEntries(kit.BONES.map(([n],i)=>[n,pose.rot[i].clone().normalize().toArray()]))};
  }),ik:Object.fromEntries(Object.entries(animation.ik||{}).filter(([,v])=>v.keys?.length).map(([c,data])=>[c,{enabled:true,samples:Array.from({length:animation.frames},(_,f)=>kit.sampleIK(data,f,animation))}]))};
  const payload = { animation, mesh, bones, samples, body, frame: Math.round(state.frame), includeKeys, controls, height:rig.H, props: [] };
  const textures = clone(state.paletteTex || {});
  for (const mat of body.materials) { mat.png = await pngOf(mat.texture); delete mat.texture; }
  for (const definition of animation.props || []) {
    const response = await fetch(`/cache/_palette/models/${encodeURIComponent(definition.cls)}.json`);
    if (!response.ok) throw new Error(`The ${definition.cls} prop preview is unavailable. Load it before sending to Blender.`);
    const model = await response.json(), geometry = { position: [], uv: [], groups: [], materials: [] };
    for (const part of model.parts || []) {
      if (part.flags & 1) continue;
      const data = gameTriangles(part.pos, part.uv), start = geometry.position.length / 3;
      geometry.position.push(...data.pos);
      for (let i = 0; i < data.uv.length; i+=2) geometry.uv.push(data.uv[i], 1-data.uv[i+1]);
      geometry.groups.push({ start, count: data.pos.length/3, materialIndex: geometry.materials.length });
      const png = textures[part.tex]?.png;
      geometry.materials.push({ color: [1,1,1], alpha: !!(part.flags & (2|4)), png: png ? await urlPNG('/cache/_palette/' + png) : null });
    }
    if (!geometry.position.length) throw new Error(`The ${definition.cls} prop has no exportable model.`);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...definition.rotation.map(v=>v*Math.PI/180), 'XYZ'));
    payload.props.push({ definition, geometry, quaternion: q.toArray() });
  }
  return payload;
}

export function mergeBlenderResult(exchange) {
  const { original, result, baseline } = exchange, anim = clone(original);
  const timing = result.frames !== anim.frames || Math.abs(result.fps-anim.fps) > .00001;
  const motion = timing || result.samples.some((s, f) => changedPose(s, baseline[f]));
  if (motion) {
    // The game has a fixed skeleton. Bake evaluated constraints, never run old IK a second time.
    anim.keys = result.samples.map((s, f) => ({ f, root: s.root, rot: s.rot }));
    delete anim.tracks; delete anim.curves; delete anim.ik;
    anim.interp = 'linear';
  } else if (result.poseKeys?.length) {
    // An explicit Key pose is an edit even when its value is still the rest pose.
    anim.keys = result.poseKeys.map(f => ({f, root:result.samples[f].root, rot:result.samples[f].rot}));
    delete anim.tracks; delete anim.curves; delete anim.ik;
  }
  if (result.controls) {
    const control=result.controls, before=exchange.controlBaseline;
    const fkChanged=!before || timing || control.fkSamples.some((s,f)=>changedPose(s,before.fkSamples[f]));
    // Keep sparse original FK curves unless their values were edited in Blender.
    anim.keys=clone(original.keys); if(original.tracks)anim.tracks=clone(original.tracks);if(original.curves)anim.curves=clone(original.curves);
    if(fkChanged){anim.keys=control.fkSamples.map((s,f)=>({f,root:s.root,rot:s.rot}));delete anim.tracks;delete anim.curves;anim.interp='linear';}
    anim.ik=clone(original.ik||{});
    for(const [chain,data] of Object.entries(control.ik)){
      if(!data.enabled){delete anim.ik[chain];continue;}
      const previous=before?.ik?.[chain];
      const changed=!previous?.enabled || timing || data.samples.some((t,f)=>!near(t.v,previous.samples[f].v)||!near(t.pole,previous.samples[f].pole)||!sameQ(t.q,previous.samples[f].q)||!near(t.twist||[0,0],previous.samples[f].twist||[0,0]));
      if(changed)anim.ik[chain]={keys:data.samples.map((t,f)=>({f,...clone(t),mode:'linear'}))};
    }
    if(!Object.keys(anim.ik).length)delete anim.ik;
    if(!motion && result.poseKeys?.length && !hasBlenderKeys(original)){
      anim.keys=result.poseKeys.map(f=>({f,...clone(control.fkSamples[f])}));delete anim.tracks;delete anim.curves;
    }
  }
  anim.frames = result.frames;
  if (Math.abs(result.fps-anim.fps) > .00001) anim.fps = result.fps;
  anim.loop = result.loop;
  for (const side of ['l', 'r']) {
    const changed = timing || result.samples.some((s, f) => {
      const a = s.grip?.[side], b = baseline[f]?.grip?.[side];
      return a == null || b == null ? a !== b : Math.abs(a-b) > .0002;
    });
    if (changed) {
      const keys = result.samples.flatMap((s, f) => s.grip?.[side] == null ? [] : [{ f, v: [s.grip[side]], mode: 'linear' }]);
      if (keys.length || anim.grip?.[side]) (anim.grip ||= {})[side] = { keys };
    }
  }
  const props = result.props.map(p => {
    const old = original.props.find(x => x.id === p.id), oldQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...old.rotation.map(v=>v*Math.PI/180), 'XYZ'));
    if ((old.space || 'bone') === p.space && old.bone === p.bone && (old.enabled !== false) === p.enabled && Math.abs(old.scale-p.scale)<.0002 && near(old.position,p.position) && sameQ(oldQ.toArray(),p.quaternion)) return clone(old);
    const copy = clone(p), e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(p.quaternion), 'XYZ');
    copy.rotation = [e.x,e.y,e.z].map(v=>+(v*180/Math.PI).toFixed(4));
    copy.position = copy.position.map(v=>+v.toFixed(5)); copy.scale = +copy.scale.toFixed(5);
    delete copy.quaternion; return copy;
  });
  if (original.props || props.length) anim.props = props;
  return { animation: anim, sampled: motion };
}

export function installBlenderBridge(host, state, kit) {
  const css = document.createElement('link'); css.rel='stylesheet'; css.href=new URL('./studio-blender.css',import.meta.url).href; document.head.append(css);
  const button = document.createElement('button'); button.id='as-blender'; button.type='button';
  button.title='Continue this animation in Blender or bring changes back'; button.setAttribute('aria-label','Blender');
  const logo = document.createElement('img'); logo.src=new URL('./blender-logo.png',import.meta.url).href; logo.alt='Blender'; button.append(logo); host.append(button);
  const api = async (action, data={}) => {
    const r=await fetch('/api/blender/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}), j=await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'The Blender exchange failed.'); return j;
  };
  button.onclick = async () => {
    kit.stopPlay();
    const dialog=document.createElement('dialog'); dialog.id='as-blender-dialog'; dialog.setAttribute('aria-label','Blender animation');
    dialog.innerHTML=`<h3>Blender</h3><div class="st-blender-actions"><button data-send class="primary">Continue in Blender</button><button data-back>Bring changes back</button></div>
      <label class="st-blender-keys" title="Off: send the current pose with an empty timeline. In Blender use Key pose when you want to add keys."><input type="checkbox" data-keys>Include existing animation keys</label>
      <label>Session <select aria-label="Blender session"></select></label><button data-resume>Reopen Blender session</button>
      <p class="hint">In Blender, open the DeusEdix sidebar and choose Send to DeusEdix. Hand and foot targets stay editable on return. Changed channels return as sampled keys; Undo restores the previous draft.</p>
      <details><summary>Connection</summary><label>Blender executable<input aria-label="Blender executable" type="text" spellcheck="false"></label><button data-configure>Use this path</button></details>
      <p role="status" aria-live="polite"></p><footer><button data-close>Close</button></footer>`;
    document.querySelector('#studio').append(dialog);
    const $=s=>dialog.querySelector(s), message=$('[role=status]'), choice=$('select'), path=$('input[type=text]');
    $('[data-keys]').checked=hasBlenderKeys(state.anim);
    let busy=false;
    const run=async(fn)=>{
      if(busy)return; busy=true; dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{await fn();}catch(e){message.textContent=e.message;}finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
    };
    const refresh=async(selected)=>{
      const data=await api('info'); path.value=data.executable;
      choice.replaceChildren(...data.sessions.map(s=>{const o=new Option(`${s.name} · ${s.mesh.split('.').pop()}${s.ready?' · return ready':''}`,s.id);o.title=s.state?.error||s.state?.message||'';return o;}));
      if(selected)choice.value=selected;
      if(!data.executable)$('details').open=true;
    };
    $('[data-close]').onclick=()=>dialog.close(); dialog.onclose=()=>dialog.remove(); dialog.oncancel=e=>{if(busy)e.preventDefault();};
    // Modal keystrokes must not reach Studio shortcuts or the desktop menu bar.
    dialog.addEventListener('keydown',e=>e.stopPropagation());
    $('[data-configure]').onclick=()=>run(async()=>{await api('configure',{executable:path.value});await refresh(choice.value);message.textContent='Blender path saved for this project.';});
    $('[data-send]').onclick=()=>run(async()=>{
      message.textContent='Preparing the character and animation…';
    const payload=await makeBlenderPayload(state,kit,{includeKeys:$('[data-keys]').checked});
      const j=await api('start',payload);await refresh(j.id);message.textContent='Blender is opening in a separate window. Use its DeusEdix sidebar to send changes back.';
    });
    $('[data-resume]').onclick=()=>run(async()=>{
      if(!choice.value)throw new Error('Send an animation to Blender first.');await api('resume',{session:choice.value});message.textContent='Reopening the saved Blender session.';
    });
    $('[data-back]').onclick=()=>run(async()=>{
      if(!choice.value)throw new Error('Send an animation to Blender first.');
      const before=JSON.stringify(state.anim), mesh=state.mesh;
      const exchange=await api('result',{session:choice.value});
      if(!exchange.ready)throw new Error(exchange.state?.error||'In Blender choose DeusEdix > Send to DeusEdix first.');
      if(state.mesh!==mesh || JSON.stringify(state.anim)!==before || state.pending || state.saving)throw new Error('The current animation changed. Try bringing the result back again.');
      if(mesh!==exchange.mesh)throw new Error('Select the original character model before bringing this session back.');
      if(exchange.bones?.some((b,i)=>!near(b.head,state.rig.joints[i]) || !near(b.tail,state.rig.tails[i])))throw new Error('The character rig changed after export. Restore the original rig before bringing this session back.');
      const merged=mergeBlenderResult(exchange);
      if(exchange.result.controls){
        for(let f=0;f<merged.animation.frames;f++){
          const p=kit.fullPose(state.rig,merged.animation,f),s=exchange.result.samples[f];
          if(!near(p.root.toArray(),s.root,.005)||kit.BONES.some(([n],i)=>!sameQ(p.rot[i].toArray(),s.rot[n])))throw new Error('The Blender controls cannot reproduce this pose in Studio. Reset limb scale/stretch or use the original controls.');
        }
      }
      if(JSON.stringify(merged.animation)===before){message.textContent='Already up to date.';return;}
      if(state.anim && before!==JSON.stringify(exchange.original)){
        if(!confirm('The Studio animation changed after this Blender session was sent. Replace the current draft with the Blender result? Undo will restore it.'))return;
      }
      // After reopening Studio there may be no draft yet. Recover the exported draft
      // first, so Undo still has the original controls to return to.
      if(!state.anim){state.anim=clone(exchange.original);state.dirty=true;kit.showAnim();}
      kit.stopPlay(); kit.beginEdit(); state.anim=merged.animation; kit.commitEdit();
      message.textContent=merged.sampled?'Blender motion applied. Undo restores the original. Save when ready.':'Blender changes applied. Save when ready.';
    });
    dialog.showModal(); await run(()=>refresh());
  };
}
