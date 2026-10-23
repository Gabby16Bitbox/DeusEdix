// Run with node --test, or node test_texture_material_choice.cjs /path/to/app.js.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const test = require('node:test'), assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, '../editor/static/app.js'), 'utf8');
const pick = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const front = { tex: 'MyLevel.Signs.UCDocksideAccess', kind: 'structure', w:256, h:128 };
const metal = { tex: 'CoreTexMetal.Metal.ClenGrayMetal_A', kind: 'structure', w:128, h:128 };
function fixture(rows = [metal, front], kind = 'structure') {
  const p = { userData: { kind, name:'sign', actor:{name:'Anna0'}, model:{} } };
  const context = vm.createContext({ script:'qa', tutorialSession:{revision:1}, structures:{sign:{label:'Dockside',obj:{}}},
    texRows:() => rows, texOverride:(_, r) => r.tex === front.tex ? {tex:'EditedFront'} : null,
    shortTex:n=>String(n).split('.').pop(), hierLabel:()=>'Anna', p, rows });
  vm.runInContext(pick('function texRowForHit(', 'function menuFor(') + '\n' + pick('function texContext(', '// the Texture Editor applies'), context);
  return context;
}
test('clicked Dockside face opens the front, not the first metal material', () => {
  const c = fixture();
  assert.equal(c.texRowForHit(c.rows,{object:{userData:{tex:front.tex}}}),front);
  assert.equal(c.texRowForHit(c.rows,{object:{userData:{tex:metal.tex}}}),metal);
  assert.equal(c.texRowForHit(c.rows,null),undefined);
  assert.equal(c.texRowForHit(c.rows,{object:{userData:{}}}),undefined);
});
test('actors sharing a texture remain distinct by skin slot', () => {
  const rows = [0,2].map(slot=>({kind:'actor',tex:'SharedSkin',slot})), c = fixture(rows,'pawn');
  assert.equal(c.texRowForHit(rows,{object:{userData:{slot:2}}}),rows[1]);
  const ctx = c.texContext(c.p,rows[0]);
  assert.equal(ctx.selectMaterial(1).slot,2);
  assert.equal(ctx.selectMaterial(1).target,'Anna0');
});
test('switching preserves structure identity and uses its current texture override', () => {
  const c = fixture(), ctx = c.texContext(c.p,metal);
  assert.equal(ctx.materialIndex,0);
  assert.equal(ctx.materials[1].label,'EditedFront');
  const next = ctx.selectMaterial(1);
  assert.equal(next.orig,front.tex); assert.equal(next.tex,'EditedFront');
  assert.equal(next.target,'sign'); assert.equal(next.kind,'structure'); assert.equal(next.materialIndex,1);
});
test('stale map or tutorial contexts cannot switch into another project', () => {
  const c = fixture(), ctx = c.texContext(c.p,metal);
  c.script = 'other'; assert.throws(()=>ctx.selectMaterial(1), /map has changed/);
  c.script = 'qa'; c.tutorialSession.revision++;
  assert.throws(()=>ctx.selectMaterial(1), /map has changed/);
});
test('removed materials and invalid choices are rejected', () => {
  const c = fixture(), ctx = c.texContext(c.p,metal);
  assert.throws(()=>ctx.selectMaterial(-1), /no longer/);
  c.texRows = () => [metal]; assert.throws(()=>ctx.selectMaterial(1), /no longer/);
});
test('context menu only uses a face hit belonging to its selected object', () => {
  assert.match(source,/surface\?\.owner === o \? texRowForHit\(texList, surface.hit\)/);
  assert.match(source,/menuFor\(sel.includes\(want\) \? want : sel\[0\] \|\| want, \{ owner: o, hit: textureHit \}\)/);
});
