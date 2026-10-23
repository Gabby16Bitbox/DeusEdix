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
 });
 for(const name of ['copyEntry','pasteEntry','poseOf','setPose','relScale','poseToPose','showPose','livePose','objectRotation','setObjectRotation','beginStructMove','followStructure','commitStructure','structureOf','surfaceHit','dropTarget','stickTarget','placeOnSurfaces','dupStructure','dupOne','duplicateSelected','lightProps','beginTransformUndo'])vm.runInContext(body(name),c);
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

test('unsupported members cannot silently turn a mixed Duplicate into only a light',()=>{
 const {c,piece,history,logs}=setup(),st=piece('story');st.copyable=false;
 const light=c.makeProxy({name:'Light28',cls:'Light',kind:'light',loc:[0,0,0],rot:[0,0,0]},'map');c.selection=[st.obj,light];c.selected=c.groupPivot;
 assert.equal(c.duplicateSelected(),false);assert.equal(history.length,0);assert.equal(c.edits.added.length,0);assert.match(logs[0][0],/Nothing duplicated/);
});

test('marquee includes independent pieces as well as actors',()=>{
 const {c,piece}=setup();const st=piece('railing');c.camera.position.set(0,100,500);c.camera.lookAt(0,0,0);c.camera.updateMatrixWorld();
 c.canvas={getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})};c.liveStruct=p=>p===st.obj;c.canGroup=p=>p===st.obj;c.objectLocked=()=>false;c.setMulti=list=>c.rectangleResult=list;
 vm.runInContext(body('marqueeSelect'),c);c.marqueeSelect(0,0,800,600);assert.ok(c.rectangleResult.includes(st.obj));
});
