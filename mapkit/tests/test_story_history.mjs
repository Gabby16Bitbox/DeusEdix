// P5: the Story in the editor's history. A change of the Story is a step of the same history as the map's
// (history-names.js recordStep with the Story as it was, the edits left out: state null), so Ctrl+Z and Ctrl+Y go back
// and forward through the map's and the Story's changes in the order they were made, each putting back only its own;
// a step of both is one step. Its name says what changed (story-history.js storyStepName).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, recordStep, travelStep, dropStep, historyRows, menuLabel } from '../editor/static/history-names.js';
import { storyStepName } from '../editor/static/story-history.js';

// a page with a map (its edits, a number) and a Story (an object), changed as app.js and story.js change them
function page() {
  const h = createHistory();
  let edits = 0, story = { dialogues: [] };
  const json = () => JSON.stringify(story);
  return {
    h, get edits() { return edits; }, get story() { return story; },
    map(label) { recordStep(h, String(edits), label); edits++; },
    talk(label, change) { const before = json(); change(story); recordStep(h, null, label, undefined, null, before); },
    both(label, change) { const before = json(); recordStep(h, String(edits), label, undefined, null, before); edits++; change(story); },
    step(way) {
      const s = travelStep(h, way, String(edits), null, json);
      if (!s) return null;
      if (s.state !== null) edits = +s.state;
      if (typeof s.story === 'string') story = JSON.parse(s.story);
      return s;
    },
  };
}
const lines = (p) => p.story.dialogues.map((d) => d.title).join(',');

test('the map\'s and the Story\'s changes are one history, each step putting back only its own', () => {
  const p = page();
  p.map('Move Light1');                                                  // edits 1
  p.talk('Add the dialogue "Gate"', (s) => s.dialogues.push({ id: 'd1', title: 'Gate' }));
  p.map('Move Light2');                                                  // edits 2
  p.talk('Change the dialogue "Gate 2"', (s) => { s.dialogues[0].title = 'Gate 2'; });
  assert.deepEqual(historyRows(p.h).map((r) => r.label),
    ['Change the dialogue "Gate 2"', 'Move Light2', 'Add the dialogue "Gate"', 'Move Light1', 'Map opened']);
  assert.equal(menuLabel(p.h, 'undo'), 'Undo Change the dialogue "Gate 2"');

  assert.equal(p.step('undo').state, null);                              // the Story's: the map stays
  assert.equal(p.edits, 2); assert.equal(lines(p), 'Gate');
  p.step('undo');                                                        // the map's: the Story stays
  assert.equal(p.edits, 1); assert.equal(lines(p), 'Gate');
  p.step('undo');
  assert.equal(p.edits, 1); assert.equal(lines(p), '');
  p.step('undo');
  assert.equal(p.edits, 0); assert.equal(p.step('undo'), null);

  // forward again, in the same order, each step bringing back its own
  p.step('redo'); assert.equal(p.edits, 1); assert.equal(lines(p), '');
  p.step('redo'); assert.equal(p.edits, 1); assert.equal(lines(p), 'Gate');
  p.step('redo'); assert.equal(p.edits, 2); assert.equal(lines(p), 'Gate');
  p.step('redo'); assert.equal(p.edits, 2); assert.equal(lines(p), 'Gate 2');
  assert.equal(p.step('redo'), null);
});

test('a step of the Story only stays one through undo and redo (no edits in it, no page)', () => {
  const p = page();
  p.talk('Add the dialogue "A"', (s) => s.dialogues.push({ id: 'd1', title: 'A' }));
  p.step('undo');
  const back = p.h.redo.at(-1);
  assert.equal(back.state, null); assert.equal(back.page, null);
  assert.equal(JSON.parse(back.story).dialogues[0].title, 'A');
  p.step('redo');
  const again = p.h.undo.at(-1);
  assert.equal(again.state, null);
  assert.deepEqual(JSON.parse(again.story), { dialogues: [] });
});

