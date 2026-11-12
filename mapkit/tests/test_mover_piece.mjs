import test from 'node:test';
import assert from 'node:assert/strict';
import {moverPanel, wireMoverPanel, moverFields} from '../editor/static/mover-piece.js';

const options={escapeHtml:s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
  section:(id,label)=>`<details><summary>${label}</summary><div>`};
const door={mover:{kind:'door',mode:'use',moveTime:1,stayOpenTime:4,locked:false}};
test('fresh and old cached library doors expose Key ID before Rebuild',()=>{
  const html=moverPanel(door,options);
  assert.match(html,/data-mover-setting="keyId"/);
  assert(html.indexOf('> Locked')<html.indexOf('>Key ID<'));
  assert.match(html,/value="" placeholder="None"/);
  const escaped=moverPanel({...door,moverSettings:{keyId:'"<id'}},options);
  assert.match(escaped,/value="&quot;&lt;id"/);
  assert(!moverPanel({mover:{kind:'elevator'}},options).includes('data-mover-setting="keyId"'));
});
test('Key ID stays a string, saves with other mover settings, and duplicates independently',()=>{
  const entry=structuredClone(door);entry.moverSettings={moveTime:2,locked:true};
  const input={dataset:{moverSetting:'keyId'},type:'text',value:'  ApartmentDoor  ',checkValidity:()=>true};
  let changed=0;
  wireMoverPanel({querySelectorAll:()=>[input]},{getEntry:()=>entry,change:f=>{changed++;f(entry);}});
  input.onchange();
  assert.deepEqual(entry.moverSettings,{moveTime:2,locked:true,keyId:'ApartmentDoor'});
  for(const value of ['2','0','']){input.value=value;input.onchange();assert.equal(entry.moverSettings.keyId,value);}
  assert.equal(changed,4);
  const copy=moverFields(entry);copy.moverSettings.keyId='4';
  assert.equal(entry.moverSettings.keyId,'');
  assert.equal(copy.moverSettings.moveTime,2);
});
test('invalid IDs do not change the map and a stale selection cannot receive the edit',()=>{
  let changed=0,reported=0;
  const input={dataset:{moverSetting:'keyId'},type:'text',value:'Door ID',checkValidity:()=>false,reportValidity:()=>reported++};
  wireMoverPanel({querySelectorAll:()=>[input]},{getEntry:()=>door,change:()=>changed++});
  input.onchange();assert.equal(changed,0);assert.equal(reported,1);
  input.checkValidity=()=>true;
  wireMoverPanel({querySelectorAll:()=>[input]},{getEntry:()=>null,change:()=>changed++});
  input.onchange();assert.equal(changed,0);
});
test('built door routes editing to its native properties without a second conflicting override',()=>{
  const html=moverPanel(door,{...options,built:true});
  assert.match(html,/id="mover-details"/);assert.match(html,/Key ID and Locked/);
  assert(!html.includes('data-mover-setting="keyId"'));
});
