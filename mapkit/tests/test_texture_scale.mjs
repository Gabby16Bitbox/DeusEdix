import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../../research/rea-blender/three.module.mjs';
import {createTextureScale, stretchOnResize} from '../editor/static/texture-scale.js';
import {createRotations} from '../editor/static/rotation.js';
const rotations = createRotations(THREE), textures = createTextureScale(THREE);
const app = fs.readFileSync(new URL('../editor/static/app.js', import.meta.url), 'utf8');
const body = name => {const at=app.indexOf(`function ${name}(`);return app.slice(at,app.indexOf('\n}',at)+2);};
const near=(a,b)=>assert.ok(Math.abs(a-b)<.002,`${a} != ${b}`);
const ue=v=>[v.x,v.z,v.y], tv=p=>new THREE.Vector3(p[0],p[2],p[1]);
function mesh(group, rotation = new THREE.Quaternion()) {
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(group.pos,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(group.uv,2));
  textures.capture(geo,group,rotation.clone().invert());
  return new THREE.Mesh(geo,new THREE.MeshBasicMaterial());
}
const fixture=()=>({pos:[0,0,0, 128,0,0, 0,128,0],uv:[.125,.25, 1.125,.25, .125,1.25],uvFrames:[[0,0,0, 1/128,0,0, 0,1/128,0,.125,.25]]});

