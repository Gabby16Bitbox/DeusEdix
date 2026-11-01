# A real map for the Logic window's tests

The Feature Test project's map `01_Feature_Lab`, frozen as it was saved on 27 Oct 2026 (13:23): its edits
(`maps/new_01_feature_lab.edits.json`) and its Story (`story/01_Feature_Lab.json`), copied byte for byte. The tests
of `static/logic-graph-model.js`, `logic-graph-problems.js` and `logic-graph-read.js` assert its exact pins, cards,
problems and Copy as text (`tests/logic_graph_world.mjs` `featureLab()`).

It is a copy so that the tests run the same on every machine and do not break when someone edits the live project.
Change it only on purpose, with the tests that read it. To also look at the live project (a smoke check that
asserts nothing exact), set `DEUSEDIX_FEATURE_TEST` to its `tools/mapkit` folder.

* `01_Feature_Lab.edits.json`: 8 rules on a button (`UCEdit5`), a door that is a moving block with an animation
  (`UCEditBox7`), a script with the ports Start and Done (`UCEdit29`), Officer Rossi (`UCEdit8`).
* `01_Feature_Lab.story.json`: Officer Rossi's dialogue `d1`, "Rossi at the door".
