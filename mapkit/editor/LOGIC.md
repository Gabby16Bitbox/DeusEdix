# Level logic: rules, conditions, scripts as blocks, the logic log

How the map editor's level logic works, from the Inspector to the game. The editor's side is in
`editor/links.py`, `editor/logic_catalog.py`, `conditions.py` (next to `story.py`, which uses it too) and
`editor/config/logic.json`; `editor/scripts.py` reads a script's ports. The page's side is in `static/app.js` (the
Interactions), `static/conditions.js`, `static/logic-log.js` (the log's lines as sentences) and `static/console.js`
(the Console that shows them). The game's side is the editor's UnrealScript in
`project-template/src/DeusEdix/Classes`: `UCLink`, `UCEditorStory` and `UCScript`.

## A rule

A rule belongs to an object: "when this happens to it, if these hold, do these things". The editor saves it in the
map's edits:

```json
{"id": "L3", "src": "Button1", "when": "used", "once": false, "label": "When the player uses Button1: open Door3",
 "requires": [{"flag": "Crypt_Generator", "is": true}, {"type": "item", "item": "DeusEx.Multitool", "has": true}],
 "do": [{"verb": "open", "target": "Door3", "delay": 0}]}
```

* `when` is one of the source's **outputs**, the things that can happen to it.
* `do` holds actions on **inputs**, the things another object can do: `open` on a door, `attack` on a character.
* `requires` lists the **conditions**. All of them must hold when the rule fires, or it does nothing that time. A
  rule refused by a condition is not used up, even when it runs only once: it runs the next time its output
  happens (a watched output, `near` for example, happens when it becomes true). The rules on one output check
  their conditions when it happens, before any of their actions runs: a counter one of them adds to is still the
  old value for the others that time (`UCLink.RunRule` checks; the actions run in its state `Running`, from the
  next tick).
* A script's own output keeps its name in `port`: `{"when": "output", "port": "Sabotaged"}`.

No Tag or Event is written by hand. At Rebuild each rule becomes a `UCLink` actor (`links.blocks`), which hooks itself
to its object when the map starts.

## Where rules are made

The Inspector shows an object's rules one line each (its **Logic** section: `app.js lkSummary`), with "+ When it…"
and the way into the **Logic window** (`static/logic-window.js`, a bottom-dock tab). There a rule is edited in
**List** (a numbered list of steps: `lkRuleHtml`, `static/action-list.js`), seen in **Graph** (`logic-graph-model.js`
drawn on `graph-canvas.js`), read in **Read**, and played in **Try it** (`static/logic-try.js` on `static/logic-sim.js`).

A rule's list reads top to bottom: **Check** (its `requires`), its actions in the order they run with **Wait** rows
between them, and **If not**: the steps when the check fails. With exactly one condition the game can turn round
(not a skill) and none of the options below, "If not" is a second rule on the same cause with the opposite
condition, naming the first (`"otherwiseOf": "L1"`, kept in step by `action-list.js syncOtherwise`). Otherwise it
is the rule's own **Otherwise** (`else`, below), edited as a branch of the rule (`app.js lkElseOf`); an "If not" rule
whose rule gets a second condition or an option becomes its Otherwise (`lkSyncOtherwise`). Duplicate copies the
rules an object starts (`copyLogicOf`), Delete asks first when rules use what goes (`confirmRuleLoss`).

The Logic window's **The map** list holds the rules with no object: when the map starts, when the player presses a
key, and the causes of the world from **+ When...**: a condition becomes true, a state or a counter changes, the
player's health falls low, an event of the game (a Tag) happens.

### The wires in the 3D view

**View > Logic wires** (as TrenchBroom draws a Quake map's target links): *off*, *selected object* (the rules it
starts and the ones that act on it), *selected chain* (everything it sets off, on and on, and what sets it off,
back, through states too), *all*; remembered in this browser (`deusedix.logicWires`). `static/logic-wires-model.js`
says which wires (pure, `tests/test_logic_wires.mjs`), `static/logic-wires.js` draws them (`app.js
refreshLogicWires` at each selection and rule change):

- an arc from what sets a rule off to each object an action reaches (a tag's or an area's members each get one),
  green, its dashes flowing that way while the view is drawn every frame (idle they stand still: no extra drawing),
  an arrowhead near the end, a dark edge under it so it shows on bright floors, faint where it is behind a wall;
- a list's If / Otherwise / End / Wait are no wires, the actions inside them are; an "otherwise" action is one;
- a state or counter one object's rule sets and another's reads: one dotted amber wire between the two objects;
- wires between the same two objects side by side (lanes), the arc higher with the distance;
- a label at the top of each action ("uses it → Open · 2 s", "chooses "Lights off" → Turn off ×9", "sets GotKit"):
  one per action however many objects it reaches, over 40 only the selection's, moved up a line when another is
  there, under the panels; a click opens the rule in the Logic window's List;
- moved objects (gizmo, Undo, a drop) are looked at every 0.15 s and their wires follow.

## Lists of steps (Logic runtime v2)

A rule with `"steps": true` runs its `do` in its order, and each step's `delay` counts from the step before (not from
the moment it was set off). Besides actions, its steps can be:

```json
{"verb": "if", "requires": [{"flag": "Ready", "is": true}], "match": "all"}
{"verb": "else"}
{"verb": "end"}
{"verb": "wait", "until": {"type": "arrived", "actor": "Guard2"}, "max": 15}
{"verb": "wait", "until": {"type": "counter", "counter": "Keys", "op": ">=", "value": 3}, "max": 0}
{"verb": "wait", "delay": 2}
```

* **If / Otherwise / End**: the steps after an If run when its conditions hold (all of them, or any: `match`), the
  ones after its Otherwise when they do not; Ifs nest; an If with no End ends with the list.
* **Wait until** waits for a character sent with Walk / Run to arrive, or for a condition, at most `max` seconds
  (0: as long as it takes), then goes on. **Wait** is only its delay.
* A rule becomes a list of steps when its first If or Wait until is added (`action-list.js toSteps`: its actions in
  the order of their time, each delay from the one before).

`links.step_items` compiles it into a `UCLink` with `bSteps=True`: an If becomes a `check` step whose conditions are
in `StepCond`, an Otherwise a `jump` past the other branch, a Wait until an `until` step (the flow jump is `jump`:
`goto` is the walk of a character):

| `Act` | what the game does (`UCLink.DoStep`, `CheckStep`, `UntilDone`) |
|---|---|
| `delay\|check\|all or any\|first\|count\|fail` | the conditions `StepCond[first..first+count-1]` hold: the next step; else the step `fail` (an index, or `stop`) |
| `delay\|jump\|\|\|step\|` | on at that step (`stop`: the end) |
| `delay\|until\|who\|arrived or cond\|most\|k` | looked at every 0.25 s until `who` has arrived or `StepCond[k]` holds, at most `most` seconds |
| `delay\|wait\|\|\|\|\|` | only its delay |

A list that runs 256 steps with no end (a loop with no wait) is stopped and says so. The rules made before
(`bSteps` False) run as they did. Try it (`logic-sim.js stepsCode`) runs the same steps the same way; a character a
Wait until waits for is offered as a decision once he is sent.

## A rule's options (the runtime v2, P6)

A rule's **More options** (`static/logic-rule-ui.js ruleOptionsHtml`, wired in `app.js lkWire`) and its rows:

```json
{"id": "L4", "src": "Button1", "when": "used", "requires": [{"flag": "A"}, {"flag": "B"}], "match": "any",
 "also": [{"src": "Lever1", "when": "used"}, {"when": "jchealth", "below": "30"}],
 "do": [{"verb": "open", "target": "Door1", "id": "a1", "requires": [{"flag": "Power"}]},
        {"verb": "hide", "target": "@it", "id": "a2"}],
 "else": [{"verb": "message", "a": "Locked", "id": "e1"}],
 "again": "each", "max": 3, "cooldown": 2.5, "talkBusy": "wait"}
```

* `also`: **Or when...**, other causes that set the same rule off (an object's output, or one of the world's);
  each is a `UCRuleAlso` that starts the rule (`UCRule.Start`), and the log names that cause, not the rule's own.
* `match: "any"`: the Check goes on when any of its conditions holds (shown with two or more).
* `else`: the **Otherwise**, the steps when the Check fails, after a jump past the main list (`ElseAt`). It is timed
  like the rule: each at its time, or, in a list of steps, each delay from the step before.
* `again`: set off again while it runs: none lets it finish, `restart` starts it again, `each` runs another beside it
  (8 at most at once; the 9th is refused, `skip ... full`).
