# Behaviour fixtures of the level logic

Scenarios of what today's rules do in the game, each a JSON file: the rules (as the editor saves them), the world
they run in, what happens (outputs of things, changes of the world) and the logic-log lines the game writes back,
with their times. They are the ground truth for three runners:

* the Logic simulator (`static/logic-sim.js`, phase P2 of the Logic design): it runs `compiled` with `inputs` and
  must write `expected`;
* `tests/test_logic_fixtures.py`: every fixture has this shape, its `edits` compile with `links.py` into exactly
  `compiled`, and its expected lines agree with those actors; `tests/test_logic_fixtures.mjs`: every expected line
  is one `static/logic-log.js` reads;
* the in-game golden-log run (Feature Test, both games) before the runtime changes (P6): the same scenario played in
  the game must write the same lines.

Today's runtime is `UCLink` (`project-template/src/DeusEdix/Classes/UCLink.uc`, with `UCEditorStory.uc`,
`UCScript.uc`, `UCTimer.uc`, `UCLinkGroup.uc`, `UCObjectTag.uc`); `editor/LOGIC.md` explains the whole. Each
scenario names the lines of code it is derived from, and the Python test checks that those lines still say so.
Where the code leaves something open, the fixture says which assumption it makes (below) instead of guessing
silently.

The fixtures were written with `backup/20261027_logic_phase_a/fixtures/make_fixtures.py`: the expected lines by
hand, the `compiled` actors and the line numbers by the script. A new fixture can be written by hand in the same
shape, or added there.

## Format

One object per file, `<id>.json`:

| key | what |
|---|---|
| `id` | the file's name |
| `title`, `behaviour` | what it shows, in a line and in a sentence or two |
| `derivedFrom` | `[{"file", "lines": [first, last], "has"}]`: the code it comes from; `has` is text found in those lines |
| `assumes` | the ids of the assumptions below that it relies on, beyond the clock |
| `map` | the map's name in the lines (`LogicFixtures`; the game writes `DeusExLevelInfo.mapName`) |
| `frame` | seconds per tick (0.1 in every fixture) |
| `until` | the last tick the runner plays; `expected` holds every line up to it |
| `edits` | the map's edits, only what the rules need: `links` (rules, `editor/links.py`), and `deleted`, `disabled`, `objectTags` when used |
| `world` | `player`: JC's actor name in the lines; `actors`: the things in the map, in the map's order (below) |
| `start` | the state at t = 0 (below); what it leaves out is the default |
| `inputs` | what happens, in time order (below) |
| `expected` | the lines, in the order the game writes them: `{"t", "line"}`, or `{"t", "anyOrder": [lines]}` for lines whose order is the map's actor order (A2) |
| `end` | optional: part of the state after `until` (counters, flags) |
| `compiled` | what `links.blocks(edits)` gives: the actors the game gets (`cls`, `name`, `loc`, `props`) |

A line is what the game writes after the log tag `DeusEdixLogic: ` (`editor/LOGIC.md`, "The logic log"), exactly,
trailing empty fields included: `skip|LogicFixtures|L1|once|`. The first line of an action on an area or a tag has
no detail field: `act|LogicFixtures|L1|lightoff|area light`.

A world actor: `{"name", "chain"}` (its class and its parents, the class first: what `IsA` and the editor's
families see), plus as needed `at` (`[x, y, z]`), `tag` (its scripting tag, what `UCObjectTag.Of` gives),
`seconds` (a timer's own length), `ports` (a script's declared inputs and outputs, as `scripts.ports` gives them),
`script` (what a script does, A9) and `absent`: `deleted` or `disabled` (in the editor, left out of the built map)
or `missing` (named by a rule but not in the map at all).

