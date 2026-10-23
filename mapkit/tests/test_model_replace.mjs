import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(process.env.DEUSEDIX_TEST_APP || new URL('../editor/static/app.js', import.meta.url), 'utf8');
export const body = name => {
  const offset = source.indexOf(`function ${name}(`), start = source.slice(offset - 6, offset) === 'async ' ? offset - 6 : offset;
  assert.ok(offset >= 0, name);
  const eol = source.indexOf('\n', start);
  return source.slice(start, source.slice(start, eol).trimEnd().endsWith('}') ? eol : source.indexOf('\n}', start) + 2);
};
const copy = x => JSON.parse(JSON.stringify(x));
function fixture() {
  const actor = {name:'Computer1',cls:'ComputerSecurity',loc:[10,20,30],rot:[0,1234,0],kind:'prop',mesh:'DeusExDeco.ComputerSecurity',meshDrawScale:0.5,
    props:{Tag:'Security',Event:'Door',cameraTag:'Camera',MultiSkins:'old'}};
  const p = {parent:{},userData:{actor,kind:'prop',source:'map',model:{}}}, history=[],calls=[];
  const c=vm.createContext({
    actor, p, edits:{added:[],deleted:{},moved:{Computer1:{loc:[20,20,30],scale:1.5}},
      props:{Computer1:{Orders:'Standing',CollisionRadius:'42',Skin:"Texture'Old.Skin'"}},
      links:[{src:'Computer1',do:[{target:'Door',verb:'trigger'}]}],motions:{Computer1:{keys:[1,2]}},
      retexture:[{kind:'actor',name:'Computer1',slot:0,tex:'Old'},{kind:'actor',name:'Other',slot:0,tex:'Keep'}]},
    mapName:'Test', mapGeneration:1,modelReplace:null,meshLib:{},meshModels:{},palette:[],paletteHas:new Set(),
    requireUnlocked:()=>!c.locked,animIsMover:p=>p?.userData.kind==='mover', isCharacter:()=>c.character,
    cancelPlacing:()=>{},closeAnim:()=>{},stopPreview:()=>{},showTab:()=>{},status:()=>{},buildModels:()=>{},
    allActors:()=>c.deletedActor?[]:[actor],proxyOf:()=>p,
    meshInfo:async()=>({info:{cls:'LodMesh',r:999,h:999,pz:999,scale:9,label:'Bottle'}}),
    pushUndo:()=>history.push(JSON.stringify(c.edits)),setDirty:()=>calls.push('dirty'),rebuildProxies:()=>calls.push('rebuild'),
    startPlacing:()=>calls.push('placement'),log:(...args)=>calls.push(args),confirm:()=>c.answer,
    answer:true,character:false,escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  });
  vm.runInContext(['actorProp','putProp','meshOf','previewMesh','modelClassInfo','replacementPose','canReplaceModel','beginModelReplacement','cancelModelReplacement','modelReplaceRow','modelProps','placeModel'].map(body).join('\n'),c);
  c.propertySlider=null;
  return {c,actor,p,history,calls};
}
test('Replace changes only appearance; identity, transform, collision, links and motion stay',async()=>{
  const {c,actor,p,history,calls}=fixture(),before=copy(c.edits),original=copy(actor);
  c.beginModelReplacement(p);await c.placeModel('DeusExItems.Bottle',{});
  assert.deepEqual(actor,original);assert.equal(history.length,1);
  for(const k of ['moved','links','motions','added','deleted']) assert.deepEqual(copy(c.edits[k]),before[k]);
  assert.equal(c.edits.props.Computer1.CollisionRadius,'42');assert.equal(c.edits.props.Computer1.PrePivot,undefined);
  assert.equal(c.edits.props.Computer1.Orders,'Standing');assert.equal(c.edits.props.Computer1.Mesh,"LodMesh'DeusExItems.Bottle'");
  assert.equal(c.edits.props.Computer1.Skin,'None');for(let i=0;i<8;i++)assert.equal(c.edits.props.Computer1[`MultiSkins(${i})`],'None');
  assert.deepEqual(copy(c.edits.retexture),[before.retexture[1]]);assert.ok(!calls.includes('placement'));
  const after=JSON.stringify(c.edits);c.edits=JSON.parse(history.pop());assert.deepEqual(copy(c.edits),before);
  c.edits=JSON.parse(after);assert.equal(c.previewMesh(actor,'map'),'DeusExItems.Bottle');
});
test('Character warning can cancel without changing any data',async()=>{
  const {c,p,history}=fixture(),before=JSON.stringify(c.edits);c.character=true;c.answer=false;
  c.beginModelReplacement(p);await c.placeModel('Other.Model',{});
  assert.equal(JSON.stringify(c.edits),before);assert.equal(history.length,0);assert.ok(c.modelReplace);assert.equal(c.modelReplace.busy,false);
});
for(const why of ['cancel','map','deleted','locked','new target']) test(`Pending replacement cannot mutate after ${why}`,async()=>{
  const {c,p,history,calls}=fixture();let resolve;c.meshInfo=()=>new Promise(r=>resolve=r);
  c.beginModelReplacement(p);const promise=c.placeModel('Other.Model',{});
  if(why==='cancel')c.cancelModelReplacement();
  if(why==='map')c.mapGeneration++;
  if(why==='deleted')c.edits.deleted.Computer1={};
  if(why==='locked')c.locked=true;
  if(why==='new target')c.beginModelReplacement(p);
  resolve({info:{cls:'LodMesh'}});await promise;assert.equal(history.length,0);assert.ok(!calls.includes('placement'));
});
test('Double click is one undo; failed load leaves the picker retryable',async()=>{
  const {c,p,history}=fixture();let resolve;c.meshInfo=()=>new Promise(r=>resolve=r);
  c.beginModelReplacement(p);const promise=c.placeModel('Other.Model',{});await c.placeModel('Other.Second',{});
  resolve({info:{cls:'LodMesh'}});await promise;assert.equal(history.length,1);
  c.beginModelReplacement(p);c.meshInfo=async()=>{throw Error('failed');};
  await assert.rejects(c.placeModel('Bad.Model',{}),/failed/);assert.equal(c.modelReplace.busy,false);assert.equal(history.length,1);
});
test('Brush movers, helpers, and locked actors cannot start replacement',()=>{
  const {c,p}=fixture();for(const kind of ['mover','structure','light','logic','path','box']) {
    p.userData.kind=kind;c.beginModelReplacement(p);assert.equal(c.modelReplace,null);
  }
  p.userData.kind='prop';c.locked=true;c.beginModelReplacement(p);assert.equal(c.modelReplace,null);
});
test('Native models keep native rendering; only explicit overrides use raw models',()=>{
  const {c,actor}=fixture();assert.equal(c.previewMesh(actor,'map'),'');
  c.putProp(actor,'Mesh',"LodMesh'New.Model'");assert.equal(c.previewMesh(actor,'map'),'New.Model');
  actor.meshPrePivot='(X=2,Y=-3,Z=4)';assert.deepEqual(copy(c.replacementPose(actor,'map')),{scale:0.5,pivot:[2,-3,4]});
  assert.match(c.modelReplaceRow(actor,'replace-model'),/Replace…/);
  assert.match(c.modelReplaceRow(actor,'replace-model'),/keep the same actor/);
});
test('Model renderer waits for the replacement instead of keeping the old mesh',()=>{
  const {c,actor}=fixture();c.putProp(actor,'Mesh',"LodMesh'New.Model'");c.mapTex={};
  vm.runInContext(body('modelFor'),c);assert.equal(c.modelFor(actor,'map'),null);
});
test('Animation requests use replacement mesh and keep class/default caches separate',async()=>{
  const {c}=fixture(),urls=[];c.animInfo={};c.api=async url=>{urls.push(url);return {seqs:[{name:'Idle'}],counts:{frames:1}};};
  vm.runInContext(body('animsOf'),c);
  await c.animsOf('ComputerSecurity');await c.animsOf('ComputerSecurity','Other.Model');await c.animsOf('OtherClass','Other.Model');
  assert.deepEqual(urls,['/api/anims?cls=ComputerSecurity','/api/anims?mesh=Other.Model']);
});
