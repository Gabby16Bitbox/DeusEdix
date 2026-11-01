import test, {THREE} from './three.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRotations} from '../editor/static/rotation.js';
import {createSurfacePlacement} from '../editor/static/surface-placement.js';
import {createDrawTools} from '../editor/static/draw-tools.js';
import {createSelectionOutline} from '../editor/static/selection-outline.js';
import {createTextureScale, stretchOnResize} from '../editor/static/texture-scale.js';
import {pushMove} from '../editor/static/grid-snap.js';
import {putBeside} from '../editor/static/hierarchy-folders.js';
import {createHistory,recordStep,renameStep,namedStep,dropStep,travelStep,currentName} from '../editor/static/history-names.js';
import {airGap} from '../editor/static/map-check.js';
import {overridesData,putOverrides,overridesOf,replacedOn} from '../editor/static/prefab-links.js';
import {signedRot} from '../editor/static/surface-stick.js';
import {mirrorPoint,faceMirrored,mirrorMotion} from '../editor/static/mirror.js';
import {TRANSFORM} from '../editor/static/multi-edit.js';
const rotations=createRotations(THREE), placementGeometry=createSurfacePlacement(THREE);
const source=fs.readFileSync(new URL('../editor/static/app.js',import.meta.url),'utf8');
const body=name=>{const i=source.indexOf(`function ${name}(`);assert.ok(i>=0,name);return source.slice(i,source.indexOf('\n}',i)+2);};
const line=start=>{const i=source.indexOf(start);assert.ok(i>=0,start);return source.slice(i,source.indexOf('\n',i));};
const T=a=>new THREE.Vector3(a[0],a[2],a[1]), UE=v=>[v.x,v.z,v.y], r1=v=>Math.round(v*10)/10;
function setup(){
 const scene=new THREE.Scene(),world=new THREE.Group(),proxies=new THREE.Group(),groupPivot=new THREE.Group();scene.add(world,proxies,groupPivot);
 const history=[],logs=[];
 const c=vm.createContext({THREE,rotations,placementGeometry,textureScale:createTextureScale(THREE),stretchOnResize,T,UE,r1,YAW:65536,ONE:[1,1,1],NO_POSE:{offset:[0,0,0],yaw:0},
  scaleOf:p=>p?.scale||[1,1,1],add3:(a,b)=>a.map((x,i)=>x+b[i]),yawToRad:y=>-y*2*Math.PI/65536,radToYaw:y=>((Math.round(-y*65536/(2*Math.PI))%65536)+65536)%65536,
  structures:{},edits:{groups:{},copies:[],prefabs:[],moved:{},deleted:{},boxes:[],added:[]},scene,world,proxies,groupPivot,mapKind:'script',actorStruct:{},
  selected:null,moveStart:null,mapGeneration:1,script:'fixture',camera:new THREE.PerspectiveCamera(),ray:new THREE.Raycaster(),builtScale:{},altCopyUndo:false,
  isStruct:p=>p?.userData.kind==='structure',objectHidden:()=>false,selectionLocked:()=>false,requireUnlocked:()=>true,
  setDirty(){},showDetails(){},buildHierarchy(){},status(){},pushUndo:(label)=>{history.push(JSON.stringify(c.edits));recordStep(c.undoHistory,'',label);},log:(...x)=>logs.push(x),
  undoHistory:createHistory(),renameStep,namedStep,dropStep,currentName,historyChanged(){},objectLabel:p=>[p.userData.name??p.userData.actor?.name,''],tc:{dragging:true,mode:'translate'},
  buildJob:null,transformStep:null,
  select:p=>{c.selected=p;},members:()=>c.selection||[],selKeys:()=>[],selectKeys(){},visibleHits:h=>h.filter(x=>{for(let p=x.object;p;p=p.parent)if(!p.visible)return false;return true;}),
  placeModeLabel:x=>x,normalToRotation:n=>({pitch:Math.round(Math.atan2(n[2],Math.hypot(n[0],n[1]))*65536/(2*Math.PI)),yaw:Math.round(Math.atan2(n[1],n[0])*65536/(2*Math.PI))}),
  rotationToVector:(p,y)=>[Math.cos(p*2*Math.PI/65536)*Math.cos(y*2*Math.PI/65536),Math.cos(p*2*Math.PI/65536)*Math.sin(y*2*Math.PI/65536),Math.sin(p*2*Math.PI/65536)],
  movedPose:p=>p.offset.some(Boolean)||p.yaw||p.pitch||p.roll||(p.scale||[1,1,1]).some(v=>v!==1),
  putBeside,nests:()=>c.edits.nests||=[],objOf:k=>k,warnHiddenKinds:(list,done)=>{c.warned=[list,done];},
  // a structure let go with queued surface rows: their preview drawn again at the next frame (commitStructure)
  surfaceFrame:0,frames:[],requestAnimationFrame:fn=>c.frames.push(fn),refreshSurfaceTexturePreview(){},wake(){},
 });
 for(const name of ['copyEntry','pasteEntry','poseOf','setPose','relScale','poseToPose','showPose','livePose','objectRotation','setObjectRotation','beginStructMove','followStructure','keptPlaces','replacingOf','carries','carriedBy','commitStructure','bakeOut','structureOf','surfaceHit','solidAlong','facingNormal','dropTarget','stickTarget','selectionParts','memberLocked','placeOnSurfaces','dupStructure','dupOne','ownProps','duplicateSelected','lightProps','stepOf','beginTransformUndo','endTransformUndo','dropUndo'])vm.runInContext(body(name),c);
 // a step's verb, the gizmo's pose, snapping's hits (as var: the test reads them on the context)
 for(const start of ['const TOOL_VERBS = ','const gizmoPose = ','const pickableHits = '])vm.runInContext(line(start).replace(/^const /,'var '),c);
 let seq=0;
 c.nextName=()=>`copy${++seq}`;c.nextPid=()=>`p${++seq}`;
 Object.assign(c,{overridesData,putOverrides,overridesOf,replacedOn});    // a copy of a copy takes its overrides, they go with it (prefab-links.js)
 c.keyOf=p=>p.userData.kind==='structure'?'s:'+p.userData.name:'a:'+p.userData.actor.name;
 c.selectKeys=keys=>c.copySelection=keys;
 c.makeProxy=(a,source)=>{const p=new THREE.Group();p.userData={actor:a,kind:a.kind,source,tilt:a.rot?.[0]||0,roll:a.rot?.[2]||0};p.rotation.y=c.yawToRad(a.rot?.[1]||0);p.position.copy(T(a.loc));p.scale.setScalar(a.scale||1);proxies.add(p);return p;};
 c.rebuildProxies=()=>{};
 function piece(name='piece',pose={},built={}){
  const obj=new THREE.Group();obj.userData={kind:'structure',name};obj.add(new THREE.Mesh(new THREE.BoxGeometry(80,12,16),new THREE.MeshBasicMaterial()));world.add(obj);
  const st={name,label:name,obj,pivot:[0,0,0],placement:{offset:[0,0,0],yaw:0,...built},copyable:true,rotatable:true,actors:[]};c.structures[name]=st;
  c.edits.groups[name]={offset:[0,0,0],yaw:0,...pose};c.showPose(st,c.poseOf(st));c.selected=obj;return st;
 }
 return {c,piece,history,logs};
}
const near=(a,b,eps=0.003)=>assert.ok(a.distanceTo(b)<eps,`${a.toArray()} != ${b.toArray()}`);
test('snapping (V, Ctrl+Shift: pickable) skips what is locked, by its padlock or its kind; Drop to floor still lands on it',()=>{
 const {c}=setup();vm.runInContext(body('visibleHits'),c);          // the page's own: what is locked is not pickable
 const floor=new THREE.Mesh(new THREE.BoxGeometry(400,10,400),new THREE.MeshBasicMaterial());floor.userData.world=true;floor.position.y=-100;c.world.add(floor);
 const block=new THREE.Group();block.userData={kind:'box',box:{name:'UCEditBox0'}};block.add(new THREE.Mesh(new THREE.BoxGeometry(100,10,100),new THREE.MeshBasicMaterial()));c.proxies.add(block);
 let locked=false;c.keyOf=o=>o.userData.box?'b:'+o.userData.box.name:null;c.objectLocked=o=>locked&&o===block;
 c.scene.updateMatrixWorld(true);
 const down=new THREE.Raycaster(new THREE.Vector3(0,100,0),new THREE.Vector3(0,-1,0));
 assert.equal(c.solidAlong(down,new Set()).object.parent,block);
 assert.equal(c.solidAlong(down,new Set(),c.pickableHits).object.parent,block,'not locked: snapped onto');
 locked=true;
 assert.equal(c.solidAlong(down,new Set()).object.parent,block,'Drop to floor: a surface all the same');
 assert.equal(c.solidAlong(down,new Set(),c.pickableHits).object,floor,'snapping: not onto what is locked');
});
test('V snapping and the Ctrl+Shift slide ask solidAlong for what can be picked (pickable: not what is locked)',()=>{
 const {c}=setup(),asked=[];
 c.solidAlong=(r,ignored,among)=>{asked.push(among===c.pickableHits);return null;};
 c.mouseRay=()=>new THREE.Raycaster();c.ringAround=()=>[[0,0],[4,0]];
 vm.runInContext(body('cornersUnder')+'\n'+body('slideOver'),c);
 assert.equal(c.cornersUnder([10,10],new Set()).length,0);
 c.moving={parts:{list:[],ignored:new Set()}};c.dragPointer=[10,10];
 c.slideOver(new THREE.Group());
 assert.deepEqual(asked,[true,true,true],'two rays of V, one of the slide');
});
test('UE pitch/yaw/roll composition round-trips including gimbal limits',()=>{
 for(const r of [[1234,8765,-4567],[16384,32000,5000],[-16384,9123,10000],[0,16384,0]]){
  const q=rotations.quat(r);assert.ok(Math.abs(q.dot(rotations.quat(rotations.rot(q))))>0.9999999);
 }
 near(new THREE.Vector3(1,0,0).applyQuaternion(rotations.quat([16384,0,0])),new THREE.Vector3(0,1,0));
 near(new THREE.Vector3(0,0,1).applyQuaternion(rotations.quat([0,0,16384])),new THREE.Vector3(0,-1,0));
});
test('canonical built geometry, compound turn and nonuniform scale agree with poseToPose',()=>{
 const {c,piece}=setup(),built={offset:[20,30,40],yaw:7000,pitch:3800,roll:1200,scale:[2,0.8,3]},to={offset:[50,-60,70],yaw:9000,pitch:-4200,roll:6500,scale:[1.1,2,0.6]};
 const st=piece('test',to,built),raw=[30,10,20];
 const builtPoint=c.poseToPose(st,c.NO_POSE,built)(raw);
 const local=T(builtPoint).sub(T(built.offset)).applyQuaternion(rotations.pose(built).invert());
 st.obj.updateMatrixWorld(true);near(local.applyMatrix4(st.obj.matrixWorld),T(c.poseToPose(st,c.NO_POSE,to)(raw)));
 const saved=c.livePose(st);assert.deepEqual(JSON.parse(JSON.stringify(saved.scale)),to.scale);
 assert.ok(Math.abs(rotations.pose(saved).dot(rotations.pose(to)))>0.9999999);
});
test('duplicate independent piece retains all axes, scale and texture stretch',()=>{
 const {c,piece}=setup(),st=piece('roof/p4',{yaw:8192,pitch:4096,roll:6000,scale:[0.3,0.6,2],stretch:true});
 const name=c.dupStructure(st,48),copy=c.edits.copies[0];assert.equal(name,'roof/p4~c1');
 for(const k of ['yaw','pitch','roll','stretch'])assert.equal(copy[k],c.edits.groups[st.name][k]);
 assert.deepEqual(JSON.parse(JSON.stringify(copy.scale)),[0.3,0.6,2]);assert.equal(copy.offset[0],48);
});
test('Drop includes pieces, excludes their own geometry, one Undo restores edits',()=>{
 const {c,piece,history}=setup(),st=piece('trim',{offset:[0,0,120],pitch:4096,roll:2000});
 const floor=new THREE.Mesh(new THREE.BoxGeometry(1000,10,1000),new THREE.MeshBasicMaterial());floor.position.y=-5;floor.userData.world=true;c.world.add(floor);
 const before=JSON.stringify(c.edits);c.placeOnSurfaces('drop');assert.equal(history.length,1);assert.equal(history[0],before);
 assert.ok(Math.abs(placementGeometry.bounds(st.obj).min.y-0.5)<0.001);assert.ok(c.edits.groups.trim.pitch);
});
test('Stick includes pieces and uses correct nonuniform-scale normals/contact',()=>{
 const {c,piece,history}=setup(),st=piece('trim',{offset:[0,0,60],yaw:2200,scale:[1.4,0.8,2]});
 const wall=new THREE.Mesh(new THREE.BoxGeometry(10,1000,1000),new THREE.MeshBasicMaterial());wall.position.x=200;wall.userData.world=true;c.world.add(wall);c.camera.position.set(-300,60,0);
 c.placeOnSurfaces('stick');assert.equal(history.length,1);assert.ok(Math.abs(placementGeometry.bounds(st.obj).max.x-194.5)<0.001);
});
test('no surface is explicit and never creates an Undo entry',()=>{
 const {c,piece,history,logs}=setup();piece();c.placeOnSurfaces('drop');assert.equal(history.length,0);assert.match(logs[0][0],/no reachable surface/);
});
test('Push to grid puts a piece and a block on the grid in one Undo; already there, no Undo',()=>{
 const {c,piece,history}=setup(),st=piece('trim',{offset:[13,-21,37]});
 vm.runInContext(['gridAnchor','pushToGrid','shiftBlock'].map(body).join('\n'),c);Object.assign(c,{pushMove,SNAP:{move:16}});
 const block=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());block.userData={kind:'box',box:{lo:[-61,3,0],hi:[67,131,128]}};
 block.position.copy(T([3,67,64]));c.proxies.add(block);c.selection=[st.obj,block];c.selected=c.groupPivot;
 c.pushToGrid();assert.equal(history.length,1);
 assert.deepEqual([...c.edits.groups.trim.offset],[16,-16,32]);near(st.obj.position,T([16,-16,32]));
 assert.deepEqual(block.userData.box.lo,[-64,0,0]);assert.deepEqual(block.userData.box.hi,[64,128,128]);near(block.position,T([0,64,64]));
 c.pushToGrid();assert.equal(history.length,1,'on the grid already: nothing to undo');
});
test('a structure moved: what Delete and Replace with... keep of its objects (their place) moves with it',()=>{
 const {c,piece}=setup(),st=piece('booth');st.actors=['Lamp1','Crate1','Other1'];
 c.edits.added.push({name:'Lamp1',cls:'Spotlight',loc:[10,0,64],replaces:{cls:'Light',orig:[10,0,64]}},{name:'Other1',cls:'Barrel1',loc:[0,40,0]});
 c.edits.deleted.Crate1={cls:'CrateUnbreakableSmall',orig:[-20,0,0]};
 const ms=c.beginStructMove(st.obj);st.obj.position.add(T([32,-16,8]));c.followStructure(ms);c.commitStructure(ms,true);
 assert.deepEqual([...c.edits.groups.booth.offset],[32,-16,8]);
 assert.deepEqual([...c.edits.added[0].replaces.orig],[42,-16,72]);           // found there at Rebuild: the map's own goes
 assert.deepEqual([...c.edits.deleted.Crate1.orig],[12,-16,8]);
 assert.deepEqual([...c.edits.added[0].loc],[10,0,64]);                        // the replacement itself stays where it was
 assert.equal(c.edits.added[1].replaces,undefined);
});
test('a moved structure taken apart: what Delete and Replace with... keep goes back to the script place',()=>{
 const {c,piece}=setup(),st=piece('booth');st.actors=['Lamp1','Crate1'];
 c.baseActors=[{name:'Lamp1',cls:'Light',loc:[10,0,64],rot:[0,0,0]},{name:'Crate1',cls:'CrateUnbreakableSmall',loc:[-20,0,0],rot:[0,0,0]}];
 c.edits.added.push({name:'Lamp1',cls:'Spotlight',loc:[10,0,64],replaces:{cls:'Light',orig:[10,0,64]}});
 c.edits.deleted.Crate1={cls:'CrateUnbreakableSmall',orig:[-20,0,0]};
 const ms=c.beginStructMove(st.obj);st.obj.position.add(T([32,0,0]));c.followStructure(ms);c.commitStructure(ms,true);
 c.bakeOut(st,[],['Lamp1','Crate1']);                      // un-nested: the build no longer moves them with the structure
 assert.deepEqual([...c.edits.added[0].replaces.orig],[10,0,64]);
 assert.deepEqual([...c.edits.deleted.Crate1.orig],[-20,0,0]);
});
test('a block turned with a group: its corners to a hundredth of a unit, its size kept, its proxy at their middle',()=>{
 const {c}=setup();vm.runInContext(['shiftBlock','turnBlock','commit'].map(body).join('\n'),c);Object.assign(c,{anim:null,dressBlock(){}});
 const b={name:'UCEditBox0',lo:[100.1,0,0],hi:[228.1,64,32],rot:[0,0,0]},a=15*Math.PI/180;
 const p=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());p.userData={kind:'box',box:b};c.proxies.add(p);
 const turned=[164.1*Math.cos(a)-32*Math.sin(a),164.1*Math.sin(a)+32*Math.cos(a),16];      // its middle, the group turned 15 degrees about 0
 p.position.copy(T(turned));p.quaternion.copy(rotations.quat([0,2731,0]));c.commit(p);
 for(const v of [...b.lo,...b.hi])assert.ok(String(v).split('.')[1]===undefined||String(v).split('.')[1].length<=2,String(v));
 b.hi.forEach((v,k)=>assert.ok(Math.abs(v-b.lo[k]-[128,64,32][k])<1e-9,'size'));
 near(p.position,T(b.lo.map((v,k)=>(v+b.hi[k])/2)),1e-9);near(p.position,T(turned),0.01);
 assert.equal(b.rot[1],2731);
});
test('drawn floor keeps arbitrary rotation after commit and recreation',()=>{
 const edits={drawn:[]},scene=new THREE.Scene(),tool=createDrawTools({THREE,T,scene,getEdits:()=>edits,status(){},escapeHtml:s=>s,getSnap:()=>false,texList:()=>[]});
 const p={kind:'floor',name:'f',pts:[[0,0],[100,0],[100,100],[0,100]],z:20,closed:true},g=tool.proxy(p),q=rotations.quat([4800,6000,1800]);g.quaternion.copy(q);g.position.add(new THREE.Vector3(10,20,30));tool.commitMove(g);
 const restored=tool.proxy(p);near(restored.position,g.position);assert.ok(Math.abs(restored.quaternion.dot(q))>0.9999999);
});