The state (`start`, and an input's `set`): `flags` `{name: true/false}` (a state never set is false), `counters`
`{name: n}` (never set: 0), `items` (JC carries one of each of these classes: `DeusEx.Multitool`), `credits`,
`skills` `{SkillLockpicking: 0-3}` (missing: 0), `dead` (characters killed or knocked out), `owned` (items JC has
picked up), `missing` (actors gone from the map since; only in `set`), `jc` (JC's position; with none he is far
from everything). A `set` replaces the parts it names; `flags`, `counters` and `skills` are merged name by name.

An input: `{"t", "fire": {"thing", "output", "by"}}`, an output of a thing happens (`output` is a `when` of
`config/logic.json`; `by` is who set it off, what the game passes along: JC, the character, the timer...; `option`
for a computer's option, `port` for a script's output), or `{"t", "set": {...}}`, the world changes without an
output (JC picks something up, walks somewhere, a character dies). An output is delivered the way the game hears it
(`config/logic.json` `hears` and `tag`): every rule waiting on the same event runs, so one use of a decoration runs
its `used` and its `any` rules. An output of something absent reaches nothing.

## The clock

The expected times follow from the code by these rules; the simulator reproduces them exactly (to 1 ms).

1. **Ticks.** t = 0 is the first tick with JC in the map; tick n is at t = n × `frame`.
2. **Order in a tick.** The map's own objects (its doors, lights...) and the editor's placed ones (timers, scripts,
   cutscenes) tick first (`world.actors`), then the editor's actors in the order `links.blocks` gives them (the rules
   in `edits.links` order), then what the editor imports after the rules (its moving blocks and the `UCMotion` of
   every animation, A1), then JC. Inputs happen in JC's part of their tick, after every rule.
3. **Telling.** When an output happens, the rules waiting for it are told in rule order (`foreach AllActors` with
   their Tag); each checks once, then running, then its conditions in order (`UCLink.RunRule`) and writes `fire` or
   `skip` before the next is told. Nothing acts yet.
4. **Acting.** A rule that fired acts in state code, from its own next turn: in the same tick when it was told
   before its turn (by a placed object, or by an earlier rule's action, A1), in the next tick otherwise (by JC, a
   later rule, or its own timer). Its actions were sorted by delay (`links.blocks`); the one with delay d runs d
   seconds after that first turn (`Sleep`, from the start, not from the action before).
5. **Running.** A rule is running from its `fire` until its last action has run, in that same turn: told again
   meanwhile, it skips with `running`.
