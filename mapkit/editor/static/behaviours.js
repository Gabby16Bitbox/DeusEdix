// The Inspector's Movement and Tactics of a character, and the player start's Player movement
// (editor/behaviours.py makes them real: properties of the character, UCBehave and UCPlayerMove actors).
// Loaded by app.js as a plain module: window.__behaviours = { characterSections, playerSection }.
const GRAVITY = 950;                       // ZoneInfo.ZoneGravity: a jump of JumpZ goes JumpZ^2 / (2 * 950) high
const GRENADES = [['GasGrenade', 'Gas grenade'], ['LAM', 'LAM'], ['EMPGrenade', 'EMP grenade'], ['NanoVirusGrenade', 'Scramble grenade']];
const AUGS = [['AugStealth', 'Run Silent'], ['AugSpeed', 'Speed Enhancement'], ['AugMuscle', 'Microfibral Muscle'], ['AugCloak', 'Cloak'],
  ['AugRadarTrans', 'Radar Transparency'], ['AugBallistic', 'Ballistic Protection'], ['AugCombat', 'Combat Strength'],
  ['AugDefense', 'Aggressive Defense'], ['AugEnviro', 'Environmental Resistance'], ['AugHealing', 'Regeneration'],
  ['AugHeartLung', 'Synthetic Heart'], ['AugPower', 'Power Recirculator'], ['AugShield', 'Energy Shield'], ['AugTarget', 'Targeting'],
  ['AugVision', 'Vision Enhancement'], ['AugAqualung', 'Aqualung'], ['AugEMP', 'EMP Shield'], ['AugLight', 'Light'], ['AugDrone', 'Spy Drone']];
const SKILLS = [['SkillSwimming', 'Swimming'], ['SkillEnviro', 'Environmental Training'], ['SkillWeaponPistol', 'Weapons: Pistol'],
  ['SkillWeaponRifle', 'Weapons: Rifle'], ['SkillWeaponHeavy', 'Weapons: Heavy'], ['SkillWeaponLowTech', 'Weapons: Low-Tech'],
  ['SkillDemolition', 'Weapons: Demolition'], ['SkillMedicine', 'Medicine'], ['SkillComputer', 'Computer'], ['SkillLockpicking', 'Lockpicking'],
  ['SkillTech', 'Electronics']];
