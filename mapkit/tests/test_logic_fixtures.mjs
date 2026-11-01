// The behaviour fixtures of the level logic (tests/fixtures/logic, README.md there) as the page reads them: every
// line they expect is a logic-log line the Console turns into a sentence (static/logic-log.js), written as the game
// writes it, and every condition of their rules is one the page's model can show (static/conditions.js).
// tests/test_logic_fixtures.py checks the rest (shape, compiled actors, the code they come from).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseLogicLine, logicSentence, decodeCondition, LOGIC_TAG } from '../editor/static/logic-log.js';
import { conditionProblem, kindOf } from '../editor/static/conditions.js';

const folder = new URL('./fixtures/logic/', import.meta.url);
const fixtures = readdirSync(folder).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, folder), 'utf8')));
const lines = (fx) => fx.expected.flatMap((e) => e.anyOrder || [e.line]);

test('there are fixtures to read', () => {
  assert.ok(fixtures.length >= 25, `${fixtures.length} fixtures`);
});

test('every expected line is one the Console reads, with its fields as the game writes them', () => {
  for (const fx of fixtures) {
    for (const line of lines(fx)) {
      const e = parseLogicLine(LOGIC_TAG + line);
      assert.ok(e, `${fx.id}: not a logic-log line: ${line}`);
      assert.equal(e.map, fx.map, `${fx.id}: ${line}`);
      // back together in logic-log.js's field order: the same line, at most without its last empty field
      // (an action on an area or a tag writes no detail: "act|M|L1|lightoff|area light")
      const again = Object.values(e).join('|');
      assert.ok(again === line || again === line + '|', `${fx.id}: ${line} has other fields than logic-log.js reads (${again})`);
      // the last field keeps the bars after it; only a condition has bars of its own (links._text makes the others /)
      const barred = Object.values(e).slice(1).filter((v) => v.includes('|') && !decodeCondition(v));
      assert.deepEqual(barred, [], `${fx.id}: ${line} has more fields than logic-log.js reads`);
      assert.notEqual(logicSentence(e).mark, '·', `${fx.id}: no sentence for ${line}`);
    }
  }
});

test('a condition a rule was refused on is one the page can say', () => {
  for (const fx of fixtures) {
    for (const line of lines(fx)) {
      const e = parseLogicLine(LOGIC_TAG + line);
      if (e.kind === 'skip' && e.why === 'cond') assert.ok(decodeCondition(e.detail), `${fx.id}: ${line}`);
    }
  }
});

test("the rules' conditions are complete for the page's model", () => {
  for (const fx of fixtures) {
    for (const rule of fx.edits.links) {
      for (const c of rule.requires || []) {
        assert.ok(kindOf(c), `${fx.id} ${rule.id}: ${JSON.stringify(c)}`);
        assert.equal(conditionProblem(c), '', `${fx.id} ${rule.id}: ${JSON.stringify(c)}`);
      }
    }
  }
});
