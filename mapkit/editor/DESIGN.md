---
version: alpha
name: DeusEdix
description: >-
  The look and feel of DeusEdix, the Deus Ex map editor: a dense, calm, desktop-tool UI in the spirit of
  Unity and Premiere, dressed in the colours of the games' own menus. Every person or agent who changes the
  editor's UI (Claude, Codex, ChatGPT) follows this file.
colors:
  # "Deus Ex · Classic" (the default theme; theme.css :root). The CSS custom property is in brackets.
  background: "#080f1a"        # --bg
  panel: "#101d2e"             # --panel
  surface: "#15263b"           # --surface   buttons, raised controls
  field: "#0b1625"             # --field     text inputs
  hover: "#203650"             # --hover
  line: "#2b415a"              # --line      every divider and border
  text: "#dce6f1"              # --text
  text-dim: "#9badc3"          # --dim       metadata, hints, labels
  heading: "#bfd4e9"           # --heading
  primary: "#89b9e8"           # --acc       the one accent
  on-primary: "#071523"        # --accent-ink
  primary-soft: "#233e5b"      # --accent-soft  selection, pressed, "on" toggles
  primary-border: "#5d87b0"    # --accent-border focus, hover borders
  viewport: "#070e18"          # --viewport
  ok: "#86cda6"                # --ok
  warn: "#e3b96b"              # --warn
  bad: "#f28780"               # --bad
  playhead: "#4c9eff"          # timelines (studio-channels.css --st-ph)
  # "Mankind Divided" (theme.css :root[data-theme="mankind"]): same roles, warm gold
  mankind-background: "#10100e"
  mankind-panel: "#191a17"
  mankind-surface: "#22231e"
  mankind-line: "#454334"
  mankind-text: "#e6e4d9"
  mankind-primary: "#d4b86b"
typography:
  body:
    fontFamily: Segoe UI
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.35
  note:
    fontFamily: Segoe UI
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
  heading:
    fontFamily: Segoe UI
    fontSize: 13px
    fontWeight: 600
    lineHeight: 18px
  label-caps:
    fontFamily: Segoe UI
    fontSize: 10px
    fontWeight: 400
    letterSpacing: 0.1em
  numeric:
    fontFamily: Segoe UI
    fontSize: 12px
    fontFeature: '"tnum"'
rounded:
  row: 1px          # --radius-row     (Classic; the "Rounded" themes use 6px)
  control: 2px      # --radius-control (8px)
  card: 2px         # --radius-card    (10px)
  window: 3px       # --radius-window  (14px)
spacing:
  xxs: 2px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  control-height: 22px
  toolbar-height: 28px
  icon: 13px
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: 22px
    padding: 1px 6px
  button-hover:
    backgroundColor: "{colors.hover}"
  button-on:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.heading}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    height: 22px
  icon-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    size: 24px
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: 22px
  list-row:
    textColor: "{colors.text}"
    height: 22px
    padding: 1px 8px
  list-row-hover:
    backgroundColor: "{colors.hover}"
  list-row-selected:
    backgroundColor: "{colors.primary-soft}"
  panel-header:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.heading}"
    typography: "{typography.heading}"
    height: 28px
  status-line:
    textColor: "{colors.text-dim}"
    typography: "{typography.note}"
---

## Overview

DeusEdix is a tool people spend hours in, so it should feel like Unity or Premiere: quiet, dense and
predictable, never like a web page. The 3D view and the timeline are the stars; everything around them
is calm chrome. The colours come from the games' menus (Classic blue, Mankind Divided gold), but the
layout rules are the same in every theme.

Three ideas decide most questions:

1. **Balance, not crowding.** An area shows the actions people use all the time; the rest is one click
   away (a menu, a right-click, the row under the pointer). When something new needs space, something
   old moves into a menu or a tooltip.
2. **One way to do a thing.** The same kind of control looks and behaves the same in the map editor,
   the Animation Studio, the texture painter and every dialog.
3. **The editor explains itself in tooltips and the status line**, not in sentences inside toolbars.

The UI text is in English (the editor is public), short, in sentence case: "Key pose", "Test route".

## Colors

- **One accent** (`primary`, `--acc`). It marks what is selected, on, focused or primary. Never use it
  for decoration or for two competing things in the same area.
- **Neutrals carry the structure**: `background` < `panel` < `surface` from back to front, `line` for
  every divider. Hierarchy comes from these steps, not from extra colours or shadows.
- **Status colours mean status only**: `ok` green, `warn` amber, `bad` red. They are never used as a
  theme colour.
- **Always use the CSS custom properties** (`var(--acc)`, `var(--line)`...), never a hex value in a
  stylesheet, so that every theme works. The exceptions are the 3D overlays drawn by three.js (AI paths,
  gizmos, effect arrows); they keep their colours in one table each (ai-paths.js `PATH_KINDS`).
- The timeline playhead is `playhead` blue in every theme, so that it reads the same as in a video editor.

## Typography

