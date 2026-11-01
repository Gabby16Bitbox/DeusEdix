// The Rebuild in the background (Map > Rebuild), as Unity's long tasks in its status bar: what the chip in the status
// bar says while it runs, which keys still work meanwhile, and the Build report Messages get at the end. The page's own
// stages come first (saving the map, making the walkable area), then the server's (editor/build_job.py: the stage of the
// command the engine runs, the seconds of each, the counts of its output). The logic only, without the page: app.js
// runs the build (rebuildMap), build-chip.js draws the chip.

// the stages the page runs before the server's, as said
export const PAGE_STAGES = Object.freeze({ save: 'Saving', navmesh: 'Walkable area' });
// the Rebuild modes (rebuild.py MODES) as the report names them
export const MODE_NAMES = Object.freeze({ auto: 'Rebuild', full: 'Full rebuild', lighting: 'Rebuild lighting', paths: 'Rebuild AI paths' });

// seconds as a clock: 0:07, 1:05, 12:40
export function clock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// seconds as a stage's time in the report: 0.4 s, 12.0 s, 1:05
const took = (seconds) => (seconds < 60 ? `${seconds.toFixed(1)} s` : clock(seconds));

// The chip: { stage, time, title, cancelling } for a build at the stage `label`, `elapsed` seconds in, the last build of
// the map taking `estimate` seconds (null: none yet), being cancelled or not
export function chipView({ label, elapsed, estimate = null, cancelling = false }) {
  const last = estimate ? `last time ${clock(estimate)}` : '';
  return {
    cancelling,
    stage: cancelling ? 'Cancelling…' : label,
    time: [clock(elapsed), last].filter(Boolean).join(' · '),
    title: cancelling ? 'Stopping the build: the map stays as it was before it'
      : `Rebuilding: ${label}${last ? ` (the last build of this map took ${clock(estimate)})` : ''}. The view is look-only until it ends.`,
  };
}

// The keys that only look while a Rebuild runs, as app.js gets them (menubar.js turns a key the user rebound into its
// default, comboOf writes it): the view, the selection, the panels. Any other key edits and waits for the build; the
// digits (views kept, selection slots) look too (Face selection's Alt+1…9 edit: app.js refuses them itself).
export const LOOK_KEYS = new Set(['F', 'Shift+F', 'H', 'Shift+H', 'P', 'L', 'M', 'W', 'E', 'R', 'G', 'Z', 'X', 'Esc',
  'Ctrl+A', 'Ctrl+I', 'Shift+D', 'Ctrl+C', 'Ctrl+K', 'Ctrl+U', 'Ctrl+[', 'Ctrl+]', 'Ctrl+Shift+[', 'Ctrl+Shift+]', 'Shift+Space',
  'Alt+G', 'Alt+Shift+G']);
export const waitsForBuild = (combo) => !!combo && !LOOK_KEYS.has(combo) && !/^(Ctrl\+|Alt\+|Shift\+|Ctrl\+Alt\+)?[1-9]$/.test(combo);
// The browser's own keys go on too, the editor does nothing with them: Tab and Shift+Tab move the focus, Enter and Space
// press what has it when that is a button, a link or a fold (onControl: the key's target is in one of PRESSABLE), so
// the chip's Cancel is reached and pressed from the keyboard
export const PRESSABLE = 'button, a[href], summary, [role="button"]';
export const browserKey = (combo, onControl) => /^(Shift\+)?Tab$/.test(combo) || (onControl && (combo === 'Enter' || combo === 'Space'));

// the lines of a build's output that say something may be wrong (editor/dxmaps.py, scene.py, zones.py, drawn.py, kit.py):
// the report lists them with a Check map link
const WARNINGS = [/IN SOLID/, /^\s*ZONE /, /^\s*TEXTURE /, /STRETCHED/, /^\s*(DROP|SNAP):/, /EDIT skipped/,
  /^\s*DRAWN .*(not built|no texture)/, /Prefab snapshot not available/, /retry \d+\/\d+/];
export const isWarning = (line) => WARNINGS.some((re) => re.test(line));

// what the build output counted (build_job.py counts), one row each: the BSP, the lighting, the AI paths
export function countRows(c = {}) {
  const rows = [];
  const bsp = [c.nodes !== undefined && `${c.nodes} nodes`, c.surfaces !== undefined && `${c.surfaces} surfaces`,
    c.zones !== undefined && `${c.zones} ${c.zones === 1 ? 'zone' : 'zones'}`].filter(Boolean);
  if (bsp.length) rows.push(`BSP: ${bsp.join(', ')}`);
  if (c.lights !== undefined) rows.push(`Lighting: ${c.lights} ${c.lights === 1 ? 'light' : 'lights'}`);
  const paths = [c.points !== undefined && `${c.points} points`, c.reachspecs !== undefined && `${c.reachspecs} reach specs`
    + (c.pruned ? ` (${c.pruned} pruned)` : ''), c.kept && `${c.kept} of the map's own put back`].filter(Boolean);
  if (paths.length) rows.push(`AI paths: ${paths.join(', ')}`);
  return rows;
}

// The Build report for Messages, in reading order: [{ text, cls, check }] (check: a Check map link after the text).
// r: { map, mode, state: 'done' | 'failed' | 'cancelled', page: the page's stages [{ label, seconds }], report: the
// server's ({ stages: [{ label, seconds }], counts }), lines: the build's output }
export function buildReport({ map, mode, state, page = [], after = [], elapsed, report = {}, lines = [] }) {
  const stages = [...page, ...(report.stages || []), ...after].filter((s) => s.seconds >= 0.05);
  const measured = stages.reduce((sum, s) => sum + s.seconds, 0);
  // The browser's elapsed time includes request/polling waits and reopening the map.
  const total = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : measured, name = MODE_NAMES[mode] || MODE_NAMES.auto;
  const head = { done: [`Build report · ${map}: ${name} in ${clock(total)}`, 'ok'],
    failed: [`Build report · ${map}: ${name} failed after ${clock(total)}`, 'bad'],
    cancelled: [`Build report · ${map}: ${name} cancelled after ${clock(total)}, the map is as it was before it`, 'warn'] }[state];
  const rows = [{ text: head[0], cls: head[1] }, ...stages.map((s) => ({ text: `  ${s.label}: ${took(s.seconds)}` }))];
  if (state === 'cancelled') return rows;
  rows.push(...countRows(report.counts).map((text) => ({ text: '  ' + text })));
  const warned = lines.filter(isWarning);
  if (warned.length) rows.push({ text: `  ${warned.length} ${warned.length === 1 ? 'warning' : 'warnings'}:`, cls: 'warn' },
    ...warned.map((l) => ({ text: '  ' + l.trim(), cls: 'warn', check: true })));
  return rows;
}