test('oriented selection box follows a thin panel on every axis without AABB growth',()=>{
 const scene=new THREE.Scene(),panel=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(200,150,3),new THREE.MeshBasicMaterial());panel.add(mesh);scene.add(panel);
 const outline=createSelectionOutline(THREE);scene.add(outline);panel.scale.set(1.4,0.7,2);
 for(const rotation of [[0,0,0],[2000,8192,6000],[-8000,19000,7000]]){
  panel.quaternion.copy(rotations.quat(rotation));panel.position.set(25,15,40);outline.setFromObject(panel);scene.updateMatrixWorld(true);
  const v=new THREE.Vector3(),expected=new THREE.Vector3();
  for(let i=0;i<8;i++){
   v.set(i&1?0.5:-0.5,i&2?0.5:-0.5,i&4?0.5:-0.5).applyMatrix4(outline.matrixWorld);
   expected.set(i&1?100:-100,i&2?75:-75,i&4?1.5:-1.5).applyMatrix4(panel.matrixWorld);near(v,expected,0.00001);
  }
 }
});

test('outline ignores icons and collision helper; refreshes a replacement model',()=>{
 const root=new THREE.Group(),model=new THREE.Mesh(new THREE.BoxGeometry(10,20,3),new THREE.MeshBasicMaterial());root.add(model,new THREE.Sprite(new THREE.SpriteMaterial()));root.userData.model=model;
 const helper=new THREE.Mesh(new THREE.SphereGeometry(200),new THREE.MeshBasicMaterial());root.add(helper);
 const outline=createSelectionOutline(THREE);outline.setFromObject(root);near(new THREE.Vector3().setFromMatrixScale(outline.matrix),new THREE.Vector3(10,20,3));
 model.geometry=new THREE.BoxGeometry(5,8,1);outline.setFromObject(root);near(new THREE.Vector3().setFromMatrixScale(outline.matrix),new THREE.Vector3(5,8,1));
});

