// Original mission-script references feed the shared Flags & conditions catalog.
let data=null, epoch=0;
function render() {
  document.querySelector('#st-originals .mission-flags')?.remove();
}
async function load(map) {
  const token=++epoch;data=null;
  if(!map) return;
  try { const r=await fetch('/api/missionflags?map='+encodeURIComponent(map));const value=await r.json();if(!r.ok) throw Error(value.error || 'Cannot read mission flags.');if(token!==epoch)return;data=value; }
  catch(e) {if(token!==epoch)return;data={flags:{},message:e.message};}
  window.dispatchEvent(new CustomEvent('deusedix:mission-flags'));render();
}
window.addEventListener('deusedix:map-state',e=>load(e.detail.open ? window.__editor?.mapName : null));
window.__missionFlags={render,get data(){return data;}};
