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
test('a hinged door says which way it opens, before and after Rebuild; a sliding door and a lift do not',()=>{
  const hinged={mover:{...door.mover,turn:16384,opens:'built'}};
  for(const built of [false,true]){
    const html=moverPanel(hinged,{...options,built});
    assert.match(html,/data-mover-setting="opens"/);
    assert.match(html,/<option value="built" selected>/);
    assert.match(html,/value="away"/);
    assert(!html.includes('value="into"'));          // only the assistant sets a room
    assert.match(html,/id="mover-room" hidden/);      // filled by the page when it has no room to open (door-room.js)
  }
  assert(!moverPanel({mover:{...door.mover,turn:0}},options).includes('mover-room'));
  assert.match(moverPanel({...hinged,moverSettings:{opens:'into',into:[1,2,3]}},options),/<option value="into" selected>/);
  assert.match(moverPanel(door,options),/data-mover-setting="opens"/);      // a door placed before 17 Nov: not known
  assert(!moverPanel({mover:{...door.mover,turn:0}},options).includes('data-mover-setting="opens"'));
  assert(!moverPanel({mover:{kind:'elevator',turn:16384}},options).includes('data-mover-setting="opens"'));
  const entry=structuredClone(hinged),select={dataset:{moverSetting:'opens'},type:'select-one',value:'away',checkValidity:()=>true};
  wireMoverPanel({querySelectorAll:()=>[select]},{getEntry:()=>entry,change:f=>f(entry)});
  select.onchange();assert.equal(entry.moverSettings.opens,'away');
});
test('every door says what it does when it meets someone (Ignore by default), a lift does not',()=>{
  for(const built of [false,true]){
    for(const d of [door,{mover:{...door.mover,turn:0}},{mover:{...door.mover,turn:16384}}]){
      const html=moverPanel(d,{...options,built});
      assert.match(html,/data-mover-setting="meets"/);
      assert.match(html,/<option value="ignore" selected>/);
      for(const v of ['stop','return','crush'])assert.match(html,new RegExp(`value="${v}"`));
    }
  }
  assert.match(moverPanel({...door,moverSettings:{meets:'return'}},options),/<option value="return" selected>/);
  assert(!moverPanel({mover:{kind:'elevator'}},options).includes('data-mover-setting="meets"'));
  const entry=structuredClone(door),select={dataset:{moverSetting:'meets'},type:'select-one',value:'stop',checkValidity:()=>true};
  wireMoverPanel({querySelectorAll:()=>[select]},{getEntry:()=>entry,change:f=>f(entry)});
  select.onchange();assert.equal(entry.moverSettings.meets,'stop');
});
