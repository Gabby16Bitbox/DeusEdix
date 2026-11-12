// The parts of a rule's form the catalogue describes (editor/static/logic-rule-ui.js): an action's arguments by
// their type, what a cause takes, the rule's options of the Logic runtime v2, and the values as links.py reads them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HAND_ROWS, argRowsHtml, argDefaults, causeRowsHtml, causeDefaults, ruleOptionsHtml, optionsText, optionsSet, parseItems, itemsText,
  WORLD_CAUSES } from '../editor/static/logic-rule-ui.js';

const logic = JSON.parse(readFileSync(new URL('../editor/config/logic.json', import.meta.url), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const h = { esc, name: (n) => `the ${n}`, items: [{ cls: 'DeusEx.Medkit', name: 'Medkit' }, { cls: 'DeusEx.Flare', name: 'Flare' }],
  rules: [{ id: 'L2', label: 'L2: when the map starts' }] };
const argsOf = (v) => logic.inputs[v].args || [];

test('every argument type of the catalogue has a row', () => {
  const types = new Set(Object.values(logic.inputs).flatMap((e) => (e.args || []).map((a) => a.type)));
  for (const [v, e] of Object.entries(logic.inputs)) {
    if (HAND_ROWS.has(v) || !(e.args || []).length) continue;
    const html = argRowsHtml(e.args, {}, 0, h);
    for (const a of e.args) {
      const form = a.forItem ? argRowsHtml(e.args, {verb:v, a:a.forItem}, 0, h) : html;
      assert.ok(form.includes(`data-k="${a.id}"`), `${v}: ${a.id} (${a.type}) has no row`);
    }
  }
  assert.ok(types.size > 5);
});

test('the P4 verbs without a hand-made row are drawn from the catalogue', () => {
  const free = logic.free.filter((v) => !HAND_ROWS.has(v) && argsOf(v).length);
  assert.ok(free.includes('credits') && free.includes('spawn') && free.includes('hurtzone'), free.join(' '));
  const spawn = argRowsHtml(argsOf('spawn'), { a: 'DeusEx.MJ12Troop', b: '2', attack: true }, 3, h);
  assert.match(spawn, /data-lkarg="3" data-k="a" value="DeusEx.MJ12Troop"/);
  assert.match(spawn, /<datalist id="lk-pawns-3">/);
  assert.match(spawn, /data-lkargb="3" data-k="attack" checked/);
  assert.match(spawn, /data-lkat="3" data-k="at"/);
  const fade = argRowsHtml(argsOf('fade'), { a: 'in' }, 0, h);
  assert.match(fade, /<option value="in" selected>/);
  const colour = argRowsHtml(argsOf('lightcolour'), {}, 0, h);
  assert.match(colour, /type="color" data-lkarg="0" data-k="a" value="#ff3020"/);
  const cancel = argRowsHtml(argsOf('cancel'), { a: 'L9' }, 0, h);
  assert.match(cancel, /L9 \(missing\)/);
});

test("a crate's items: one row each with its weight, as links.py reads them", () => {
  const list = parseItems('DeusEx.Medkit:1; DeusEx.Flare:3;;Foo.Bar');
  assert.deepEqual(list, [{ cls: 'DeusEx.Medkit', w: 1 }, { cls: 'DeusEx.Flare', w: 3 }, { cls: 'Foo.Bar', w: 1 }]);
  assert.equal(itemsText(list), 'DeusEx.Medkit:1;DeusEx.Flare:3;Foo.Bar:1');
  const html = argRowsHtml(argsOf('fillcrate'), { a: 'DeusEx.Medkit:1;Foo.Bar:2' }, 1, h);
  assert.match(html, /data-lkitem="1" data-k="a" data-i="1"/);
  assert.match(html, /<option selected value="Foo.Bar">Foo.Bar \(unavailable in this catalog\)<\/option>/, 'an item the game list lacks is kept');
  assert.match(html, /data-lkitemadd="1"/);
});

test('the defaults: the catalogue\'s, a place where the rule\'s object is, never over a value', () => {
  const x = argDefaults({ verb: 'spawn', b: '5' }, argsOf('spawn'), () => [1, 2, 3]);
  assert.deepEqual(x, { verb: 'spawn', b: '5', at: [1, 2, 3], attack: true });
  assert.deepEqual(argDefaults({ verb: 'credits' }, argsOf('credits'), null), { verb: 'credits', a: '100' });
  assert.deepEqual(argDefaults({ verb: 'moveplayer' }, argsOf('moveplayer'), () => null), { verb: 'moveplayer' });
});

test('what a cause takes: below N %, a floor, a game event, a condition, a state or a counter', () => {
  const hurt = causeRowsHtml(logic.outputs.hurt, { when: 'hurt', below: '50' }, -1, h);
  assert.match(hurt, /data-lkwarg="-1" data-k="below" value="50" min="0" max="100"/);
  assert.match(causeRowsHtml(logic.outputs.gametag, { when: 'gametag' }, 2, h), /data-lkwarg="2" data-k="gameTag"/);
  assert.match(causeRowsHtml(logic.outputs.becomes, { when: 'becomes' }, -1, h), /data-lkwatchcond="-1"/);
  assert.match(causeRowsHtml(logic.outputs.changes, { when: 'changes', watch: { counter: 'Hits' } }, 0, h),
    /<option value="counter" selected>.*value="Hits"/s);
  assert.equal(causeRowsHtml(logic.outputs.near, { when: 'near' }, -1, h), '', 'drawn by app.js');
  assert.deepEqual(causeDefaults({ when: 'jchealth' }), { when: 'jchealth', below: '30' });
  assert.deepEqual(causeDefaults({ when: 'becomes' }), { when: 'becomes', watch: { flag: '', is: true } });
  for (const w of WORLD_CAUSES) assert.ok(logic.outputs[w], w);
});

test("the rule's options: other causes, again, at most, apart, while the player talks", () => {
  const l = { id: 'L1', src: 'Button1', when: 'used', also: [{ src: 'Button2', when: 'used' }, { when: 'jchealth', below: '20' }],
    again: 'each', max: 3, cooldown: 2.5, talkBusy: 'wait' };
  assert.equal(optionsSet(l), 5);
  const html = ruleOptionsHtml(l, { ...h, eventsOf: (c) => (c.src ? ['used', 'destroyed'] : WORLD_CAUSES), whenLabel: (c, w) => w, entryOf: (w) => logic.outputs[w] });
  assert.match(html, /More options \(5\)/);
  assert.match(html, /data-lkalsow="0"/);
  assert.match(html, /data-lkwarg="1" data-k="below" value="20"/);
  assert.match(html, /<option value="each" selected>/);
  assert.match(html, /data-lkmaxruns value="3"/);
  assert.match(html, /data-lkcool value="2.5"/);
  assert.match(html, /<option value="wait" selected>/);
  const o = optionsText(l, (c) => (c.src ? `When the player uses ${c.src}` : "When the player's health falls low"));
  assert.equal(o.also, " or when the player uses Button2 or when the player's health falls low");
  assert.deepEqual(o.more, ['set off again: alongside', 'at most 3 times', 'at least 2.5 s apart', 'waits while the player talks']);
  assert.deepEqual(optionsText({}, () => ''), { also: '', more: [] });
});