test('only a scale gesture defaults Pieces to stretch; existing data is not migrated',()=>{
  const prev={scale:[1.5,1.5,1.5]};
  assert.equal(stretchOnResize(true,prev,prev.scale),undefined);
  assert.equal(stretchOnResize(true,prev,[2,2,2]),true);
  assert.equal(stretchOnResize(false,prev,[2,2,2]),undefined);
  assert.equal(stretchOnResize(true,{...prev,stretch:false},[2,2,2]),false);
  assert.equal(stretchOnResize(true,{...prev,stretch:true},[2,2,2]),true);
  assert.deepEqual(prev,{scale:[1.5,1.5,1.5]});
});
test('tiling grows by multiplication, with separate axes and unchanged pan',()=>{
  const m=mesh(fixture());textures.update(m,{}, {scale:[1.5,1.9,2],stretch:false});
  near(m.geometry.attributes.uv.getX(1),1.625);near(m.geometry.attributes.uv.getY(2),2.15);
  near(m.geometry.attributes.uv.getX(0),.125);near(m.geometry.attributes.uv.getY(0),.25);
  textures.update(m,{}, {scale:[1.5,1.9,2],stretch:true});
  assert.deepEqual([...m.geometry.attributes.uv.array],fixture().uv);
});
test('repeated toggles and Undo do not accumulate UV drift',()=>{
  const m=mesh(fixture());for(let i=0;i<100;i++){textures.update(m,{}, {scale:[2,3,4]});textures.update(m,{},{});}
  assert.deepEqual([...m.geometry.attributes.uv.array],fixture().uv);
});
test('duplicate geometry is isolated; scale one sign does not retile its sibling',()=>{
  const original=mesh(fixture()),copy=original.clone();textures.update(copy,{}, {scale:[3,1,1]});
  assert.notEqual(copy.geometry,original.geometry);near(original.geometry.attributes.uv.getX(1),1.125);
  near(copy.geometry.attributes.uv.getX(1),3.125);
});
test('already rebuilt tiling can be switched to stretch without another rebuild',()=>{
  const g=fixture();g.pos=g.pos.map(v=>v*2);g.uv=[.125,.25,2.125,.25,.125,2.25];
  const m=mesh(g);textures.update(m,{scale:[2,2,2],stretch:false},{scale:[2,2,2],stretch:true});
  near(m.geometry.attributes.uv.getX(1),1.125);near(m.geometry.attributes.uv.getY(2),1.25);
});
test('full built rotation is removed from texture axes before nonuniform scaling',()=>{
  const g=fixture(),q=rotations.quat([7000,9000,3000]);
  for(let i=0;i<g.pos.length;i+=3)g.pos.splice(i,3,...ue(tv(g.pos.slice(i,i+3)).applyQuaternion(q)));
  const f=g.uvFrames[0];for(let i=0;i<9;i+=3)f.splice(i,3,...ue(tv(f.slice(i,i+3)).applyQuaternion(q)));
  const m=mesh(g,q);textures.update(m,{}, {scale:[1.5,1.9,2]});
  near(m.geometry.attributes.uv.getX(1),1.625);near(m.geometry.attributes.uv.getY(2),2.15);
});
test('setPose keeps explicit Off, not an absent value that auto-enables next time',()=>{
  const c=vm.createContext({});vm.runInContext(body('setPose'),c);
  const e={};c.setPose(e,{offset:[0,0,0],yaw:0,stretch:false});assert.equal(e.stretch,false);
  c.setPose(e,{offset:[1,0,0],yaw:7000,stretch:e.stretch});assert.equal(e.stretch,false);
  c.setPose(e,{offset:[0,0,0],yaw:0});assert.equal(Object.hasOwn(e,'stretch'),false);
});
test('Inspector captures checkbox before redraw and commits it in the same undo',()=>{
  const start=app.indexOf('const textureChoice = ev?.target?.id');
  assert.ok(start>0);const code=app.slice(start,app.indexOf('// its position,',start));
  assert.ok(code.indexOf('textureChoice =')<code.indexOf('commitStructure('));
  assert.match(code,/commitStructure\(structureMove, false, textureChoice\)/);
  assert.equal((code.match(/pushUndo\(/g)||[]).length,1);
});
test('real saved p8/p9 sign previews retain frames and match both stretch and tile formulas', {skip:!fs.existsSync(new URL('./real-signs.json',import.meta.url))}, ()=>{
  const rows=JSON.parse(fs.readFileSync(new URL('./real-signs.json',import.meta.url),'utf8'));
  for(const {entry,display} of rows)for(const group of display.groups){
    const m=mesh(group);textures.update(m,{}, {...entry,stretch:false});
    for(let t=0;t<group.uvFrames.length;t++)for(let j=0;j<3;j++)for(let axis=0;axis<2;axis++){
      const f=group.uvFrames[t],p=group.pos.slice(t*9+j*3,t*9+j*3+3);
      const expected=f[9+axis]+p.reduce((sum,x,k)=>sum+(x-f[k])*entry.scale[k]*f[3+axis*3+k],0);
      near(m.geometry.attributes.uv.array[(t*3+j)*2+axis],expected);
    }
    textures.update(m,{}, {...entry,stretch:true});
    group.uv.forEach((v,i)=>near(m.geometry.attributes.uv.array[i],v));
  }
});

function transformFixture(piece=true) {
  const obj=new THREE.Group();obj.userData={kind:'structure',name:'sign'};obj.add(mesh(fixture()));
  const st={name:'sign',obj,pivot:[0,0,0],placement:{offset:[0,0,0]},rotatable:true,scalable:true,actors:[],piece_of:piece?'parent':undefined};
  const history=[],fields={};
  const c=vm.createContext({THREE,rotations,textureScale:textures,stretchOnResize,T:tv,UE:ue,r1:v=>Math.round(v*10)/10,
    YAW:65536,ONE:[1,1,1],scaleOf:p=>p?.scale||[1,1,1],add3:(a,b)=>a.map((x,i)=>x+b[i]),
    structures:{sign:st},edits:{groups:{},prefabs:[],copies:[],moved:{},deleted:{}},proxies:new THREE.Group(),actorStruct:{},moveStart:null,selected:obj,
    objectHidden:()=>false,movedPose:p=>p.offset.some(Boolean)||p.yaw||p.pitch||p.roll||p.scale.some(v=>v!==1),
    setDirty(){},showDetails(){render();},log(){},$:(id)=>fields[id],pushUndo:()=>history.push(JSON.stringify(c.edits)),p:obj,st,pose:{scale:[1,1,1]},
  });
  for(const name of ['copyEntry','pasteEntry','poseOf','setPose','relScale','poseToPose','showPose','livePose','beginStructMove','followStructure','commitStructure']) vm.runInContext(body(name),c);
  function render(){for(const [id,value] of Object.entries({px:0,py:0,pz:0,spitch:0,pyaw:0,sroll:0,ssx:100,ssy:100,ssz:100})) fields['#'+id]={value};fields['#sstretch']={checked:!!c.poseOf(st).stretch};}
  render();
  const start=app.lastIndexOf('const apply = (ev) => {',app.indexOf('const textureChoice = ev?.target?.id'));
  const end=app.indexOf('\n    // its position,',start);
  vm.runInContext(app.slice(start,end)+'\nthis.apply = apply;',c);
  return {c,st,obj,history,fields};
}
test('actual Inspector handler: resize enables Stretch, checkbox Off persists across another resize',()=>{
  const {c,fields,history}=transformFixture();
  fields['#ssx'].value=150;c.apply({target:{id:'ssx'}});
  assert.equal(c.edits.groups.sign.stretch,true);assert.equal(fields['#sstretch'].checked,true);
  fields['#sstretch'].checked=false;c.apply({target:{id:'sstretch'}});
  assert.equal(c.edits.groups.sign.stretch,false);assert.equal(fields['#sstretch'].checked,false);
  fields['#ssx'].value=200;c.apply({target:{id:'ssx'}});
  assert.equal(c.edits.groups.sign.stretch,false);assert.equal(history.length,3);
  const before=JSON.parse(history[2]);assert.equal(before.groups.sign.stretch,false);
});
test('actual Inspector handler: walls retain tiling and moving legacy pieces does not enable Stretch',()=>{
  const {c,fields}=transformFixture(false);fields['#ssx'].value=150;c.apply({target:{id:'ssx'}});
  assert.equal(c.edits.groups.sign.stretch,undefined);
  const b=transformFixture();b.fields['#px'].value=80;b.c.apply({target:{id:'px'}});
  assert.equal(b.c.edits.groups.sign.stretch,undefined);
});
test('actual gizmo path: live preview and committed choice match; Undo restores absence',()=>{
  const {c,st,obj}=transformFixture();c.beginStructMove(obj);obj.scale.set(1.5,1.5,1.5);
  c.followStructure();assert.equal(c.livePose(st).stretch,true);
  near(obj.children[0].geometry.attributes.uv.getX(1),1.125);
  c.commitStructure();assert.equal(c.edits.groups.sign.stretch,true);
  c.edits.groups={};c.showPose(st,c.poseOf(st));assert.equal(c.poseOf(st).stretch,undefined);
  near(obj.children[0].geometry.attributes.uv.getX(1),1.125);
});
