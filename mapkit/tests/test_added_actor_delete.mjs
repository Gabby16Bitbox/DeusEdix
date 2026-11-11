import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(process.env.DEUSEDIX_TEST_APP || new URL('../editor/static/app.js',import.meta.url),'utf8');
function body(name) {
  const start=source.indexOf(`function ${name}(`);
  assert.ok(start>=0,name);
  return source.slice(start,source.indexOf('\n}',start)+2);
}
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture({built=true,name='HH_DiningChair1',replaces=false}={}) {
  const chair={name,cls:'HKChair',loc:[-484,-22,36.5],rot:[0,16384,0],kind:'prop'};
  const original={...clone(chair),cls:replaces?'Chair1':chair.cls};
  const keep={name:'Computer0',cls:'ComputerPersonal',loc:[0,0,24],rot:[0,0,0],kind:'prop'};
  const added=clone(chair);
  if(replaces)added.replaces={cls:'Chair1',orig:[10,20,30]};
  const proxies={children:[],clear(){this.children=[];},remove(p){this.children=this.children.filter(q=>q!==p);}};
  const c=vm.createContext({
    edits:{added:[added],deleted:{},moved:{},boxes:[],drawn:[],prefabs:[]},
    baseActors:[keep,...(built?[original]:[])],proxies,structures:{},actorStruct:{},
    selected:null,groupPivot:{},textureTransfer:null,surfaceTexturePreview:null,skyTool:{syncViewport(){}},
    tc:{detach(){}},syncStructures(){},disposeEffectPoint(){},disposeParticleGizmo(){},disposeViewportIcons(){},
    makeProxy(a,source){const p={userData:{actor:a,source,kind:a.kind}};proxies.children.push(p);return p;},
    makeBoxProxy(){},addedKind:()=> 'prop',drawTools:{proxy(){}},applyTextureOverrides(){},applyLighting(){},applyObjectVisibility(){},
    select(){},selectKeys(){},selectNest(){},showChanges(){},buildStructList(){},buildHierarchy(){},
  });
  vm.runInContext(['removeOne','rebuildProxies','allActors'].map(body).join('\n'),c);
  c.rebuildProxies();
  return {c,chair,proxies,visible:()=>proxies.children.map(p=>p.userData.actor.name)};
}

test('built MCP chair stays deleted when placing a prefab refreshes all proxies',()=>{
  const {c,chair,visible}=fixture();
  c.removeOne(c.proxies.children.find(p=>p.userData.actor.name===chair.name));
  assert.deepEqual(visible(),['Computer0']);
  c.edits.prefabs.push({pid:'p1',prefab:'table'});
  c.rebuildProxies();c.rebuildProxies();
  assert.deepEqual(visible(),['Computer0']);
  assert.deepEqual(clone(c.edits.deleted[chair.name]),{cls:'HKChair',orig:chair.loc});
});
test('saved deletion survives reload with the previous built map still cached',()=>{
  const {c,chair,visible}=fixture();
  c.removeOne(c.proxies.children.find(p=>p.userData.actor.name===chair.name));
  c.edits=clone(c.edits);c.rebuildProxies();
  assert.deepEqual(visible(),['Computer0']);
  assert.equal(c.allActors().filter(a=>!c.edits.deleted[a.name]).length,1);
});
test('undo and redo snapshots restore and remove custom-named actors consistently',()=>{
  const {c,chair,visible}=fixture();const before=clone(c.edits);
  c.removeOne(c.proxies.children.find(p=>p.userData.actor.name===chair.name));const after=clone(c.edits);
  c.edits=before;c.rebuildProxies();
  assert.deepEqual(visible(),['Computer0',chair.name]);
  c.edits=after;c.rebuildProxies();
  assert.deepEqual(visible(),['Computer0']);
});
test('deleting an unbuilt addition does not delete unrelated map actors',()=>{
  const {c,chair,visible}=fixture({built:false});
  c.removeOne(c.proxies.children.find(p=>p.userData.actor.name===chair.name));c.rebuildProxies();
  assert.deepEqual(visible(),['Computer0']);assert.deepEqual(clone(c.edits.deleted),{});
});
test('converted actor deletion retains the original replacement identity, before or after rebuild',()=>{
  for(const built of [false,true]) {
    const {c,chair,visible}=fixture({built,replaces:true});
    c.edits.moved[chair.name]={orig:[99,99,99],loc:[20,30,40]};
    c.removeOne(c.proxies.children.find(p=>p.userData.actor.name===chair.name));c.rebuildProxies();
    assert.deepEqual(visible(),['Computer0']);
    assert.deepEqual(clone(c.edits.deleted[chair.name]),{cls:'Chair1',orig:[10,20,30]});
    assert.equal(c.edits.moved[chair.name],undefined);
  }
});
test('normal UCEdit additions and multi-delete follow the same persistent deletion path',()=>{
  const {c,visible}=fixture({name:'UCEdit12'});
  const second={name:'MCP_OfficeChair',cls:'OfficeChair',loc:[40,20,30],rot:[0,0,0],kind:'prop'};
  c.baseActors.push(clone(second));c.edits.added.push(clone(second));c.rebuildProxies();
  for(const p of [...c.proxies.children].filter(p=>p.userData.source==='added'))c.removeOne(p);
  c.rebuildProxies();assert.deepEqual(visible(),['Computer0']);
  assert.equal(Object.keys(c.edits.deleted).length,2);
});
