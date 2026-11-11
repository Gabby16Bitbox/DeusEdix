import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(process.env.DEUSEDIX_TEST_APP || new URL('../editor/static/app.js',import.meta.url),'utf8');
const fn=name=> {const start=source.indexOf(`function ${name}(`); assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);};
function fixture({fail=false}={}) {
  const p={userData:{kind:'structure',name:'s_Lamp'}};
  let resolve;
  const gate=new Promise(r=>resolve=r), calls=[];
  const c=vm.createContext({
    selected:p,groupPivot:{userData:{}},structures:{s_Lamp:{name:'s_Lamp',label:'Lamp',copyable:false,actors:['Light1']}},
    script:'dx:Room',mapGeneration:1,editRevision:2,gameView:{active:false},edits:{prefabs:[],props:{Light1:{LightHue:0}},deleted:{},disabled:{}},
    requireUnlocked:()=>true,copyLogicOf:()=>[],carriedBy:()=>()=>false,isStruct:p=>p.userData.kind==='structure',selKeys:()=>['s:s_Lamp'],
    livePose:()=>({offset:[12,0,0],yaw:12000,pitch:1000,roll:2000,scale:[1,1,1]}),proxyOf:()=>null,
    clipClone:v=>JSON.parse(JSON.stringify(v)),busy:()=>{},status:(...a)=>calls.push(a),log:()=>{},
    api:async()=>{await gate;if(fail)throw Error('linked gameplay');return {id:'dup_test',label:'Lamp',source:'Room',pivot:[12,0,0],members:{Light1:1}};},
    loadPrefabDisplay:async()=>({groups:[]}),nextPid:()=> 'p1',pushUndo:()=>calls.push('undo'),stepOf:()=> 'Duplicate',
    nests:()=>[],putBeside:()=>{},keyOf:p=>p.userData.name,
    setDirty:()=>{c.editRevision++;calls.push('dirty');},rebuildProxies:()=>calls.push('rebuild'),selectKeys:ks=>calls.push(ks),
    objOf:()=>({}),warnHiddenKinds:()=>{},
  });
  vm.runInContext('let nativeDuplicateTask=null;\n'+['duplicateNativePieces','duplicateNativeEntry','duplicateSelected'].map(fn).join('\n'),c);
  return {c,calls,resolve};
}
test('native piece uses snapshot and is one undo with adjacent placement and member properties',async()=>{
  const {c,calls,resolve}=fixture();const task=c.duplicateSelected();
  assert.equal(c.edits.prefabs.length,0);assert.ok(!calls.includes('undo'));resolve();assert.equal(await task,true);
  assert.equal(c.edits.prefabs.length,1);assert.equal(c.edits.prefabs[0].offset[0],48);
  assert.equal(c.edits.props.UCPfp1A1.LightHue,0);assert.equal(calls.filter(x=>x==='undo').length,1);
});
test('Alt snapshot copies in place, with no camera-relative paste offset',async()=>{
  const {c,resolve}=fixture();const task=c.duplicateSelected({offset:0});resolve();await task;
  assert.equal(c.edits.prefabs[0].offset[0],0);
});
test('stale asynchronous capture cannot modify a changed map',async()=>{
  const {c,calls,resolve}=fixture();const task=c.duplicateSelected();c.mapGeneration++;resolve();assert.equal(await task,false);
  assert.equal(c.edits.prefabs.length,0);assert.ok(!calls.includes('undo'));
});
test('failure leaves selection, history and all edits intact',async()=>{
  const {c,calls,resolve}=fixture({fail:true});const before=JSON.stringify(c.edits),p=c.selected;
  const task=c.duplicateSelected();resolve();assert.equal(await task,false);
  assert.equal(JSON.stringify(c.edits),before);assert.equal(c.selected,p);assert.ok(!calls.includes('undo'));
});
test('double click during snapshot creates only one duplicate',async()=>{
  const {c,resolve}=fixture();const a=c.duplicateSelected(),b=c.duplicateSelected();assert.equal(a,b);resolve();await a;
  assert.equal(c.edits.prefabs.length,1);
});
test('individually moved light is shifted exactly once',()=>{
  const {c}=fixture();c.duplicateNativeEntry({clip:{id:'dup',pivot:[0,0,0],members:{Light1:2}},states:{Light1:{moved:{loc:[15,20,30],rot:[4,5,6]},deleted:{orig:[2,3,4],cls:'Light'}}}},48);
  assert.deepEqual(Array.from(c.edits.moved.UCPfp1A2.loc),[63,20,30]);
  assert.equal(c.edits.deleted.UCPfp1A2.orig,undefined);
});
test('multi-selection duplicates native pieces and ordinary objects together',async()=>{
  const {c,calls,resolve}=fixture();const original=c.selected;
  c.members=()=>[original,{userData:{kind:'light',name:'Light2'}}];c.selected=c.groupPivot;
  c.dupOne=(p,off)=>{calls.push(['actor',off]);return {userData:{name:'LightCopy'}};};
  const task=c.duplicateSelected();resolve();assert.equal(await task,true);
  assert.equal(c.edits.prefabs.length,1);assert.equal(calls.filter(x=>x==='undo').length,1);
  assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='actor'&&x[1]===48));
});
test('failed native snapshot prevents partial duplication of ordinary members',async()=>{
  const {c,calls,resolve}=fixture({fail:true});const original=c.selected;
  c.members=()=>[original,{userData:{kind:'light',name:'Light2'}}];c.selected=c.groupPivot;
  c.dupOne=()=>{throw Error('must not be called');};
  const task=c.duplicateSelected();resolve();assert.equal(await task,false);
  assert.equal(c.edits.prefabs.length,0);assert.ok(!calls.includes('undo'));
});