Four sizes and no more: `note` 11px (metadata, hints, the status line), `body` 12px (everything),
`heading` 13px semibold (panel and section titles), `label-caps` 10px uppercase (rare top-bar labels).
Numbers that change (frames, coordinates, counts) use tabular figures so they do not jitter.
Do not introduce 9px, 14px, 15px or other one-off sizes; if text does not fit, shorten it.

## Layout

- **Panels** are docked like Unity's: Hierarchy, Browser and Inspector at the edges, the 3D view in the
  middle. A panel has a 28px header with its title and at most a search box and one or two icon buttons.
- **Heights**: inputs, buttons and list rows are 22px; toolbars are 28px with 24px icon buttons; the top
  bar keeps its height. Do not mix 20/24/28/30/32px controls in one row.
- **Spacing** steps are 2, 4, 6, 8 and 12px. Use 4px between controls in a group, 8-12px between groups,
  and a 1px `line` divider rather than empty space to separate regions.
- **Toolbars** read left to right: the most used group first; groups are separated by a divider; a spacer
  pushes secondary tools (view options, toggles) to the right end.
- **Lists and trees**: 22px rows, name on the left, dim metadata on the right in `note` size, actions
  of a row (Copy, Delete, the eye, the lock) appear on the row under the pointer or the selected one.
- **Timelines** behave like Premiere's: a frame ruler with ticks over the tracks, a playhead with a
  flag on the ruler and a line through every track, click or drag anywhere on the ruler or an empty spot
  of a track to scrub, frame-snapped. Never a plain range slider. Transport buttons (first, previous key,
  play, next key, last) are icon buttons grouped together; the current frame sits next to them in
  `playhead` blue.

## Elevation & Depth

Flat. Depth comes from the background/panel/surface steps and 1px lines. Only floating things that sit
over the 3D view (menus, dialogs, tooltips, floating panels) get a shadow (`0 14px 30px #0009`).
3D-view overlays are see-through and never stack: AI paths are one faint area with an outline (the stencil
layers in ai-paths.js), not piles of transparent strips.

## Shapes

Small radii (`rounded.control` 2px in Classic, 8px in the Rounded themes, both through the CSS
properties). Diamonds are keys (timeline keys, the theme swatch); circles are points in the 3D view.
Icons are simple 13px SVGs drawn with `currentColor`, the same weight everywhere; no emoji in the UI.

## Components

- **Text in a button is always centred**, never higher or lower. A control with a fixed height (22px,
  24px) gets no vertical padding (`padding:0 8px`) and a line-height no taller than its inside, so the
  browser centres it; vertical padding on a fixed-height button pushes the text down. After a UI change,
  run `ui-centering-check.js` (next to this file) in the editor's console: it lists any button that is off.
- **Button**: `surface` with a `line` border; hover lifts to `hover` with an `accent-border`; pressed and
  "on" toggles use `primary-soft`. One `button-primary` per dialog or panel at most (Save, Create).
- **Icon button**: 24px square, an SVG icon, a tooltip that names the action and its shortcut
  ("Play / pause (Space)"). Use them for frequent, well-known actions (transport, show/hide, lock).
- **Input**: `field` background, 22px, placeholder as the label when the meaning is obvious ("Find bone").
- **Panel header**: title in `heading`, actions on the right; the panel's content scrolls, the header does not.
- **Status line**: one sentence of feedback in `note` size; `ok`/`warn`/`bad` colour only for the outcome.
- **Empty state**: one short dim line saying what to do ("New or Copy an animation to edit its bone keys.").
- **Dialog**: title, content, then the buttons right-aligned with the primary last; Esc closes.

## Do's and Don'ts

- Do move rare actions into a menu, a right-click or the row under the pointer when an area gets busy.
- Do put explanations in `title` tooltips and the status line.
- Do reuse the editor's shared pieces (workspace.js panels, tool-window.js windows, menubar.js menus).
- Do check a change at the editor's normal size and at a narrow window before calling it done.
- Don't add explanatory sentences or "(click to ...)" notes inside toolbars and headings.
- Don't hardcode colours, sizes or fonts that this file gives as tokens.
- Don't add a second accent colour, gradients on controls, or shadows on docked panels.
- Don't give a fixed-height button vertical padding, and don't let a menu item wrap onto two lines.
- Don't use plain range sliders as timelines, or big round handles that take space from the tracks.
- Don't put more than one primary button in an area, or more than about seven controls in a toolbar group.

## References

Editors to look at when a part of DeusEdix needs a better design. Their behaviour is the model; the code is
written for DeusEdix (nothing is copied, so nothing needs a notice).

- **PlayCanvas Editor** and its control library **PCUI** (both MIT, a web game editor like ours): the
  Hierarchy, the Inspector's controls, the asset panel.
- **Unity** and **Godot** (Godot is MIT): the layout, the Hierarchy and Inspector habits people already know.
- **Premiere**: timelines (ruler, playhead, transport).
- **Blender's Human Interface Guidelines** and **JetBrains' toolbar guidelines**: wording, toolbars, density.
- **Dockview** (MIT): docking panels, tabs and floating groups, if the panel system needs more.
