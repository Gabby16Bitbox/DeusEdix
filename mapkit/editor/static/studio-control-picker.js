// A small body picker shared by all humanoids; controls, rather than bone names.
export function mountControlPicker(host,state,kit){
  if(!state.anim)return;
  const root=document.createElement('div');root.className='st-body-picker';
  const controls=[['head','Head',50,13],['chest','Chest',50,37],['hips','Hips',50,62],
    ['l_arm','Left hand',86,64],['r_arm','Right hand',14,64],['l_leg','Left foot',65,105],['r_leg','Right foot',35,105]];
  const selected=state.sel==='ik'?state.ikChain:({0:'hips',2:'chest',4:'head'}[state.bone]);
  root.innerHTML=`<svg viewBox="0 0 100 118" aria-hidden="true"><circle cx="50" cy="13" r="9"/><path d="M50 23v40M50 32 25 43 14 64M50 32 75 43 86 64M50 62 38 80 35 105M50 62 62 80 65 105"/></svg>`+
    controls.map(([id,label,x,y])=>`<button type="button" data-control="${id}" aria-label="${label}" aria-pressed="${selected===id}" title="${label}${id.includes('_')?': move with G, rotate with R':''}" style="--cx:${x}px;--cy:${y}px"><svg viewBox="0 0 16 16" aria-hidden="true">${id.endsWith('arm')?'<path d="M5 8V3h2v4-5h2v5-4h2v5-3h2v5c0 3-2 5-5 5-2 0-3-1-4-3L2 9l2-1 1 1Z"/>':id.endsWith('leg')?'<path d="M6 2h5v6l3 3v3H3v-3l3-3V2Z"/>':'<circle cx="8" cy="8" r="4"/>'}</svg></button>`).join('')+
    `<div class="st-picker-tools"><button type="button" data-bones aria-pressed="${!!state.showBones}" title="Show the technical skeleton">Bones</button><button type="button" data-frame title="Frame the selected control (F)">Focus</button></div>`;
  host.prepend(root);
  root.querySelectorAll('[data-control]').forEach(b=>b.onclick=()=>{
    const c=b.dataset.control;
    if(c.includes('_')){if(!state.anim.ik?.[c]?.keys?.length)kit.setIK(c,true);else kit.selectIK(c);}
    else if(c==='hips'){kit.selectBone(0);kit.moveMode('translate');}
    else kit.selectBone(c==='head'?4:2);
  });
  root.querySelector('[data-bones]').onclick=()=>{state.showBones=!state.showBones;kit.refresh();};
  root.querySelector('[data-frame]').onclick=kit.frameSelected;
}
