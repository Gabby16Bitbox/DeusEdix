import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlay } from '../editor/static/story-sim.js';
import { createSession } from '../editor/static/logic-sim.js';
import { portsOf } from '../editor/static/story-graph.js';
import { itemOptionsHtml, keyFieldsHtml } from '../editor/static/item-options.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
test('key rewards go to the keyring once, at their dialogue step, with case-insensitive IDs', () => {
  const p = createPlay([{type:'line',text:'Before'},
    {type:'give',item:'DeusEx.NanoKey',keyId:'Roof',keyDescription:'Roof access'},
    {type:'give',item:'DeusEx.NanoKey',keyId:'roof',keyDescription:'Different description'},
    {type:'give',item:'DeusEx.NanoKey',keyId:'4'}, {type:'line',text:'After'}]);
  assert.equal(p.next().text,'Before');
  assert.equal(p.state.keyring,undefined);
  assert.match(p.next().text,/Roof access/);
  p.next(); p.next();
  assert.deepEqual(p.state.keyring,{roof:'Roof access','4':'Key 4'});
  assert.equal(p.state.items.size,0);
  assert.equal(p.next().text,'After');
});
test('missing key ID stops the dialogue preview; native NPC transfers keep their old path', () => {
  const p=createPlay([{type:'give',item:'DeusEx.NanoKey'}]);
  assert.match(p.next().why,/Key ID/);
  const key={type:'give',item:'DeusEx.NanoKey',keyId:'2',fail:'full'};
  assert.deepEqual(portsOf(key),[{port:'next'}]);
  assert.equal(portsOf({...key,keyId:undefined,from:'Guard'}).length,1);
  const native={type:'give',item:'DeusEx.NanoKey',from:'Guard',fail:'full'};
  assert.equal(portsOf(native).length,2);
});
test('compiled rule gives keys independently of inventory and rejects an unconfigured key', () => {
  const acts=['0|giveitem||DeusEx.NanoKey|1|2|key+|Roof','0|giveitem||DeusEx.NanoKey|1|2|key+|Duplicate',
    '0|giveitem||DeusEx.Medkit|1|', '0|giveitem||DeusEx.NanoKey|1|'];
  const props={Tag:'UCL_Button1',When:'used',Rule:'"L1"',Source:'"Button1"'};
  acts.forEach((a,i)=>props[`Act(${i})`]=`"${a}"`);
  const s=createSession({actors:[{cls:'UCLink',name:'UCLink_L1',props}],outputs:logic.outputs,
    world:{player:'JCDentonMale0',actors:[{name:'Button1',chain:['Button1','Actor']}]},map:'M'});
  s.fire({thing:'Button1',output:'used'}); s.step(10);
  assert.deepEqual(s.state().keyring,{'2':'Roof'});
  assert.deepEqual(s.state().items,['DeusEx.Medkit']);
});
test('only a picker with configuration can offer a new NanoKey; IDs and labels are escaped', () => {
  const items=[{cls:'DeusEx.NanoKey',name:'NanoKey',needsSetup:true},
    {cls:'DeusEx.Credits',name:'Credits',needsSetup:true}];
  assert(!itemOptionsHtml(items,'').includes('value="DeusEx.NanoKey"'));
  const html=itemOptionsHtml(items,'',{configureKey:true});
  assert(html.includes('value="DeusEx.NanoKey"'));
  assert(!html.includes('value="DeusEx.Credits"'));
  const fields=keyFieldsHtml({keyId:'2',keyDescription:'"<Roof>'},k=>`data-k="${k}"`);
  assert(fields.includes('value="2"'));
  assert(fields.includes('&quot;&lt;Roof&gt;'));
});