test('Duplicate copies every selected piece and actor with one shared offset, rotation and scale',()=>{
 const {c,piece,history}=setup(),p1=piece('plant/p4',{offset:[100,200,30],pitch:2000,yaw:5000,roll:-1000,scale:[2,1,0.5]}),p2=piece('plant/p5',{offset:[-100,300,30],yaw:9000});
 const light=c.makeProxy({name:'Light28',cls:'Light',kind:'light',loc:[80,90,100],rot:[3300,4400,5500],props:{LightHue:120},scale:1.3},'added');c.edits.added.push(light.userData.actor);
 c.selection=[p1.obj,p2.obj,light];c.selected=c.groupPivot;
 assert.equal(c.duplicateSelected(),true);assert.equal(history.length,1);assert.equal(c.copySelection.length,3);assert.equal(c.edits.copies.length,2);
 for(let i=0;i<2;i++){const original=c.edits.groups[i?'plant/p5':'plant/p4'],copy=c.edits.copies[i];assert.equal(copy.offset[0],original.offset[0]+48);assert.equal(copy.yaw,original.yaw);}
 const copied=c.edits.added[1];assert.deepEqual([...copied.rot],[3300,4400,5500]);assert.deepEqual([...copied.loc],[128,90,100]);assert.equal(copied.scale,1.3);assert.equal(copied.props.LightHue,120);
 assert.deepEqual(JSON.parse(history[0]).copies,[]);
});

