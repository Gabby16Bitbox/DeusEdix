// Pure, bounded graph view. The full index stays intact; the canvas shows a neighbourhood.
export function graphIndex(snapshot) {
  const nodes = new Map((snapshot.nodes || []).map(n => [n.id,n])), adjacent=new Map();
  for(const edge of snapshot.edges || []) {
    for(const id of [edge.source,edge.target]) {
      if(!adjacent.has(id))adjacent.set(id,[]);
      adjacent.get(id).push(edge);
    }
  }
  return {nodes,adjacent};
}
export function neighbourhood(snapshot,root,depth=1,limit=25) {
  const {nodes,adjacent}=graphIndex(snapshot), found=new Set(nodes.has(root)?[root]:[]), distances=new Map([[root,0]]);
  let frontier=[root];
  for(let step=0;step<Math.min(2,Math.max(1,depth));step++) {
    const next=[];
    for(const id of frontier) {
      const edges=[...(adjacent.get(id)||[])].sort((a,b)=>(a.relation==='contains')-(b.relation==='contains') || a.relation.localeCompare(b.relation));
      for(const edge of edges) {
        const other=edge.source===id?edge.target:edge.source;
        if(nodes.has(other)&&!found.has(other)) {found.add(other);distances.set(other,step+1);next.push(other);}
      }
    }
    frontier=next;
  }
  const kept=[...found].slice(0,limit), visible=new Set(kept);
  return {nodes:kept.map(id=>nodes.get(id)),edges:(snapshot.edges||[]).filter(e=>visible.has(e.source)&&visible.has(e.target)),
    hidden:Math.max(0,found.size-kept.length),total:found.size,distances};
}
export function searchNodes(snapshot,query='',kind='',origin='') {
  const q=query.trim().toLowerCase();
  return (snapshot.nodes||[]).filter(n=>(!kind||n.kind===kind||(kind==='character'&&['identity','character-class'].includes(n.kind)))
    &&(!origin||n.origin===origin)&&(!q||[n.label,n.map,n.cls,n.kind].join(' ').toLowerCase().includes(q)))
    .sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
}
export function selectedRoot(snapshot,context={}) {
  return (context.actor && snapshot.nodes?.find(n=>n.actor?.toLowerCase()===context.actor.toLowerCase()&&n.map?.toLowerCase()===context.map?.toLowerCase())?.id)
    || snapshot.nodes?.find(n=>n.kind==='map'&&n.label.toLowerCase()===context.map?.toLowerCase())?.id
    || snapshot.nodes?.find(n=>n.kind==='character')?.id || snapshot.nodes?.[0]?.id || '';
}

