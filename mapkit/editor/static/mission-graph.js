import {attachToolWindow} from './tool-window.js';
import {graphIndex,searchNodes,selectedRoot,groupedOverview,nodeTitle,nodeKind,relationLabel,pathScope} from './mission-graph-model.js';
import {createRuleView} from './mission-rules.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root=document.createElement('section');root.id='mission-graph';root.style.display='none';
root.innerHTML=`<header class="mg-head"><b>Mission graph</b><small data-mg-project></small><span class="mg-readonly">Read only</span><button type="button" data-mg-close aria-label="Close mission graph" title="Close (Esc)">×</button></header>
  <div class="mg-tools"><button type="button" data-mg-home title="Return to the character or object you started from">Back to selection</button><button type="button" data-mg-find aria-expanded="false">Find…</button><span class="mg-spacer"></span><button type="button" data-mg-refresh title="Read saved maps and scripts again; no rebuild or save">Refresh</button><details class="mg-options"><summary>More</summary><div><button type="button" data-mg-sources title="Read game packages into the local analysis cache; no build or save">Read game sources</button><button type="button" data-mg-coverage>Coverage</button></div></details></div>
  <div class="mg-body"><aside class="mg-browser" hidden><input type="search" data-mg-search aria-label="Search mission graph" placeholder="Find character, state, map…"><select data-mg-kind aria-label="Node type"><option value="">All types</option>${['character','flag','map','script','conversation','dialogue','event','engine-tag','scripting-tag','object'].map(k=>`<option value="${k}">${esc(nodeKind({kind:k}))}</option>`).join('')}</select><select data-mg-origin aria-label="Source origin"><option value="">All sources</option><option value="original">Original game</option><option value="project">Project scripts</option><option value="editor">Editor rules</option></select><small data-mg-count></small><div class="mg-list" data-mg-list></div></aside>
  <main class="mg-main"><div class="mg-canvas" data-mg-canvas tabindex="0" aria-label="Grouped mission dependencies"><p class="mg-empty">Reading saved references…</p></div><div class="mg-canvas-status" data-mg-view></div></main>
  <aside class="mg-details"><nav><button type="button" data-mg-details aria-pressed="true">Details</button><button type="button" data-mg-findings aria-pressed="false">Findings</button></nav><div data-mg-detail></div></aside></div>
  <footer><span data-mg-status role="status" aria-live="polite">Saved project files only.</span></footer>`;