test('Alt-copy starts in place and its drag shares the same Undo snapshot',()=>{
 const {c,piece,history}=setup();piece('railing',{offset:[10,20,30],pitch:3200,yaw:5400,roll:2100});
 assert.ok(c.duplicateSelected({offset:0}));assert.deepEqual([...c.edits.copies[0].offset],[10,20,30]);
 c.altCopyUndo=true;c.beginTransformUndo();assert.equal(history.length,1);assert.equal(c.altCopyUndo,false);
 c.beginTransformUndo();assert.equal(history.length,2,'the next normal drag gets its own Undo');
 const names=c.undoHistory.undo.map(s=>s.label);                                // the copy's step took the drag in
 assert.equal(names.length,2);assert.match(names[0],/^Duplicate and move /);assert.match(names[1],/^Move /);
});

// part B's #8 (B2, 1 Nov 2026): a linked copy pasted from the library (paste~p7, built) whose objects were moved, deleted
// and given another class; Alt-drag (Duplicate in place) gives the new copy, not built yet, its overrides; then it is
// dragged and turned before a Rebuild. pid: the copy, built: whether it is in the map, actors: its objects there
function linkedCopies(){
 const {c}=setup(),V='usr_'+'d'.repeat(32),clone=x=>JSON.parse(JSON.stringify(x));
 Object.assign(c,{signedRot,applyTilt(){}});          // setObjectRotation's, for an added object dragged along
 const paste=(pid,built,actors=[])=>{const name='paste~'+pid,obj=new THREE.Group();obj.userData={kind:'structure',name};c.world.add(obj);
  const st={name,obj,label:'Desk',pivot:[0,0,0],placement:{offset:[0,0,0],yaw:0},rotatable:true,copyable:true,paste:true,pendingPaste:!built,built,actors:built?actors:[]};
  c.structures[name]=st;c.showPose(st,c.poseOf(st));return st;};
 c.edits.prefabs.push({pid:'p7',prefab:V,line:V,version:1,label:'Desk',pivot:[0,0,0],offset:[0,0,0],yaw:0});
 c.edits.moved.UCPfp7A0={cls:'Chair1',loc:[110,0,0],rot:[0,0,0],orig:[100,0,0]};
 c.edits.deleted.UCPfp7A1={cls:'Lamp1',orig:[50,0,0]};
 c.edits.added.push({name:'UCPfp7A3',cls:'Plant2',loc:[70,0,0],rot:[0,0,0],props:{},replaces:{cls:'Plant1',orig:[70,0,0]}});
 const p7=paste('p7',true,['UCPfp7A0','UCPfp7A1','UCPfp7A3']);
 // its replacing object (an added one) in the view, as rebuildProxies draws it
 const shown=name=>c.makeProxy({...c.edits.added.find(x=>x.name===name),kind:'prop'},'added');
 return {c,clone,paste,p7,shown};
}
test('a linked copy not built yet takes its carried overrides along when moved or turned before a Rebuild, its replacing object too',()=>{
 const {c,clone,paste,p7,shown}=linkedCopies();
 const name=c.dupStructure(p7,0),pid=name.slice('paste~'.length),tag='UCPf'+pid,copy=paste(pid,false),plant=shown(tag+'A3');
 const ms=c.beginStructMove(copy.obj);copy.obj.position.add(T([300,0,0]));c.followStructure(ms);
 near(plant.position,T([370,0,0]));                                       // dragged with it
 c.commitStructure(ms,true);
 const e=c.edits,replacing=()=>e.added.find(x=>x.name===tag+'A3');
 assert.deepEqual([clone(e.moved[tag+'A0'].loc),clone(e.moved[tag+'A0'].orig),clone(e.deleted[tag+'A1'].orig)],[[410,0,0],[400,0,0],[350,0,0]]);
 assert.deepEqual([clone(replacing().loc),clone(replacing().replaces.orig)],[[370,0,0],[370,0,0]]);
 assert.deepEqual([clone(e.moved.UCPfp7A0.orig),clone(e.deleted.UCPfp7A1.orig),clone(e.added[0].loc)],[[100,0,0],[50,0,0],[70,0,0]]);   // the first copy's stay
 // turned a quarter round where it stands: each of them turns with it
 const before=c.poseOf(copy),ms2=c.beginStructMove(copy.obj);copy.obj.quaternion.copy(c.rotations.pose({yaw:16384,pitch:0,roll:0}));c.followStructure(ms2);
 const f=c.poseToPose(copy,before,c.livePose(copy));c.commitStructure(ms2,true);
 assert.deepEqual([clone(e.moved[tag+'A0'].loc),clone(e.deleted[tag+'A1'].orig),clone(replacing().loc)],clone([f([410,0,0]),f([350,0,0]),f([370,0,0])].map(x=>x.map(r1))));
 assert.equal(replacing().rot[1],16384);
});
test('a built linked copy\'s object given another class goes with it when it is moved (an added object)',()=>{
 const {c,clone,p7,shown}=linkedCopies(),plant=shown('UCPfp7A3');
 const ms=c.beginStructMove(p7.obj);p7.obj.position.add(T([100,0,0]));c.followStructure(ms);c.commitStructure(ms,true);
 near(plant.position,T([170,0,0]));
 const replacing=c.edits.added.find(x=>x.name==='UCPfp7A3');
 assert.deepEqual([clone(replacing.loc),clone(replacing.replaces.orig),clone(c.edits.moved.UCPfp7A0.orig)],[[170,0,0],[170,0,0],[200,0,0]]);
});
// part B2's #0 (B3, 1 Nov 2026): a pasted copy and its object given another class (Replace with...) selected together,
// the object first (as a rectangle or Ctrl+A picks them: pickables lists objects before structures) or after its copy.
// The copy carries that object (carries), so a command on the selection moves it once, with its copy, built or not: the
// page's own gizmo release, Transform fields of several objects, Mirror, Push to grid and Duplicate. built: p7 itself (its
// objects its own, as syncPieces has them), else a copy of it not built yet; plant: the object's proxy, entry: its entry
function carriedPair(built,objectFirst){
 const {c,clone,paste,p7,shown}=linkedCopies();
 vm.runInContext(['uncarried','beginGroupMove','followGroupMove','gizmoDragChanged','commit','transformOf','applyTransform','memberName','setTransforms','transformRows','mirrorSelection','gridAnchor','pushToGrid','shiftBlock'].map(body).join('\n'),c);
 vm.runInContext(line('const MOVE_AXES = ').replace(/^const /,'var '),c);
 Object.assign(c,{anim:null,TRANSFORM,canScale:()=>false,builtOf:()=>1,placeGroupPivot(){},unfoldTilt(){},localMoveFrom:null,groupStart:null,evenScale:null,scaleStart:null,
  mirrorPoint,faceMirrored,mirrorMotion,groupPivotAt:()=>[200,0,0],pivotItems:()=>[],pushMove,SNAP:{move:16}});
 let copy=p7;
 if(built)for(const a of p7.actors)c.actorStruct[a]=p7.name;
 else copy=paste(c.dupStructure(p7,0).slice('paste~'.length),false);
 const tag='UCPf'+copy.name.slice('paste~'.length),plant=shown(tag+'A3'),entry=()=>c.edits.added.find(x=>x.name===tag+'A3');
 c.selection=objectFirst?[plant,copy.obj]:[copy.obj,plant];c.selected=c.groupPivot;c.groupPivot.userData.members=c.selection;
 return {c,copy,plant,entry,loc:()=>clone(entry().loc),clone,named:`${built?'built':'pending'} copy, ${objectFirst?'object':'copy'} first`};
}
const PAIRS=[[true,true],[true,false],[false,true],[false,false]];
test('a pasted copy and its replacing object selected together: the group gizmo moves the object once, with its copy',()=>{
 for(const [built,first] of PAIRS){
  const {c,plant,loc,named}=carriedPair(built,first);
  c.gizmoDragChanged({value:true});c.groupPivot.position.add(T([100,0,0]));c.followGroupMove(c.groupStart);c.gizmoDragChanged({value:false});
  assert.deepEqual(loc(),[170,0,0],named);near(plant.position,T([170,0,0]));
 }
});
test('a pasted copy and its replacing object selected together: the Transform fields of several objects move the object once',()=>{
 for(const [built,first] of PAIRS){
  const {c,copy,loc,named}=carriedPair(built,first);
  assert.deepEqual([...c.uncarried(c.selection)].map(m=>m===copy.obj?'copy':'object'),['copy'],named);   // the rotation fields' drag's list too
  const x=c.transformRows(c.selection).find(r=>r.key==='x');
  assert.equal(x.of,1,named);
  x.apply(x.values.map(v=>v+100));
  assert.deepEqual(loc(),[170,0,0],named);
 }
});
test('a pasted copy and its replacing object selected together: Mirror moves the object with its copy, once',()=>{
 for(const [built,first] of PAIRS){
  const {c,loc,named}=carriedPair(built,first);
  c.mirrorSelection(0);                                                   // about X 200 (groupPivotAt): the copy to 400
  assert.deepEqual(loc(),[470,0,0],named);
 }
});
test('a pasted copy and its replacing object selected together: Push to grid moves the object with its copy only',()=>{
 for(const [built,first] of PAIRS){
  const {c,copy,plant,entry,loc,clone,named}=carriedPair(built,first);
  const e=c.pasteEntry(copy.name);e.offset=[4,0,0];c.showPose(copy,c.poseOf(copy));          // 4 off the grid, its object too
  entry().loc=[74,0,0];entry().replaces.orig=[74,0,0];plant.position.copy(T([74,0,0]));
  c.pushToGrid();
  assert.deepEqual([clone(e.offset),loc()],[[0,0,0],[70,0,0]],named);
 }
});
test('a pasted copy and its replacing object selected together: Duplicate makes one such object, the new copy\'s own',()=>{
 for(const [built,first] of PAIRS){
  const {c,named}=carriedPair(built,first),plants=()=>c.edits.added.filter(x=>x.cls==='Plant2');
  const before=plants().length;
  assert.equal(c.duplicateSelected(),true);
  const made=plants().slice(before);
  assert.equal(made.length,1,named);assert.ok(made[0].replaces,named);
 }
});
test('a group of the map and its object given another class selected together: Push to grid moves that object on its own, as the gizmo does',()=>{
 const {c,piece}=setup(),st=piece('booth',{offset:[20,0,0]});st.actors=['Lamp1'];c.actorStruct.Lamp1='booth';
 vm.runInContext(['uncarried','commit','gridAnchor','pushToGrid','shiftBlock'].map(body).join('\n'),c);Object.assign(c,{pushMove,SNAP:{move:16},anim:null});
 c.edits.added.push({name:'Lamp1',cls:'Spotlight',loc:[74,0,64],rot:[0,0,0],replaces:{cls:'Light',orig:[74,0,64]}});
 const lamp=c.makeProxy({...c.edits.added[0],kind:'light'},'added');
 c.selection=[lamp,st.obj];c.selected=c.groupPivot;
 assert.equal(c.uncarried(c.selection).length,2);                         // the group's gizmo moves both
 c.pushToGrid();
 assert.deepEqual([[...c.edits.groups.booth.offset],[...c.edits.added[0].loc],[...c.edits.added[0].replaces.orig]],[[16,0,0],[80,0,64],[70,0,64]]);
});
test('a click on the gizmo that moves nothing leaves no step, Redo as it was, nothing written; a move is one step',()=>{
 const {c,piece}=setup(),written=[];
 vm.runInContext(body('gizmoDragChanged'),c);
 Object.assign(c,{commit:p=>written.push(p.userData.actor.name),commitStructure:ms=>written.push(ms.st.name),unfoldTilt(){},localMoveFrom:null,groupStart:null,evenScale:null,scaleStart:null,moveStart:null});
 const lamp=c.makeProxy({name:'Lamp1',cls:'Lamp1',kind:'prop',loc:[0,0,0],rot:[0,0,0]},'added');c.selected=lamp;
 recordStep(c.undoHistory,'a','Move Light4');recordStep(c.undoHistory,'b','Delete Barrel');travelStep(c.undoHistory,'undo','c');
 const before=JSON.stringify(c.undoHistory);
 c.gizmoDragChanged({value:true});assert.equal(c.undoHistory.undo.at(-1).label,'Move Lamp1');     // while it is held
 c.gizmoDragChanged({value:false});
 assert.equal(JSON.stringify(c.undoHistory),before,'the History and Redo as they were');assert.deepEqual(written,[]);
 c.gizmoDragChanged({value:true});lamp.position.x+=16;c.gizmoDragChanged({value:false});
 assert.deepEqual(written,['Lamp1']);assert.deepEqual(c.undoHistory.undo.map(s=>s.label),['Move Light4','Move Lamp1']);assert.equal(c.undoHistory.redo.length,0);
 c.gizmoDragChanged({value:true});lamp.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),0.5);c.gizmoDragChanged({value:false});
 assert.deepEqual(written,['Lamp1','Lamp1'],'a turn is a move too');
 // an Alt copy let go where it began keeps its own step, named as it was
 recordStep(c.undoHistory,'d','Duplicate Lamp1');c.altCopyUndo=true;
 c.gizmoDragChanged({value:true});assert.equal(c.undoHistory.undo.at(-1).label,'Duplicate and move Lamp1');
 c.gizmoDragChanged({value:false});assert.equal(c.undoHistory.undo.at(-1).label,'Duplicate Lamp1');assert.equal(written.length,2);
 // a structure clicked: its move is over (nothing keeps autosave waiting), nothing written
 const st=piece('rail');c.gizmoDragChanged({value:true});assert.ok(c.moveStart);c.gizmoDragChanged({value:false});
 assert.equal(c.moveStart,null);assert.equal(written.length,2);
 // several objects: a click writes none of them, a drag writes each
 const other=c.makeProxy({name:'Lamp2',cls:'Lamp1',kind:'prop',loc:[64,0,0],rot:[0,0,0]},'added');
 c.selection=[lamp,other];c.selected=c.groupPivot;c.beginGroupMove=()=>({m:c.selection.map(m=>({m,st:null}))});
 const steps=c.undoHistory.undo.length;
 c.gizmoDragChanged({value:true});c.gizmoDragChanged({value:false});
 assert.equal(c.undoHistory.undo.length,steps);assert.equal(written.length,2);
 c.gizmoDragChanged({value:true});c.groupPivot.position.z+=8;c.gizmoDragChanged({value:false});
 assert.deepEqual(written.slice(2),['Lamp1','Lamp2']);assert.equal(c.undoHistory.undo.at(-1).label,'Move 2 objects');
 assert.ok(st);
});
test('Check map measures the map, not the view: what Isolate or the Show menu hides still holds what is on it',()=>{
 const {c,piece}=setup(),hidden=new Set();
 vm.runInContext(['visibleHits','presentHits','hiddenByView','structureInMap','gapBelow','dropSelected'].map(body).join('\n'),c);
 Object.assign(c,{airGap,objectHidden:o=>hidden.has(o),objectLocked:()=>false,commit(){},
  keyOf:o=>o.userData.box?'b:'+o.userData.box.name:o.userData.actor?'a:'+o.userData.actor.name:o.userData.kind==='structure'?'s:'+o.userData.name:null});
 const floor=new THREE.Mesh(new THREE.BoxGeometry(400,10,400),new THREE.MeshBasicMaterial());floor.userData.world=true;floor.position.y=-105;c.world.add(floor);
 const table=new THREE.Group();table.userData={kind:'box',box:{name:'UCEditBox0'}};table.add(new THREE.Mesh(new THREE.BoxGeometry(60,10,60),new THREE.MeshBasicMaterial()));c.proxies.add(table);
 const bottle=c.makeProxy({name:'Bottle1',cls:'WineBottle',kind:'prop',loc:[0,0,20],rot:[0,0,0]},'added');
 const shape=new THREE.Mesh(new THREE.BoxGeometry(8,20,8),new THREE.MeshBasicMaterial());bottle.add(shape);bottle.userData.body=shape;
 c.scene.updateMatrixWorld(true);
 assert.equal(c.gapBelow(bottle),0,'on the table');
 table.visible=false;hidden.add(table);                            // Isolate, or Blocks hidden in the Show menu
 assert.equal(c.gapBelow(bottle),0,'on the table still: the view hides it, the map has it');
 const ignored=new Set([bottle]);
 assert.ok(Math.abs(c.dropTarget(bottle,ignored).point.y+100)<0.01,'the user\'s own Drop to floor: what is shown');
 assert.ok(Math.abs(c.dropTarget(bottle,ignored,c.presentHits).point.y-5)<0.01);
 bottle.position.y=60;c.scene.updateMatrixWorld(true);
 assert.ok(Math.abs(c.gapBelow(bottle)-45)<0.01,'in the air over the table, not over the floor');
 c.selected=bottle;c.dropSelected(c.presentHits);                    // Check map's fix
 c.scene.updateMatrixWorld(true);
 assert.ok(Math.abs(placementGeometry.bounds(bottle).min.y-5.5)<0.01,'dropped onto the hidden table, not through it');
 // what is hidden for good is no surface: a deleted structure the Show menu hides too
 c.proxies.remove(table);
 const shelf=piece('shelf');shelf.obj.position.set(0,0,0);c.edits.groups.shelf.deleted=true;shelf.obj.visible=false;hidden.add(shelf.obj);
 c.scene.updateMatrixWorld(true);
 assert.ok(Math.abs(c.gapBelow(bottle)-105.5)<0.01,'down to the floor');
});
test('Duplicate keeps a copy beside its original in its folder, not in the folder new objects go in',()=>{
 const {c}=setup(),light=c.makeProxy({name:'Light28',cls:'Light',kind:'light',loc:[80,90,100],rot:[0,0,0]},'added');c.edits.added.push(light.userData.actor);
 c.edits.nests=[{id:'n1',label:'Room',items:['a:Light28','a:Lamp3']},{id:'n2',label:'Office 2 props',items:[]}];c.edits.defaultFolder='n2';
 c.selected=light;assert.equal(c.duplicateSelected(),true);
 const copy='a:'+c.edits.added.at(-1).name;
 assert.deepEqual([[...c.warned[0]],c.warned[1]],[[copy],'Duplicated'],'a copy of a kind the Show menu hides or locks says so');
 assert.deepEqual([...c.edits.nests[0].items],['a:Light28',copy,'a:Lamp3']);assert.deepEqual([...c.edits.nests[1].items],[]);
});
test('unsupported members cannot silently turn a mixed Duplicate into only a light',()=>{
 const {c,piece,history,logs}=setup(),st=piece('story');st.copyable=false;
 const light=c.makeProxy({name:'Light28',cls:'Light',kind:'light',loc:[0,0,0],rot:[0,0,0]},'map');c.selection=[st.obj,light];c.selected=c.groupPivot;
 assert.equal(c.duplicateSelected(),false);assert.equal(history.length,0);assert.equal(c.edits.added.length,0);assert.match(logs[0][0],/Nothing duplicated/);
});

test('marquee includes independent pieces as well as actors',()=>{
 const {c,piece}=setup();const st=piece('railing');c.camera.position.set(0,100,500);c.camera.lookAt(0,0,0);c.camera.updateMatrixWorld();
 c.canvas={getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})};c.liveStruct=p=>p===st.obj;c.canGroup=p=>p===st.obj;c.objectLocked=()=>false;c.setMulti=list=>c.rectangleResult=list;
 c.isIcon=()=>false;c.iconShown=()=>true;
 vm.runInContext(body('marqueeSelect')+'\n'+body('pickables'),c);c.marqueeSelect(0,0,800,600);assert.ok(c.rectangleResult.includes(st.obj));
 c.isIcon=p=>p===st.obj;c.iconShown=()=>false;c.selected=null;c.marqueeSelect(0,0,800,600);assert.ok(!c.rectangleResult.includes(st.obj),'an icon not drawn is not taken');
});