6. **Inside an action.** An action that makes an output happen (a script's output, a timer stopped) tells that
   output's rules at once, before the acting rule's next action.
7. **Half-second looks.** Every rule's timer (`UCEditorStory.Timer`) runs at the end of its turn at t = 0.5, 1.0,
   1.5... (A8): `start` rules are told at the first; watched outputs (`near`, `picked`, `gone`, `arrived`) are
   looked at each time, the first look only notes, and the output happens when the look turns true.
8. **Timers.** A UCTimer started at t = T runs out at T + its seconds, in its own turn (before the rules), and tells
   its `finished` rules there (A3). Paused, it keeps what it had left. Stopped while counting, it tells its
   `stopped` rules inside the stopping action; stopped when not counting, nothing.
9. **Scripts.** A script starts in its first tick (t = 0): `Started()`, then the outputs it said while the map
   loaded, in order. Lines written while the map loads (`hook`, a script's `full`) have t = 0 and come first (A6).

## Assumptions

Always: the names (A4) and the place of inputs (A7). The others where a fixture lists them.

- `A1` **Same-tick acting.** Rule 4's same tick holds when the teller comes before the rule in the actor list. For a
  map the editor builds, the map's own actors come first, then what `dxmaps.py` imports in this order: its placed
  objects (`edits.added`: timers, scripts, cutscenes; `dxmaps.py:532`), the rules in `edits.links` order
  (`dxmaps.py:562`), then its moving blocks and the `UCMotion` of every animated object (`dxmaps.py:586-593`); JC is
  spawned last. So a rule told by a placed object acts in that tick, one told by a moving block (a door made in the
  editor) or by the end of an animation in the next. Nothing in the code guarantees that order after other tools
  have touched the map. In the game the zero-delay loop makes one round per tick either way.
- `A2` **Map order.** A tag action and an area's current entrants are found with `foreach AllActors`: the map's
  actor order, which the editor does not control. Those lines are `anyOrder`.
- `A3` **Timer arithmetic.** The game's ticks are not fixed and a UCTimer counts down a float: it may run out a
  tick early or late. The fixtures use whole ticks.
- `A4` **Names.** JC's actor name (`JCDentonMale0`) and the map's name (`LogicFixtures`) stand for the game's own;
  a game run replaces them.
- `A5` **No name.** `StringToName("")` gives the empty name, so a counter with no name fails `noname` (a state and a
  goal are refused on their empty text directly).
- `A6` **Loading.** Lines written in `PostBeginPlay` (a rule's `hook`, a script's `full`) are before any tick; they
  are stamped t = 0.
- `A7` **Inputs.** Every input happens in JC's turn. Outputs the game delivers from another actor's turn (a door
  that has opened, a character's death, a timer stopped by something else) could make a rule act a tick earlier
  in the game, unless that actor ticks after the rules (a moving block made in the editor, a `UCMotion` at the end
  of an animation, A1): those act in the next tick, as an input does.
- `A8` **Half-second looks.** All rules set their timer in `PostBeginPlay`, so they look in the same ticks, the
  first at t = 0.5.
- `A9` **Scripts as data.** What a script does is given by its world actor: `script.input` `{input: [outputs it
  says]}` (an input not there reaches `UCScript.Input`: `noinput`), `script.started` (outputs `Started()` says),
  `script.loading` (outputs said while the map loads). Real scripts can do anything.

## Not covered, or not reachable from edits

- `bad|...`: a condition kind the game does not know; `conditions.check` never builds one.
- Doors' `opened` and `destroyed` (told apart on the rule's next Tick), `arrived`, `npcused`, cutscenes,
  `animdone`, usable objects, the cutscene skip (`Hurry`), area members beyond 128 (chained `UCLinkGroup`s), and
  what the actions do to the world (a door opening, a light going off) beyond counters and states: these write no
  logic line of their own.

## Scenarios

| Fixture | What it shows | Derived from |
|---|---|---|
| `once_used_only_when_passing` | Only once is used up only when the rule passes | `UCLink.uc:266-288`, `UCLink.uc:36` |
| `once_checked_before_running` | Only once is checked before running | `UCLink.uc:270-273`, `UCLink.uc:275-278` |
| `running_ignores_refire` | A running rule ignores a re-fire | `UCLink.uc:275-278`, `UCLink.uc:839-858` |
| `running_before_conditions_no_recheck` | Running is checked before the conditions, which are not checked again | `UCLink.uc:275-278`, `UCLink.uc:280-284`, `UCLink.uc:839-858` |
| `conditions_before_actions` | All the rules on one output check their conditions before any action runs | `UCLink.uc:196-219`, `UCLink.uc:266-288`, `UCLink.uc:839-858` |
| `first_failing_condition_named` | All conditions must hold; the skip names the first that does not | `UCLink.uc:280-284` |
| `actions_in_delay_order` | Actions run in delay order, delays counted from the start | `links.py:303`, `UCLink.uc:864-868` |
| `condition_flag` | Condition: a state is Yes or No | `UCEditorStory.uc:864-865`, `UCEditorStory.uc:36-42` |
| `condition_item` | Condition: JC carries or does not carry an item | `UCEditorStory.uc:866-867`, `UCEditorStory.uc:981-989` |
| `condition_alive` | Condition: a character is alive or not | `UCEditorStory.uc:868-869`, `UCEditorStory.uc:973-979` |
| `condition_skill` | Condition: JC's skill is at least a level | `UCEditorStory.uc:870-871`, `UCEditorStory.uc:902-912` |
| `condition_counter` | Condition: a counter compared with a number | `UCEditorStory.uc:872-873`, `UCEditorStory.uc:866-883` |
| `condition_credits` | Condition: JC's credits compared with a number | `UCEditorStory.uc:874-875`, `UCEditorStory.uc:866-883` |
| `counter_actions` | Counters: set and add, read by another rule | `UCLink.uc:621-631`, `UCLink.uc:591-592` |
| `action_without_name` | A counter, a state or a goal with no name fails, the next actions still run | `UCLink.uc:576-587`, `UCLink.uc:625-628` |
| `area_dynamic` | Area target with current entrants: saved members, then what is in the radius now | `UCLink.uc:408-437`, `UCLink.uc:342-348`, `UCLink.uc:354-368`, `UCLink.uc:452` |
| `group_saved_members` | Group target: only the saved members that can do it | `UCLink.uc:408-437`, `UCLink.uc:342-348`, `links.py:74`, `UCLinkGroup.uc:12-16` |
| `tag_targets` | Scripting-tag target: what has the tag and can do the verb, never the source | `UCLink.uc:386-394`, `UCLink.uc:397-405`, `UCObjectTag.uc:95-98` |
| `target_missing` | A target that is gone fails, the next actions still run | `UCLink.uc:469`, `UCLink.uc:469-472` |
| `script_input_output` | A script's input and output | `UCLink.uc:634-639`, `UCScript.uc:55-78`, `UCLink.uc:224-235` |
| `script_outputs_wait_for_start` | Outputs said while the map loads wait for Started() | `UCScript.uc:55-78`, `UCScript.uc:221-232` |
| `script_queue_full` | At most 8 outputs wait; the same output again finds its rule running | `UCScript.uc:55-78`, `UCScript.uc:221-232`, `UCLink.uc:275-278` |
| `script_noinput_and_noscript` | An input the script does not handle, an input on something that is no script | `UCScript.uc:48-51`, `UCLink.uc:600-603` |
| `deleted_and_disabled` | Deleted and disabled objects take their rules and actions with them | `links.py:285`, `links.py:294-299` |
| `missing_source_hook` | A rule that cannot hook itself says so, when and how depends on its output | `UCLink.uc:104-112`, `UCLink.uc:150-159`, `UCLink.uc:326-332` |
| `used_and_any_one_event` | Outputs heard on the same event run together | `UCLink.uc:196-219`, `UCLink.uc:139-142` |
| `enter_leave_share_a_tag` | Walking in and out of one zone | `UCLink.uc:196-219`, `UCLink.uc:252-260` |
| `start_rule` | The map starts: at the first half-second look, once | `UCEditorStory.uc:28`, `UCEditorStory.uc:1029-1032`, `UCLink.uc:301-305` |
| `near_watch_edge` | Near is watched every half second and happens when it becomes true | `UCLink.uc:308-335` |
| `picked_watch` | Picked up is watched every half second | `UCLink.uc:308-335` |
| `timer_finished` | A timer runs out | `UCLink.uc:682-692`, `UCTimer.uc:76-87`, `UCTimer.uc:101-105` |
| `timer_stopped_only_when_running` | Stopping a timer tells its rules only when it was counting | `UCLink.uc:682-692`, `UCTimer.uc:45-55` |
| `timer_pause_resume` | A paused timer keeps what it had left | `UCLink.uc:682-692`, `UCTimer.uc:57-63`, `UCTimer.uc:66-72` |
| `zero_delay_loop` | A loop with no delay goes round once per tick and never stops | `UCLink.uc:682-692`, `UCTimer.uc:45-55`, `UCLink.uc:839-858`, `UCLink.uc:275-278` |
| `self_retrigger_skips_running` | A rule that sets off its own output finds itself running | `UCLink.uc:275-278`, `UCLink.uc:839-858`, `UCTimer.uc:45-55` |
| `computer_options_apart` | A computer's options and its use are told apart | `UCLink.uc:130-137`, `links.py:104-109` |
| `keypad_codes` | Right and wrong code | `UCLink.uc:116-119`, `UCLink.uc:121-128`, `UCLink.uc:252-260` |

## Running them

From `tools/mapkit`:

```
node --test tests/test_logic_fixtures.mjs
.venv\Scripts\python.exe -m unittest discover -s tests -p test_logic_fixtures.py
```

A runner plays `inputs` up to `until` and compares the lines it gets with `expected`: same lines, same order,
`anyOrder` groups as sets, times to 1 ms, and the `end` state. In the game the lines carry no time until P6, so a
game run compares the order of each rule's lines after replacing the names (A4), and checks the loop scenario by its
properties (each rule fires once per tick at most, never `running`, it does not stop by itself) rather than by tick.

`backup/20261027_logic_phase_a/fixtures/reference_runner.py` is a throwaway runner written from this README alone:
it plays every fixture and agrees with all of them, which shows the format is enough to drive the simulator.
`mutation_proof.py` there shows both tests fail on broken versions of what they check.
