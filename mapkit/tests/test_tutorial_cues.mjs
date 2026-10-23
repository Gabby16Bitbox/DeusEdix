import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonCues } from '../editor/static/tutorial-cues.js';

function fixture(check, actor) {
  const nodes = new Map();
  const env = { __editor:{ selected:{ userData:{ actor:{ name:actor } } }, edits:{} } };
  const step = { check, show:actor ? `select:${actor}` : 'room' };
  const doc = { querySelectorAll:s => nodes.get(s) || [] };
  const put = (s, values = {}) => { const el = { value:'', getClientRects:() => [1], closest:() => null, ...values }; nodes.set(s, [el]); return el; };
  const run = () => { const c = lessonCues(step, env, doc); assert.ok(c.selectors.length <= 1); assert.ok(!c.selectors.length || !c.world); return c; };
  return { nodes, env, step, put, run };
}

test('dialogue: opener → new → first line → reply → save; close/reopen resumes', () => {
  const f = fixture('dialogue:Scientist', 'Scientist');
  let dialogues = [];
  f.env.__story = { data:() => ({ dialogues }) };
  assert.deepEqual(f.run().selectors, ['#bstory']);
  f.put('#story.open:not(.peek)');
  assert.deepEqual(f.run().selectors, ['#st-newd']);
  dialogues = [{ owner:'Scientist', steps:[{type:'line',who:'npc'},{type:'line',who:'jc'}] }];
  f.put('#st-dlist [data-d="0"].on');
  const lines = [0,1].map(i => ({ value:'', closest:() => ({dataset:{s:String(i)}}) }));
  f.nodes.set('#st-steps .card.line textarea[data-k="text"]', lines);
  assert.match(f.run().selectors[0], /data-s="0"/);
  lines[0].value = 'Welcome.';
  assert.match(f.run().selectors[0], /data-s="1"/);
  f.nodes.delete('#story.open:not(.peek)');
  assert.deepEqual(f.run().selectors, ['#bstory']);
  f.put('#story.open:not(.peek)');
  assert.match(f.run().selectors[0], /data-s="1"/);
  lines[1].value = 'Thanks.';
  assert.deepEqual(f.run().selectors, ['#st-save']);
});
test('select existing dialogue instead of creating duplicates', () => {
  const f = fixture('dialogue:Scientist','Scientist'); f.put('#story.open:not(.peek)');
  f.env.__story={data:()=>({dialogues:[{owner:'Other'},{owner:'Scientist'}]})};
  assert.deepEqual(f.run().selectors,['#st-dlist [data-d="1"]']);
});
test('crate menu targets exclude stockpile until placement; returning regresses', () => {
  const f=fixture('added:0,0,1,1'); f.step.focus={bounds:[0,0,1,1]};
  assert.equal(f.run().world,null);
  f.put('.btab[data-tab="objects"].on'); assert.deepEqual(f.run().selectors,['#search']);
  f.put('#search',{value:'crate'}); assert.match(f.run().selectors[0],/palette/);
  f.put('#palette .item.active[data-cls*="Crate"]'); assert.deepEqual(f.run().world,f.step.focus);
  f.nodes.delete('.btab[data-tab="objects"].on'); assert.equal(f.run().world,null);
});

test('Player Start keeps its floor circle visible through the entire menu sequence', () => {
  const f=fixture('playerstart');
  f.step.focus={bounds:[-168,-218,-72,-122,2],shape:'circle',label:'Place Player start here'};
  const next=()=>{const c=f.run();assert.deepEqual(c.placement,f.step.focus);return c;};
  assert.deepEqual(next().selectors,['.btab[data-tab="objects"]']);
  f.put('.btab[data-tab="objects"].on'); assert.deepEqual(next().selectors,['#search']);
  f.put('#search',{value:'Player start'}); assert.match(next().selectors[0],/palette/);
  f.put('#palette .item.active[data-cls="PlayerStart"]');
  assert.deepEqual(next().world,f.step.focus);
  assert.match(next().hint,/Left-click.*yellow circle.*No link to JC/);
  f.nodes.delete('.btab[data-tab="objects"].on'); assert.deepEqual(next().selectors,['.btab[data-tab="objects"]']);
});
test('connection follows picking, Escape, target and action', () => {
  const f=fixture('link:Button:open:Door','Button');
  assert.deepEqual(f.run().selectors,['#lkconnect']);
  f.env.__editor.pickingInteraction=true; assert.equal(f.run().world.actor,'Door');
  f.env.__editor.pickingInteraction=false; assert.deepEqual(f.run().selectors,['#lkconnect']);
  f.env.__editor.edits.links=[{id:'r1',src:'Button',when:'used',do:[{target:'Door',verb:'close'}]}];
  assert.match(f.run().selectors[0],/data-lkv/);
});
test('texture: edit, paint, scope, apply, cancel returns to opener', () => {
  const f=fixture('texture:Crate','Crate'); assert.deepEqual(f.run().selectors,['[data-texedit]']);
  const state={open:true,dirty:false}; f.env.__texedit={state}; assert.deepEqual(f.run().selectors,['#te-view']);
  state.dirty=true; assert.match(f.run().selectors[0],/value="one"/);
  f.put('input[name="te-to"][value="one"]:checked'); assert.deepEqual(f.run().selectors,['#te-apply']);
  state.open=false; assert.deepEqual(f.run().selectors,['[data-texedit]']);
});
test('camera menu is reversible and has one target', () => {
  const f=fixture('camera:6'); assert.deepEqual(f.run().selectors,['#bcreate']);
  f.put('#addcut'); assert.deepEqual(f.run().selectors,['#addcut']);
  f.nodes.delete('#addcut'); assert.deepEqual(f.run().selectors,['#bcreate']);
});
test('cinematic: reopen, look through, time, key, preview', () => {
  const f=fixture('cinematic:6','Camera');
  f.step.trainingRoom={origin:[0,0],cells:[[-100,-100,100,100]],size:[200,200,200]};
  const cut={keys:[{t:0,p:[0,0,40],r:[0,0,0]}]};
  f.env.__editor.edits={added:[{name:'Camera',cls:'UCCutscene'}],cutscenes:{Camera:cut}};
  let open=false; f.env.__cutscene={isOpen:()=>open}; assert.deepEqual(f.run().selectors,['#bcut']);
  open=true; assert.deepEqual(f.run().selectors,['#cslook']);
  f.put('#cslook.primary'); assert.deepEqual(f.run().selectors,['#cstl']);
  f.put('#cstime',{textContent:'4.00 / 4.0 s'}); assert.deepEqual(f.run().selectors,['#cskey']);
  cut.keys.push({t:4,p:[30,0,40],r:[0,0,0]}); assert.deepEqual(f.run().selectors,['#csplay']);
  open=false; assert.deepEqual(f.run().selectors,['#bcut']);
});
test('field test uses current Play controls', () => {
  const f=fixture('clicked:playhere'); assert.deepEqual(f.run().selectors,['#playhere']);
  f.put('#pgo'); assert.deepEqual(f.run().selectors,['#pgo']);
});
