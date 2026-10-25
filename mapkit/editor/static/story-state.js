import {validFlagName} from './state-model.js';
import {kindOf, conditionProblem} from './conditions.js';

// Read the authored shape explicitly: native SetFlag lists are writes, whereas
// choice requirements are reads even though both live inside dialogue steps.
const items = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];

export function collectDraftStates(story, map, {playedFlag, heardFlag}, links = []) {
  const entries = new Map();
  // type: 'bool' for a state, 'int' for a counter (the rules' count action, counter conditions: conditions.js)
  function add(flag, context, kind = 'read', extra = {}) {
    if (typeof flag !== 'string' || !flag.trim()) return;
    flag = flag.trim();
    const key = flag.toLowerCase();
    const entry = entries.get(key) || {flag, source: 'project', type: extra.type || 'bool', uses: []};
    if (extra.source === 'automatic') entry.source = 'automatic';
    if (extra.label) entry.label = extra.label;
    const use = {map: String(map), context, kind};
    if (!entry.uses.some(previous => previous.map === use.map && previous.context === context && previous.kind === kind)) entry.uses.push(use);
    entries.set(key, entry);
  }
  const flag = (value, context, kind = 'read') => add(value.flag, context, kind);
  // a state is read (or set, a flag step's); a counter condition reads a counter
  const requirements = (value, context, kind = 'read') => items(value.requires).forEach(requirement => {
    if (kindOf(requirement) === 'counter') add(requirement.counter, context, 'read', {type: 'int'});
    else if (kindOf(requirement) === 'flag') flag(requirement, context, kind);
  });
  function actions(value, context) {
    for (const action of items(value)) {
      if (action.type === 'flag') flag(action, context, 'write');
      if (action.type === 'do') actions(action.do, context);
    }
  }
  for (const dialogue of items(story?.dialogues)) {
    const title = String(dialogue.title || dialogue.id || 'Untitled');
    const context = 'Dialogue: ' + title;
    requirements(dialogue, context);
    if (dialogue.id && !dialogue.disabled) add(playedFlag(dialogue), context, 'automatic', {source: 'automatic', label: title + ' · Played'});
    for (const step of items(dialogue.steps)) {
      if (step.type === 'flag' || step.type === 'if') {
        const kind = step.type === 'flag' ? 'write' : 'read';
        if (step.requires?.length) requirements(step, context, kind);
        else flag(step, context, kind);
      } else if (step.type === 'choice') {
        for (const answer of items(step.options)) {
          const choice = context + ' · Answer: ' + String(answer.text || 'Untitled');
          flag(answer, choice);
          requirements(answer, choice);
        }
      } else if (step.type === 'do') actions(step.do, context);
    }
  }
  for (const info of items(story?.infolinks)) {
    const title = String(info.title || info.id || 'Untitled');
    const context = 'InfoLink: ' + title;
    if (info.id) add(heardFlag(info), context, 'automatic', {source: 'automatic', label: title + ' · Heard'});
    actions(info.do, context);
  }
  for (const event of items(story?.events)) {
    const context = 'Event: ' + String(event.title || event.id || 'Untitled');
    requirements(event, context);
    if (event.when?.type === 'flag') flag(event.when, context);
    actions(event.do, context);
  }
  for (const link of items(links)) {
    const context = 'Interaction: ' + String(link.label || link.id || link.src || 'Untitled');
    requirements(link, context);
    for (const action of items(link.do)) {
      if (action.verb === 'flag') add(action.a, context, 'write');
      if (action.verb === 'count') add(action.a, context, 'write', {type: 'int'});
    }
  }
  return [...entries.values()].sort((a, b) => a.flag.toLowerCase().localeCompare(b.flag.toLowerCase()));
}

export function conditionProblems(story) {
  const problems = [];
  function check(value, context, optional = false) {
    const name = typeof value?.flag === 'string' ? value.flag.trim() : '';
    if (!name) {
      if (!optional) problems.push(context + ': choose a state.');
    } else if (!validFlagName(name)) problems.push(context + ': invalid flag ID "' + name + '". Use letters, numbers and underscores.');
  }
  // a dialogue's requirements are states only; an event's may be any kind (conditions.js), each with its own check
  function requirements(value, context, anyKind = false) {
    if (!Array.isArray(value.requires)) return;
    value.requires.forEach((requirement, index) => {
      const where = context + ' · Condition ' + (index + 1);
      if (!anyKind || kindOf(requirement) === 'flag') check(requirement, where);
      else if (conditionProblem(requirement)) problems.push(where + ': ' + conditionProblem(requirement) + '.');
    });
  }
  function actions(value, context) {
    for (const [index, action] of items(value).entries()) {
      if (action.type === 'flag') check(action, context + ' · State change ' + (index + 1));
      if (action.type === 'do') actions(action.do, context);
    }
  }
  for (const dialogue of items(story?.dialogues)) {
    if (dialogue.disabled) continue;
    const context = 'Dialogue "' + String(dialogue.title || dialogue.id || 'Untitled') + '"';
    requirements(dialogue, context);
    for (const [index, step] of items(dialogue.steps).entries()) {
      const stepContext = context + ' · Step ' + (index + 1);
      if (step.type === 'flag' || step.type === 'if') {
        if (step.requires?.length) requirements(step, stepContext);
        else check(step, stepContext);
      } else if (step.type === 'choice') {
        for (const [answerIndex, answer] of items(step.options).entries()) {
          const answerContext = stepContext + ' · Answer ' + (answerIndex + 1);
          check(answer, answerContext, true);
          requirements(answer, answerContext);
        }
      } else if (step.type === 'do') actions(step.do, stepContext);
    }
  }
  for (const info of items(story?.infolinks)) actions(info.do, 'InfoLink "' + String(info.title || info.id || 'Untitled') + '"');
  for (const event of items(story?.events)) {
    const context = 'Event "' + String(event.title || event.id || 'Untitled') + '"';
    requirements(event, context, true);
    if (event.when?.type === 'flag') check(event.when, context + ' · When');
    actions(event.do, context);
  }
  return problems;
}

// References are kept intact: drawing one list must not convert a legacy single
// choice flag into native requirements or alter expiration/voice metadata.
export function conditionRows(list, primary) {
  const rows = items(list);
  return primary?.flag ? [primary, ...rows.filter(value => value !== primary)] : rows;
}

export function removeCondition(list, value, primary, {minimum = 0} = {}) {
  const rows = conditionRows(list, primary);
  if (!rows.includes(value) || rows.length <= minimum) return false;
  if (value === primary) {
    delete value.flag;
    delete value.is;
    return true;
  }
  const index = Array.isArray(list) ? list.indexOf(value) : -1;
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}