* `max`: at most so many runs; `cooldown`: at least so many seconds from one start to the next.
* `talkBusy`: a step due while the player is in a conversation: `wait` until it is over, `giveup` that run.
* An action's **if…**: its own `requires` (and `match`), checked just before it; failing, only it is skipped.
* An action's object can be `@by` (whoever set the run off: the player, a character) or `@it` (the object it
  happened to: useful with several causes). They are no objects of the map: no wire, no node in the Graph.
* Every action has an `id` (`a1`..., the Otherwise's `e1`...: `logic-graph-model.js ensureActionIds`, given at every
  edit): the log names the step that ran.

A rule with any of these is built as a `UCRule` (`links.needs_rule`), the others stay the `UCLink` they were.
The verbs and outputs app.js has no rows of its own for (the P4 ones: credits, shake, spawn, fill a crate, hurt
below N%, a floor reached...) take their rows from their arguments in `config/logic.json` (`logic-rule-ui.js
argRowsHtml`, `causeRowsHtml`), and their words from the catalogue (`logic-vocab.js`, asked once: `app.js
lkVocabLoad`). A crate's own contents are in its Inspector (Contents: what drops out when it breaks, the two that
take its place 3 times in 10 each, how many).

## Outputs and inputs come from the class: `config/logic.json`

What an object offers depends on its game class. That is data, not code: `config/logic.json` lists **families**,
each with the classes it starts at, its outputs and its inputs (the first input is the one a new rule takes).
`logic_catalog.io_for(chain, ports)` finds an object's family: the one whose class is the **nearest ancestor** in the
object's class chain, so a `BeamTrigger` is a beam before it is a `Trigger`. The page gets the result with
`/api/props?cls=` (`io`). `links.py` takes from the same table the outputs that exist, how each is heard in the game
(`hears`) and the Tag its link waits for (`tag`).

How the game hears an output (`hears`):

| hears | how |
|---|---|
| `event` | the object's `Event` becomes the link's Tag (`UCLink.Hook`); the event it had is passed on |
| `fail` | a keypad's `FailEvent` |
| `keypad` | a keypad's right code: its `Event` when it triggers events, a free `UnTriggerEvent` slot when it toggles door locks (`bToggleLock`, the default; its `Event` names the doors and must stay) |
| `option` | a computer's `specialOptions[Option].TriggerEvent` |
| `motion` | the `Event` of the object's `UCMotion` (the end of its animation) |
| `watch` | checked every half second (picked, gone, near, arrived) |
| `start`, `cut`, `npcuse`, `timer` | the editor's own actors trigger the link (UCTimer, UCNpcUse, UCCutscene) |
| `port` | a script's `Output("Name")` (below) |

`used` on an object made usable (Properties > Usable) is heard from its UCUsable, when JC has finished using it
(`links.tag_of`). Some classes use their `Event` as a list of targets, not as an output: `AllianceTrigger`,
`OrdersTrigger`, `InterpolateTrigger`, `SequenceTrigger`, the game's `UnTrigger`, Revision's `RevStateTrigger` and
the MoreTriggers that act on it (ElevatorTrigger, PawnAppearTrigger...). Their family, `targettrigger`, offers only
`near` (watched: their Event is never touched); `switchtrigger` (DamageTriggerDirect, LOSHateTrigger) can also be
switched off. Revision's other MoreTriggers never send their Event when JC walks in, only untrigger it when he walks
out: their family, `moretrigger`, offers `leave` and `near`. Each MoreTriggers class is named, because the editor may
not know their chain. `UCLink.AimsItsEvent` refuses the same in the game (by `IsA`, for a rule saved before).

