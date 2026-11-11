// The Ports table of Tools > Scripts (P8 slice 5, editor/static/script-ports.js): a script's inputs and outputs read
// from its defaultproperties and written back, the rest of its text untouched. tests/test_logic_rules.py reads the
// same lines with editor/scripts.py ports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePorts, writePorts, portsProblem, portWords, defaultsBlock } from '../editor/static/script-ports.js';

const GEN = `class Gen extends UCScript;
// Inputs(5)=(Id="Commented") is not in defaultproperties
function Foo() // values in defaultproperties
{
	Say("defaultproperties {");
}
defaultproperties
{
	Inputs(1)=(Id=Open,Label="Open it",Args="Speed:number, Mode, Who:thing, Bad:nope")  // a bare Id
	Inputs(0)=(Id="Close")
	Outputs(0)=(Id="Opened",Label="it is open")
	Outputs(1)=(Id="no spaces allowed")
	Seconds=10
}
`;

test('ports read as the editor reads them', () => {
  assert.deepEqual(parsePorts(GEN), {
    inputs: [{ id: 'Close', label: 'Close', args: [] },
      { id: 'Open', label: 'Open it', args: [{ name: 'Speed', type: 'number' }, { name: 'Mode', type: 'text' }, { name: 'Who', type: 'thing' }, { name: 'Bad', type: 'text' }] }],
    outputs: [{ id: 'Opened', label: 'it is open' }] });
  assert.deepEqual(parsePorts('class A extends UCScript;'), { inputs: [], outputs: [] });
});

test('written back in place, the rest of the script as it was', () => {
  const ports = parsePorts(GEN);
  ports.inputs[1].args[0].type = 'seconds';
  ports.outputs.push({ id: 'Closed', label: 'it is "shut"' });
  const out = writePorts(GEN, ports);
  assert.equal(out, GEN.replace(`	Inputs(1)=(Id=Open,Label="Open it",Args="Speed:number, Mode, Who:thing, Bad:nope")  // a bare Id
	Inputs(0)=(Id="Close")
	Outputs(0)=(Id="Opened",Label="it is open")
	Outputs(1)=(Id="no spaces allowed")
`, `	Inputs(0)=(Id="Close",Label="Close")
	Inputs(1)=(Id="Open",Label="Open it",Args="Speed:seconds,Mode,Who:thing,Bad")
	Outputs(0)=(Id="Opened",Label="it is open")
	Outputs(1)=(Id="Closed",Label="it is 'shut'")
`));
  assert.deepEqual(parsePorts(out).outputs.map((p) => p.id), ['Opened', 'Closed']);
  // written again: the same
  assert.equal(writePorts(out, parsePorts(out)), out);
});

test('a script with no defaultproperties gets one; CRLF kept', () => {
  const text = 'class A extends UCScript;\r\n\r\nfunction Started()\r\n{\r\n}\r\n';
  const out = writePorts(text, { inputs: [{ id: 'Go', label: 'Go', args: [{ name: 'Who', type: 'thing' }] }], outputs: [] });
  assert.equal(out, 'class A extends UCScript;\r\n\r\nfunction Started()\r\n{\r\n}\r\n\r\ndefaultproperties\r\n{\r\n\tInputs(0)=(Id="Go",Label="Go",Args="Who:thing")\r\n}\r\n');
  const again = writePorts(out, { inputs: [], outputs: [{ id: 'Done', label: 'it is done' }] });
  assert.equal(again, 'class A extends UCScript;\r\n\r\nfunction Started()\r\n{\r\n}\r\n\r\ndefaultproperties\r\n{\r\n\tOutputs(0)=(Id="Done",Label="it is done")\r\n}\r\n');
  assert.equal(writePorts(text, { inputs: [], outputs: [] }), text);
  const settings = 'class B extends UCScript;\ndefaultproperties\n{\n    RepeatEvery=5.0\n}\n';
  assert.equal(writePorts(settings, { inputs: [], outputs: [{ id: 'Tick', label: 'it ticks' }] }),
    'class B extends UCScript;\ndefaultproperties\n{\n    Outputs(0)=(Id="Tick",Label="it ticks")\n    RepeatEvery=5.0\n}\n');
  assert.ok(defaultsBlock(GEN).start > GEN.indexOf('Say('));
});

test('what cannot be written, in words', () => {
  assert.equal(portsProblem({ inputs: [{ id: 'Go' }, { id: 'go' }] }), 'Two inputs are called "go".');
  assert.equal(portsProblem({ outputs: [{ id: '2nd' }] }), 'An output\'s name has letters, digits and _ only, and starts with a letter: "2nd".');
  assert.equal(portsProblem({ inputs: Array.from({ length: 9 }, (_, i) => ({ id: 'I' + i })) }), 'A script has at most 8 inputs.');
  assert.equal(portsProblem({ inputs: [{ id: 'Go', args: [{ name: 'A' }, { name: 'a' }] }] }), 'The input "Go" has two values called "a".');
  assert.throws(() => writePorts('class A;', { inputs: [{ id: '' }] }), /letters, digits/);
  assert.equal(portWords({ id: 'Start', label: 'Start it', args: [{ name: 'Seconds', type: 'seconds' }, { name: 'Who', type: 'thing' }] }),
    'Start it (Seconds: seconds, Who: an object of the map)');
});
