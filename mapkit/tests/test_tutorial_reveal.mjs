import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorialRevealer, revealDelta } from '../editor/static/tutorial-reveal.js';

// Geometry is expressed in document coordinates before scrolling. Descendants
// move when an ancestor scrolls, as they do in the actual docked editor panels.
function fixture({ reduced = false } = {}) {
  const matches = new Map(), calls = [];
  const doc = {
    querySelectorAll: selector => matches.get(selector) || [],
    defaultView: {
      getComputedStyle: el => ({ display:'block', visibility:'visible', overflowX:'visible', overflowY:'visible', ...el.style }),
      matchMedia: () => ({ matches:reduced }),
    },
  };
  function element(name, options = {}) {
    const el = {
      name, ownerDocument:doc, parentElement:options.parent || doc.body || null,
      tagName:options.tag || 'DIV', style:options.style || {}, hidden:!!options.hidden,
      disabled:!!options.disabled, open:options.open ?? true,
      left:options.left || 0, top:options.top || 0,
      clientWidth:options.width ?? 100, clientHeight:options.height ?? 100,
      clientLeft:options.clientLeft || 0, clientTop:options.clientTop || 0,
      scrollWidth:options.scrollWidth ?? options.width ?? 100,
      scrollHeight:options.scrollHeight ?? options.height ?? 100,
      scrollLeft:options.scrollLeft || 0, scrollTop:options.scrollTop || 0,
      scrollTo(value) { this.scrollLeft=value.left; this.scrollTop=value.top; calls.push({ name:this.name, ...value }); },
      getBoundingClientRect() {
        let left=this.left, top=this.top;
        for (let p=this.parentElement; p; p=p.parentElement) { left-=p.scrollLeft; top-=p.scrollTop; }
        return { left, top, right:left+this.clientWidth, bottom:top+this.clientHeight, width:this.clientWidth, height:this.clientHeight };
      },
      getClientRects() {
        for (let p=this; p; p=p.parentElement)
          if (p.hidden || p.style.display==='none' || (p!==this && p.tagName==='DETAILS' && !p.open)) return [];
        return [this.getBoundingClientRect()];
      },
      matches(selector) {
        if (selector!==':disabled') return false;
        if (this.disabled) return true;
        for (let p=this.parentElement; p; p=p.parentElement) if (p.tagName==='FIELDSET' && p.disabled) return true;
        return false;
      },
    };
    return el;
  }
  doc.documentElement=element('html');
  doc.body=element('body', { parent:doc.documentElement });
  const panel = (name='panel', options={}) => element(name, { width:100, height:100, scrollHeight:500, style:{ overflowY:'auto' }, ...options });
  const target = (parent, options={}) => element('target', { parent, tag:'BUTTON', left:20, top:200, width:30, height:20, ...options });
  const bind = (selector, ...els) => matches.set(selector, els);
  return { doc, element, panel, target, bind, calls, revealer:createTutorialRevealer(doc) };
}

test('nearest reveal keeps an already visible target still and handles oversized targets', () => {
  assert.equal(revealDelta(20, 60, 0, 100), 0);
  assert.equal(revealDelta(-20, 120, 0, 100), 0);
  const f=fixture(), panel=f.panel(), target=f.target(panel, { top:30 });
  f.bind('#target', target); f.revealer.reveal(['#target']);
  assert.deepEqual(f.calls, []);
});

test('targets below and above a scroll panel move only to the nearest padded edge', () => {
  const f=fixture(), panel=f.panel(), target=f.target(panel);
  f.bind('#target', target); f.revealer.reveal(['#target']);
  assert.equal(panel.scrollTop, 128);
  assert.equal(target.getBoundingClientRect().bottom, 92);
  panel.scrollTop=250; f.revealer.reset(); f.revealer.reveal(['#target']);
  assert.equal(panel.scrollTop, 192);
  assert.equal(target.getBoundingClientRect().top, 8);
  assert.equal(f.calls.length, 2);
});

test('horizontal reveal preserves the vertical position and supports reduced motion', () => {
  const f=fixture({ reduced:true }), panel=f.panel('horizontal', { scrollWidth:500, scrollHeight:100, style:{ overflowX:'auto' } });
  const target=f.target(panel, { left:230, top:30 });
  f.bind('#target', target); f.revealer.reveal(['#target']);
  assert.equal(panel.scrollLeft, 168); assert.equal(panel.scrollTop, 0);
  assert.equal(target.getBoundingClientRect().right, 92);
  assert.equal(f.calls[0].behavior, 'instant');
});

test('nested scrollers account for the inner movement before moving the outer panel', () => {
  const f=fixture(), outer=f.panel('outer');
  const inner=f.panel('inner', { parent:outer, top:80, height:60, scrollHeight:400 });
  const target=f.target(inner, { top:240 });
  f.bind('#target', target); f.revealer.reveal(['#target']);
  assert.deepEqual(f.calls.map(({name, top})=>[name, top]), [['inner',128], ['outer',40]]);
  assert.equal(target.getBoundingClientRect().top, 72);
  assert.equal(target.getBoundingClientRect().bottom, 92);
});

