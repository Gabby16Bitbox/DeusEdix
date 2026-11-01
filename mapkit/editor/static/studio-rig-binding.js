import {RIG_PROFILES} from './studio-rig-profiles.js';
const baseRigs=new WeakMap();
function signature(m,rig){
  const start=rig.ref*m.FV*3,bytes=new Uint8Array(new Float32Array(m.pos.slice(start,start+m.FV*3)).buffer);
  let value=2166136261;for(const byte of bytes)value=Math.imul(value^byte,16777619)>>>0;
  return value.toString(16).padStart(8,'0');
}
function profile(mesh,m,rig){
  const p=RIG_PROFILES.profiles[mesh];
  return p&&p.base.version===rig.version&&p.base.ref===rig.ref&&p.base.weights.length===m.FV&&signature(m,rig)===p.signature&&JSON.stringify(p.base.joints)===JSON.stringify(rig.joints)&&JSON.stringify(p.base.tails)===JSON.stringify(rig.tails)?p:null;
}
export function preparedRig(mesh,m,version){
  const p=RIG_PROFILES.profiles[mesh];
  return p&&p.base.version===version&&signature(m,p.base)===p.signature?structuredClone(p.base):null;
}
export function bindHumanoid(rig,mesh,m){
  const p=profile(mesh,m,rig);if(!p?.refined)return rig;
  const out={...rig,weights:p.weights,binding:RIG_PROFILES.id,bindingMetrics:p.metrics};baseRigs.set(out,rig);return out;
}
export function originalBinding(rig){return baseRigs.get(rig)||rig;}