const LEVELS = ['Untrained', 'Trained', 'Advanced', 'Master'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => (v === '' || v === undefined || v === null || Number.isNaN(+v) ? '' : +v);
const opts = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
const field = (id, label, value, title, attrs = '') => `<div class="row" title="${esc(title)}"><label style="width:auto;min-width:96px">${label}</label>`
  + `<input type="number" id="${id}" value="${value}" placeholder="game" style="width:72px" ${attrs}></div>`;

// E: the editor's own functions (app.js): edits, actorProp, setProp, unsetProp, pushUndo, setDirty, status, UE, section, requireUnlocked
export function characterSections(E, a, p, redraw) {
  const prop = (k) => { const v = E.actorProp(a, k); return v === undefined || v === null ? '' : num(v); };
  const jz = prop('JumpZ');
  const b = (E.edits.behave || {})[a.name] || {};
  const g = b.grenades, j = b.jump, d = b.dodge;
  const html = E.section('movement', 'Movement',
    field('mvspeed', 'Speed', prop('GroundSpeed'), 'GroundSpeed: how fast it runs, in units a second (JC 304; empty: as the game has it)', 'min="0" max="2000" step="10"')
    + field('mvjump', 'Jump height', jz === '' ? '' : Math.round(jz * jz / (2 * GRAVITY)), 'How high it jumps, in units (JumpZ: the game\'s characters about 8, JC 47; a crate is 32 to 48)', 'min="0" max="400" step="4"')
    + field('mvstep', 'Step height', prop('MaxStepHeight'), 'MaxStepHeight: the highest step it walks up without jumping (25 in the game)', 'min="0" max="100" step="1"')
    + field('mvair', 'Air control', prop('AirControl'), 'AirControl: how much it can steer in the air, 0 to 1 (0.05 in the game)', 'min="0" max="1" step="0.05"'),
    ['GroundSpeed', 'JumpZ', 'MaxStepHeight', 'AirControl'].some((k) => prop(k) !== ''))
    + E.section('tactics', 'Tactics', `
    <div class="row"><label style="width:auto" title="When the player stands above it (a roof, a ledge, a catwalk) in sight and in range, it throws a grenade at the player's feet"><input type="checkbox" id="bhgren" ${g ? 'checked' : ''}> Throws grenades from below</label></div>
    ${g ? `<div class="row"><label style="width:auto;min-width:96px">Grenade</label><select id="bhgcls" style="flex:1;min-width:0">${opts(GRENADES, g.cls || 'GasGrenade')}</select></div>`
      + field('bhgabove', 'Player above', num(g.above ?? 96), 'The player\'s feet at least this much higher than its own, in units', 'min="16" max="2000" step="8"')
      + field('bhgrange', 'Range', num(g.range ?? 900), 'The farthest it throws, in units', 'min="100" max="5000" step="50"')
      + field('bhgevery', 'Every (s)', num(g.every ?? 6), 'Seconds between two grenades, about', 'min="1" max="120" step="1"') : ''}
    <div class="row"><label style="width:auto" title="Walking into a crate, a railing, a low wall: it jumps on or over it (its own jump, high enough for it)"><input type="checkbox" id="bhjump" ${j ? 'checked' : ''}> Jumps over obstacles</label></div>
    ${j ? field('bhjmax', 'Highest', num(j.max ?? 56), 'The highest obstacle it jumps, in units (a crate 32 to 48)', 'min="20" max="200" step="4"') : ''}
    <div class="row"><label style="width:auto" title="When the player aims at it and fires, it steps quickly to one side"><input type="checkbox" id="bhdodge" ${d ? 'checked' : ''}> Dodges when shot at</label></div>
    ${d ? field('bhdchance', 'Chance %', Math.round((d.chance ?? 0.5) * 100), 'How often it dodges a shot', 'min="5" max="100" step="5"')
      + field('bhdevery', 'Every (s)', num(d.every ?? 2.5), 'The least time between two dodges', 'min="0.5" max="60" step="0.5"') : ''}`, !!(g || j || d));

  const wire = () => {
    const $ = (id) => document.getElementById(id);
    if (!$('mvspeed')) return;
    const setNum = (id, key, conv = (v) => v) => {
      $(id).onchange = () => {
        const v = $(id).value.trim();
        if (v === '') E.unsetProp(a, key);
        else E.setProp(a, key, conv(+v).toFixed(6));
        E.status(`${a.name}: ${key} ${v === '' ? 'as the game has it' : 'changed'}: Rebuild to put it in the map.`, 'ok');
      };
    };
    setNum('mvspeed', 'GroundSpeed');
    setNum('mvjump', 'JumpZ', (h) => Math.sqrt(2 * GRAVITY * Math.max(0, h)));
    setNum('mvstep', 'MaxStepHeight');
    setNum('mvair', 'AirControl', (v) => Math.max(0, Math.min(1, v)));
    // behaviours: edits.behave[name] = {loc, grenades, jump, dodge}
    const change = (fn, again = false) => {
      if (!E.requireUnlocked(p)) { redraw(); return; }
      E.pushUndo();
      E.edits.behave = E.edits.behave || {};
      const e = Object.assign({}, E.edits.behave[a.name], { loc: E.UE(p.position) });
      fn(e);
      if (e.grenades || e.jump || e.dodge) E.edits.behave[a.name] = e;
      else delete E.edits.behave[a.name];
      E.setDirty();
      E.status(`${a.name}'s behaviours changed: Rebuild to put them in the map.`, 'ok');
      if (again) redraw();
    };
    $('bhgren').onchange = () => change((e) => { if ($('bhgren').checked) e.grenades = { cls: 'GasGrenade', above: 96, range: 900, every: 6 }; else delete e.grenades; }, true);
    $('bhjump').onchange = () => change((e) => { if ($('bhjump').checked) e.jump = { max: 56 }; else delete e.jump; }, true);
    $('bhdodge').onchange = () => change((e) => { if ($('bhdodge').checked) e.dodge = { chance: 0.5, every: 2.5 }; else delete e.dodge; }, true);
    const sub = (id, part, key, conv = (v) => +v) => { if ($(id)) $(id).onchange = () => change((e) => { e[part] = Object.assign({}, e[part], { [key]: conv($(id).value) }); }); };
    sub('bhgcls', 'grenades', 'cls', (v) => v);
    sub('bhgabove', 'grenades', 'above');
    sub('bhgrange', 'grenades', 'range');
    sub('bhgevery', 'grenades', 'every');
    sub('bhjmax', 'jump', 'max');
    sub('bhdchance', 'dodge', 'chance', (v) => Math.max(5, Math.min(100, +v || 50)) / 100);
    sub('bhdevery', 'dodge', 'every');
  };
  return { html, wire };
}

// the player start: how JC moves in this map (edits.player_move)
export function playerSection(E, a, p, redraw) {
  const m = E.edits.player_move || {};
  const when = m.aug ? 'aug' : m.skill ? 'skill' : '';
  const html = E.section('playermove', 'Player movement',
    field('pmair', 'Air control', num(m.air), 'How much JC steers in the air, 0 to 1 (0.05 in the game)', 'min="0" max="1" step="0.05"')
    + `<div class="row" title="Other values while an aug is on, or while a skill is at least a level"><label style="width:auto;min-width:96px">While</label>
      <select id="pmwhen" style="flex:1;min-width:0"><option value="">(always the same)</option><option value="aug" ${when === 'aug' ? 'selected' : ''}>an aug is on</option><option value="skill" ${when === 'skill' ? 'selected' : ''}>a skill is at least</option></select></div>`
    + (when === 'aug' ? `<div class="row"><label style="width:auto;min-width:96px">Aug</label><select id="pmaug" style="flex:1;min-width:0">${opts(AUGS, m.aug)}</select></div>` : '')
    + (when === 'skill' ? `<div class="row"><label style="width:auto;min-width:96px">Skill</label><select id="pmskill" style="flex:1;min-width:0">${opts(SKILLS, m.skill)}</select></div>
      <div class="row"><label style="width:auto;min-width:96px">Level</label><select id="pmlevel" style="flex:1;min-width:0">${opts(LEVELS.map((l, i) => [String(i), l]), String(m.level ?? 1))}</select></div>` : '')
    + (when ? field('pmairif', '→ Air control', num(m.air_if), 'JC\'s air control while it holds, 0 to 1', 'min="0" max="1" step="0.05"')
      + field('pmjumpif', '→ Jump ×', num(m.jump_if), 'JC jumps this many times as high while it holds (1: the same)', 'min="0.2" max="5" step="0.1"') : ''),
    !!(m.air !== undefined || when));
  const wire = () => {
    const $ = (id) => document.getElementById(id);
    if (!$('pmair')) return;
    const change = (fn, again = false) => {
      E.pushUndo();
      const e = Object.assign({}, E.edits.player_move, { loc: E.UE(p.position) });
      fn(e);
      for (const k of Object.keys(e)) if (e[k] === '' || e[k] === undefined) delete e[k];
      if (Object.keys(e).some((k) => k !== 'loc')) E.edits.player_move = e;
      else delete E.edits.player_move;
      E.setDirty();
      E.status('Player movement changed: Rebuild to put it in the map.', 'ok');
      if (again) redraw();
    };
    const val = (id) => ($(id).value.trim() === '' ? undefined : +$(id).value);
    $('pmair').onchange = () => change((e) => { e.air = val('pmair'); });
    $('pmwhen').onchange = () => change((e) => {
      delete e.aug; delete e.skill; delete e.level;
      if ($('pmwhen').value === 'aug') e.aug = 'AugStealth';
      if ($('pmwhen').value === 'skill') { e.skill = 'SkillSwimming'; e.level = 1; }
      if (!$('pmwhen').value) { delete e.air_if; delete e.jump_if; }
    }, true);
    if ($('pmaug')) $('pmaug').onchange = () => change((e) => { e.aug = $('pmaug').value; });
    if ($('pmskill')) $('pmskill').onchange = () => change((e) => { e.skill = $('pmskill').value; });
    if ($('pmlevel')) $('pmlevel').onchange = () => change((e) => { e.level = +$('pmlevel').value; });
    if ($('pmairif')) $('pmairif').onchange = () => change((e) => { e.air_if = val('pmairif'); });
    if ($('pmjumpif')) $('pmjumpif').onchange = () => change((e) => { e.jump_if = val('pmjumpif'); });
  };
  return { html, wire };
}
