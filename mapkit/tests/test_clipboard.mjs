import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath, pathToFileURL} from 'node:url';
const kit=process.env.DEUSEDIX_TEST_KIT || fileURLToPath(new URL('../',import.meta.url));
const support=process.env.DEUSEDIX_TEST_SUPPORT || kit;
const THREE=await import(pathToFileURL(path.resolve(support,'../research/rea-blender/three.module.mjs')));
const {createRotations}=await import(pathToFileURL(path.join(support,'editor/static/rotation.js')));
const {createTextureScale,stretchOnResize}=await import(pathToFileURL(path.join(support,'editor/static/texture-scale.js')));
const rotations=createRotations(THREE),T=a=>new THREE.Vector3(a[0],a[2],a[1]),UE=v=>[v.x,v.z,v.y];
const source=fs.readFileSync(path.join(kit,'editor/static/app.js'),'utf8');
const fn=name=>{const i=source.indexOf(`function ${name}(`);assert.ok(i>=0,name);const first=source.slice(i,source.indexOf('\n',i));return first.trimEnd().endsWith('}')?first:source.slice(i,source.indexOf('\n}',i)+2);};
const clone=v=>JSON.parse(JSON.stringify(v));
function setup(){
 const stored=new Map(),history=[],messages=[],requests=[],scene=new THREE.Scene(),world=new THREE.Group(),proxies=new THREE.Group();scene.add(world,proxies);
 const c=vm.createContext({THREE,rotations,textureScale:createTextureScale(THREE),stretchOnResize,T,UE,ONE:[1,1,1],NO_POSE:{offset:[0,0,0],yaw:0},
  scaleOf:p=>p?.scale||[1,1,1],r1:v=>Math.round(v*10)/10,add3:(a,b)=>a.map((x,i)=>x+b[i]),
  radToYaw:r=>((Math.round(-r*65536/(2*Math.PI))%65536)+65536)%65536,
  scene,world,proxies,camera:new THREE.PerspectiveCamera(),structures:{},edits:{groups:{},copies:[],prefabs:[],added:[],boxes:[],drawn:[],props:{},anims:{},moved:{}},
  selected:null,groupPivot:new THREE.Group(),selection:[],actorStruct:{},projectContext:{id:'project'},mapGeneration:1,script:'roof',gameView:null,
  projectStorageKey:(key,p)=>p.id+':'+key,
  localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
  isStruct:p=>p?.userData.kind==='structure',objectHidden:()=>false,members:()=>c.selection,
  status:(...a)=>messages.push(a),log:(...a)=>messages.push(a),busy(){},setDirty(){},rebuildProxies(){},selectKeys:keys=>{c.keys=keys;},
  pushUndo:()=>history.push(clone(c.edits)),addedKind:cls=>cls==='PlayerStart'?'logic':cls==='ScientistFemale'?'pawn':'prop',
  lightProps:()=>({LightBrightness:100}),moverFields:e=>e.mover?clone({mover:e.mover,moverSettings:e.moverSettings||{}}):{},
  api:async(url,body)=>{requests.push(body);return body.actor?{props:{DrawScale:2,Skin:'Original'}}:{kind:'prefab',id:'export',pivot:[0,0,0],label:'Pipe',source:'roof'};},
 });
 vm.runInContext('let copyInFlight = null, clipboardSequence = 0, clipboardPastes = null; const clipClone=value=>JSON.parse(JSON.stringify(value));',c);
 for(const name of ['copyEntry','pasteEntry','poseOf','setPose','relScale','livePose','showPose','objectRotation','clipboard','clipboardItem','copySelected','clipboardPasteDelta'])vm.runInContext(fn(name),c);
 vm.runInContext('async '+fn('pasteClipboard'),c);
 vm.runInContext(fn('nextPid'),c);
 c.pastePoint=()=>{throw Error('Camera must not be used when pasting in the source map');};
 c.nextName=prefix=>{let n=0;const used=[...c.edits.added,...c.edits.boxes].map(e=>e.name);while(used.includes(prefix+n))n++;return prefix+n;};
 function actor({name='Original',cls='Barrel1',loc=[100,200,30],rot=[2200,18000,-3100],scale=1.4,source='added'}={}){
  const a={name,cls,loc,rot,scale,props:{Skin:'Live'},radius:12,height:23,kind:cls==='ScientistFemale'?'pawn':'prop'};
  if(source==='added')c.edits.added.push(a);
  const p=new THREE.Group();p.position.copy(T(loc));p.rotation.y=-rot[1]*2*Math.PI/65536;p.scale.setScalar(scale);
  p.userData={actor:a,kind:a.kind,source,tilt:rot[0],roll:rot[2]};proxies.add(p);c.selected=p;return p;
 }
 function piece({name='pipes/p0',paste=false,built={},pose={},pending=false}={}){
  const obj=new THREE.Group();obj.userData={kind:'structure',name};world.add(obj);
  const st={name,obj,label:'Pipe',pivot:[900,-200,40],placement:{offset:[0,0,0],yaw:0,...built},rotatable:true,copyable:true,piece_of:'pipes',paste,pendingPiece:pending};
  c.structures[name]=st;
  const entry={offset:[20,40,60],pitch:4000,yaw:21000,roll:-6000,scale:[0.7,1.4,2],stretch:true,...pose};
  if(paste)c.edits.prefabs.push({pid:name.slice(6),prefab:'obj_pipe',label:'Pipe',source:'Canal',pivot:st.pivot,rotatable:true,...entry});
  else c.edits.groups[name]=entry;
  c.showPose(st,c.poseOf(st));obj.add(new THREE.Mesh(new THREE.BoxGeometry(5,5,200),new THREE.MeshBasicMaterial()));c.selected=obj;c.camera.position.copy(obj.position).add(new THREE.Vector3(-100,0,0));return st;
 }
 return {c,actor,piece,stored,history,messages,requests};
}
function sameTurn(actual,expected){assert.ok(Math.abs(rotations.quat(actual).dot(rotations.quat(expected)))>0.9999999,`${actual} != ${expected}`);}