An elevator (`ElevatorMover`, `MultiMover`) ignores Trigger: the input `floor` sends it to a floor of its sequence
(`SetSeq`), as a `SequenceTrigger` does. A floor it does not have (an ElevatorMover's `NumKeys`, 2 when the map
does not say; a MultiMover's sequences 0-3 that have keys, `SeqKey1..4(0)`) is refused (`nofloor`): `SetSeq` checks
nothing. The page caps the field and Check map says so too (`lkFloorOk`).

A sound effect played by a rule (`UCSoundFX` with `bOnTouch` off) says neither "walks in" nor "walks out": the page
does not offer them, and Check map warns about a rule saved before. Its input `off` (the page's *Stop its repeats*)
untriggers it: one that plays again by itself (`RepeatMax`, its More sounds' *Repeats every*) stops.

## Conditions: one model for rules and the Story

`conditions.py` and `static/conditions.js` hold the one model, for the Interactions and the Story's events alike.

| condition | data | in the game |
|---|---|---|
| a state (flag) | `{"flag": "Name", "is": true}` (the Story's own shape) | `flag\|Name\|1` |
| JC carries | `{"type": "item", "item": "DeusEx.Multitool", "has": true}` | `item\|DeusEx.Multitool\|1` |
| a character is alive | `{"type": "alive", "actor": "Guard1", "is": true}` (alive: not killed, not knocked out) | `alive\|Guard1\|1` |
| JC's skill | `{"type": "skill", "skill": "SkillLockpicking", "level": 2}` (at least: 1 trained, 2 advanced, 3 master) | `skill\|SkillLockpicking\|2` |
| a counter | `{"type": "counter", "counter": "Levers", "op": ">=", "value": 3}` | `count\|Levers\|>=\|3` |
| JC's credits | `{"type": "credits", "op": ">=", "value": 100}` | `credits\|>=\|100` |

A rule's conditions go into `UCLink.Cond[8]` as these strings (8 at most), and `UCEditorStory.Holds()` evaluates
them. The Story's events compile flags into `GetF(...)` as before, and the other kinds into `Holds("...")`, the same
evaluator, with no limit. A dialogue's requirements stay flags only: the game checks them itself (`ConFlagRef`).

A row added in the editor and not filled in yet (an item, a character or a counter not chosen) is kept in a draft
(the Story's autosave); building refuses it, naming the rule or the event, and for the Story its map. Play,
Install map and Apply build the other maps' stories too: one that cannot be built keeps its last class there, and
the report says why (`story.write_all(current)`); Export mod, which builds them all, stops on it.

A state's, a counter's or a goal's name is the game's, the same for a rule's actions, its conditions and the Story
(`conditions.ident`): ASCII letters, digits and underscores, an accented letter without its accent, the others
made `_`, 60 characters at most, `X_` (a goal `G_`) before a leading digit. A rule's state, counter or goal action
with no name is built with none, and the game says so (`noname`); Check map warns first. The Story refuses a state
action with no name when it is built (`originalstory.unnamed_states`), and gives a goal with no name the one name
`G_`, as it always did. The map's own names (characters, items) are ASCII.

Texts (messages, notes, goals, labels, usable texts) are the game's Latin-1, with typographic quotes and dashes made
plain (`gametext.plain`). In the T3D their backslashes are doubled (`gametext.t3d`): the engine's reader takes a
single one as the start of a hex byte.

The action `count` changes a counter: `{"verb": "count", "a": "Levers", "b": "1"}` adds 1, and `"c": "set"` sets
the value instead. Counters are the game's own integer flags (`FlagBase.SetInt`).

## Scripts as blocks

A script of Tools > Scripts declares what the rules can make it do, its **inputs**, and what it tells them, its
**outputs**, in its `defaultproperties`. That is the place UnrealScript keeps a class's data. `scripts.ports()`
reads the declarations, so the Inspector shows them before the first compile; a script that extends another
script has that one's ports too (`scripts.lineage`, `ports_of`).

```unrealscript
class Generator extends UCScript;

var() float BlackoutSeconds;          // shown in the Inspector, under Script settings

function Input(string InputName, string Args, Actor Caller)
{
	switch (InputName)
	{
	case "Sabotage":
		Say("The generator sputters.");
		Output("Sabotaged");          // the rules on "it says Sabotaged" run
		break;
	default:
		Super.Input(InputName, Args, Caller);
	}
}

defaultproperties
{
	Inputs(0)=(Id="Sabotage",Label="Sabotage it",Args="Seconds")
	Outputs(0)=(Id="Sabotaged",Label="it is sabotaged")
	BlackoutSeconds=10
}
```

* An input is an action of the verb `input`: `{"verb": "input", "target": "Generator0", "a": "Sabotage",
  "b": "Seconds=10"}`. UCLink calls `UCScript.Input(a, b, Self)`. That is a virtual call, not a call by name: UCLink
  and UCScript are in the same package. The script reads its arguments with `Arg(Args, "Seconds")`,
  `ArgFloat`, `ArgInt` and `ArgBool`.
* An output is a rule on the script: `{"when": "output", "port": "Sabotaged"}`. `UCScript.Output("Sabotaged")` finds
  the links waiting for it by their `Source` and `Port`, so no name is built from a string. An output said while
  the map is still loading (from `PostBeginPlay`) waits, and its rules run as soon as the map has started.
* `Started()`, `Triggered()` and `Repeat()` stay as before; `Untriggered()` is new: `on` and `off` reach a script.
* A script starts (`StartScript`: `Started()`, then the outputs said while loading) in its Tick, or at whatever
  reaches it first: an output, an input, a switch, a repeat. A Tick of its own should call `Super.Tick(DeltaTime)`.
  More than 8 outputs said before the map has started: the others are lost, and the log says so (`full`).
* A script is saved in Latin-1, as the game reads it: typographic quotes and dashes are made plain, and the editor
  shows the text as saved; any other letter outside Latin-1 is refused, naming its line.

## Characters sent somewhere

"Walk to a place" (`NpcGo`, `NpcWalk`) gives the character orders to a `UCMark`, and on the walkable area a
`UCNavRoute`. Both are transient: after a load, or back in a map already visited, they are gone. The walk is kept in
the saved story or rule that sent him (`goWho`, `goSpot`, `goRun`), and `TickGoes` sends him on again; `arrived`
reads it meanwhile (`UCLink.Arrived`). A newer walk, from any rule or the Story, replaces the older one. A
character busy with something else (fighting, fleeing) is left alone until he goes back to his orders; one standing
at the place, or nearly, only gets his mark again. Each story or rule keeps 32 walks: past that, the slot of one
who got there is taken first, and the log says when a walk in progress is given up.

"Leave" and "appear" wait until JC does not see the character (`Hide`, `Show`). The last order given wins, whoever
gave it: each one cancels the other's waiting order in every rule and in the Story (`ForgetHideShow`).

## The logic log

While Play runs, the Console shows what the logic does. Lines are written with the log tag `DeusEdixLogic`, with
`|` between the fields (the editor's texts never contain one: `links._text`):

| line | meaning |
|---|---|
| `fire\|map\|rule\|source\|when\|by\|label` | a rule runs (`by`: what set it off: JC, a character using an object, a timer, a script...) |
| `skip\|map\|rule\|why\|detail` | a rule did not run: `once` (already used), `running` (still doing its actions), `cond` (detail: the condition) |
| `act\|map\|rule\|verb\|target\|detail` | one of its actions, as it happens (detail: what it says or sets: a message, a counter...) |
| `fail\|map\|rule\|verb\|target\|why` | an action that could not happen (`missing`, `cannot`, `nosound`, `noscript`, `noname`: a counter or a state with no name, `nofloor`; a script's `output` lost before the map started: `full`; a list of steps that went round 256 times: `steps` with `loop`) |
| `hook\|map\|rule\|source\|why` | a rule that could not hook itself (`missing`, `noslot`, `target`) |
| `input\|map\|script\|name\|args` and `output\|map\|script\|name\|count` | a script's inputs and outputs |
| `noinput\|map\|script\|name` | a script was called on an input its `Input()` does not handle |
| `bad\|map\|\|condition` | a condition this version of the game classes does not know |
| `check\|map\|rule\|pass or fail\|step\|condition` | an If of a list of steps held, or did not (the first condition that did not) |
| `until\|map\|rule\|done or timeout\|step\|who` | a Wait until is over: what it waited for is so, or its time ran out |
| `else\|map\|rule\|source\|when\|by` | a `UCRule`'s check failed: its Otherwise runs |

A `UCRule` names its runs `<rule>@<game time>` and a step `#<step id>` (`L4@12.30#a1`); its `skip` reasons add
`restarted`, `full` (8 runs already), `max`, `cooldown`, `cancelled` (an action stopped it), `talking` (`giveup`)
and `how` (a killed rule told a knocked out one apart, or the other way round, a tick later).

`logic-log.js` turns these lines into sentences ("▶ L3 When the player uses Button1: open Door3", "→ open Door3"), and the
Console shows them. A name is a link that selects the object in the map (a line of another map says which map it
is in); a rule's id goes to the object it belongs to, whose Interactions show it.

The Console's command line runs a command in the game's own console. A command the game runs only with its cheats
on (`god`, `summon`, `slomo`, `trig`...: `UCConsoleLink.Cheats`, the ones `PlayerPawn` and `DeusExPlayer` check)
turns them on for that game first, and says so: the game would do nothing. The editor's Play on Revision starts
with them on already.
