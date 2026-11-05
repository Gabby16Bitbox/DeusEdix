// The Console's lines as data (static/console-lines.js, G39), as Unity's Console: Collapse merges identical lines into
// one row with how many came, Time is the seconds since Play started, Copy writes the rows as they read, and the names
// of the open map's objects in any line become parts a click selects (logic-log.js's { name }).
import test from 'node:test';
import assert from 'node:assert/strict';
import { playSeconds, timeText, singleRow, addLine, collapseLines, dropLine, nameIndex, nameParts, lineView, partsText, copyText }
  from '../editor/static/console-lines.js';

const line = (text, kind = 'engine', t = null) => ({ text, kind, t });

test('Time: seconds since Play started, unknown before it or without a start', () => {
  assert.equal(playSeconds(15_400, 10_000), 5.4);
  assert.equal(playSeconds(10_000, 10_000), 0);
  assert.equal(playSeconds(9_000, 10_000), null, 'a line from before Play started');
  assert.equal(playSeconds(null, 10_000), null, 'a line read back from the log when the panel opened');
  assert.equal(playSeconds(15_000, null), null, 'no Play seen starting');
});

test('Time reads in tenths, minutes from one minute on', () => {
  assert.equal(timeText(4.24), '4.2');
  assert.equal(timeText(0), '0.0');
  assert.equal(timeText(59.96), '1:00.0', 'rounded before the minutes are taken');
  assert.equal(timeText(75), '1:15.0');
  assert.equal(timeText(605.5), '10:05.5');
  assert.equal(timeText(null), '');
});

test('Collapse: identical lines are one row where the text first came, counting the others', () => {
  const lines = [line('Accessed None', 'bad', 1), line('Log: other'), line('Accessed None', 'bad', 2), line('Accessed None', 'bad', 3)];
  const rows = [...collapseLines(lines).values()];
  assert.deepEqual(rows.map((r) => [r.line.text, r.count]), [['Accessed None', 3], ['Log: other', 1]]);
  assert.equal(rows[0].line.t, 1, 'the first one keeps its place and time');
  assert.equal(rows[0].last.t, 3, 'the newest is known too');
});

test('Collapse while lines come: the row is counted again, a new text is a new row', () => {
  const rows = collapseLines([line('a')]);
  const again = addLine(rows, line('a', 'engine', 7));
  assert.equal(again, rows.get('a'));
  assert.equal(again.count, 2);
  assert.equal(again.last.t, 7);
  const fresh = addLine(rows, line('b'));
  assert.deepEqual(fresh, singleRow(fresh.line));
  assert.deepEqual([...rows.keys()], ['a', 'b']);
});

test('Collapse when the oldest lines are let go: counted once less, the row gone at none', () => {
  const lines = [line('a'), line('b'), line('a')], rows = collapseLines(lines);
  assert.equal(dropLine(rows, lines[0]).count, 1);
  assert.equal(rows.get('a').count, 1);
  const gone = dropLine(rows, lines[1]);
  assert.equal(gone.count, 0);
  assert.deepEqual([...rows.keys()], ['a']);
  assert.equal(dropLine(rows, line('never came')), null);
});

test('names of the open map in any line, in any case, as parts', () => {
  const names = nameIndex(['DeusExMover3', 'UCEdit12', '', null]);
  assert.deepEqual(nameParts('ScriptLog: deusexmover3 opened by UCEdit12.', names, '01_Lab'),
    ['ScriptLog: ', { name: 'DeusExMover3' }, ' opened by ', { name: 'UCEdit12' }, '.']);
  assert.deepEqual(nameParts('no names here', names, '01_Lab'), ['no names here']);
  assert.deepEqual(nameParts('', names, '01_Lab'), []);
});

test('Map.Name is a name of the open map only; Package.Class never is', () => {
  const names = nameIndex(['DeusExMover3', 'Door']);
  assert.deepEqual(nameParts('ScriptWarning: DeusExMover 01_Lab.DeusExMover3 (Function Engine.Door.Bump:0012) Accessed None', names, '01_lab'),
    ['ScriptWarning: DeusExMover 01_Lab.', { name: 'DeusExMover3' }, ' (Function Engine.Door.Bump:0012) Accessed None']);
  assert.deepEqual(nameParts('02_Other.DeusExMover3 fell', names, '01_Lab'), ['02_Other.DeusExMover3 fell'], 'another map: not this object');
});

test('a row shows: a logic line as its sentence, a script line without its tag, any line with the names', () => {
  const names = nameIndex(['Door3', 'Button1']);
  const logic = lineView(line('DeusEdixLogic: act|01_Lab|L1|open|Door3', 'logic'), names, '01_Lab');
  assert.equal(logic.logic, 'act');
  assert.equal(logic.map, '01_Lab');
  assert.equal(partsText(logic.parts), '→   open Door3');
  assert.deepEqual(lineView(line('DeusEdixLogic: nothing|x', 'logic'), names, '01_Lab'), { parts: ['nothing|x'], map: '', unread: true });
  assert.deepEqual(lineView(line('ScriptLog: Button1 pressed', 'script'), names, '01_Lab').parts, [{ name: 'Button1' }, ' pressed']);
  assert.deepEqual(lineView(line('Log: Button1 spawned'), names, '01_Lab'), { parts: ['Log: ', { name: 'Button1' }, ' spawned'], map: '' });
});

test('Copy: the rows as they read, with the time and how many when shown', () => {
  const rows = [...collapseLines([line('ScriptLog: hello', 'script', 1.25), line('Accessed None', 'bad', 2), line('Accessed None', 'bad', 3),
    line('Log: before', 'engine', null)]).values()];
  assert.equal(copyText(rows), 'hello\nAccessed None  (×2)\nLog: before');
  assert.equal(copyText(rows, { time: true }), '1.3  hello\n2.0  Accessed None  (×2)\nLog: before');
  assert.equal(copyText([singleRow(line('DeusEdixLogic: act|M|L1|open|Door3', 'logic'))]), '→   open Door3');
  assert.equal(copyText([]), '');
  assert.equal(partsText(nameParts('a Door3 b', nameIndex(['Door3']), '')), 'a Door3 b', 'names read as they are');
});
