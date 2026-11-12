import test from 'node:test';
import assert from 'node:assert/strict';
import { itemOptionsHtml, itemWarningText } from '../editor/static/item-options.js';
import { argRowsHtml } from '../editor/static/logic-rule-ui.js';
import { usableHtml } from '../editor/static/interaction-blocks.js';

const items = [
  {cls:'DeusEx.Ammo762mm', name:'7.62x51mm Ammo', cat:'Ammo'},
  {cls:'DeusEx.AmmoSecurityBot3', name:'7.62x51mm ammo (robot)', cat:'Ammo', internal:true, warning:'Robot ammo only.'},
  {cls:'DeusEx.NanoKey', name:'NanoKey (set Key ID)', cat:'Pickups', needsSetup:true, warning:'Choose the door key action.'},
  {cls:'DeusEx.WeaponModProjectile', name:'Projectile mod (Revision)', cat:'Pickups', group:'Gameplay-specific', warning:'Requires a compatible gameplay mode.'},
];
const esc = (s) => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

test('new choices hide helpers and unconfigured pickups', () => {
  const html = itemOptionsHtml(items, '');
  assert.match(html, /Ammo762mm/);
  assert.doesNotMatch(html, /AmmoSecurityBot3|NanoKey/);
  assert.match(html, /label="Gameplay-specific"/);
});
test('existing special choice remains selected, with original spelling and explanation', () => {
  const html = itemOptionsHtml(items, 'deusex.NANOKEY');
  assert.match(html, /value="deusex.NANOKEY" selected/);
  assert.match(html, /Saved special item/);
  assert.match(html, /Choose the door key action/);
  assert.equal(itemWarningText(items, 'DEUSEX.NANOKEY'), 'Choose the door key action.');
  assert.equal(itemWarningText(items, 'Other.NanoKey'), '');
});
test('unavailable saved classes cannot silently become the first available item', () => {
  assert.match(itemOptionsHtml(items, 'Other.Supply'), /<option selected value="Other.Supply">Other.Supply \(unavailable in this catalog\)<\/option>/);
  assert.match(itemOptionsHtml([], 'Old.Item'), /value="Old.Item"/);
});
test('all values and tooltip text are escaped; duplicates use class identity', () => {
  const item = {cls:'Mod.A',name:'<supply>',cat:'"group',hint:'"<hint>'};
  const html = itemOptionsHtml([item, {...item,cls:'mod.a'}], '');
  assert.equal((html.match(/value="Mod.A"/g)||[]).length, 1);
  assert.doesNotMatch(html, /<supply>|<hint>/);
  assert.match(itemOptionsHtml([], 'Mod."<bad>'), /value="Mod.&quot;&lt;bad&gt;"/);
});
test('kind conditions can omit the empty and missing-class options', () => {
  const html = itemOptionsHtml(items, 'weapons', {empty:null, fallback:false});
  assert.doesNotMatch(html, /value=""|unavailable in this catalog/);
});
test('rules show the relevant warning and usable objects preserve old requirements', () => {
  const args = [{id:'a',type:'itemclass',label:'Item'}];
  const html = argRowsHtml(args, {verb:'giveitem',a:'DeusEx.NanoKey'}, 0, {esc,items});
  assert.match(html, /data-k="keyId"/);
  assert.match(html, /Enable Locked/);
  const mode = argRowsHtml(args, {verb:'giveitem',a:'DeusEx.WeaponModProjectile'}, 0, {esc,items});
  assert.match(mode, /class="hint"[^>]*>Requires a compatible gameplay mode/);
  assert.match(usableHtml({item:'Old.Item'},items,esc), /<option selected value="Old.Item">/);
});
