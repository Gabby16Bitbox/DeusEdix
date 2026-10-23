import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('renderer draws one marker for broad/multiple selectors and clears the old marker', () => {
  const nodes=[];
  function element(tag) {
    const e={tag,attrs:{},style:{},children:[],setAttribute(k,v){this.attrs[k]=v;},
      appendChild(c){c.parent=this;this.children.push(c);},remove(){this.parent.children=this.parent.children.filter(c=>c!==this);},
      getClientRects:()=>[1],getBoundingClientRect:()=>({x:10,y:10,width:30,height:20}),
      contains:()=>true,matches:()=>false,closest:()=>null}; nodes.push(e);return e;
  }
  const targets=[element('button'),element('button')];
  const doc={head:element('head'),body:element('body'),createElement:element,
    createElementNS:(_,tag)=>element(tag),querySelectorAll:()=>targets,
    elementFromPoint:()=>targets[0],hidden:false};
  let next;
  const context=vm.createContext({document:doc,window:{},getComputedStyle:()=>({visibility:'visible'}),
    createTutorialRevealer:()=>({reset(){},reveal(){}}),
    createTutorialSelect:()=>({update(){},close(){}}),
    requestAnimationFrame:f=>{next=f;return 1;},cancelAnimationFrame(){}});
  const source=fs.readFileSync(new URL('../editor/static/tutorial-focus.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*;\r?\n/gm,'').replace('export function focusLesson','function focusLesson');
  vm.runInContext(source,context);
  context.focusLesson({selectors:['a','b'],world:{actor:'Crate'}},null,()=>true);
  next();
  const controlGroups=()=>nodes.filter(e=>e.tag==='g' && e.parent?.tag==='g' && !e.parent.attrs['clip-path'] && e.parent.children.includes(e));
  assert.equal(controlGroups().length,1);
  assert.equal(controlGroups()[0].children.filter(e=>e.tag==='ellipse').length,1);
  context.focusLesson({selectors:[],world:null},null,()=>true); next();
  assert.equal(controlGroups().length,0);
  context.focusLesson(null,null,()=>true);
  assert.equal(nodes.find(e=>e.attrs.id==='tut-focus').style.display,'none');
});
