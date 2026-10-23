// Resolve the next action from live UI/data. Closing a panel naturally returns
// to its opener; a click alone never marks an unfinished exercise complete.
import { roomCameras, movingShot } from './tutorial-checks.js';

export function lessonCues(step, env = window, doc = document) {
  const ed = env.__editor, story = env.__story;
  const all = s => [...doc.querySelectorAll(s)];
  const visible = e => !!e && e.getClientRects().length > 0 && !e.closest('[hidden]');
  const first = s => all(s).find(visible);
  // the patch of floor the room's camera looks at, for steps that ask for a click there
  // (the whole room cannot be drawn: Show me puts the camera inside it)
  const at = step.trainingRoom?.camera?.at;
  const roomFloor = at ? { bounds:[at[0] - 80, at[1] - 80, at[0] + 80, at[1] + 80, 2], label:'Click here' } : null;
  const world = step.focus || (step.show?.startsWith('select:') ? { actor: step.show.slice(7) } : step.show === 'room' ? roomFloor : null);
  const cue = (selector, hint, focus = null) => ({ lesson:step, selectors:selector ? [selector] : [], world:focus, hint,
    // The first placement lesson keeps its destination visible while guiding the menu.
    ...(step.check === 'playerstart' && world ? { placement:world } : {}) });
  const choice = (selector, values, hint, label = 'Choose an option') => {
    const open = first('#tut-choice')?.dataset?.select === selector;
    return { ...cue(open ? '#tut-choice [data-recommended="true"]' : selector, hint), choice:{selector, values, label} };
  };
  const selected = name => ed?.selected?.userData.actor?.name === name;
  const choose = name => cue(null, 'Select the indicated object to continue.', { actor:name });
  const [kind, name, , target] = (step.check || '').split(':');
  // the Play dialog's own button once it is open, else the Play of the menu bar (#playhere is the old, hidden one)
  const playButton = () => ['#pgo', '[data-play-main]', '#playhere'].find(s => first(s)) || '#playhere';
  // Map story left open from a dialogue exercise covers the rooms: close it first
  if (!['dialogue', 'choice', 'consequence', 'remember', 'end', ''].includes(kind) && first('#story.open:not(.peek)') && first('#st-close'))
    return cue('#st-close', 'Close Map story to see the room.');
  if (kind === 'added') {
    if (!first('.btab[data-tab="objects"].on')) return cue('.btab[data-tab="objects"]', 'Open Objects.');
    if (!/crate/i.test(first('#search')?.value || '')) return cue('#search', 'Search for crate.');
    if (!first('#palette .item.active[data-cls*="Crate"]')) {
      const small = '#palette .item[data-cls$="CrateUnbreakableSmall"]';
      return cue(first(small) ? small : '#palette .item[data-cls*="Crate"]', 'Choose one small crate.');
    }
    return cue(null, 'Click the TOP of the circled stockpile platform to place the crate.', world);
  }
  if (kind === 'playerstart') {
    if (!first('.btab[data-tab="objects"].on')) return cue('.btab[data-tab="objects"]', 'Open Objects.');
    if (!/player\s*start/i.test(first('#search')?.value || '')) return cue('#search', 'Search for Player start.');
    if (!first('#palette .item.active[data-cls="PlayerStart"]')) return cue('#palette .item[data-cls="PlayerStart"]', 'Choose Player start.');
    return cue(null, 'Left-click inside the yellow circle to place the Player start. No link to JC is needed.', world);
  }
  if (kind === 'dialogue') {
    if (!first('#story.open:not(.peek)')) return selected(name) ? cue('#bstory', 'Open Dialogues for this character.') : choose(name);
    const dialogues = story?.data()?.dialogues || [];
    const index = dialogues.findIndex(d => d.owner === name);
    if (index < 0) return first('#st-owner') ? choice('#st-owner', [name], 'Choose the tutorial scientist as Speaker.') : cue('#st-newd', 'Create a new dialogue.');
    if (!first(`#st-dlist [data-d="${index}"].on`)) return cue(`#st-dlist [data-d="${index}"]`, 'Open this character’s dialogue.');
    const fields = all('#st-steps .card.line textarea[data-k="text"]');
    const empty = fields.findIndex(e => !e.value.trim());
    if (empty >= 0) return cue(`#st-steps [data-s="${fields[empty].closest('[data-s]').dataset.s}"] textarea[data-k="text"]`, 'Write the highlighted line.');
    if (!fields.length) return cue('[data-addstep="line"]', 'Add a spoken line.');
    const lines = dialogues[index].steps?.filter(s => s.type === 'line') || [];
    const missing = ['npc', 'jc'].find(who => !lines.some(s => s.who === who));
    if (missing && lines.length < 2) return cue('[data-addstep="line"]', 'Add a line for JC and choose JC as its Speaker.');
    if (missing) return choice('#st-steps .card.line:last-child [data-k="who"]', [missing], `Set this line’s Speaker to ${missing === 'jc' ? 'JC' : 'the scientist'}, or add a line for them.`);
    return cue('#st-save', story?.saving ? 'Saving the dialogue…' : 'Save the dialogue to finish this exercise.');
  }
  const WHEN_TEXT = { used: 'When JC uses it', code: 'When the right code is typed', finished: 'When it runs out', enter: 'When JC walks in' };
  const VERB_TEXT = { open: 'Opens', timerstart: 'Start the timer', timerstop: 'Stop the timer', explode: 'An explosion there',
    effect: 'An effect on it', blow: 'Blow up', hostile: 'Turn hostile to JC', attack: 'Attack JC', on: 'Switch on' };
  const scriptPackage = env.__scripts?.package;
  const placedScripts = () => (ed?.edits?.added || []).filter(a => scriptPackage && String(a.cls).startsWith(scriptPackage + '.') && !ed.edits.deleted?.[a.name]);
  // select the source, Connect to... the target, then the When and the action the exercise asks for
  const ruleCue = (src, targets, whens, verbs, targetHint) => {
    const target = targets[0];
    if (ed?.pickingInteraction) return cue(null, 'Click the indicated target. Escape cancels the connection.', target ? { actor:target } : null);
    if (!selected(src)) return choose(src);
    const rule = ed?.edits?.links?.find(l => l.src === src && l.do?.some(a => targets.includes(a.target)));
    if (rule) {
      const prefix = `.lk-rule[data-lk="${rule.id}"]`;
      if (whens && !whens.includes(rule.when)) return choice(`${prefix} [data-lkw]`, whens, `Choose ${WHEN_TEXT[whens[0]] || whens[0]}.`);
      const action = rule.do.findIndex(a => targets.includes(a.target));
      if (!verbs.includes(rule.do[action].verb)) return choice(`${prefix} [data-lkv="${action}"]`, verbs, `Choose ${verbs.map(v => VERB_TEXT[v] || v).join(' or ')}.`);
    }
    return cue('#lkconnect', targetHint || 'Press Connect to… and click the indicated target.');
  };
  if (kind === 'link') return ruleCue(name, [target, ...(step.aliases || [])], [step.when || 'used'], [step.check.split(':')[2]]);
  if (kind === 'linkwhen') { const [, src, when, verbs, tgt] = step.check.split(':'); return ruleCue(src, [tgt], [when], verbs.split(',')); }
  if (kind === 'linkany') { const [, src, verbs, tgt] = step.check.split(':'); return ruleCue(src, [tgt], [step.when || 'enter'], verbs.split(',')); }
  if (kind === 'linkscript') {
    const names = placedScripts().map(a => a.name);
    if (!names.length) return cue(null, 'Place your script in the code lab first (previous step).');
    return ruleCue(name, names, null, ['on'], 'Press Connect to… and click your script.');
  }
  // the dialogue exercises: the Story open on this character's dialogue, then each piece in the order of the text
  const dialogueOf = (owner, who) => {
    if (!first('#story.open:not(.peek)')) return { cue: selected(owner) ? cue('#bstory', 'Open Dialogues for this character.') : choose(owner) };
    const dialogues = story?.data()?.dialogues || [];
    const index = dialogues.findIndex(d => d.owner === owner);
    if (index < 0) return { cue: first('#st-owner') ? choice('#st-owner', [owner], `Choose ${who} as Speaker.`) : cue('#st-newd', 'Create a new dialogue.') };
    if (!first(`#st-dlist [data-d="${index}"].on`)) return { cue: cue(`#st-dlist [data-d="${index}"]`, 'Open his dialogue.') };
    return { d: dialogues[index] };
  };
  const card = (i, inner) => `#st-steps [data-s="${i}"] ${inner}`;
  const saveCue = () => cue('#st-save', story?.saving ? 'Saving the dialogue…' : 'Save the dialogue to finish this exercise.');
  if (kind === 'choice' || kind === 'consequence' || kind === 'remember') {
    const got = dialogueOf(name, 'the archivist');
    if (got.cue) return got.cue;
    const steps = got.d.steps || [], said = s => String(s.text || '').trim();
    // what is still empty, from the top of the dialogue down: lines and JC's answers in the order they are shown
    const blanks = [
      ...all('#st-steps .card.line textarea[data-k="text"]').filter(e => !e.value.trim())
        .map(e => ({ at: [+e.closest('[data-s]').dataset.s, 0], sel: card(e.closest('[data-s]').dataset.s, 'textarea[data-k="text"]'), hint: 'Write the highlighted line.' })),
      ...steps.flatMap((s, i) => s.type !== 'choice' ? [] : (s.options || []).map((o, k) => ({ o, k, i })))
        .filter(({ o }) => !String(o.text || '').trim())
        .map(({ k, i }) => ({ at: [i, k + 1], sel: card(i, `[data-o="${k}"] input[data-k="text"]`), hint: 'Write JC’s answer.' })),
    ].sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
    if (blanks.length) return cue(blanks[0].sel, blanks[0].hint);
    const ch = steps.findIndex(s => s.type === 'choice');
    if (kind === 'choice') {
      if (!steps.some(s => s.type === 'line' && s.who === 'npc' && said(s))) return cue('[data-addstep="line"]', 'Add Duarte’s opening line.');
      if (ch < 0) return cue('[data-addstep="choice"]', 'Press + JC’s answers.');
      if (steps.slice(ch + 1).filter(s => s.type === 'line' && said(s)).length < 2) return cue('[data-addstep="line"]', 'Add Duarte’s reply under each answer’s label.');
      return saveCue();
    }
    if (ch < 0) return cue('[data-addstep="choice"]', 'First give JC a choice (the previous exercise).');
    if (kind === 'consequence') {
      const flag = steps.findIndex(s => s.type === 'flag');
      if (flag < 0) return choice('#st-more', ['flag'], 'In + more…, choose Change state.');
      if (!steps[flag].flag) return cue(card(flag, '.st-state-field .state-name'), 'Press Choose state and name it, for example DuarteHelped.');
      const tag = steps.findIndex(s => s.type === 'trigger');
      if (tag < 0 && !JSON.stringify(steps).includes(target || 'TutorialVault')) return choice('#st-more', ['trigger'], 'In + more…, choose Trigger an event (Tag).');
      if (!JSON.stringify(steps).includes(step.check.split(':')[2])) return cue(card(tag, 'input[data-k="tag"]'), 'Type the Tag TutorialVault.');
      return saveCue();
    }
    // he can only remember a state this conversation sets (the previous exercise)
    const setFlags = steps.filter(s => s.type === 'flag' && s.flag).map(s => String(s.flag));
    if (!setFlags.length) {
      const flag = steps.findIndex(s => s.type === 'flag');
      if (flag >= 0) return cue(card(flag, '.st-state-field .state-name'), 'First name the state he will remember, for example DuarteHelped.');
      return choice('#st-more', ['flag'], 'First give him something to remember: in + more…, choose Change state (the previous exercise).');
    }
    const cond = steps.findIndex(s => s.type === 'if');
    if (cond < 0) return choice('#st-more', ['if'], 'In + more…, choose Check a condition.');
    const known = setFlags.map(f => f.toLowerCase());
    if (!steps[cond].requires?.length && !known.includes(String(steps[cond].flag || '').toLowerCase()))
      return cue(card(cond, '.st-state-field .state-name'), `Press Choose state and pick ${setFlags[0]}, the state you set before.`);
    // a label of its own (not one of the answers' branches), a line under it, then the If jumps there
    const branches = new Set((steps[ch].options || []).map(o => o.goto));
    const own = steps.findIndex(s => s.type === 'label' && s.name && !branches.has(s.name));
    if (own < 0) return choice('#st-more', ['label'], 'In + more…, add a Label (jump target) for his second visit.');
    if (!steps.slice(own + 1).some(s => s.type === 'line' && said(s))) return cue('[data-addstep="line"]', 'Add his line under the new label.');
    if (steps[cond].goto !== steps[own].name) return choice(card(cond, 'select[data-k="goto"]'), [steps[own].name], `Choose ${steps[own].name} as the label to jump to.`);
    return saveCue();
  }
  // a script: Tools > Scripts..., a new one, Compile, Place in map, a click in the code lab
  if (kind === 'scriptplaced') {
    const box = first('#scripts');
    const open = box && getComputedStyle(box).display !== 'none';
    if (!open) {
      if (placedScripts().length) return cue(null, 'Move your script inside the code lab.', world);
      if (/^Click a floor/.test(first('#status')?.textContent || doc.querySelector('#status')?.textContent || '')) return cue(null, 'Click the floor of the code lab to place it.', world);
      if (first('.mb-item[data-label="Scripts..."]')) return cue('.mb-item[data-label="Scripts..."]', 'Choose Scripts…');
      return cue('.mb-menu[data-menu="Tools"] .mb-title', 'Open the Tools menu.');
    }
    if (!first('#scripts .sc-item.on')) {
      if (first('#scripts .sc-item')) return cue('#scripts .sc-item', 'Open your script.');
      return (first('#scripts .sc-name')?.value || '').trim() ? cue('#scripts .sc-new button', 'Press + New (When triggered is a good start).')
        : cue('#scripts .sc-name', 'Name your new script.');
    }
    if (first('#scripts .sc-out .sc-prob.sc-error')) return cue('#scripts .sc-prob.sc-error', 'Click the error to go to its line, fix it, then Compile again.');
    if (!/compiled/i.test(first('#scripts .sc-out .sc-ok')?.textContent || '')) return cue('#scripts .sc-compile', 'Press Compile (Ctrl+B).');
    return cue('#scripts .sc-place', 'Press Place in map, then click the floor of the code lab.');
  }
  // the Console: Play, its tab, a command
  if (kind === 'console') {
    if (!first('#console .cn-state.on')) return cue(playButton(), 'Press Play to run the training map.');
    if (!first('#console .cn-input')) return cue('#ws-tab-console', 'Open the Console tab.');
    return cue('#console .cn-input', 'Type a command, for example say Hello, and press Enter.');
  }
  if (kind === 'cutlink') {
    const camera = roomCameras(ed?.edits || {}, step.trainingRoom)[0];
    if (ed?.pickingInteraction) return cue(null, 'Click the indicated target. Escape cancels the connection.', { actor:kind === 'link' ? target : camera?.name });
    if (!selected(name)) return choose(name);
    const destination = kind === 'link' ? target : camera?.name;
    const rule = ed?.edits?.links?.find(l => l.src === name && l.do?.some(a => a.target === destination));
    if (rule) {
      const prefix = `.lk-rule[data-lk="${rule.id}"]`;
      if (rule.when !== 'used') return choice(`${prefix} [data-lkw]`, ['used'], 'Choose When used.');
      const action = rule.do.findIndex(a => a.target === destination);
      return choice(`${prefix} [data-lkv="${action}"]`, kind === 'link' ? ['open'] : ['cutplay'], kind === 'link' ? 'Choose Opens.' : 'Choose Play the cutscene.');
    }
    return cue('#lkconnect', 'Press Connect to… to choose the target.');
  }
  if (kind === 'idle') return selected(name) ? choice('#anidle', ['GestureRight'], 'Choose GestureRight in When idle.', 'When idle') : choose(name);
  if (kind === 'moved') return cue(null, selected(name) ? 'Drag a movement arrow to move the crate.' : 'Select the crate.', world);
  if (kind === 'texture') {
    const te = env.__texedit?.state;
    if (!te?.open) return selected(name) ? cue('[data-texedit]', 'Open Edit beside the crate’s texture.') : choose(name);
    if (!te.dirty) return cue(first('#te-model.te-main') ? '#te-model-view' : '#te-view', 'Paint on the texture or model.');
    if (!first('input[name="te-to"][value="one"]:checked')) return cue('input[name="te-to"][value="one"]', 'Choose This object.');
    return cue('#te-apply', te.saving ? 'Applying the texture…' : 'Apply the painted texture.');
  }
  if (kind === 'camera') return first('#addcut') ? cue('#addcut', 'Choose Cutscene camera.') : cue('#bcreate', 'Open Create.');
  if (kind === 'cinematic') {
    const camera = roomCameras(ed?.edits || {}, step.trainingRoom)[0];
    if (!camera) return cue('#bcreate', 'Create a camera in the film stage.');
    if (!env.__cutscene?.isOpen(camera.name)) return selected(camera.name) ? cue('#bcut', 'Open Edit cutscene to continue.') : choose(camera.name);
    if (movingShot(camera.cut)) return cue('#csplay', 'Play the shot to preview it.');
    if (!first('#cslook.primary')) return cue('#cslook', 'Turn on Look through.');
    if (parseFloat(first('#cstime')?.textContent || '0') < .1) return cue('#cstl', 'Click about four seconds into the timeline.');
    return cue('#cskey', 'Fly closer to the mug, then press Key to record the new view.');
  }
  // Play now saves and builds the temporary game copy itself. The old lesson
  // pointed at two obsolete quick-menu buttons and could never notice Play.
  if (kind === 'clicked' && name === 'playhere') return cue(playButton(), 'Press Play to test your training map.');
  const selector = (step.highlight || []).find(s => first(s)) || step.highlight?.[0];
  return cue(selector, '', selector ? null : world);
}
