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
{"id": "L3", "src": "Button1", "when": "used", "once": false, "label": "When JC uses Button1: open Door3",
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
does not offer them, and Check map warns about a rule saved before.

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
| `fail\|map\|rule\|verb\|target\|why` | an action that could not happen (`missing`, `cannot`, `nosound`, `noscript`, `noname`: a counter or a state with no name, `nofloor`; a script's `output` lost before the map started: `full`) |
| `hook\|map\|rule\|source\|why` | a rule that could not hook itself (`missing`, `noslot`, `target`) |
| `input\|map\|script\|name\|args` and `output\|map\|script\|name\|count` | a script's inputs and outputs |
| `noinput\|map\|script\|name` | a script was called on an input its `Input()` does not handle |
| `bad\|map\|\|condition` | a condition this version of the game classes does not know |

`logic-log.js` turns these lines into sentences ("▶ L3 When JC uses Button1: open Door3", "→ open Door3"), and the
Console shows them. A name is a link that selects the object in the map (a line of another map says which map it
is in); a rule's id goes to the object it belongs to, whose Interactions show it.

The Console's command line runs a command in the game's own console. A command the game runs only with its cheats
on (`god`, `summon`, `slomo`, `trig`...: `UCConsoleLink.Cheats`, the ones `PlayerPawn` and `DeusExPlayer` check)
turns them on for that game first, and says so: the game would do nothing. The editor's Play on Revision starts
with them on already.
