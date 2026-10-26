import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../../research/rea-blender/three.module.mjs';
import {createRotations} from '../editor/static/rotation.js';
import {createSurfacePlacement} from '../editor/static/surface-placement.js';
import {createDrawTools} from '../editor/static/draw-tools.js';
import {createSelectionOutline} from '../editor/static/selection-outline.js';
import {createTextureScale, stretchOnResize} from '../editor/static/texture-scale.js';
import {pushMove} from '../editor/static/grid-snap.js';
import {putBeside} from '../editor/static/hierarchy-folders.js';
const rotations=createRotations(THREE), placementGeometry=createSurfacePlacement(THREE);
const source=fs.readFileSync(new URL('../editor/static/app.js',import.meta.url),'utf8');
const body=name=>{const i=source.indexOf(`function ${name}(`);assert.ok(i>=0,name);return source.slice(i,source.indexOf('\n}',i)+2);};
const T=a=>new THREE.Vector3(a[0],a[2],a[1]), UE=v=>[v.x,v.z,v.y], r1=v=>Math.round(v*10)/10;
function setup(){
 const scene=new THREE.Scene(),world=new THREE.Group(),proxies=new THREE.Group(),groupPivot=new THREE.Group();scene.add(world,proxies,groupPivot);
 const history=[],logs=[];
 const c=vm.createContext({THREE,rotations,placementGeometry,textureScale:createTextureScale(THREE),stretchOnResize,T,UE,r1,YAW:65536,ONE:[1,1,1],NO_POSE:{offset:[0,0,0],yaw:0},
  scaleOf:p=>p?.scale||[1,1,1],add3:(a,b)=>a.map((x,i)=>x+b[i]),yawToRad:y=>-y*2*Math.PI/65536,radToYaw:y=>((Math.round(-y*65536/(2*Math.PI))%65536)+65536)%65536,
  structures:{},edits:{groups:{},copies:[],prefabs:[],moved:{},deleted:{},boxes:[],added:[]},scene,world,proxies,groupPivot,mapKind:'script',actorStruct:{},
  selected:null,moveStart:null,mapGeneration:1,script:'fixture',camera:new THREE.PerspectiveCamera(),ray:new THREE.Raycaster(),builtScale:{},altCopyUndo:false,
  isStruct:p=>p?.userData.kind==='structure',objectHidden:()=>false,selectionLocked:()=>false,requireUnlocked:()=>true,
  setDirty(){},showDetails(){},buildHierarchy(){},status(){},pushUndo:()=>history.push(JSON.stringify(c.edits)),log:(...x)=>logs.push(x),
  select:p=>{c.selected=p;},members:()=>c.selection||[],selKeys:()=>[],selectKeys(){},visibleHits:h=>h.filter(x=>{for(let p=x.object;p;p=p.parent)if(!p.visible)return false;return true;}),
  placeModeLabel:x=>x,normalToRotation:n=>({pitch:Math.round(Math.atan2(n[2],Math.hypot(n[0],n[1]))*65536/(2*Math.PI)),yaw:Math.round(Math.atan2(n[1],n[0])*65536/(2*Math.PI))}),
  rotationToVector:(p,y)=>[Math.cos(p*2*Math.PI/65536)*Math.cos(y*2*Math.PI/65536),Math.cos(p*2*Math.PI/65536)*Math.sin(y*2*Math.PI/65536),Math.sin(p*2*Math.PI/65536)],
  movedPose:p=>p.offset.some(Boolean)||p.yaw||p.pitch||p.roll||(p.scale||[1,1,1]).some(v=>v!==1),
  putBeside,nests:()=>c.edits.nests||=[],objOf:k=>k,warnHiddenKinds:(list,done)=>{c.warned=[list,done];},
 });
 for(const name of ['copyEntry','pasteEntry','poseOf','setPose','relScale','poseToPose','showPose','livePose','objectRotation','setObjectRotation','beginStructMove','followStructure','keptPlaces','commitStructure','bakeOut','structureOf','surfaceHit','solidAlong','facingNormal','dropTarget','stickTarget','selectionParts','memberLocked','placeOnSurfaces','dupStructure','dupOne','ownProps','duplicateSelected','lightProps','beginTransformUndo'])vm.runInContext(body(name),c);
 let seq=0;
 c.nextName=()=>`copy${++seq}`;c.nextPid=()=>`p${++seq}`;
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
 assert.equal(c.solidAlong(down,new Set(),true).object.parent,block,'not locked: snapped onto');
 locked=true;
 assert.equal(c.solidAlong(down,new Set()).object.parent,block,'Drop to floor: a surface all the same');
 assert.equal(c.solidAlong(down,new Set(),true).object,floor,'snapping: not onto what is locked');
});
test('V snapping and the Ctrl+Shift slide ask solidAlong for what can be picked (pickable: not what is locked)',()=>{
 const {c}=setup(),asked=[];
 c.solidAlong=(r,ignored,pickable)=>{asked.push(pickable);return null;};
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
