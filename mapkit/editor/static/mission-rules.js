import {nodeTitle} from './mission-graph-model.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lower=s=>String(s||'').toLowerCase();
export function ruleIndex(snapshot) {
  const items=snapshot.rules?.items||[],byId=new Map(items.map(r=>[r.id,r])),flags=new Map();
  for(const r of items)for(const key of ['reads','writes'])for(const flag of r[key]) {
    const id=lower(flag);if(!flags.has(id))flags.set(id,{label:flag,reads:[],writes:[]});flags.get(id)[key].push(r);
  }
  return {items,byId,flags};
}
export function rulesForSelection(data,index,node) {
  if(!node)return [];
  const subjects=new Set([node.id]);
  if(node.cls)subjects.add('class:'+lower(node.cls.split('.').at(-1)));
  if(node.kind==='character-class')subjects.add('class:'+lower(node.label));
  for(const e of index.adjacent.get(node.id)||[])if(e.relation==='dialogue identity')subjects.add(e.target);
  const names=[...subjects].filter(s=>s.startsWith('class:')||s.startsWith('identity:')).map(s=>s.split(':').at(-1));
  return data.items.flatMap(r=>{
    let reason='';
    if(r.owner===node.id||r.subjects.some(s=>subjects.has(s)))reason='Explicit subject reference';
    else if(node.kind==='flag'&&[...r.reads,...r.writes].some(f=>lower(f)===lower(node.label)))reason='Literal flag access';
    else if(node.kind==='map'&&r.maps.some(m=>lower(m)===lower(node.map||node.label)))reason='Map scope';
    else if([...r.reads,...r.writes].some(f=>names.some(n=>lower(f).startsWith(n+'_'))))reason='Matching flag name · not an actor reference';
    return reason?[{rule:r,reason}]:[];
  });
}
export function filterRules(rows,mission,map,query='') {
  const q=lower(query.trim());
  return rows.filter(({rule:r})=>(!mission||r.missions.includes(mission))&&(!map||(map==='?'?!r.maps.length:r.maps.some(m=>lower(m)===lower(map))))&&(!q||lower([r.title,r.evidence.file,...r.reads,...r.writes,...r.conditions,...r.actions].join(' ')).includes(q)));
}
function conditionText(text) {
  return text.replace(/!\s*[\w.]*GetBool\('([^']+)'\)/gi,'$1 = false').replace(/[\w.]*GetBool\('([^']+)'\)/gi,'$1 = true').replace(/&&/g,' AND ').replace(/\|\|/g,' OR ').replace(/\s+/g,' ').trim();
}
function actionText(text) {
  const m=text.match(/^[\w.]*SetBool\('([^']+)'\s*,\s*(True|False)\b/i);
  if(m)return `Set ${m[1]} = ${m[2].toLowerCase()}`;
  return text.replace(/(\w+)\.EnterWorld\(\);?/g,'Show $1 in the world').replace(/(\w+)\.Destroy\(\);?/g,'Remove $1').replace(/(\w+)\.SetHomeBase\(.*\);?/g,'Set $1’s home position').replace(/;$/,'');
}
const mapLabel=r=>r.maps.length>1?`${r.maps.length} maps · script binding`:r.maps[0]||'Map not resolved';
const missionLabel=r=>r.missions.length>3?`${r.missions.length} missions`:r.missions.join(', ');
const sourceLabel=r=>`${r.evidence.file||r.owner}${r.evidence.line?':'+r.evidence.line:''}`;
const flagButton=f=>`<button type="button" data-rule-flag="${esc(f)}" title="Show all scanned rules that read or write ${esc(f)}">${esc(f)}</button>`;
function list(values,format=x=>x) {
  return `<ul>${values.map(v=>`<li>${esc(format(v))}</li>`).join('')}</ul>`;
}
export function createRuleView(snapshot,index,onDetails) {
  const data=ruleIndex(snapshot);let rows=[],subject=null,mission='',map='',query='',limit=18,selected='',flag='',flagLimit=24,canvas=null,selectionMap='';
  const api={
    select(id,context={}) {
      subject=index.nodes.get(id);rows=rulesForSelection(data,index,subject);selectionMap=subject?.map||context.map||'';
      const m=selectionMap.match(/^(\d\d)_/);mission=m?'Mission '+m[1]:'';map='';query='';limit=18;flag='';selected='';
    },
    render(target) {
      canvas=target;
      if(!snapshot.rules){canvas.innerHTML='<p class="mg-empty">Rule cards need the updated analysis service. Restart DeusEdix, then Refresh.</p>';return;}
      const missions=[...new Set(rows.flatMap(x=>x.rule.missions).concat(mission?[mission]:[]))].sort();
      const maps=[...new Set(rows.filter(x=>!mission||x.rule.missions.includes(mission)).flatMap(x=>x.rule.maps))].sort();
      const filtered=filterRules(rows,mission,map,query),visible=filtered.slice(0,limit);
      if(!selected&&visible.length)selected=visible[0].rule.id;
      const groups=new Map();
      for(const item of visible){const r=item.rule,key=(mission||missionLabel(r))+' · '+mapLabel(r);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
      canvas.innerHTML=`<div class="mg-rule-heading"><h3>${esc(nodeTitle(subject))}</h3><small>${esc(selectionMap||'Selection')} · saved rules</small></div>
        <div class="mg-rule-filters"><label>Mission<select data-rule-mission aria-label="Rule mission"><option value="">All missions</option>${missions.map(m=>`<option ${m===mission?'selected':''}>${esc(m)}</option>`).join('')}</select></label><label>Map<select data-rule-map aria-label="Rule map"><option value="">All maps</option><option value="?" ${map==='?'?'selected':''}>Map not resolved</option>${maps.map(m=>`<option ${m===map?'selected':''}>${esc(m)}</option>`).join('')}</select></label><label>Find<input type="search" data-rule-query aria-label="Find rule or flag" placeholder="Rule or flag…" value="${esc(query)}"></label></div>
        <p class="mg-rule-count">${filtered.length} rules · ${rows.length} for this selection across all missions. Map scope is shown on each group.</p>
        <div data-rule-cards>${[...groups].map(([key,items])=>`<section class="mg-rule-map"><h3>${esc(key)}</h3>${items.map(({rule:r,reason})=>api.card(r,reason)).join('')}</section>`).join('')||'<p class="mg-empty">No matching rules in this scope. Choose All missions or Read game sources.</p>'}</div>
        ${filtered.length>limit?`<button type="button" data-rules-more>Show more (${filtered.length-limit})</button>`:''}`;
      canvas.querySelector('[data-rule-mission]').onchange=e=>{mission=e.target.value;map='';limit=18;selected='';flag='';api.render(canvas);onDetails();};
      canvas.querySelector('[data-rule-map]').onchange=e=>{map=e.target.value;limit=18;selected='';flag='';api.render(canvas);onDetails();};
      canvas.querySelector('[data-rule-query]').oninput=e=>{query=e.target.value;limit=18;selected='';flag='';const pos=e.target.selectionStart;api.render(canvas);const input=canvas.querySelector('[data-rule-query]');input.focus();input.setSelectionRange(pos,pos);onDetails();};
      canvas.querySelector('[data-rules-more]')?.addEventListener('click',()=>{limit+=18;api.render(canvas);});
      canvas.querySelectorAll('[data-rule-card]>summary').forEach(el=>el.onclick=()=>{selected=el.parentElement.dataset.ruleCard;flag='';onDetails();});
      api.bindFlags(canvas);
    },
    card(r,reason) {
      // Map guards are already presented by the map group; retain exact guards in Source.
      const conditions=r.conditions.filter(c=>!r.maps.length||!/^\s*(?:NOT \()?localURL\s*(?:==|~=)\s*"[\w-]+"\)?\s*$/i.test(c));
      const owner=index.nodes.get(r.owner)?.label||r.owner;
      return `<details class="mg-rule-card" data-rule-card="${esc(r.id)}" ${selected===r.id?'open':''}><summary title="${esc(r.title+' · '+owner)}">${esc(r.title)} <small>· ${esc(owner)}</small></summary><div class="mg-rule-content"><small>${esc(reason)} · ${esc(r.mapScope)}</small><dl><dt>When</dt><dd>${esc(r.when)}</dd><dt>Conditions</dt><dd>${conditions.length?list(conditions,conditionText):'No additional predicate reconstructed.'}${r.loops?.length?`<details><summary>Loop & actor selection</summary>${list(r.loops)}</details>`:''}</dd><dt>Actions</dt><dd>${list(r.actions.slice(0,6),actionText)}${r.actions.length>6?`<details><summary>${r.actions.length-6} more actions</summary>${list(r.actions.slice(6),actionText)}</details>`:''}</dd><dt>Reads flags</dt><dd class="mg-rule-flags">${r.reads.map(flagButton).join('')||'None found'}</dd><dt>Writes flags</dt><dd class="mg-rule-flags">${r.writes.map(flagButton).join('')||'None found'}</dd></dl><small class="mg-rule-source">${esc(sourceLabel(r))}</small>${r.notes.some(n=>n.startsWith('Partial'))?'<p class="mg-unknown">Partial control flow · review source.</p>':''}</div></details>`;
    },
    bindFlags(el) {el.querySelectorAll('[data-rule-flag]').forEach(b=>b.onclick=()=>{flag=lower(b.dataset.ruleFlag);flagLimit=24;onDetails();});},
    details(panel) {
      if(flag) {
        const entry=data.flags.get(flag);if(!entry)return;
        panel.innerHTML=`<h3>${esc(entry.label)}</h3><p>Across all scanned missions. These are code readers and writers, not necessarily characters performing the action.</p>${['writes','reads'].map(key=>`<section class="mg-flag-access"><h3>${key==='writes'?'Who writes it':'Who checks it'} · ${entry[key].length}</h3>${entry[key].slice(0,flagLimit).map(r=>`<div><button type="button" class="mg-row" data-open-rule="${esc(r.id)}" title="${esc(r.title+' · '+sourceLabel(r))}"><span>${esc(r.title)}</span></button><small>${esc(r.missions.join(', ')+' · '+mapLabel(r))}</small></div>`).join('')||'<p>No literal access found in the available sources.</p>'}${entry[key].length>flagLimit?'<button type="button" data-flags-more>Show more</button>':''}</section>`).join('')}<p class="mg-unknown">Computed names, engine code and missing sources can add dependencies. A missing writer is not proof that a flag is unused.</p>`;
        panel.querySelectorAll('[data-flags-more]').forEach(b=>b.onclick=()=>{flagLimit+=24;api.details(panel);});
        panel.querySelectorAll('[data-open-rule]').forEach(b=>b.onclick=()=>{
          const r=data.byId.get(b.dataset.openRule);if(!r)return;
          // Explicit drill-down can leave the subject; it never changes the editor selection.
          rows=[{rule:r,reason:'Flag dependency · may concern another character'}];mission='';map='';query='';selected=r.id;flag='';api.render(canvas);onDetails();
          canvas.focus({preventScroll:true});
        });return;
      }
      const r=data.byId.get(selected);
      panel.innerHTML=r?`<h3>Rule evidence</h3><p>${esc(r.title)}</p><dl><dt>Owner</dt><dd>${esc(index.nodes.get(r.owner)?.label||r.owner)}</dd><dt>Scope</dt><dd>${esc(r.mapScope)}</dd></dl>${list(r.notes)}<details class="mg-technical"><summary>Source statements & conditions</summary><div class="mg-evidence"><div>${esc(sourceLabel(r))}</div><pre>${esc(r.evidence.excerpt||'No excerpt available.')}</pre></div></details><p>Choose a flag in a card to inspect who writes it and who checks it.</p>`:'<p class="mg-empty">Choose a rule or change the mission filter.</p>';
    }
  };
  return api;
}