document.body.append(root);
const $=s=>root.querySelector(s);
attachToolWindow(root,$('.mg-head'),$('[data-mg-close]'));
let snapshot=null,index=null,overview=null,context={},anchor='',home='',active='',groupId='',path=null,edgeId='',epoch=0,controller=null,detailMode='details',selectedBefore=null,groupQuery='',groupLimit=40,viewMode='rules',ruleView=null;
const mode=document.createElement('select');mode.dataset.mgMode='';mode.setAttribute('aria-label','Mission graph view');mode.innerHTML='<option value="rules">Rules</option><option value="connections">Connections</option>';$('.mg-tools').prepend(mode);
mode.onchange=()=>{viewMode=mode.value;detailMode='details';render();};
const note=(text,level='')=>{const el=$('[data-mg-status]');el.textContent=text;el.dataset.level=level;};
const other=(edge,id)=>edge.source===id?edge.target:edge.source;
const metadata=n=>[nodeKind(n),n.map].filter(Boolean).join(' · ');
const scopeShort=p=>p.edges.some(e=>e.relation==='uses character class')?'Shared script':p.nodes.some(id=>index.nodes.get(id)?.kind==='identity')?'Shared identity':p.edges.length===1?'Direct reference':`${p.edges.length} links`;
function evidenceHtml(ev={}) {
  return `<div class="mg-evidence"><div>${esc(ev.file||'Saved map structure')}${ev.line?' : '+esc(ev.line):''}</div>${ev.function?`<small>${esc(ev.function)}</small>`:''}${ev.excerpt?`<pre>${esc(ev.excerpt)}</pre>`:''}</div>`;
}
async function request(url,options={}) {
  const response=await fetch(url,{...options,signal:controller?.signal});const value=await response.json();
  if(!response.ok)throw Error(value.error||'Cannot read mission graph.');return value;
}
function busy(value) {
  for(const s of ['[data-mg-refresh]','[data-mg-sources]'])$(s).disabled=value;
  root.setAttribute('aria-busy',String(value));
}
function toggleSearch(value) {
  $('.mg-browser').hidden=!value;root.classList.toggle('mg-searching',value);$('[data-mg-find]').setAttribute('aria-expanded',String(value));
  if(value){renderList();$('[data-mg-search]').focus();}
}
function renderList() {
  if(!snapshot)return;
  const nodes=searchNodes(snapshot,$('[data-mg-search]').value,$('[data-mg-kind]').value,$('[data-mg-origin]').value);
  $('[data-mg-count]').textContent=`${nodes.length} results`;
  $('[data-mg-list]').innerHTML=nodes.slice(0,180).map(n=>`<button type="button" class="mg-row" data-search-node="${esc(n.id)}" title="${esc(n.label+' · '+metadata(n))}"><span>${esc(n.label)}</span><small>${esc(n.map||nodeKind(n))}</small></button>`).join('')||'<p class="mg-empty">No matching references.</p>';
  if(nodes.length>180)$('[data-mg-list]').insertAdjacentHTML('beforeend','<p class="mg-empty">Refine the search to see more results.</p>');
  $('[data-mg-list]').querySelectorAll('[data-search-node]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.searchNode;
    if(viewMode==='rules'){setAnchor(id);toggleSearch(false);return;}
    if(overview.paths.has(id)&&id!==anchor){const g=overview.groups.find(g=>g.items.some(x=>x.node.id===id));groupId=g?.id||'';focusPath(overview.paths.get(id));}
    else setAnchor(id);
    toggleSearch(false);
  });
}
function setAnchor(id) {
  ruleView?.select(id,context);
  anchor=id;active=id;overview=groupedOverview(index,anchor);path=null;groupId='';edgeId='';detailMode='details';groupQuery='';groupLimit=40;render();
}
function focusPath(next) {
  path=next;active=next.nodes.at(-1);edgeId='';detailMode='details';render();
  $('[data-mg-path]')?.scrollIntoView({block:'nearest'});
}
function followEdge(id) {
  const edge=index.edges.get(id);if(!edge)return;
  const current=path||{nodes:[anchor],edges:[]},at=current.nodes.at(-1);
  if(edge.source!==at&&edge.target!==at)return;
  const next=other(edge,at),old=current.nodes.indexOf(next);
  focusPath(old>=0?{nodes:current.nodes.slice(0,old+1),edges:current.edges.slice(0,old)}:{nodes:[...current.nodes,next],edges:[...current.edges,edge]});
}
function pathHtml() {
  if(!path?.edges.length)return '';
  return `<section class="mg-path" data-mg-path aria-label="Selected reference path"><div class="mg-section-head"><h3>Selected path</h3><button type="button" data-mg-clear>Clear path</button></div><p class="mg-scope">${esc(pathScope(path,index))}</p><ol>${path.nodes.map((id,i)=>{
    const n=index.nodes.get(id),edge=path.edges[i],label=edge&&relationLabel(edge,id),forward=edge?.source===id;
    return `<li><button type="button" class="mg-path-node" data-path-step="${i}" title="${esc(n.label+' · '+metadata(n))}" aria-pressed="${id===active}"><span>${esc(nodeTitle(n))}</span><small>${esc(metadata(n))}</small></button>${edge?`<button type="button" class="mg-path-link" data-path-edge="${esc(edge.id)}" title="Show connection details and source"><span aria-hidden="true">${forward?'↓':'↑'}</span><span>${esc(label)}</span></button>`:''}</li>`;
  }).join('')}</ol></section>`;
}
function renderCanvas() {
  const canvas=$('[data-mg-canvas]'),n=index?.nodes.get(anchor);
  if(!n){canvas.innerHTML='<p class="mg-empty">No references found. Open More → Coverage.</p>';return;}
  if(viewMode==='rules') {ruleView?.render(canvas);$('[data-mg-view]').textContent='Read only · source rules, not a runtime simulation.';return;}
  const selected=overview.groups.find(g=>g.id===groupId);
  canvas.innerHTML=`<section class="mg-overview" aria-label="Dependency groups"><div class="mg-subject"><h3>${esc(nodeTitle(n))}</h3><small>${esc(n.kind==='character'?'This instance · '+n.label:nodeKind(n))}</small>${n.map?`<small>${esc(n.map)}</small>`:''}</div>${overview.groups.map(g=>`<div class="mg-group ${groupId&&groupId!==g.id?'mg-muted':''}" data-category="${g.id}"><small>${esc(g.link)}</small><button type="button" data-group="${g.id}" aria-expanded="${g.id===groupId}" aria-controls="mg-group-content"><span>${esc(g.label)}</span><span class="mg-count">${g.items.length}</span></button></div>`).join('')}</section>
    ${pathHtml()}<section id="mg-group-content" class="mg-group-content" ${selected?'':'hidden'}>${selected?`<div class="mg-section-head"><h3>${esc(selected.label)}</h3><input type="search" data-group-search aria-label="Filter ${esc(selected.label.toLowerCase())}" placeholder="Filter references…" value="${esc(groupQuery)}"></div><div data-group-rows></div>`:''}</section>`;
  canvas.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{groupId=groupId===b.dataset.group?'':b.dataset.group;groupQuery='';groupLimit=40;path=null;active=anchor;edgeId='';detailMode='details';render();});
  canvas.querySelectorAll('[data-path-step]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.pathStep);focusPath({nodes:path.nodes.slice(0,i+1),edges:path.edges.slice(0,i)});});
  canvas.querySelectorAll('[data-path-edge]').forEach(b=>b.onclick=()=>{edgeId=b.dataset.pathEdge;detailMode='details';renderDetails();});
  $('[data-mg-clear]')?.addEventListener('click',()=>{path=null;active=anchor;edgeId='';render();});
  $('[data-group-search]')?.addEventListener('input',e=>{groupQuery=e.target.value;groupLimit=40;renderGroupRows();});
  renderGroupRows();
  $('[data-mg-view]').textContent=path?.edges.length?'One reference path · arrows show the recorded direction, not execution order.':'Choose a group to explore its references.';
}
function renderGroupRows() {
  const panel=$('[data-group-rows]'),group=overview?.groups.find(g=>g.id===groupId);if(!panel||!group)return;
  const q=groupQuery.trim().toLowerCase(),items=group.items.filter(x=>[x.node.label,x.node.map,nodeKind(x.node)].join(' ').toLowerCase().includes(q));
  panel.innerHTML=items.slice(0,groupLimit).map(x=>`<button type="button" class="mg-row ${path&&active!==x.node.id?'mg-muted':''}" data-reference="${esc(x.node.id)}" aria-pressed="${active===x.node.id&&!!path}" title="${esc(x.node.label+' · '+metadata(x.node)+' · '+pathScope(x.path,index))}"><span>${esc(x.node.label)}</span><small>${esc(groupId==='appearances'?x.node.map||scopeShort(x.path):scopeShort(x.path))}</small></button>`).join('')||'<p class="mg-empty">No matching references in this scan.</p>';
  if(items.length>groupLimit)panel.insertAdjacentHTML('beforeend',`<button type="button" data-group-more>Show more (${items.length-groupLimit})</button>`);
  panel.querySelectorAll('[data-reference]').forEach(b=>b.onclick=()=>focusPath(overview.paths.get(b.dataset.reference)));
  $('[data-group-more]')?.addEventListener('click',()=>{groupLimit+=40;renderGroupRows();});
}
function findingsHtml(rows) {
  return rows.map(f=>`<section class="mg-finding" data-level="${esc(f.severity)}"><b>${esc(f.severity==='error'?'Error':f.severity==='review'?'Review':'Unverified')} · ${esc(f.title)}</b><p>${esc(f.detail)}</p>${f.evidence?.file?`<details><summary>Source</summary>${evidenceHtml(f.evidence)}</details>`:''}${f.nodes.length?`<button type="button" data-finding="${esc(f.id)}">Show dependency</button>`:''}</section>`).join('')||'<p>No findings in the scanned references. Runtime and narrative checks are still needed.</p>';
}
function renderDetails() {
  const panel=$('[data-mg-detail]');
  $('[data-mg-details]').setAttribute('aria-pressed',String(detailMode==='details'));$('[data-mg-findings]').setAttribute('aria-pressed',String(detailMode==='findings'));
  if(!snapshot){panel.innerHTML='<p class="mg-empty">No scan loaded.</p>';return;}
  if(detailMode==='coverage') {
    const c=snapshot.coverage||{};
    panel.innerHTML=`<h3>Analysis coverage</h3><dl><dt>Game</dt><dd>${esc(snapshot.project.target==='vanilla'?'Original':'Revision')}</dd><dt>Maps</dt><dd>${c.completeMaps||0} complete / ${c.maps||0} scanned</dd><dt>Classes</dt><dd>${c.sourceClasses||0}</dd><dt>Dialogues</dt><dd>${c.conversations||0}</dd></dl><p>Saved files only. Unsaved editor changes are not included.</p><p>Groups collect recorded references. Shared scripts and identities can concern other actors or maps. A reference chain is not an execution order.</p><p>Missing sources and dynamic names stay unverified. No errors does not guarantee narrative consistency.</p><p>Read game sources updates only local analysis caches. Maps and game state are not changed.</p>`;return;
  }
  if(detailMode==='findings') {
    const ids=new Set(path?.nodes||[anchor]);const local=snapshot.findings.filter(f=>f.nodes.some(id=>ids.has(id)));
    panel.innerHTML=`<h3>${path?'Path findings':'Selection findings'} · ${local.length}</h3>${findingsHtml(local)}<details class="mg-all-findings"><summary>Project findings · ${snapshot.findings.length}</summary>${findingsHtml(snapshot.findings.slice(0,150))}${snapshot.findings.length>150?'<p>First 150 shown. Select a reference to inspect its findings.</p>':''}</details>`;
    panel.querySelectorAll('[data-finding]').forEach(b=>b.onclick=()=>{const f=snapshot.findings.find(x=>x.id===b.dataset.finding),id=f?.nodes.find(id=>index.nodes.has(id));if(!id)return;if(overview.paths.has(id))focusPath(overview.paths.get(id));else setAnchor(id);});return;
  }
  if(viewMode==='rules'&&ruleView){ruleView.details(panel);return;}
  const edge=index.edges.get(edgeId),n=index.nodes.get(active);
  if(edge) {
    const pos=path?.edges.findIndex(e=>e.id===edge.id),from=pos>=0?path.nodes[pos]:edge.source,to=other(edge,from);
    panel.innerHTML=`<h3>Connection</h3><p class="mg-explanation">${esc(nodeTitle(index.nodes.get(from)))} <b>${esc(relationLabel(edge,from))}</b> ${esc(nodeTitle(index.nodes.get(to)))}.</p><p>${esc(edge.certainty==='literal'?'This reference is written explicitly in the scanned data.':edge.certainty==='inherited'?'This connection comes from inherited class defaults.':'This connection is inferred; verify it in the game.')}</p><details class="mg-technical"><summary>Technical details & source</summary><dl><dt>Relation</dt><dd>${esc(edge.relation)}</dd><dt>Certainty</dt><dd>${esc(edge.certainty)}</dd></dl>${evidenceHtml(edge.evidence)}</details><button type="button" data-mg-node-details>Back to reference</button>`;
    $('[data-mg-node-details]').onclick=()=>{edgeId='';renderDetails();};return;
  }
  if(!n){panel.innerHTML='<p class="mg-empty">Choose a reference.</p>';return;}
  const edges=index.adjacent.get(active)||[],findings=snapshot.findings.filter(f=>f.nodes.includes(active));
  panel.innerHTML=`<h3>${esc(nodeTitle(n))}</h3><p class="mg-metadata">${esc(metadata(n))}</p>${n.deleted?'<p class="mg-error">Deleted in saved edits.</p>':''}${n.missing?'<p class="mg-unknown">Not resolved in available map data.</p>':''}
    ${active===anchor?`<p>${n.kind==='character'?'Start with a group. This view keeps this character instance separate from its class and other appearances.':'Open a group, or expand Direct connections to follow a reference.'}</p>`:`<p class="mg-scope">${esc(pathScope(path||{nodes:[active],edges:[]},index))}</p>`}
    ${n.kind==='character-class'?'<p>This class can have several separate instances across maps.</p>':''}
    ${findings.length?`<button type="button" data-mg-node-findings>${findings.length} findings</button>`:''}
    <details class="mg-connections" ${active!==anchor?'open':''}><summary>Direct connections · ${edges.length}</summary>${edges.slice(0,100).map(e=>`<button type="button" data-follow-edge="${esc(e.id)}" title="Follow this recorded reference"><span>${esc(relationLabel(e,active))}</span><small>${esc(index.nodes.get(other(e,active))?.label||other(e,active))}</small></button>`).join('')||'<p>No recorded connections.</p>'}${edges.length>100?'<p>First 100 shown. Use Find to inspect more references.</p>':''}</details>
    <details class="mg-technical"><summary>Technical details & source</summary><dl><dt>ID</dt><dd>${esc(n.label)}</dd>${n.cls?`<dt>Class</dt><dd>${esc(n.cls)}</dd>`:''}<dt>Source</dt><dd>${esc(n.origin||'Shared reference')}</dd></dl>${n.evidence?evidenceHtml(n.evidence):'<p>Connections carry their own source evidence.</p>'}</details>`;
  panel.querySelectorAll('[data-follow-edge]').forEach(b=>b.onclick=()=>followEdge(b.dataset.followEdge));
  $('[data-mg-node-findings]')?.addEventListener('click',()=>{detailMode='findings';renderDetails();});
}
function render() {
  const h=index.nodes.get(home);$('[data-mg-home]').textContent='Back to '+nodeTitle(h);$('[data-mg-home]').title='Return to '+nodeTitle(h)+' · '+(h?.map||'overview');renderCanvas();renderDetails();
  // Replacing a focused row must not send keyboard shortcuts back to the editor.
  $('[data-mg-canvas]').focus({preventScroll:true});
}
function accept(value) {
  snapshot=value;index=graphIndex(snapshot);index.edges=new Map(snapshot.edges.map(e=>[e.id,e]));home=selectedRoot(snapshot,context);
  ruleView=createRuleView(snapshot,index,()=>{detailMode='details';renderDetails();});
  $('[data-mg-project]').textContent=`${snapshot.project.name} · ${snapshot.project.target==='vanilla'?'Original':'Revision'}`;setAnchor(home);if(!$('.mg-browser').hidden)renderList();
  const c=snapshot.coverage||{},errors=snapshot.findings.filter(f=>f.severity==='error').length,unverified=snapshot.findings.filter(f=>f.severity==='unknown').length;
  note(`Saved files · ${c.maps||0} maps · ${errors} errors · ${unverified} unverified.`,errors?'error':'');
}
async function scan(readSources=false) {
  const token=++epoch;controller?.abort();controller=new AbortController();busy(true);note('Starting read-only scan…');
  try {
    let job=await request('/api/missiongraph/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({readSources})});
    while(token===epoch&&root.style.display==='grid') {
      if(job.state==='error')throw Error(job.error||'Scan failed.');if(job.state==='ready'){accept(job.result);return;}
      note(`${job.phase}${job.total?' · '+job.done+' / '+job.total:''}`);await new Promise(resolve=>setTimeout(resolve,600));if(token!==epoch)return;job=await request('/api/missiongraph');
    }
  } catch(error){if(token===epoch&&error.name!=='AbortError')note(error.message,'error');}
  finally{if(token===epoch)busy(false);}
}
async function open(value={}) {
  context={...value};selectedBefore=document.activeElement;window.__editor?.cutKit?.resetInput?.();root.style.display='grid';toggleSearch(false);$('.mg-options').open=false;
  if(snapshot){home=selectedRoot(snapshot,context);setAnchor(home);note('Cached scan · Refresh after saving changes.');return;}
  $('[data-mg-canvas]').innerHTML='<p class="mg-empty">Reading saved references…</p>';$('[data-mg-detail]').replaceChildren();$('[data-mg-view]').textContent='';$('[data-mg-home]').textContent='Back to selection';
  const token=++epoch;controller?.abort();controller=new AbortController();busy(true);
  try{const job=await request('/api/missiongraph');if(token!==epoch)return;if(job.state==='ready')accept(job.result);else await scan(false);}
  catch(error){if(token===epoch&&error.name!=='AbortError')note(error.message,'error');}
  finally{if(token===epoch)busy(false);}
}
function close(){++epoch;controller?.abort();root.style.display='none';busy(false);selectedBefore?.focus?.({preventScroll:true});}
$('[data-mg-close]').onclick=close;
$('[data-mg-home]').onclick=()=>{if(index){setAnchor(home);toggleSearch(false);$('[data-mg-canvas]').scrollTop=0;}};
$('[data-mg-find]').onclick=()=>toggleSearch($('.mg-browser').hidden);
$('[data-mg-refresh]').onclick=()=>scan(false);
$('[data-mg-sources]').onclick=()=>{$('.mg-options').open=false;scan(true);};
$('[data-mg-coverage]').onclick=()=>{$('.mg-options').open=false;detailMode='coverage';renderDetails();};
$('[data-mg-details]').onclick=()=>{detailMode='details';renderDetails();};
$('[data-mg-findings]').onclick=()=>{detailMode='findings';renderDetails();};
for(const selector of ['[data-mg-search]','[data-mg-kind]','[data-mg-origin]'])$(selector).addEventListener(selector.includes('search')?'input':'change',renderList);
root.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const focusable=[...root.querySelectorAll('button:not(:disabled),input,select,summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
window.addEventListener('deusedix:project-state',()=>{close();snapshot=null;index=null;overview=null;ruleView=null;});
window.addEventListener('deusedix:map-state',()=>{if(root.style.display==='grid')close();});
window.__missionGraph={open,close};
