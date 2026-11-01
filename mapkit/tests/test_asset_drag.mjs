import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../editor/static/app.js',import.meta.url),'utf8');
class Element {
  constructor(){this.events={};this.classList={add(){},remove(){}};this.hidden=false;}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  async emit(name,event){for(const fn of this.events[name]??[]) await fn(event);}
  setAttribute(){}
  querySelectorAll(){return [];}
}
function fixture(){
  const bottom=new Element(), inspector=new Element(), canvas=new Element(), window=new Element();
  const calls=[], context=vm.createContext({window,canvas,
    document:{createElement:()=>new Element(),body:{appendChild(){}},querySelectorAll:()=>[]},
    $:id=>id==='#bottom'?bottom:inspector,
    dragSound:null,dragTile:false,script:'MapA',placing:null,selected:null,
    projectContext:{id:'test-project',kind:'custom'},projectHub:{visible:false},
    MouseEvent:class {}, queueFileImport:(files,target)=>calls.push(['import',files,target]),
    finishPlacing:()=>calls.push(['place']),cancelPlacing:()=>calls.push(['cancel']),
    dropSound:(name)=>calls.push(['sound',name]),log:()=>{},selectionLocked:()=>false,inspectedObject:()=>null,
    SOUND_EXT:/\.wav$/i,
  });
  const start=source.indexOf('// ------------------------------- drag and drop');
  const end=source.indexOf('// a sound let go over the 3D view',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(source.slice(start,end),context);
  const transfer={types:[],setData(){},files:[]};
  const event=target=>({target,dataTransfer:transfer,clientX:300,clientY:200,preventDefault(){this.defaultPrevented=true;}});
  return {bottom,canvas,window,context,calls,event,transfer};
}
test('dragging an object out of the app never starts placement',async()=>{
  const f=fixture(),tile={onclick:()=>f.calls.push(['clicked'])},target={closest:s=>s==='.srow'?null:tile};
  await f.bottom.emit('dragstart',f.event(target));
  assert.equal(f.context.dragTile,true); assert.deepEqual(f.calls,[]);
  await f.bottom.emit('dragend',f.event(target));
  assert.equal(f.context.dragTile,false); assert.deepEqual(f.calls,[]);
});
test('a valid scene drop waits for the asset and places it once',async()=>{
  const f=fixture(),tile={onclick:async()=>{await Promise.resolve();f.calls.push(['ready']);f.context.placing={};}},target={closest:s=>s==='.srow'?null:tile};
  await f.bottom.emit('dragstart',f.event(target));
  await f.canvas.emit('drop',f.event({closest:()=>null}));
  await f.bottom.emit('dragend',f.event(target));
  assert.deepEqual(f.calls,[['ready'],['place'],['cancel']]);
});
test('a delayed asset never places into another map',async()=>{
  const f=fixture(),tile={onclick:async()=>{f.context.script='MapB';f.context.placing={};}},target={closest:s=>s==='.srow'?null:tile};
  await f.bottom.emit('dragstart',f.event(target));await f.canvas.emit('drop',f.event({closest:()=>null}));
  assert.deepEqual(f.calls,[['cancel']]);
});
test('Alt: the item let go on an object replaces it (or the selection it is in), and is not placed',async()=>{
  const f=fixture(),item={cls:'Barrel1'},tile={onclick:async()=>{f.context.placing=item;}},target={closest:s=>s==='.srow'?null:tile};
  Object.assign(f.context,{replaceTargetsAt:at=>(f.calls.push(['under',at.clientX,at.clientY]),['Crate1']),
    replaceWith:async(it,list)=>{f.calls.push(['replace',it,list]);}});
  await f.bottom.emit('dragstart',f.event(target));
  await f.canvas.emit('drop',{...f.event({closest:()=>null}),altKey:true});
  assert.deepEqual(f.calls,[['under',300,200],['cancel'],['replace',item,['Crate1']],['cancel']]);
  f.calls.length=0;f.context.replaceTargetsAt=()=>null;                    // nothing under the pointer: placed as usual
  await f.bottom.emit('dragstart',f.event(target));
  await f.canvas.emit('drop',{...f.event({closest:()=>null}),altKey:true});
  assert.deepEqual(f.calls,[['place'],['cancel']]);
});
test('OS file drop prevents browser navigation and queues one import',async()=>{
  const f=fixture();f.transfer.types=['Files'];f.transfer.files=[{name:'tone.wav'}];
  const event=f.event({closest:()=>null});await f.window.emit('drop',event);
  assert.equal(event.defaultPrevented,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'import');
  const consumed=f.event({closest:()=>null});consumed.defaultPrevented=true;await f.window.emit('drop',consumed);
  assert.equal(f.calls.length,1);
});

test('OS file drop cannot import without a project or while choosing one',async()=>{
  for(const mode of ['no-project','project-hub']){
    const f=fixture();f.transfer.types=['Files'];f.transfer.files=[{name:'tone.wav'}];
    if(mode==='no-project')f.context.projectContext=null;else f.context.projectHub.visible=true;
    const event=f.event({closest:()=>null});await f.window.emit('drop',event);
    assert.equal(event.defaultPrevented,true);assert.equal(f.calls.length,0);
  }
});