// Human-facing views retain the original edge IDs and evidence. A path is a
// chain of references, never an inferred execution sequence or impact verdict.
export const overviewGroups = [
  {id:'dialogue',label:'Dialogues',link:'has dialogue references'},
  {id:'behaviour',label:'Behaviour',link:'has behaviour references'},
  {id:'states',label:'Story states',link:'has state references'},
  {id:'appearances',label:'Other appearances',link:'shares a class or identity'},
];
export function nodeTitle(node) {
  return node?.kind==='character'
    ? (node.displayName || node.cls || node.label).replace(/([a-z])([A-Z])/g,'$1 $2')
    : node?.label || 'Unknown reference';
}
export function nodeKind(node) {
  return ({character:'Character in this map','character-class':'Shared character class',identity:'Dialogue identity',
    flag:'Story state',script:'Script',conversation:'Game dialogue',dialogue:'Editor dialogue',event:'Interaction',
    'engine-tag':'Engine tag','scripting-tag':'Scripting tag',map:'Map',object:'Object'})[node?.kind] || node?.kind || 'Reference';
}
export function relationLabel(edge,from=edge.source) {
  const forward=from===edge.source;
  const pair=({
    'contains':['contains','is in'], 'instance of':['uses the class','is the class used by'],
    'dialogue identity':['uses this dialogue identity','is the dialogue identity of'],
    'original conversation':['identifies the speaker in','uses this speaker identity'],
    'uses character class':['references this character class','is referenced by this script'],
    'reads state':['is checked by','checks this state'], 'writes state':['sets this state','is set by'],
    'mission script':['runs this mission script','is the mission script for'],
    'inherits':['inherits logic from','provides inherited logic to'],
    'references runtime logic':['references this logic','is referenced by'],
    'mentions map':['mentions this map','is mentioned by'], 'travels to':['travels to','is a travel destination for'],
    'native receiver':['can trigger this receiver','receives this engine event'],
    'fires event':['fires this engine event','can be fired by'],
    'fires failevent':['fires this event on failure','can be fired on failure by'],
    'fires native event':['fires this engine event','can be fired by'],
    'logical tag':['has this scripting tag','labels this object'],
    'targets logical tag':['targets objects with this tag','is targeted by'],
    'speaker':['uses this speaker','speaks in'], 'triggered by':['is triggered by','triggers this interaction'],
    'waits for outcome':['waits for this character outcome','has an outcome checked by'],
    'saved area member':['includes this saved recipient','is a saved recipient of'],
    'authored story':['contains this story rule','is authored in'], 'interaction':['contains this interaction','is authored in'],
  })[edge.relation];
  if(pair)return pair[forward?0:1];
  if(edge.relation.startsWith('replaces in '))return forward?'replaces this dialogue':'is replaced by';
  if(edge.relation.startsWith('changes ') || edge.relation.startsWith('action: '))return forward?'acts on this object':'is acted on by';
  return forward?'references':'is referenced by';
}
export function pathScope(path,index) {
  if(path.edges.some(e=>e.relation==='uses character class'))return 'Shared script; may concern other actors or maps.';
  if(path.nodes.slice(1).some(id=>index.nodes.get(id)?.kind==='character'))return 'Separate instance; shared class or dialogue identity only.';
  if(path.nodes.some(id=>index.nodes.get(id)?.kind==='identity'))return 'Shared dialogue identity; availability may depend on the mission and its conditions.';
  return 'Reference chain; not an execution order or a guaranteed outcome.';
}
// Do not walk through maps, states, other actors or generic runtime libraries:
// those hubs would turn Anna's overview into the whole campaign. Expose them
// as endpoints; their direct links remain available in Details for exploration.
export function groupedOverview(index,anchor) {
  const paths=new Map(), groups=overviewGroups.map(g=>({...g,items:[]}));
  const start=index.nodes.get(anchor);
  if(!start)return {groups,paths};
  if(start.kind!=='character')groups[3]={id:'appearances',label:'Characters & maps',link:'has map or character references',items:[]};
  const queue=[{nodes:[anchor],edges:[]}];paths.set(anchor,queue[0]);
  function canExpand(path,node) {
    if(path.edges.length===0)return true;
    if(path.edges.length>=4)return false;
    return ['identity','character-class','script','event','dialogue','conversation','engine-tag','scripting-tag'].includes(node.kind);
  }
  for(let i=0;i<queue.length;i++) {
    const path=queue[i],at=path.nodes.at(-1),node=index.nodes.get(at);
    if(!canExpand(path,node))continue;
    for(const edge of index.adjacent.get(at)||[]) {
      const next=edge.source===at?edge.target:edge.source,other=index.nodes.get(next);
      if(!other||paths.has(next))continue;
      // Containment is metadata, not a dependency of every actor in the room.
      if(edge.relation==='contains' && at!==anchor)continue;
      if(node.kind==='map' && at!==anchor)continue;
      if(node.kind==='script' && !['reads state','writes state','uses character class','travels to','mentions map'].includes(edge.relation))continue;
      // A dialogue may be used by many identities; do not expand to unrelated speakers.
      if(['conversation','dialogue'].includes(node.kind) && other.kind==='identity' && at!==anchor)continue;
      if(other.kind==='character-class' && path.edges.length>0)continue;
      const entry={nodes:[...path.nodes,next],edges:[...path.edges,edge]};
      paths.set(next,entry);queue.push(entry);
    }
  }
  for(const [id,path] of paths) {
    if(id===anchor)continue;
    const n=index.nodes.get(id);let group;
    if(['identity','conversation','dialogue'].includes(n.kind))group='dialogue';
    else if(n.kind==='flag')group='states';
    else if(n.kind==='character')group=path.edges.every(e=>['instance of','dialogue identity'].includes(e.relation))?'appearances':'behaviour';
    else if(n.kind==='map')group=start.kind==='character'?null:'appearances';
    else if(n.kind!=='character-class')group='behaviour';
    if(group)groups.find(g=>g.id===group).items.push({node:n,path});
  }
  for(const group of groups)group.items.sort((a,b)=>{
    // Recorded states named for this identity first, without inventing a link.
    const names=[start.cls,start.label].filter(Boolean).map(s=>s.toLowerCase());
    const score=n=>group.id==='states'&&names.some(s=>n.label.toLowerCase().startsWith(s))?0:1;
    return score(a.node)-score(b.node)||a.path.edges.length-b.path.edges.length||a.node.label.localeCompare(b.node.label)||a.node.id.localeCompare(b.node.id);
  });
  return {groups,paths};
}
