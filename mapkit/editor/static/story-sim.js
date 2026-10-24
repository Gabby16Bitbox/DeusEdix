// A dialogue played in the editor (the Story's Play-test): its steps run as story.py compiles them for the game, with
// the story's state (flags, credits, health, skill points, what JC carries) that can be set before and during the run.
// What the game does outside the conversation (goals, notes, items given, doors and characters moved by actions) is
// said, not done. Pure: tests/test_story_graph.mjs.

const VALUE = { EP_Credits: 'credits', EP_Health: 'health', EP_SkillPoints: 'skillpoints' };
const COMPARE = { EC_Less: (a, b) => a < b, EC_LessEqual: (a, b) => a <= b, EC_Equal: (a, b) => a === b,
  EC_GreaterEqual: (a, b) => a >= b, EC_Greater: (a, b) => a > b };

// the flags a condition asks for: a list of {flag, is}, or the step's own flag
export const conditionsOf = (s) => (s.requires?.length ? s.requires : s.flag ? [{ flag: s.flag, is: s.is !== false }] : []);
// an answer shows when its own flag and every flag it requires match (story.py: Answer, then AnswerFlag)
export const answerConditions = (o) => [...(o.flag ? [{ flag: o.flag, is: o.is !== false }] : []), ...(o.requires || [])];
export const holds = (conditions, flags) => conditions.every((c) => !!flags[c.flag] === (c.is !== false));

// state: {flags: {name: bool}, credits, health, skillpoints, items: [class names JC carries]}; random(): 0..1
export function createPlay(steps, state = {}, { random = Math.random } = {}) {
  const st = { flags: { ...(state.flags || {}) }, credits: +state.credits || 0, health: state.health ?? 100,
    skillpoints: +state.skillpoints || 0, items: new Set(state.items || []) };
  const labelAt = (name) => steps.findIndex((s) => s.type === 'label' && s.name === name);
  let at = 0, waiting = null, done = null;
  // a loop: the same step again, in the same state, with no answer chosen in between (nothing can change it)
  let since = new Map();
  const snapshot = () => JSON.stringify([st.flags, st.credits, st.health, st.skillpoints, [...st.items].sort()]);
  const jump = (name, why) => {
    const i = labelAt(name);
    if (i < 0) { done = { type: 'end', why: name ? `The label "${name}" is missing` : why || 'It goes nowhere' }; return; }
    at = i + 1;
  };

  // the next thing to show: {type: 'line' | 'choice' | 'effect' | 'end', id, ...}; a choice waits for choose()
  function next() {
    if (done) return done;
    if (waiting) return waiting;
    while (at < steps.length) {
      const s = steps[at], now = snapshot();
      if (since.get(at) === now) return (done = { type: 'end', why: 'It goes round in a loop' });
      since.set(at, now);
      switch (s.type) {
        case 'label': at++; break;
        case 'goto':
          if (s.conversation) return (done = { type: 'end', id: s.id, why: `It goes on in the conversation ${s.conversation}` });
          jump(s.label);
          if (done) return done;
          break;
        case 'end': return (done = { type: 'end', id: s.id, why: 'End of dialogue' });
        case 'line': at++; return { type: 'line', id: s.id, who: s.who || 'npc', text: s.text || '' };
        case 'choice': {
          const options = (s.options || []).map((o, k) => ({ k, text: o.text || '', shown: holds(answerConditions(o), st.flags) }))
            .filter((o) => o.text.trim());
          return (waiting = { type: 'choice', id: s.id, step: s, options });
        }
        case 'if': {
          const yes = holds(conditionsOf(s), st.flags);
          if (yes) { jump(s.goto); if (done) return done; } else at++;
          break;
        }
        case 'checkitem':
          if (st.items.has(s.item)) at++; else { jump(s.goto, `JC has no ${s.item}`); if (done) return done; }
          break;
        case 'checkvalue': {
          const value = st[VALUE[s.valueType || 'EP_Credits']], test = COMPARE[s.condition || 'EC_GreaterEqual'];
          if (test && test(value, +s.amount || 0)) { jump(s.goto); if (done) return done; } else at++;
          break;
        }
        case 'random': {
          const labels = s.labels || [];
          if (!labels.length) return (done = { type: 'end', id: s.id, why: 'A random branch with no labels' });
          jump(labels[Math.min(labels.length - 1, Math.floor(random() * labels.length))]);
          if (done) return done;
          break;
        }
        case 'flag': {
          const set = s.requires?.length ? s.requires : [{ flag: s.flag, is: s.is !== false }];
          for (const f of set) if (f.flag) st.flags[f.flag] = f.is !== false;
          at++;
          return { type: 'effect', id: s.id, text: set.map((f) => `${f.flag} = ${f.is !== false}`).join(', ') };
        }
        case 'credits': st.credits += +s.amount || 0; at++; return { type: 'effect', id: s.id, text: `Credits ${+s.amount >= 0 ? '+' : ''}${+s.amount || 0}` };
        case 'skillpoints': st.skillpoints += +s.amount || 0; at++; return { type: 'effect', id: s.id, text: `Skill points +${+s.amount || 0}` };
        case 'give': st.items.add(s.item); at++; return { type: 'effect', id: s.id, text: `JC receives ${s.count || 1} × ${s.item || '?'}` };
        case 'goal': at++; return { type: 'effect', id: s.id, text: `Goal ${s.done ? 'completed' : 'added'}: ${s.text || s.goal || ''}` };
        case 'note': at++; return { type: 'effect', id: s.id, text: `Note: ${s.text || ''}` };
        case 'trigger': at++; return { type: 'effect', id: s.id, text: `Triggers the event ${s.tag || '?'}` };
        case 'do': at++; return { type: 'effect', id: s.id, text: `When the dialogue ends: ${(s.do || []).length} action${(s.do || []).length === 1 ? '' : 's'}` };
        default: at++; return { type: 'effect', id: s.id, text: s.type };
      }
    }
    return (done = { type: 'end', why: 'End of dialogue' });
  }
  // JC's answer k of the choice shown
  function choose(k) {
    if (!waiting) return;
    const o = waiting.step.options[k];
    waiting = null;
    since = new Map();
    if (o.goto) jump(o.goto); else done = { type: 'end', why: 'This answer goes nowhere' };
  }
  return { next, choose, state: st };
}