test('a gesture that changes the map and the Story is one step that puts back both', () => {
  const p = page();
  p.both('Wire Button1 to a new InfoLink', (s) => s.dialogues.push({ id: 'i1', title: 'Call' }));
  assert.equal(p.edits, 1); assert.equal(lines(p), 'Call');
  p.step('undo');
  assert.equal(p.edits, 0); assert.equal(lines(p), '');
  p.step('redo');
  assert.equal(p.edits, 1); assert.equal(lines(p), 'Call');
});

test('a map step has no Story in it, and keeps none through undo and redo', () => {
  const p = page();
  p.map('Move Light1');
  assert.equal('story' in p.h.undo[0], false);
  p.step('undo');
  assert.equal('story' in p.h.redo[0], false);
});

test('a Story step taken back unused leaves the history as it was', () => {
  const p = page();
  p.map('Move Light1');
  p.step('undo');
  p.talk('Change the Story', () => {});
  dropStep(p.h);
  assert.deepEqual(historyRows(p.h).map((r) => r.label), ['Move Light1', 'Map opened']);
});

test('a Story step\'s name says what changed', () => {
  const d = (id, title, more = {}) => ({ id, title, steps: [], ...more });
  const s = (over = {}) => ({ dialogues: [d('d1', 'Gate talk')], infolinks: [{ id: 'i1', title: 'Call', lines: [] }],
    events: [{ id: 'e1', title: 'Alarm', do: [] }], ...over });
  assert.equal(storyStepName(s(), s({ dialogues: [d('d1', 'Gate talk'), d('d2', 'New dialogue')] })), 'Add the dialogue "New dialogue"');
  assert.equal(storyStepName(s(), s({ dialogues: [] })), 'Delete the dialogue "Gate talk"');
  assert.equal(storyStepName(s(), s({ dialogues: [d('d1', 'Gate talk', { once: false })] })), 'Change the dialogue "Gate talk"');
  assert.equal(storyStepName(s(), s({ infolinks: [{ id: 'i1', title: 'Call', lines: [{ text: 'Hi' }] }] })), 'Change the InfoLink "Call"');
  // a title being written: the step says the title it had
  assert.equal(storyStepName(s(), s({ infolinks: [{ id: 'i1', title: 'Call X', lines: [] }] })), 'Change the InfoLink "Call"');
  assert.equal(storyStepName(s(), s({ events: [] })), 'Delete the Story event "Alarm"');
  // two of the same kind and verb; different ones
  assert.equal(storyStepName(s({ dialogues: [d('d1', 'A'), d('d2', 'B')] }), s({ dialogues: [] })), 'Delete 2 dialogues');
  assert.equal(storyStepName(s(), s({ dialogues: [], events: [] })), 'Change the Story');
  // only the order (a dialogue moved up: its speaker's priority)
  assert.equal(storyStepName(s({ dialogues: [d('d1', 'A'), d('d2', 'B')] }), s({ dialogues: [d('d2', 'B'), d('d1', 'A')] })),
    'Change the order of the dialogues');
  // a graph's nodes moved (its layout only)
  assert.equal(storyStepName(s({ layout: { d1: { n1: [0, 0] } } }), s({ layout: { d1: { n1: [40, 0] } } })), 'Arrange the graph of "Gate talk"');
  // ... on the node canvas (places, 9 Nov 2026), and a node moved in both at once is one dialogue
  assert.equal(storyStepName(s({ places: { d1: { n1: [0, 0] } } }), s({ places: { d1: { n1: [40, 0] } } })), 'Arrange the graph of "Gate talk"');
  assert.equal(storyStepName(s({ places: {}, layout: { d1: {} } }), s({ places: { d1: { n1: [5, 5] } }, layout: { d1: { n1: [1, 1] } } })), 'Arrange the graph of "Gate talk"');
  // the other settings; a title-less item says its id; an empty Story
  assert.equal(storyStepName(s({ route: 'unatco' }), s({ route: 'always' })), 'Change the Story');
  assert.equal(storyStepName(s(), s({ dialogues: [d('d1', 'Gate talk'), { id: 'd7', steps: [] }] })), 'Add the dialogue "d7"');
  assert.equal(storyStepName(null, { dialogues: [d('d1', 'X')] }), 'Add the dialogue "X"');
});