test('panel borders and maximum scroll bounds are respected', () => {
  const f=fixture(), panel=f.panel('bordered', { top:20, height:80, clientTop:3, scrollHeight:200 });
  const target=f.target(panel, { top:180 });
  f.bind('#target', target); f.revealer.reveal(['#target']);
  assert.equal(panel.scrollTop, 105);
  f.revealer.reset(); target.top=1000; f.revealer.reveal(['#target']);
  assert.equal(panel.scrollTop, 120, 'Do not request a scroll beyond the browser limit');
});

test('an absent target remains pending until its delayed DOM arrives', () => {
  const f=fixture(), panel=f.panel();
  f.revealer.reveal(['#late']); assert.equal(f.calls.length, 0);
  f.bind('#late', f.target(panel)); f.revealer.reveal(['#late']);
  assert.equal(panel.scrollTop, 128);
});

test('hidden and disabled controls remain pending until they can be used', () => {
  for (const reason of ['hidden', 'disabled', 'display', 'visibility']) {
    const f=fixture(), panel=f.panel(), target=f.target(panel);
    if (reason==='display') panel.style.display='none';
    else if (reason==='visibility') panel.style.visibility='hidden';
    else target[reason]=true;
    f.bind('#target', target); f.revealer.reveal(['#target']);
    assert.equal(f.calls.length, 0, reason);
    target.hidden=false; target.disabled=false; panel.style.display='block'; panel.style.visibility='visible';
    f.revealer.reveal(['#target']);
    assert.equal(panel.scrollTop, 128, reason+' becomes actionable');
  }
});

test('controls disabled through their fieldset remain pending until unlocked', () => {
  const f=fixture(), panel=f.panel();
  const fields=f.element('fields', { parent:panel, tag:'FIELDSET', disabled:true });
  const target=f.target(fields);
  assert.equal(target.disabled, false, 'HTML .disabled only reflects the control attribute');
  assert.equal(target.matches(':disabled'), true, 'The fieldset still disables the control');
  f.bind('#target', target); f.revealer.reveal(['#target']);
  assert.equal(f.calls.length, 0);
  fields.disabled=false; f.revealer.reveal(['#target']);
  assert.equal(panel.scrollTop, 128);
});

test('closed ancestor details are opened before their target is revealed', () => {
  const f=fixture(), panel=f.panel();
  const section=f.element('section', { parent:panel, tag:'DETAILS', open:false });
  const target=f.target(section); f.bind('#target', target);
  assert.equal(target.getClientRects().length, 0);
  f.revealer.reveal(['#target']);
  assert.equal(section.open, true); assert.equal(panel.scrollTop, 128);
});

test('same logical selector does not fight user scroll even when its DOM node is replaced', () => {
  const f=fixture(), panel=f.panel();
  f.bind('#target', f.target(panel)); f.revealer.reveal(['#target']);
  panel.scrollTop=0;
  f.bind('#target', f.target(panel, { top:350 })); f.revealer.reveal(['#target']);
  assert.equal(panel.scrollTop, 0); assert.equal(f.calls.length, 1);
  f.revealer.reset(); f.revealer.reveal(['#target']);
  assert.equal(panel.scrollTop, 278, 'Show me/reset can reveal the current target again');
});

test('a broad selector reveals one usable match, not its last matching texture slot', () => {
  const f=fixture(), panel=f.panel();
  f.bind('[data-slot]', f.target(panel, { disabled:true }), f.target(panel), f.target(panel, { top:400 }));
  f.revealer.reveal(['[data-slot]']);
  assert.equal(panel.scrollTop, 128); assert.equal(f.calls.length, 1);
});

test('multiple targets in the same panel do not jump to the last cue', () => {
  const f=fixture(), panel=f.panel();
  f.bind('#first', f.target(panel)); f.bind('#last', f.target(panel, { top:400 }));
  f.revealer.reveal(['#first', '#last']);
  assert.equal(panel.scrollTop, 128); assert.equal(f.calls.length, 1);
  panel.scrollTop=0; f.revealer.reveal(['#first', '#last']);
  assert.equal(panel.scrollTop, 0, 'A later cue tick must not move to the deferred secondary target');
});

test('independent panels can each reveal their own target', () => {
  const f=fixture(), a=f.panel('inspector'), b=f.panel('browser');
  f.bind('#a', f.target(a)); f.bind('#b', f.target(b, { top:300 }));
  f.revealer.reveal(['#a', '#b']);
  assert.deepEqual(f.calls.map(({name, top})=>[name, top]), [['inspector',128], ['browser',228]]);
});

test('prepare can reject the old actor without consuming the correct delayed Inspector target', () => {
  const f=fixture(), panel=f.panel();
  const old=f.target(panel); old.actor='Old';
  f.bind('#anidle', old);
  const prepare=el=>el.actor==='TutorialTrooper';
  f.revealer.reveal(['#anidle'], prepare); assert.equal(f.calls.length, 0);
  const fresh=f.target(panel); fresh.actor='TutorialTrooper'; f.bind('#anidle', fresh);
  f.revealer.reveal(['#anidle'], prepare);
  assert.equal(panel.scrollTop, 128);
});