test('nearby Objects paste beside the copied pose, not current selection; repeated paste advances by 48',async()=>{
 const {c,actor,history}=setup(),p=actor(),before=clone(c.edits);
 await c.copySelected();p.position.set(90000,80000,-70000);p.rotation.y=0;c.selected=null;
 await c.pasteClipboard();const one=c.edits.added.at(-1);assert.deepEqual(clone(one.loc),[148,200,30]);sameTurn(one.rot,[2200,18000,-3100]);assert.equal(one.scale,1.4);
 await c.pasteClipboard();assert.deepEqual(clone(c.edits.added.at(-1).loc),[196,200,30]);assert.equal(history.length,2);assert.deepEqual(history[0],before);
});
test('pasted library Piece keeps full pose, nonuniform scale, explicit tiling and mover metadata',async()=>{
 const {c,piece,requests}=setup(),st=piece({name:'paste~p1',paste:true,pose:{stretch:false}});
 Object.assign(c.edits.prefabs[0],{mover:{kind:'elevator'},moverSettings:{moveTime:2}});const before=clone(c.edits.prefabs[0]);
 await c.copySelected();c.edits.prefabs[0].yaw=0;await c.pasteClipboard();const e=c.edits.prefabs[1];
 assert.equal(requests.length,0);for(const k of ['yaw','pitch','roll','scale','stretch','mover','moverSettings'])assert.deepEqual(clone(e[k]),before[k]);
 assert.deepEqual(clone(e.offset),[68,40,60]);assert.notEqual(e.pid,before.pid);assert.equal(e.prefab,before.prefab);
});
test('built Piece pasted via its existing prefab does not double its baked rotation or scale',async()=>{
 const {c,piece}=setup();const pose={offset:[35,-80,14],yaw:24000,pitch:-1300,roll:4100,scale:[1.7,0.6,2.2],stretch:false};
 piece({name:'paste~p1',paste:true,built:pose,pose});await c.copySelected();await c.pasteClipboard();const e=c.edits.prefabs[1];
 for(const k of ['yaw','pitch','roll','scale','stretch'])assert.deepEqual(clone(e[k]),pose[k]);assert.deepEqual(clone(e.offset),[83,-80,14]);
});
test('pending Un-nest pieces copy locally without Rebuild, and use the snapshot even if source moves',async()=>{
 const {c,piece,requests}=setup();piece({pending:true});await c.copySelected();c.edits.groups['pipes/p0'].yaw=0;await c.pasteClipboard();
 const e=c.edits.copies[0];assert.equal(requests.length,0);assert.equal(e.group,'pipes/p0');assert.equal(e.yaw,21000);assert.equal(e.pitch,4000);assert.equal(e.roll,-6000);assert.deepEqual(clone(e.offset),[68,40,60]);
});
test('copy of a structure copy uses original geometry and the copied pose',async()=>{
 const {c,piece}=setup(),base=piece(),st=piece({name:'pipes/p0~c1',pending:true,pose:{offset:[200,300,40]}});st.copy_of=base.name;
 c.edits.copies.push({group:base.name,id:'c1',offset:[200,300,40],yaw:21000,pitch:4000,roll:-6000});c.showPose(st,c.poseOf(st));
 await c.copySelected();await c.pasteClipboard();assert.equal(c.edits.copies[1].group,base.name);assert.deepEqual(clone(c.edits.copies[1].offset),[248,300,40]);
});
test('mixed selection keeps all members, spacing and complete rotations with one Undo',async()=>{
 const {c,piece,actor,history}=setup(),st=piece({name:'paste~p1',paste:true}),p=actor({cls:'ScientistFemale'});
 const box=new THREE.Mesh();box.position.copy(T([1,2,3]));box.scale.set(10,30,20);box.quaternion.copy(rotations.quat([5000,6000,7000]));box.userData={kind:'box',box:{name:'Block',tex:'Wall'}};
 const draw=new THREE.Group();draw.position.copy(T([10,20,30]));draw.quaternion.copy(rotations.quat([600,1200,3200]));draw.userData={kind:'drawn',origin:[10,20,30],drawn:{name:'Floor',kind:'floor',pts:[[0,0],[20,0],[20,40]],z:30}};
 c.selection=[st.obj,p,box,draw];c.selected=c.groupPivot;c.camera.position.copy(T([250,0,50]));const before=clone(c.edits);
 await c.copySelected();await c.pasteClipboard();assert.equal(c.keys.length,4);assert.equal(history.length,1);assert.deepEqual(history[0],before);
 assert.deepEqual(clone(c.edits.added.at(-1).loc),[148,200,30]);assert.equal(c.edits.added.at(-1).kind,'pawn');
 const b=c.edits.boxes[0];assert.deepEqual(clone(b.lo),[44,-8,-12]);assert.deepEqual(clone(b.hi),[54,12,18]);sameTurn(b.rot,[5000,6000,7000]);
 const d=c.edits.drawn[0];assert.deepEqual(clone(d.pts),[[48,0],[68,0],[68,40]]);sameTurn(d.rot,[600,1200,3200]);assert.equal(d.z,30);
});
test('map actor overlays and live rotation win over stale export; built scale is not applied twice',async()=>{
 const {c,actor}=setup(),p=actor({source:'map',scale:1.25});c.edits.props.Original={Skin:'Changed'};c.edits.anims.Original={sequence:'Dance'};
 await c.copySelected();await c.pasteClipboard();const e=c.edits.added[0];assert.equal(e.props.DrawScale,2);assert.equal(e.scale,1.25);assert.equal(e.props.Skin,'Changed');sameTurn(e.rot,[2200,18000,-3100]);assert.equal(c.edits.anims[e.name].sequence,'Dance');
});
test('immediate Ctrl+V waits for Ctrl+C instead of pasting an old clipboard',async()=>{
 const {c,actor}=setup();actor({source:'map'});let finish;c.api=()=>new Promise(resolve=>{finish=resolve;});
 const copying=c.copySelected(),pasting=c.pasteClipboard();assert.equal(c.edits.added.length,0);finish({props:{}});await copying;await pasting;assert.equal(c.edits.added.length,1);
});
test('snapshot is captured for all members before slow exports finish',async()=>{
 const {c,actor}=setup(),p=actor({source:'map'}),q=actor({name:'Other',source:'map',rot:[2,3,4]});c.selection=[p,q];c.selected=c.groupPivot;
 let release,first=true;c.api=async()=>{if(first){first=false;await new Promise(r=>{release=r;});}return {props:{}};};
 const copying=c.copySelected();q.position.set(9999,8888,7777);q.rotation.y=1;release();await copying;await c.pasteClipboard();assert.deepEqual(clone(c.edits.added[1].loc),[148,200,30]);sameTurn(c.edits.added[1].rot,[2,3,4]);
});
test('changing map while copy is pending cannot commit a stale clipboard',async()=>{
 const {c,actor,stored}=setup();actor({source:'map'});let finish;c.api=()=>new Promise(r=>{finish=r;});const copying=c.copySelected();c.script='other';c.mapGeneration++;finish({props:{}});assert.equal(await copying,false);assert.equal(stored.size,0);
});
test('unsupported mixed selection fails atomically and clears an old clipboard',async()=>{
 const {c,actor,stored,history}=setup(),p=actor();await c.copySelected();const mover=new THREE.Group();mover.userData={kind:'mover'};
 c.selection=[p,mover];c.selected=c.groupPivot;assert.equal(await c.copySelected(),false);await c.pasteClipboard();assert.equal(stored.size,0);assert.equal(history.length,0);assert.equal(c.edits.added.length,1);
});
test('structures do not copy carried actors twice',async()=>{
 const {c,actor,piece}=setup(),st=piece({name:'paste~p1',paste:true}),p=actor({source:'map'});c.actorStruct.Original=st.name;c.selection=[st.obj,p];c.selected=c.groupPivot;
 await c.copySelected();await c.pasteClipboard();assert.equal(c.keys.length,1);assert.equal(c.edits.added.length,0);
});
test('across maps prefab pieces keep rotation and group spacing, using destination camera only there',async()=>{
 const {c,actor,piece}=setup(),st=piece({name:'paste~p1',paste:true}),p=actor();c.selection=[st.obj,p];c.selected=c.groupPivot;
 await c.copySelected();const clip=c.clipboard();c.script='other';c.edits.prefabs=[];c.edits.added=[];c.pastePoint=()=>T([1000,2000,3000]);await c.pasteClipboard();
 const delta=c.clipboardPasteDelta(clip,1);assert.deepEqual(clone(c.edits.added[0].loc),[100,200,30].map((x,i)=>x+delta[i]));assert.equal(c.edits.prefabs[0].yaw,21000);
});
test('unbuilt native structure cannot silently paste stale geometry into another map',async()=>{
 const {c,piece,history,messages}=setup();piece({pending:true});await c.copySelected();c.script='other';await c.pasteClipboard();assert.equal(history.length,0);assert.match(messages.at(-1)[0],/Nothing pasted/);
});
test('rebuilt native structure keeps baked orientation through portable cross-map fallback',async()=>{
 const {c,piece,requests}=setup();const pose={offset:[20,40,60],pitch:4000,yaw:21000,roll:-6000,scale:[0.7,1.4,2],stretch:true};piece({built:pose,pose});await c.copySelected();assert.equal(requests.length,1);
 c.script='other';c.pastePoint=()=>T([100,200,300]);await c.pasteClipboard();assert.equal(c.edits.prefabs[0].yaw,0);assert.equal(c.edits.prefabs[0].prefab,'export');
});
test('local duplicate preview applies exactly the snapshot rotation to every vertex',async()=>{
 const {c,piece}=setup(),st=piece({pending:true});const q0=st.obj.quaternion.clone(),p0=st.obj.position.clone();await c.copySelected();await c.pasteClipboard();
 const e=c.edits.copies[0],copy={...st,obj:st.obj.clone()};c.showPose(copy,e);st.obj.updateMatrixWorld(true);copy.obj.updateMatrixWorld(true);
 for(const v of [[1,2,3],[5,0,100],[-2,5,200]]){const expected=T(v).applyMatrix4(st.obj.matrixWorld).add(new THREE.Vector3(48,0,0));const actual=T(v).applyMatrix4(copy.obj.matrixWorld);assert.ok(actual.distanceTo(expected)<0.001);}
 assert.ok(Math.abs(copy.obj.quaternion.dot(q0))>0.99999999);assert.equal(copy.obj.position.x-p0.x,48);
});
test('far Object pastes between source and current camera, within 256 units, with unchanged rotation',async()=>{
 const {c,actor}=setup();actor({loc:[4000,-2000,300]});await c.copySelected();c.camera.position.copy(T([40,60,80]));await c.pasteClipboard();
 const e=c.edits.added.at(-1),from=T([4000,-2000,300]).sub(c.camera.position).normalize(),to=T(e.loc).sub(c.camera.position);
 assert.ok(Math.abs(to.length()-256)<0.001);assert.ok(to.clone().normalize().distanceTo(from)<0.0001);sameTurn(e.rot,[2200,18000,-3100]);
});
test('far mixed selection shifts as one rigid group, never towards a distant wall',async()=>{
 const {c,actor,piece}=setup(),st=piece({name:'paste~p1',paste:true}),p=actor({loc:[1000,-190,80]});c.selection=[st.obj,p];c.selected=c.groupPivot;
 await c.copySelected();const original=c.clipboard();c.camera.position.copy(T([-3000,2000,200]));await c.pasteClipboard();
 const copiedCenter=T(original.anchor).add(T(c.clipboardPasteDelta(original,1)));assert.ok(Math.abs(copiedCenter.distanceTo(c.camera.position)-256)<0.001);
 const a=c.edits.added.at(-1),pf=c.edits.prefabs.at(-1),pfLoc=pf.pivot.map((v,i)=>v+pf.offset[i]);
 assert.ok(T(a.loc).sub(T(pfLoc)).distanceTo(T(original.items[1].loc).sub(T(original.items[0].loc)))<0.001);
});
test('Alt-drag and Duplicate remain on their existing original-relative path',()=>{
 const alt=source.slice(source.indexOf('let evenScale = null;'),source.indexOf('function evenScaleNow'));
 assert.match(alt,/duplicateSelected\(\{offset: 0\}\)/);assert.doesNotMatch(alt,/clipboardPasteDelta|pasteClipboard/);
 const duplicate=fn('duplicateSelected');assert.doesNotMatch(duplicate,/clipboardPasteDelta|pasteClipboard|camera/);
});
test('actual saved rooftop pipes retain the rotated geometry through copy/paste and serialized edits', {skip:!process.env.DEUSEDIX_REAL_MAP}, async()=>{
 const saved=JSON.parse(fs.readFileSync(process.env.DEUSEDIX_REAL_MAP,'utf8'));
 const pipes=saved.prefabs.filter(e=>/pipe/i.test(e.label||''));assert.ok(pipes.length>0);
 let vertices=0;
 for(const entry of pipes){
  const {c,piece}=setup();c.edits.prefabs=[];
  const st=piece({name:'paste~'+entry.pid,paste:true,pose:entry});c.edits.prefabs=[clone(entry)];st.pivot=clone(entry.pivot);c.showPose(st,c.poseOf(st));c.camera.position.copy(st.obj.position).add(new THREE.Vector3(-100,20,0));
  const display=JSON.parse(fs.readFileSync(path.join(support,'prefabs',entry.prefab,'display.json'),'utf8'));
  await c.copySelected();await c.pasteClipboard();const result=clone(c.edits.prefabs.at(-1));
  const output={...st,obj:new THREE.Group()};c.showPose(output,result);st.obj.updateMatrixWorld(true);output.obj.updateMatrixWorld(true);
  for(const group of display.groups)for(let i=0;i<group.pos.length;i+=3){
    const p=T(group.pos.slice(i,i+3)).sub(T(entry.pivot)),before=p.clone().applyMatrix4(st.obj.matrixWorld),after=p.applyMatrix4(output.obj.matrixWorld);
    assert.ok(after.distanceTo(before.add(new THREE.Vector3(48,0,0)))<0.01);vertices++;
  }
 }
 assert.ok(vertices>100);console.log(`Verified ${pipes.length} saved rooftop pipes, ${vertices} vertices; no user files written.`);
});
test('real keyboard handler: Ctrl+C / Ctrl+V and one Ctrl+Z restore the selection atomically',async()=>{
 const {c,actor,history}=setup();actor();const before=clone(c.edits);let onKey;
 Object.assign(c,{window:{addEventListener:(type,fn)=>{if(type==='keydown')onKey=fn;}},document:{querySelector:()=>null},
   projectHub:null,textureTransfer:null,propertySlider:null,inspectorDrag:null,cam:{look:false},undo:[],redoStack:[],afterHistory(){}});
 c.pushUndo=()=>{c.undo.push(JSON.stringify(c.edits));history.push(clone(c.edits));};
 const start=source.indexOf('window.addEventListener(\'keydown\'',source.indexOf('// ---------------------------------------------------------------- keyboard'));
 const end=source.indexOf("$('#lightmode').onchange",start);vm.runInContext(source.slice(start,end),c);
 const key=(key,tagName='BODY')=>onKey({key,ctrlKey:true,target:{tagName},preventDefault(){}});
 key('c');await vm.runInContext('copyInFlight',c);key('v');await Promise.resolve();assert.equal(c.edits.added.length,2);assert.equal(c.undo.length,1);
 key('z');assert.deepEqual(clone(c.edits),before);assert.equal(c.redoStack.length,1);
 key('v','INPUT');assert.deepEqual(clone(c.edits),before);
});
