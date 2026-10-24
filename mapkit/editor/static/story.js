import {configureStateEditor, mountStateField} from './state-editor.js';
import {stateLabel, normalizeCatalog} from './state-model.js';
import {collectDraftStates, conditionProblems, conditionRows, removeCondition} from './story-state.js';
import {createSaveQueue} from './save-state.js';
// "Story" panel of the map editor: dialogues attached to the characters and objects of the map, InfoLinks
// (one-way radio calls) and the events of the mission. Saved in tools/mapkit/story/<map>.json; "Apply in game" turns them into
// UnrealScript (tools/mapkit/story.py), compiles the mod and installs it.
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const E = () => window.__editor;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let story = null, flags = [], items = [], current = null, mapLoaded = null, dirty = false, mapCode = '';
let catalogFlags = [], storyLoad=null, loadEpoch=0;
let revision = 0;
const saveQueue = createSaveQueue();
let voices = {}, soundsPkg = 'UCSounds';        // the voices given to lines (/api/dubs): key -> {seconds}
const MAX_ANSWERS = 6;

const STEP_TYPES = {
  line: 'Line', choice: 'JC\'s answers (choice)', label: 'Label (jump target)', if: 'Check a condition',
  goto: 'Go to a label', flag: 'Change state', goal: 'Goal', trigger: 'Trigger an event (Tag)',
  give: 'Give JC an item', do: 'Actions (when the dialogue ends)', end: 'End of dialogue',
  credits: 'Give or take credits', skillpoints: 'Award skill points', checkitem: 'Check inventory',
  checkvalue: 'Check credits, health or skill points', random: 'Branch selection',
  animation: 'Play an animation', trade: 'Trade', note: 'Datavault note',
};
const ACTION_TYPES = {
  flag: 'Change state', goal: 'Goal', note: 'Datavault note', message: 'On-screen message',
  talk: 'Start a dialogue', trigger: 'Trigger an event (Tag)',
  npc: 'A character...', faction: 'A faction...', door: 'A door...', travel: 'Take JC to another map', infolink: 'Play an InfoLink',
  cutscene: 'Play a cutscene',
};
// the cutscene cameras of the map (cutscene.js): [name, title]
function cutscenes() {
  const ed = E();
  return ((ed && ed.edits.added) || []).filter((a) => a.cls === 'UCCutscene' && !(ed.edits.deleted || {})[a.name])
    .map((a) => [a.name, ((ed.edits.cutscenes || {})[a.name] || {}).title || a.name]);
}
// InfoLink callers with a portrait in the game (InfoPortraits.<bind name>, or the mod's UCPortraits)
const CALLERS = [
  ['AlexJacobson', 'Alex Jacobson'], ['WaltonSimons', 'Walton Simons'], ['Jock', 'Jock'], ['PaulDenton', 'Paul Denton'],
  ['SamCarter', 'Sam Carter'], ['JaimeReyes', 'Jaime Reyes'], ['AnnaNavarre', 'Anna Navarre'], ['GuntherHermann', 'Gunther Hermann'],
  ['TracerTong', 'Tracer Tong'], ['BobPage', 'Bob Page'], ['BobPageAug', 'Bob Page (augmented)'], ['MorganEverett', 'Morgan Everett'],
  ['GarySavage', 'Gary Savage'], ['StantonDowd', 'Stanton Dowd'], ['Daedalus', 'Daedalus'], ['Icarus', 'Icarus'],
];
const ident = (s) => String(s || '').replace(/\W/g, '_');
const NPC_ACTS = {
  goto: 'walks to a point', run: 'runs to a point', stop: 'stops where they are', wander: 'wanders around the area',
  follow: 'follows JC', hostile: 'becomes hostile to JC (attacks when he sees him)', attack: 'attacks JC right now',
  neutral: 'becomes neutral to JC', friend: 'becomes friendly to JC',
  hide: 'vanishes (once JC can\'t see them)', show: 'reappears (once JC can\'t see their spot)', join: 'joins a faction',
};
const FACTION_ACTS = { hostile: 'becomes hostile', neutral: 'becomes neutral', friendly: 'becomes friendly' };
const facInput = (v, key = 'faction', ph = 'faction, e.g. RedArrow') => `<input type="text" data-k="${key}" list="factionlist" value="${esc(v)}" placeholder="${ph}" style="max-width:170px">`;
const DOOR_ACTS = { open: 'opens', close: 'closes', lock: 'locks', unlock: 'unlocks', blow: 'blows up' };

// ---------------------------------------------------------------- page
const css = `
#story { position:fixed; inset:52px calc(var(--rw, 280px) + 10px) 10px calc(var(--lw, 250px) + 10px); background:#1a1d24f7; border:1px solid #2c313b; border-radius:8px; z-index:8; display:none; flex-direction:column; }
#story.open { display:flex; }
#story .st-head { display:flex; gap:8px; align-items:center; padding:8px 12px; border-bottom:1px solid #2c313b; }
#story .st-body { flex:1; display:flex; min-height:0; }
#story .st-list { width:230px; border-right:1px solid #2c313b; overflow:auto; padding:6px 8px; }
#story .st-list h4 { margin:10px 4px 4px; font-size:12px; color:#8b93a3; text-transform:uppercase; letter-spacing:.05em; }
#story .st-list .it { display:block; width:100%; text-align:left; margin:2px 0; padding:5px 8px; }
#story .st-list .it.on { border-color:#5aa2ff; background:#22314a; }
#story .st-list .it small { display:block; color:#8b93a3; }
#story .st-edit { flex:1; overflow:auto; padding:10px 14px; }
#story .st-edit .f { display:flex; gap:8px; align-items:center; margin:6px 0; flex-wrap:wrap; }
#story .st-edit .f > label:first-child { width:110px; color:#8b93a3; }
#story .st-edit input[type=text], #story .st-edit textarea { flex:1; min-width:160px; }
#story .st-edit textarea { min-height:44px; resize:vertical; font:inherit; color:inherit; background:#262a33; border:1px solid #2c313b; border-radius:5px; padding:5px 8px; }
#story .card { border:1px solid #2c313b; border-radius:6px; margin:6px 0; padding:6px 8px; background:#1f232b; }
#story .card .ch { display:flex; gap:6px; align-items:center; color:#8b93a3; font-size:12px; }
#story .card .ch b { color:#d9dde5; font-weight:600; flex:1; }
#story .card .ch button { padding:1px 7px; }
#story .card.line { border-left:3px solid #5aa2ff; } #story .card.choice { border-left:3px solid #ffb347; }
#story .card.give { border-left:3px solid #ff7a7a; } #story .card.do { border-left:3px solid #4fd1c5; }
#story .card .card { background:#252a33; }
#story .card.info { border-left:3px solid #f5d76e; }
#story .card.label { border-left:3px solid #6bd68a; } #story .card.if, #story .card.goto { border-left:3px solid #c08aff; }
#story .st-log { max-height:110px; overflow:auto; padding:6px 12px; border-top:1px solid #2c313b; font:12px/1.35 Consolas, monospace; color:#8b93a3; white-space:pre-wrap; }
#story .loc { display:inline-flex; align-items:center; padding:4px 6px; flex:none; }
#story .loc svg { width:15px; height:15px; }
#story .loc:disabled { opacity:.35; }
/* "who is this?": the panel steps aside to a bar above the browser, the character is shown in the 3D view */
#story .st-peek { display:none; align-items:center; gap:10px; padding:8px 12px; }
#story.peek { inset:auto calc(var(--rw, 280px) + 10px) calc(var(--bh, 230px) + 10px) calc(var(--lw, 250px) + 10px); box-shadow:0 6px 24px #000a; }
#story.peek .st-head, #story.peek .st-body, #story.peek .st-log { display:none; }
#story.peek .st-peek { display:flex; }
#story .tip { color:#8b93a3; margin:4px 0 8px; }
#story .st-condition-list { flex:1; min-width:180px; }
#story .st-condition-row { display:flex; align-items:flex-start; gap:6px; margin:5px 0; }
#story .st-state-field { flex:1; min-width:170px; }
#story .st-condition-row > button { flex:none; }
#story .st-condition-list > .tip { font-size:11px; margin:3px 0; }
#story .st-choice-req { flex-basis:100%; }
#story .st-choice-advanced { flex-basis:100%; }
#story .st-state-catalog > details { padding:7px 0; border-bottom:1px solid var(--line); }
#story .st-state-catalog summary { cursor:pointer; }
#story .st-state-catalog code { display:block; overflow-wrap:anywhere; font-size:11px; color:var(--dim); }
#story .st-state-catalog .tip { font-size:11px; }
#story #st-state-search { flex:1; min-width:180px; max-width:none; width:auto; }
`;
const styleEl = document.createElement('style');
styleEl.textContent = css;
document.head.appendChild(styleEl);
const root = document.createElement('div');
root.id = 'story';
root.innerHTML = `
  <div class="st-head"><b>Map story</b><span id="st-map" style="color:#8b93a3"></span>
    <label style="margin-left:12px">Applies <select id="st-route"><option value="unatco">only on the UNATCO route</option><option value="always">always</option></select></label>
    <span style="flex:1"></span>
    <button id="st-save">Save</button>
    <button id="st-apply" class="primary" title="Saves, generates the mod code, compiles and installs it (about 2 minutes, with the game closed)">Apply in game</button>
    <button id="st-close">Close</button></div>
  <div class="st-body">
    <div class="st-list">
      <h4>Dialogues</h4><div id="st-dlist"></div><button class="it" id="st-newd">+ New dialogue</button>
      <h4>Original conversations</h4><div id="st-originals"></div>
      <h4>InfoLinks</h4><div id="st-ilist"></div><button class="it" id="st-newi">+ New InfoLink</button>
      <h4>Events</h4><div id="st-elist"></div><button class="it" id="st-newe">+ New event</button>
      <h4>Story state</h4><button class="it" id="st-state">Flags &amp; conditions</button>
      <div class="tip" style="margin-top:12px">A <b>dialogue</b> belongs to a character or an object: it starts when JC talks to it or gets close.<br>
      An <b>InfoLink</b> is a radio call: only the caller speaks, JC never answers. An event or a dialogue plays it.<br>
      An <b>event</b> happens when JC reaches a point, when a condition is met or when the map starts.<br>
      <b>Flags</b> are the story's memory: one dialogue sets them, another one requires them.</div>
    </div>
    <div class="st-edit" id="st-edit"></div>
  </div>
  <div class="st-log" id="st-log"></div>
  <div class="st-peek"><span>Showing <b id="st-peekname"></b></span>
    <span class="tip" style="margin:0">selected in the 3D view, its properties on the right</span>
    <span style="flex:1"></span><button id="st-back" class="primary">Back to the story</button></div>`;
document.body.appendChild(root);
const LOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/></svg>';
const locButton = (attr, title = 'Show who this is in the 3D view') => `<button class="loc" ${attr} title="${title}">${LOC_ICON}</button>`;
const flagList = document.createElement('datalist');
flagList.id = 'st-flags';
document.body.appendChild(flagList);
const goalList = document.createElement('datalist');
goalList.id = 'st-goals'; document.body.appendChild(goalList);
const noteList = document.createElement('datalist');
noteList.id = 'st-notes'; document.body.appendChild(noteList);
const mapList = document.createElement('datalist');
mapList.id = 'st-maps';
document.body.appendChild(mapList);
function refreshMaps() {
  const names = new Set();
  for (const s of document.querySelectorAll('select')) for (const o of s.options) if (/^\d\d_\w+$/.test(o.textContent.trim())) names.add(o.textContent.trim());
  mapList.innerHTML = [...names].sort().map((m) => `<option value="${esc(m)}">`).join('');
}

function log(lines, cls) {
  const el = $('#st-log');
  el.innerHTML += (Array.isArray(lines) ? lines : [lines]).map((l) => `<div class="${cls || ''}">${esc(l)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}
function changed() { revision++; dirty = true; $('#st-save').textContent = 'Save *'; renderLists(); }

// ---------------------------------------------------------------- data
async function ensure() {
  const ed=E(), script=ed?.script;
  if(!script) return false;
  if(mapLoaded===script && story) return true;
  if(storyLoad?.script===script) return storyLoad.promise;
  const epoch=++loadEpoch;
  const promise=(async()=>{
    const response=await fetch('/api/story?script='+encodeURIComponent(script));
    const r=await response.json();
    if(!response.ok) throw Error(r.error || 'Could not read this story.');
    const [catalogResult,voiceResult]=await Promise.allSettled([
      fetch('/api/state_catalog').then(async response=>response.ok ? (await response.json()).flags || [] : []),
      fetch('/api/dubs').then(async response=>response.ok ? response.json() : {})
    ]);
    if(epoch!==loadEpoch || E()?.script!==script) return false;
    story=r.story; story.dialogues ||= []; story.events ||= []; story.infolinks ||= [];
    mapCode=r.code || ''; flags=r.flags || []; items=r.items || [];
    catalogFlags=catalogResult.status==='fulfilled' ? catalogResult.value : [];
    const v=voiceResult.status==='fulfilled' ? voiceResult.value : {};
    voices=v.voices || {}; soundsPkg=v.package || soundsPkg;
    mapLoaded=script; current=null; dirty=false;
    revision++; $('#st-save').textContent='Save';
    $('#st-map').textContent=' · '+r.map;
    $('#st-route').value=story.route || 'unatco';
    if(ed.standalone){$('#st-route').value='always';$('#st-route').closest('label').style.display='none';}
    refreshFlags(); refreshMaps(); mapsAll().catch(()=>{});
    return true;
  })();
  storyLoad={script,promise};
  try{return await promise;}finally{if(storyLoad?.promise===promise)storyLoad=null;}
}
function refreshFlags() {
  const all = new Set(flags);
  for (const f of Object.keys(window.__gamecons?.data?.flags || {})) all.add(f);
  const missionFlags=window.__missionFlags?.data?.flags || {};
  for(const [f,uses] of Object.entries(missionFlags)) if(uses.some(r=>r.type==='bool')) all.add(f);
  const walk = (o) => { if (!o || typeof o !== 'object') return; if (typeof o.flag === 'string' && o.flag) all.add(o.flag); Object.values(o).forEach(walk); };
  walk(story);
  for (const d of story.dialogues) all.add(playedFlag(d));
  for (const il of story.infolinks) all.add(heardFlag(il));
  const originals = window.__gamecons?.data;
  flagList.innerHTML = [...all].sort().map((f) => `<option value="${esc(f)}" label="${esc([missionFlags[f]?.map(r=>`${r.cls} · ${r.function}:${r.line} (${r.operation})`).slice(0,2).join('; '), originals?.flags[f]?.slice(0,3).join(', ')].filter(Boolean).join(' | ') || 'Your story')}">`).join('');
  goalList.innerHTML = Object.entries(originals?.goals || {}).map(([name, uses]) => `<option value="${esc(name)}" label="${esc(uses.map(u=>u.conversation).slice(0,3).join(', '))}">`).join('');
  noteList.innerHTML = Object.entries(originals?.notes || {}).map(([text, uses]) => `<option value="${esc(text)}" label="${esc(uses.slice(0,3).join(', '))}">`).join('');
}
// what an object added in the editor is called in the lists: a character's own name, else its class in words
const NOT_TALKERS = /^(PathNode|PatrolPoint|HidePoint|WanderPoint|AmbushPoint|Teleporter|PlayerStart|Light|Spotlight|TriangleLight|AmbientSound|UCSoundFX|ZoneInfo|UCScript\w*|UCTimer|UCEffectPoint|UCCutscene|UCTriggerBox|Trigger)$/;
function addedLabel(a) {
  const fam = String((a.props || {}).FamiliarName || '').replace(/^"|"$/g, '');
  return fam || String(a.cls || '').replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}
function talkers() {          // characters first, then objects: the actors that can have a conversation
  const ed = E();
  const added = ed.added || [], names = new Set(added.map((a) => a.name)), deleted = (ed.edits && ed.edits.deleted) || {};
  // the built map's copy of an object also in the editor's list, deleted, or added here and deleted since: once
  const base = (ed.baseActors || []).filter((a) => a.talker && !names.has(a.name) && !deleted[a.name] && !/^UCEdit\d+$/.test(a.name));
  const list = base.concat(added.filter((a) => !NOT_TALKERS.test(a.cls || ''))
    .map((a) => Object.assign({ talker: true, kind: /Custom|Male|Female|Bum|Scientist|Troop|Soldier|Thug|Pawn/i.test(a.cls) ? 'pawn' : 'prop', label: addedLabel(a) }, a)));
  return list.sort((a, b) => (a.kind === 'pawn' ? 0 : 1) - (b.kind === 'pawn' ? 0 : 1) || a.name.localeCompare(b.name));
}
// where an actor of the map is: the structure it belongs to ("Helipad", "Roof access", "Dock"...)
function areaOf(name) {
  for (const s of Object.values(E().structures || {})) if ((s.actors || []).includes(name)) return String(s.label || '').split(/[(:]/)[0].trim();
  return '';
}
function actorLabel(a) {
  if (!a) return '?';
  const area = areaOf(a.name);
  return `${a.name}${a.label ? ' (' + a.label + ')' : ''}${a.bind ? ' · ' + a.bind : ''}${area ? ' — ' + area : ''}`;
}
function bindOf(name) {
  const a = talkers().find((x) => x.name === name);
  return (a && a.bind) || ('UCEd_' + String(name || '').replace(/\W/g, '_'));
}
// "who is this?": the character (or object, or door) selected and framed in the 3D view, the panel
// shrunk to a bar so the view shows; "Back to the story" (or Esc) brings it back as it was
function locate(name) {
  if (!name) { log('Choose who it is first.', 'warn'); return; }
  const a = talkers().concat(doors()).find((x) => x.name === name);
  E().selectActor(name);
  $('#st-peekname').textContent = a ? actorLabel(a) : name;
  root.classList.add('peek');
}
function unpeek() { root.classList.remove('peek'); }
function playedFlag(d) { return d.replaces ? `${d.replaces}_Played` : `UCEd${mapCode}_${ident(d.id)}_Played`; }
function heardFlag(il) { return `UCEd${mapCode}_${ident(il.id)}_Heard`; }
function nextId(prefix, list) { let i = 1; while (list.some((x) => x.id === prefix + i)) i++; return prefix + i; }
function labelsOf(d) { return (d.steps || []).filter((s) => s.type === 'label' && s.name).map((s) => s.name); }

// ---------------------------------------------------------------- lists
function renderLists() {
  window.__gamecons?.renderStoryList();
  refreshFlags();
  $('#st-dlist').innerHTML = story.dialogues.map((d, i) => `<button class="it ${current && current.kind === 'd' && current.i === i ? 'on' : ''}" data-d="${i}">${esc(d.title || d.id)}<small>${esc(d.owner || 'nobody')} · ${plural((d.steps || []).filter((s) => s.type === 'line').length, 'line')}</small></button>`).join('')
    || '<div class="tip">No dialogues yet.</div>';
  $('#st-ilist').innerHTML = story.infolinks.map((il, i) => `<button class="it ${current && current.kind === 'i' && current.i === i ? 'on' : ''}" data-i="${i}">${esc(il.title || il.id)}<small>${esc(il.name || il.caller || '?')} · ${plural((il.lines || []).length, 'line')}</small></button>`).join('')
    || '<div class="tip">No InfoLinks yet.</div>';
  $('#st-elist').innerHTML = story.events.map((e, i) => `<button class="it ${current && current.kind === 'e' && current.i === i ? 'on' : ''}" data-e="${i}">${esc(e.title || e.id)}<small>${esc(whenText(e.when))}</small></button>`).join('')
    || '<div class="tip">No events yet.</div>';
  for (const b of root.querySelectorAll('[data-d]')) b.onclick = () => { current = { kind: 'd', i: +b.dataset.d }; render(); };
  for (const b of root.querySelectorAll('[data-e]')) b.onclick = () => { current = { kind: 'e', i: +b.dataset.e }; render(); };
  for (const b of root.querySelectorAll('[data-i]')) b.onclick = () => { current = { kind: 'i', i: +b.dataset.i }; render(); };
}
function whenText(w) {
  w = w || {};
  if (w.type === 'near') return `JC comes within ${w.radius || 256} of a point`;
  if (w.type === 'flag') return `${stateLabel(w,true,allMaps || [])}${/^UCFate/i.test(w.flag || '')?'':w.is===false?' · No':' · Yes'}`;
  if (w.type === 'dead') return `dies: ${w.actor || '?'}`;
  if (w.type === 'item') return `JC has ${String(w.item || '?').split('.').pop()}`;
  if (w.type === 'hostile') return `${w.faction || '?'} turns hostile`;
  return 'at map start';
}

// ---------------------------------------------------------------- widgets
// One state selector is shared by Story, Interactions and Play.
let allMaps = null;
const peopleCache = {};
function thisMap() { return E()?.mapName || ''; }
async function mapsAll() {
  if (!allMaps) { try { allMaps = (await (await fetch('/api/newmap_info')).json()).maps || []; } catch (_) { allMaps = []; } }
  if (thisMap() && !allMaps.includes(thisMap())) allMaps.unshift(thisMap());
  return allMaps;
}
async function peopleOf(map) {
  if (map === thisMap()) {
    const ed=E(), kit=ed?.cutKit;
    const actors=kit?.allActors ? kit.allActors().filter(a=>kit.isCharacter(a)) : pawns();
    return actors.filter(a=>!ed.edits?.deleted?.[a.name] && !/Helicopter|PlayerStart/.test(a.cls || '')).map(a=>({name:a.name,label:actorLabel(a)}));
  }
  if (!peopleCache[map]) {
    const response = await fetch('/api/people?map=' + encodeURIComponent(map));
    if (!response.ok) throw Error('Could not read characters in this map.');
    peopleCache[map] = (await response.json()).people || [];
  }
  return peopleCache[map].map(x => ({name:x.name,label:x.label ? `${x.label} (${x.name})` : x.name}));
}
function stateCatalog() {
  const map = thisMap(), entries = [];
  const add = (flag, context, kind='read', extra={}) => {
    if (typeof flag === 'string' && flag.trim()) entries.push({flag,type:'bool',source:'project',uses:context?[{map,context,kind}]:[],...extra});
  };
  // Replace saved uses from the open map with the draft, so unsaved changes are searchable.
  for (const item of catalogFlags) entries.push({...item,uses:(item.uses || []).filter(u => u.map !== map)});
  entries.push(...collectDraftStates(story,map,{playedFlag,heardFlag},E()?.edits?.links || []));
  for (const [flag, uses] of Object.entries(window.__gamecons?.data?.flags || {})) add(flag,null,'read',{source:'original',category:'original',uses:uses.map(context=>({map,context:String(context),kind:'reference'}))});
  for (const [flag, uses] of Object.entries(window.__missionFlags?.data?.flags || {})) {
    const type=uses.every(u=>u.type==='bool') ? 'bool' : uses.find(u=>u.type!=='bool')?.type || 'bool';
    add(flag,null,'read',{source:'original',category:'original',type,readonly:type!=='bool',uses:uses.map(u=>({map,context:`${u.cls} · ${u.function}:${u.line} (${u.operation})`,kind:'reference'}))});
  }
  const indexed=new Set(entries.map(e=>e.flag.toLowerCase()));
  for(const flag of flags) if(!indexed.has(flag.toLowerCase())) add(flag);
  return normalizeCatalog(entries);
}
configureStateEditor({
  getCatalog: async () => { if(!(await ensure())) throw Error('Open a map first.'); return stateCatalog(); },
  getMaps: mapsAll, getPeople: peopleOf, getCurrentMap: thisMap,
  getSelectedPerson: () => { const ed=E(), a=ed?.selected?.userData?.actor; return a && (ed.cutKit?.isCharacter(a) || a.kind==='pawn') ? {map:thisMap(),name:a.name,label:actorLabel(a)} : null; },
});
function stateField(host,value,mode='check',options={}) {
  return mountStateField(host,value,{mode,onChange:()=>{changed();refreshFlags();},...options});
}
function renderStateCatalog(el) {
  el.innerHTML='<h3>Flags &amp; conditions</h3><p class="tip">The same story state is used by dialogues, events and interactions. Character outcomes are flags too.</p><div class="f"><input id="st-state-search" aria-label="Search story state" placeholder="Search names, maps or uses"><select id="st-state-filter" aria-label="State source"><option value="">All sources</option><option value="project">Your story</option><option value="automatic">Automatic</option><option value="original">Original game</option></select></div><div class="st-state-catalog"></div>';
  const results=el.querySelector('.st-state-catalog');
  const draw=()=>{
    const q=el.querySelector('#st-state-search').value.toLowerCase().trim(), source=el.querySelector('#st-state-filter').value;
    const entries=stateCatalog().filter(x=>(!source || x.source===source) && `${x.name} ${x.label || ''} ${(x.references || []).map(u=>`${u.map || ''} ${u.context || u}`).join(' ')}`.toLowerCase().includes(q));
    results.innerHTML=entries.slice(0,100).map(x=>`<details><summary>${esc(/^UCFate/i.test(x.name) ? stateLabel(x.name,true,allMaps || []) : x.label || x.name)} <small>· ${esc(x.source || 'project')}${!x.selectable?' · reference only':''}</small></summary><code>${esc(x.name)}</code><p class="tip">${(x.references || []).map(u=>`${esc(u.kind || 'used')} · ${esc(u.context || u)}${u.map?' · '+esc(u.map):''}`).join('<br>') || 'Known flag; no authored use found in this project.'}</p></details>`).join('') || '<p class="tip">No matching state. Create one from a condition or Change state action.</p>';
    if(entries.length>100) results.insertAdjacentHTML('beforeend','<p class="tip">Showing 100 matches. Refine the search to see more.</p>');
  };
  el.querySelector('#st-state-search').oninput=draw;el.querySelector('#st-state-filter').onchange=draw;el.refreshStateCatalog=draw;draw();
}
function labelSelect(d, v, key = 'goto') {
  const labels = labelsOf(d);
  return `<select data-k="${key}"><option value="">(choose)</option>${labels.map((l) => `<option ${l === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
function itemSelect(v) {                          // weapons, ammo, pickups (pkg.Class)
  const cats = [...new Set(items.map((x) => x.cat))];
  return `<select data-k="item" style="max-width:420px"><option value="">(choose the item)</option>${cats.map((c) => `<optgroup label="${esc(c)}">${items.filter((x) => x.cat === c).map((x) => `<option value="${esc(x.cls)}" ${x.cls === v ? 'selected' : ''}>${esc(x.name)} · ${esc(x.cls.split('.').pop())}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
function pawns() { return talkers().filter((a) => a.kind === 'pawn'); }
function doors() { return (E().baseActors || []).filter((a) => a.kind === 'mover').sort((a, b) => a.name.localeCompare(b.name)); }
function actorSelect(list, v, what) {
  return `<select data-k="actor" style="max-width:300px"><option value="">(${what})</option>${list.map((a) => `<option value="${esc(a.name)}" ${a.name === v ? 'selected' : ''}>${esc(actorLabel(a))}</option>`).join('')}</select>`;
}
function optSelect(map, v, key = 'act') {
  return `<select data-k="${key}">${Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}
// a point: X Y Z + the selected object / the point in front of the camera
function pointHtml(at) {
  at = at || [0, 0, 0];
  return `<div class="f st-point">point X <input type="number" data-pi="0" value="${at[0]}" style="width:80px"> Y <input type="number" data-pi="1" value="${at[1]}" style="width:80px"> Z <input type="number" data-pi="2" value="${at[2]}" style="width:80px">
    <button data-psel="1">Use the selected object</button><button data-pcam="1">Use the point in front of the camera</button></div>`;
}
function wirePoint(el, obj, redraw) {
  const box = el.querySelector('.st-point');
  if (!box) return;
  obj.at = obj.at || [0, 0, 0];
  for (const i of box.querySelectorAll('[data-pi]')) i.oninput = () => { obj.at[+i.dataset.pi] = +i.value; changed(); };
  box.querySelector('[data-psel]').onclick = () => { const p = E().selectedLoc(); if (!p) { log('Select an object in the scene.', 'warn'); return; } obj.at = p; changed(); redraw(); };
  box.querySelector('[data-pcam]').onclick = () => { obj.at = E().cameraPoint(160); changed(); redraw(); };
}

// ---------------------------------------------------------------- actions (events, and dialogues when they end)
function actionBody(a) {
  if (a.type === 'flag') return '<div class="st-state-field"></div>';
  if (a.type === 'goal') return `<div class="f">name <input type="text" data-k="goal" list="st-goals" value="${esc(a.goal)}" style="max-width:180px"> text <input type="text" data-k="text" value="${esc(a.text)}"> <label><input type="checkbox" data-k="done" ${a.done ? 'checked' : ''}> completed</label></div>`;
  if (a.type === 'note' || a.type === 'message') return `<div class="f"><input type="text" data-k="text" ${a.type === 'note' ? 'list="st-notes"' : ''} value="${esc(a.text)}" placeholder="the text"></div>`;
  if (a.type === 'talk') return `<div class="f"><select data-k="dialogue"><option value="">(choose)</option>${story.dialogues.map((d) => `<option value="${esc(d.id)}" ${d.id === a.dialogue ? 'selected' : ''}>${esc(d.title || d.id)}</option>`).join('')}</select></div>`;
  if (a.type === 'trigger') return `<div class="f">Tag <input type="text" data-k="tag" value="${esc(a.tag)}"></div>`;
  if (a.type === 'cutscene') return `<div class="f"><select data-k="cutscene"><option value="">(choose)</option>${cutscenes().map(([n, t]) => `<option value="${esc(n)}" ${n === a.cutscene ? 'selected' : ''}>${esc(t)} (${esc(n)})</option>`).join('')}</select></div>`
    + (cutscenes().length ? '' : '<div class="tip" style="margin:2px 0">No cutscene in this map yet: + Cutscene in the bottom bar.</div>');
  if (a.type === 'infolink') return `<div class="f"><select data-k="infolink"><option value="">(choose)</option>${story.infolinks.map((il) => `<option value="${esc(il.id)}" ${il.id === a.infolink ? 'selected' : ''}>${esc(il.title || il.id)}</option>`).join('')}</select></div>`;
  if (a.type === 'npc') return `<div class="f">${actorSelect(pawns(), a.actor, 'who')}${locButton('data-aloc="1"')} ${optSelect(NPC_ACTS, a.act || 'goto')}</div>`
    + (a.act === 'goto' || a.act === 'run' ? pointHtml(a.at) + `<div class="f"><label title="The way a man would walk, on the walkable area (View > Walkable area), without path nodes; it goes into the map at Rebuild. Off: on the AI paths, as the game's characters go"><input type="checkbox" data-k="nav" ${a.nav ? 'checked' : ''}> on the walkable area</label></div>` : '')
    + (a.act === 'join' ? `<div class="f">faction ${facInput(a.faction)}</div>` : '')
    + (a.act === 'hostile' || a.act === 'attack' ? `<div class="f"><label><input type="checkbox" data-k="alone" ${a.alone ? 'checked' : ''}> alone: only this character</label></div>
      <div class="tip" style="margin:2px 0">Alone: they leave their faction, so when JC fights back the others neither help them nor turn on JC. Off: as in the game, their friends may join the fight. To turn a whole faction, use "A faction...".</div>` : '')
    + (a.act === 'hide' || a.act === 'show' ? '<div class="tip" style="margin:2px 0">As the rule goes: nobody vanishes or appears right in front of JC, it waits until JC can\'t see that spot. To make someone appear later, make them vanish first with an "at map start" event.</div>' : '');
  if (a.type === 'door') return `<div class="f">${actorSelect(doors(), a.actor, 'which door')}${locButton('data-aloc="1"', 'Show this door in the 3D view')} ${optSelect(DOOR_ACTS, a.act || 'open')}</div>`;
  if (a.type === 'faction') return `<div class="f">${facInput(a.faction)} ${optSelect(FACTION_ACTS, a.act || 'hostile')} towards ${facInput(a.toward || 'Player', 'toward', 'Player = JC')}
      <label><input type="checkbox" data-k="fixed" ${a.fixed ? 'checked' : ''}> fixed</label></div>
    <div class="tip" style="margin:2px 0">Every living member of the faction changes. Hostile members attack JC when they see him; fixed = it never changes again by itself.</div>`;
  if (a.type === 'travel') return `<div class="f">map <input type="text" data-k="map" list="st-maps" value="${esc(a.map)}" placeholder="06_HongKong_WanChai_Market" style="max-width:280px">
      arrival (Tag) <input type="text" data-k="tag" value="${esc(a.tag)}" placeholder="(map start)" style="max-width:200px"></div>`;
  return '';
}
function newAction(type) {
  if (type === 'flag') return { type, flag: '', is: true };
  if (type === 'npc') return { type, actor: '', act: 'goto', at: [0, 0, 0], nav: true };
  if (type === 'door') return { type, actor: '', act: 'open' };
  if (type === 'travel') return { type, map: '', tag: '' };
  if (type === 'faction') return { type, faction: '', act: 'hostile', toward: 'Player', fixed: false };
  return { type };
}
function renderActions(box, list) {
  const redraw = () => renderActions(box, list);
  box.innerHTML = (list.map((a, i) => `<div class="card act" data-a="${i}"><div class="ch"><b>${ACTION_TYPES[a.type] || a.type}</b><button data-ax="${i}" title="remove">✕</button></div>${actionBody(a)}</div>`).join('')
    || '<div class="tip">No actions: add one below.</div>')
    + `<div class="f"><select data-addact="1"><option value="">+ action...</option>${Object.entries(ACTION_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>`;
  list.forEach((a, i) => {
    const card = box.querySelector(`[data-a="${i}"]`);
    bindFields(card, a);
    if (a.type === 'flag') stateField(card.querySelector('.st-state-field'), a, 'set');
    const act = card.querySelector('select[data-k="act"]');
    if (act) act.addEventListener('change', redraw);
    const lb = card.querySelector('[data-aloc]');
    if (lb) lb.onclick = () => locate(a.actor);
    wirePoint(card, a, redraw);
  });
  for (const b of box.querySelectorAll('[data-ax]')) b.onclick = () => { list.splice(+b.dataset.ax, 1); changed(); redraw(); };
  const add = box.querySelector('[data-addact]');
  add.onchange = () => { if (!add.value) return; list.push(newAction(add.value)); changed(); redraw(); };
}
function actionProblems(list, where, out) {
  for (const a of list || []) {
    if ((a.type === 'npc' || a.type === 'door') && !a.actor) out.push(`${where}: a "${ACTION_TYPES[a.type]}" action with no ${a.type === 'npc' ? 'character' : 'door'}`);
    if (a.type === 'npc' && (a.act === 'goto' || a.act === 'run') && !(a.at || []).some((v) => v)) out.push(`${where}: missing the point ${a.actor || 'the character'} goes to`);
    if (a.type === 'travel' && !a.map) out.push(`${where}: missing the map to take JC to`);
    if (a.type === 'faction' && !a.faction) out.push(`${where}: missing the faction`);
    if (a.type === 'npc' && a.act === 'join' && !a.faction) out.push(`${where}: missing the faction ${a.actor || 'the character'} joins`);
    if (a.type === 'talk' && !a.dialogue) out.push(`${where}: missing the dialogue to start`);
    if (a.type === 'infolink' && !story.infolinks.some((il) => il.id === a.infolink)) out.push(`${where}: missing the InfoLink to play`);
    if (a.type === 'cutscene' && !cutscenes().some(([n]) => n === a.cutscene)) out.push(`${where}: missing the cutscene to play`);
    if ((a.type === 'flag') && !a.flag) out.push(`${where}: a flag with no name`);
  }
}
function addBranch(d) {                            // label + a line + end at the bottom: where an answer goes
  let k = 1;
  while (labelsOf(d).includes('answer' + k)) k++;
  d.steps = d.steps || [];
  d.steps.push({ type: 'label', name: 'answer' + k }, { type: 'line', who: 'npc', text: '' }, { type: 'end' });
  return 'answer' + k;
}
function bindFields(el, obj, onChange) {          // inputs with data-k write into obj
  for (const i of el.querySelectorAll('[data-k]')) {
    const k = i.dataset.k;
    const set = () => {
      let v = i.type === 'checkbox' ? i.checked : i.value;
      if (k === 'is') v = v === '1';
      if (i.type === 'number') v = +v;
      obj[k] = v;
      if (['text','who','caller','bind'].includes(k) && typeof obj.voice === 'object') {
        delete obj.voice;
        el.querySelector('.vbar .tip')?.replaceChildren(document.createTextNode('Text or speaker changed: choose a matching voice.'));
        el.querySelectorAll('[data-vplay],[data-vdel]').forEach(button=>button.disabled=true);
      }
      onChange && onChange();
      changed();
    };
    i.addEventListener(i.tagName === 'SELECT' || i.type === 'checkbox' ? 'change' : 'input', set);
  }
}
function condList(el, list, options={}) {
  const refs=conditionRows(list,options.primary);
  el.classList.add('st-condition-list');
  el.innerHTML=(refs.length ? '<p class="tip">'+(options.mode==='set'?'Change each state below.':'All conditions must match.')+'</p>' : '<p class="tip">No conditions — always available.</p>')
    + refs.map((r,i)=>`<div class="st-condition-row" data-c="${i}"><div class="st-state-field"></div><button data-del="${i}" aria-label="Remove condition" ${refs.length<=(options.minimum || 0)?'disabled title="Delete the whole step to remove its last condition"':''}>×</button></div>`).join('')
    + '<button data-add="1">'+(options.mode==='set'?'+ State change':'+ Condition')+'</button>';
  const fields=refs.map((r,i)=>stateField(el.querySelector(`[data-c="${i}"] .st-state-field`),r,options.mode || 'check',{expiration:options.expiration && r!==options.primary}));
  for(const b of el.querySelectorAll('[data-del]')) b.onclick=()=>{
    if(refs.length<=(options.minimum || 0))return;
    const value=refs[+b.dataset.del];
    if(!removeCondition(list,value,options.primary,{minimum:options.minimum || 0}))return;
    changed();condList(el,list,options);refreshFlags();
  };
  el.querySelector('[data-add]').onclick=()=>{list.push({flag:'',is:true});options.onList?.(list);changed();const fields=condList(el,list,options);refreshFlags();fields.at(-1)?.open();};
  return fields;
}

// ---------------------------------------------------------------- dialogue editor
function render() {
  renderLists();
  const el = $('#st-edit');
  if (!current) { el.innerHTML = '<div class="tip">Pick a dialogue, an InfoLink or an event on the left, or create a new one. For a character\'s dialogues you can also select them in the scene and press "Dialogues" in the right panel.</div>'; return; }
  el.refreshStateCatalog=null;
  if (current.kind === 'state') { renderStateCatalog(el); return; }
  if (current.kind === 'd') renderDialogue(el, story.dialogues[current.i]);
  else if (current.kind === 'i') renderInfo(el, story.infolinks[current.i]);
  else if (current.kind === 'o') window.__gamecons?.renderConversation(el, current.path);
  else renderEvent(el, story.events[current.i]);
}

function renderDialogue(el, d) {
  const ts = talkers();
  el.innerHTML = `
    <div class="f"><label>Title</label><input type="text" data-k="title" value="${esc(d.title)}"></div>
    <div class="f"><label>Speaker</label><select id="st-owner">${ts.map((a) => `<option value="${esc(a.name)}" ${a.name === d.owner ? 'selected' : ''}>${esc(actorLabel(a))}</option>`).join('')}</select>
      <button id="st-show">Show in scene</button><button id="st-pick" title="Select the character in the scene, then press here">Use selection</button></div>
    <div class="f"><label>Starts</label><select data-k="start"><option value="talk" ${d.start !== 'near' ? 'selected' : ''}>when JC talks to them (click)</option><option value="near" ${d.start === 'near' ? 'selected' : ''}>when JC gets close (and sees them)</option></select>
      <span id="st-rad" style="${d.start === 'near' ? '' : 'display:none'}">within <input type="number" data-k="radius" value="${d.radius || 200}" style="width:80px"> units</span>
      <label><input type="checkbox" data-k="once" ${d.once !== false ? 'checked' : ''}> only once</label></div>
    <div class="f" style="align-items:flex-start"><label>Only if</label><div id="st-req" style="flex:1"></div></div>
    <div class="f"><label>Priority</label><button id="st-up" title="Before the speaker's dialogue above it">▲</button><button id="st-down" title="After the speaker's dialogue below it">▼</button>
      <span class="tip" style="margin:0">${esc(prioText(d))}</span></div>
    <div class="tip">Lines play in order. A choice jumps to a label; "End of dialogue" closes the dialogue (put one at the end of every branch).</div>
    <div id="st-steps"></div>
    <div class="f"><button data-addstep="line">+ Line</button><button data-addstep="choice">+ JC's answers</button>
      <select id="st-more"><option value="">+ more...</option>${Object.entries(STEP_TYPES).filter(([k]) => !['line', 'choice'].includes(k)).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <span style="flex:1"></span><button id="st-deld" class="bad">Delete dialogue</button></div>`;
  bindFields(el, d, () => { $('#st-rad').style.display = d.start === 'near' ? '' : 'none'; });
  d.requires = d.requires || [];
  condList($('#st-req'), d.requires);
  // drawn again: the lines say who the speaker is, and the priority is among the speaker's dialogues
  $('#st-owner').onchange = () => { d.owner = $('#st-owner').value; d.bind = bindOf(d.owner); changed(); render(); };
  $('#st-show').onclick = () => locate(d.owner);
  $('#st-pick').onclick = () => {
    const s = E().selected, a = s && s.userData && s.userData.actor;
    if (!a) { log('Select a character or an object in the scene first.', 'warn'); return; }
    d.owner = a.name; d.bind = bindOf(a.name); changed(); render();
  };
  for (const b of el.querySelectorAll('[data-addstep]')) b.onclick = () => addStep(d, b.dataset.addstep);
  $('#st-more').onchange = () => { if ($('#st-more').value) addStep(d, $('#st-more').value); };
  $('#st-deld').onclick = () => { if (!confirm(`Delete the dialogue "${d.title || d.id}"?`)) return; story.dialogues.splice(current.i, 1); current = null; changed(); render(); };
  $('#st-up').onclick = () => moveDialogue(d, -1);
  $('#st-down').onclick = () => moveDialogue(d, 1);
  renderSteps($('#st-steps'), d);
  if (d.replaces) {
    $('#st-owner').closest('.f').hidden = true;
    el.querySelector('[data-k="start"]').closest('.f').hidden = true;
    $('#st-up').closest('.f').hidden = true;
    const banner = document.createElement('div'); banner.className = 'gc-copy-state';
    banner.innerHTML = `<b>${esc(d.replaces)}</b> · ${d.disabled ? 'Switched off' : 'Your editable copy'}<p class="tip">Original speaker, activation rules and conversation priority are preserved.</p>
      <label><input type="checkbox" id="st-original-off" ${d.disabled?'checked':''}> Switch off in this map</label>
      <button id="st-original-view">View original</button><button id="st-original-restore">Restore original</button>
      ${(d.conversionNotes || []).map(n=>`<p class="tip">${esc(n)}</p>`).join('')}`;
    el.prepend(banner);
    $('#st-original-off').onchange = e => {
      d.disabled=e.target.checked;
      if(!d.disabled && !d.steps?.length) { story.dialogues.splice(story.dialogues.indexOf(d),1);current={kind:'o',path:d.original.path}; }
      changed(); render();
    };
    $('#st-original-view').onclick = () => window.__story.showOriginal(d.original.path);
    $('#st-original-restore').onclick = () => restoreOriginal(d.original.path);
    if (d.disabled) { $('#st-steps').hidden=true; $('#st-more').closest('.f').hidden=true; }
  }
}

// a speaker's dialogues: when more than one can play, the first from the top whose conditions hold plays
// (story.py attaches them so); a dialogue that played "only once" is skipped and the next one plays
function prioText(d) {
  const same = story.dialogues.filter((x) => x.owner && x.owner === d.owner);
  if (same.length < 2) return 'The only dialogue of this speaker.';
  return `${same.indexOf(d) + 1} of ${same.length} dialogues of ${d.owner}: when more than one can play, the first from the top whose conditions hold is the one that plays.`;
}
function moveDialogue(d, dir) {
  const list = story.dialogues, i = list.indexOf(d);
  let j = i + dir;
  while (j >= 0 && j < list.length && list[j].owner !== d.owner) j += dir;     // past the other speakers' ones
  if (j < 0 || j >= list.length) return;
  list.splice(i, 1);
  list.splice(j, 0, d);
  current = { kind: 'd', i: j };
  changed();
  render();
}

// where new steps go: after the step whose ＋ was clicked (Crypt Test, 20 Oct 2026: they all went to the bottom and
// had to be carried into their branch with ↑ again and again); null: at the end
let insertAt = null, insertFor = null;
function placeStep(d, s) {
  d.steps = d.steps || [];
  if (insertFor === d && insertAt !== null && insertAt <= d.steps.length) d.steps.splice(insertAt++, 0, s);
  else { d.steps.push(s); insertAt = null; }
}
function addStep(d, type) {
  const s = { type };
  if (type === 'line') Object.assign(s, { who: (d.steps || []).filter((x) => x.type === 'line').slice(-1)[0]?.who === 'npc' ? 'jc' : 'npc', text: '' });
  if (type === 'choice') {
    placeStep(d, s);
    s.options = [{ text: '', goto: addBranch(d) }, { text: '', goto: addBranch(d) }];
    changed(); render(); return;
  }
  if (type === 'give') Object.assign(s, { item: '', count: 1 });
  if (type === 'do') s.do = [];
  if (type === 'flag' || type === 'if') Object.assign(s, { flag: '', is: true });
  if (type === 'goal') Object.assign(s, { goal: '', text: '', done: false });
  if (type === 'label') s.name = 'point' + ((d.steps || []).filter((x) => x.type === 'label').length + 1);
  placeStep(d, s);
  changed(); render();
}

// ---------------------------------------------------------------- the voice of a line (dubbing)
// Each line can have its own voice: recorded with the microphone (voice.js), a file, or one of the user's
// sounds dropped from the browser. The server makes it a sound of the editor's package named after the
// speaker and the text (editor/sounds.py dub); the game plays it from the speaker's mouth, the lips follow
// it (UCVoice.Dub, UCVoiceDriver). Changing the text keeps the voice: it moves with the line at Save.
function voiceBar(line, ref) {
  const v = typeof line.voice === 'string' && voices[line.voice], original = line.voice?.ref;
  return `<div class="f vbar" data-vref="${ref}" title="Drop one of your sounds here (browser > My sounds), or a recorded file, to make it this line's voice">
    <button data-vrec title="Record this line with your microphone: the character says it in the game and the lips follow">● Record</button>
    <button data-vgear title="Which microphone (also in Settings > Microphone)">⚙</button>
    <button data-vimp title="A recorded file: WAV, MP3, OGG, FLAC">Import...</button>
    ${ref.startsWith('o:') ? '' : '<button data-vgame title="Choose a line in Game voices, then use it here. You can also drag it onto this bar.">Use game voice</button>'}
    ${line.voice ? `<button data-vplay title="Listen">▶</button><span class="tip" style="margin:0">${original?'Game voice reference':'Your recording'}${v ? ` · ${v.seconds} s` : ''}</span><button data-vdel title="Remove its voice">✕</button>`
      : '<span class="tip" style="margin:0">no voice of its own</span>'}</div>`;
}
function voiceTarget(ref, ctx) {
  const parts = ref.split(':'), i = +parts[1];
  if (ctx.kind === 'o') return ctx.targets[i];
  if (ctx.kind === 'd') {
    const d = ctx.d, st = parts.length > 2 ? d.steps[i].options[+parts[2]] : d.steps[i], who = parts.length > 2 ? 'jc' : String(st.who || 'npc');
    return { line: st, who: who === 'jc' ? 'JC Denton' : who.startsWith('actor:') ? who.slice(6) : (d.owner || 'the speaker'),
      body: { dialogue: { owner: d.owner, bind: d.replaces ? d.bind : bindOf(d.owner), replaces: d.replaces }, line: { who, bind: who.startsWith('actor:') ? bindOf(who.slice(6)) : st.bind, text: st.text } } };
  }
  const l = ctx.il.lines[i];
  return { line: l, who: ctx.il.name || ctx.il.caller, body: { infolink: { caller: ctx.il.caller }, line: { text: l.text } } };
}
async function giveVoice(t, extra, redraw) {
  if (!String(t.line.text || '').trim()) { log('Write the line first: its voice goes with its text.', 'warn'); return; }
  const busyEl = document.getElementById('busy'), bt = document.getElementById('busytext');
  if (busyEl) { bt.textContent = 'Giving the line its voice...'; busyEl.style.display = 'flex'; }
  try {
    const r = await fetch('/api/dub', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ map: (E() && E().mapName) || '', old: t.line.voice || '' }, t.body, extra)) });
    const j = await r.json();
    if (!r.ok) { log(j.error || r.statusText, 'bad'); return; }
    if (!j.ok) { log(j.lines || [], 'bad'); return; }
    t.line.voice = j.voice.key;
    voices[j.voice.key] = { seconds: j.voice.seconds, original: t.body.original };
    changed();
    redraw();
    log(`${t.who}: the line has its voice (${(+j.voice.seconds).toFixed(1)} s). Save, then Apply in game: the character says it and the lips follow.`, 'ok');
  } catch (e) { log('Voice: ' + e.message, 'bad'); } finally { if (busyEl) busyEl.style.display = 'none'; }
}
function wireVoices(el, ctx, redraw) {
  for (const bar of el.querySelectorAll('[data-vref]')) {
    const t = () => voiceTarget(bar.dataset.vref, ctx), q = (s) => bar.querySelector(s);
    q('[data-vrec]').onclick = async () => {
      const x = t();
      if (!String(x.line.text || '').trim()) { log('Write the line first: its voice goes with its text.', 'warn'); return; }
      if (!window.__voice) { log('The microphone module is not loaded.', 'bad'); return; }
      const take = await window.__voice.record({ who: x.who, text: x.line.text, anchor: bar });
      if (take) await giveVoice(x, { wav: take.wav, source: take.source }, redraw);
    };
    q('[data-vgear]').onclick = () => window.__voice && window.__voice.chooseMic(bar);
    const fromFile = async (f) => {
      try { const v = await window.__voice.fileToVoice(f); await giveVoice(t(), { wav: v.wav, source: v.source }, redraw); }
      catch (e) { log(`${f.name}: not a sound the editor can read (${e.message || e}).`, 'bad'); }
    };
    q('[data-vimp]').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.wav,.mp3,.ogg,.oga,.flac,.m4a,.aac,.opus,.webm';
      inp.onchange = () => { if (inp.files[0]) fromFile(inp.files[0]); };
      inp.click();
    };
    const useReference = clip => {
      if (ctx.kind === 'o') { log('To change an original voice to a game reference, choose Edit a copy first.', 'warn'); return; }
      if (!clip?.ref) { log('In the Game voices browser, choose “Select voice” on a line first, then press Use game voice here.', 'warn'); return; }
      const x=t();
      const speaker=x.body.dialogue ? (x.body.line.who==='jc' ? 'JCDenton' : x.body.line.who==='npc' ? x.body.dialogue.bind : x.body.line.who.startsWith('actor:') ? x.body.line.bind : x.body.line.who) : x.body.infolink.caller;
      x.line.voice={ref:clip.ref,package:clip.package,text:x.line.text,speaker}; changed(); redraw();
      log('Game voice linked. It stays in the player’s game install. Changing this line’s text or speaker clears the reference.', 'ok');
    };
    if (q('[data-vgame]')) q('[data-vgame]').onclick = () => useReference(window.__gamecons?.selectedVoice);
    if (q('[data-vplay]')) q('[data-vplay]').onclick = () => {
      const v=t().line.voice; if (!v) return;
      if (v.ref) window.__gamecons.play(v.ref,q('[data-vplay]'),v.package);
      else E().playSound(soundsPkg + '.' + v, q('[data-vplay]'));
    };
    if (q('[data-vdel]')) q('[data-vdel]').onclick = async () => {
      const x = t();
      if (x.line.voice?.ref) { delete x.line.voice; changed(); redraw(); return; }
      if (!confirm(ctx.kind === 'o' ? 'Remove this dub and restore the original voice? This affects every occurrence of the same speaker and text. Apply in game with the game closed afterwards.' : 'Remove this recording? Other lines with the same speaker and text will also use their default voice.')) return;
      try {
        const response=await fetch('/api/dub_delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: x.line.voice }) });
        const result=await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || (result.lines || []).join('\n') || 'Could not remove the voice.');
      } catch(e) { log(e.message,'bad'); return; }
      delete voices[x.line.voice];
      delete x.line.voice;
      changed();
      redraw();
    };
    // one of the user's sounds from the browser, or a file from Windows, let go on the line
    bar.addEventListener('dragover', (e) => { e.preventDefault(); bar.style.outline = '2px dashed var(--acc)'; });
    bar.addEventListener('dragleave', () => { bar.style.outline = ''; });
    bar.addEventListener('drop', (e) => {
      bar.style.outline = '';
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length) { fromFile(e.dataTransfer.files[0]); return; }
      const clip=e.dataTransfer.getData('application/x-deusedix-game-voice');
      if (clip) { try { useReference(JSON.parse(clip)); } catch(error) { log('Invalid game voice reference.','warn'); } return; }
      const name = e.dataTransfer.getData('text/plain');
      if (!/^\w+\.\w/.test(name)) return;
      if (!name.startsWith(soundsPkg + '.')) { log('Only your own sounds (My sounds) can be a voice: import the file first, or Record.', 'warn'); return; }
      giveVoice(t(), { sound: name }, redraw);
    });
  }
}

function renderSteps(el, d) {
  const ts = talkers();
  const steps = d.steps || [];
  const field=(s,k,label,type='text')=>`<label>${label} <input type="${type}" data-k="${k}" value="${esc(s[k] ?? '')}"></label>`;
  const tick=(s,k,label)=>`<label><input type="checkbox" data-k="${k}" ${s[k]?'checked':''}> ${label}</label>`;
  const select=(s,k,options)=>`<select data-k="${k}">${options.map(([v,label])=>`<option value="${v}" ${s[k]===v?'selected':''}>${label}</option>`).join('')}</select>`;
  el.innerHTML = steps.map((s, i) => {
    let body = '';
    if (s.type === 'line') {
      body = `<div class="f"><select data-k="who"><option value="npc" ${s.who === 'npc' ? 'selected' : ''}>speaker (${esc(d.owner || '?')})</option><option value="jc" ${s.who === 'jc' ? 'selected' : ''}>JC</option>
        ${s.who && !['npc','jc'].includes(s.who) && !s.who.startsWith('actor:') ? `<option selected value="${esc(s.who)}">${esc(s.who)} (original binding)</option>` : ''}
        ${ts.filter((a) => a.name !== d.owner && a.kind === 'pawn').map((a) => `<option value="actor:${esc(a.name)}" ${s.who === 'actor:' + a.name ? 'selected' : ''}>${esc(actorLabel(a))}</option>`).join('')}</select>
        ${locButton(`data-loc="${i}"`)}
        <textarea data-k="text" placeholder="what they say">${esc(s.text)}</textarea></div>${voiceBar(s, 'd:' + i)}`;
    } else if (s.type === 'choice') {
      const n = (s.options || []).length;
      body = (s.options || []).map((o, k) => `<div class="f" data-o="${k}">${k + 1}. <input type="text" data-k="text" value="${esc(o.text)}" placeholder="what JC can answer"> goes to ${labelSelect(d, o.goto)}
          ${n > 1 ? `<button data-ox="${i}:${k}" title="remove this answer">✕</button>` : ''}
          <details class="st-choice-advanced"><summary>Answer options</summary>${tick(o,'displayAsSpeech','Speak this answer')}${field(o,'skill','Required skill class')}${field(o,'skillLevel','Skill level','number')}</details>
          <div class="st-choice-req" data-oreq="${k}"></div>${voiceBar(o,`d:${i}:${k}`)}</div>`).join('')
        + `<div class="f">${n < MAX_ANSWERS ? `<button data-oadd="${i}">+ answer</button>` : ''}<span class="tip" style="margin:0">2 to ${MAX_ANSWERS} answers. An answer appears only when all its conditions match.</span></div>`;
    } else if (s.type === 'label') {
      body = `<div class="f">name <input type="text" data-k="name" value="${esc(s.name)}"></div>`;
    } else if (s.type === 'if') {
      body = `<div class="st-state-field"></div><div class="f">When matched, go to ${labelSelect(d, s.goto)}</div>`;
    } else if (s.type === 'goto') {
      body = `<div class="f">go to ${labelSelect(d, s.label, 'label')}</div>`;
      if(s.conversation) body=`<div class="f">${field(s,'label','Label')}${field(s,'conversation','Original conversation path')}</div>`;
    } else if (s.type === 'flag') {
      body = '<div class="st-state-field"></div>';
    } else if (s.type === 'goal') {
      body = `<div class="f">name <input type="text" data-k="goal" list="st-goals" value="${esc(s.goal)}" placeholder="UC_TalkToMax" style="max-width:200px"> text <input type="text" data-k="text" value="${esc(s.text)}"></div>
        <div class="f"><label style="width:auto"><input type="checkbox" data-k="done" ${s.done ? 'checked' : ''}> already completed (ticks off a goal given earlier)</label></div>`;
    } else if (s.type === 'trigger') {
      body = `<div class="f">Tag <input type="text" data-k="tag" value="${esc(s.tag)}" placeholder="the Tag of doors, lights, alarms...">`;
    } else if (s.type === 'do') {
      body = `<div class="tip" style="margin:2px 0">They happen as soon as the dialogue ends (e.g. the character walks away, a door opens).</div><div class="st-doacts"></div>`;
    } else if (s.type === 'give') {
      body = `<div class="f">${itemSelect(s.item)} how many <input type="number" data-k="count" value="${s.count || 1}" min="1" style="width:70px"></div>
        <div class="tip" style="margin:2px 0">JC gets it during the dialogue (the game shows it in the conversation); the speaker keeps their own. With a full inventory JC doesn't get it.</div>`;
      if (d.replaces) body+=`<div class="f">${field(s,'from','From binding (blank: create)')}${field(s,'to','To binding')} on failure ${labelSelect(d,s.fail,'fail')}</div>`;
    } else if (s.type === 'credits' || s.type === 'skillpoints') {
      body=`<div class="f">${field(s,'amount',s.type==='credits'?'Credits (negative: take)':'Skill points','number')}${s.type==='skillpoints'?field(s,'text','Award message'):''}</div>`;
    } else if (s.type === 'note') {
      body=`<div class="f"><textarea data-k="text" placeholder="Datavault note">${esc(s.text)}</textarea></div>`;
    } else if (s.type === 'checkitem') {
      body=`<div class="f">${field(s,'item','Item class')} if absent, go to ${labelSelect(d,s.goto)}</div>`;
    } else if (s.type === 'checkvalue') {
      body=`<div class="f">${select(s,'valueType',[['EP_Credits','Credits'],['EP_Health','Health'],['EP_SkillPoints','Skill points']])}
        ${select(s,'condition',[['EC_Less','less than'],['EC_LessEqual','at most'],['EC_Equal','equal to'],['EC_GreaterEqual','at least'],['EC_Greater','greater than']])}${field(s,'amount','Value','number')} go to ${labelSelect(d,s.goto)}</div>`;
    } else if (s.type === 'random') {
      body=`<div class="f"><label>Labels (one per line)<textarea data-random-labels>${esc((s.labels||[]).join('\n'))}</textarea></label>${tick(s,'cycle','Cycle through labels')}${tick(s,'once','Repeat last label after one cycle')}${tick(s,'shuffle','Random after first cycle')}</div>`;
    } else if (s.type === 'animation') {
      body=`<div class="f">${field(s,'actor','Actor binding')}${field(s,'sequence','Animation sequence')}${field(s,'seconds','Duration','number')}${tick(s,'loop','Loop')}${tick(s,'wait','Wait until finished')}</div>`;
    } else if (s.type === 'trade') {
      body=`<div class="f">${field(s,'actor','Trader binding')}</div>`;
    }
    if (['flag','if'].includes(s.type) && s.requires?.length) body=`<div class="st-native-req"></div>${s.type==='if'?`<div class="f">if all match, go to ${labelSelect(d,s.goto)}</div>`:''}`;
    if (s.type==='goal') body+=`<div class="f">${tick(s,'secondary','Secondary goal')}</div>`;
    const here = insertFor === d && insertAt === i + 1;
    return `<div class="card ${s.type}${here ? ' st-insert' : ''}" data-s="${i}"><div class="ch"><b>${STEP_TYPES[s.type] || s.type}</b>
      <button data-ins="${i}" title="${here ? 'New steps go here, after this one: click again to add them at the end' : 'Add the next steps here, after this one'}" ${here ? 'style="color:var(--acc)"' : ''}>＋</button>
      <button data-up="${i}" title="up">↑</button><button data-down="${i}" title="down">↓</button><button data-x="${i}" title="remove">✕</button></div>${body}</div>`;
  }).join('') || '<div class="tip">Nothing yet: add a line.</div>';
  steps.forEach((s, i) => {
    const card = el.querySelector(`[data-s="${i}"]`);
    if (s.type === 'choice') (s.options || []).forEach((o, k) => {
      bindFields(card.querySelector(`[data-o="${k}"]`), o);
      condList(card.querySelector(`[data-oreq="${k}"]`),o.requires || [],{primary:o,expiration:true,onList:list=>{o.requires=list;}});
    });
    else if (s.type === 'do') { s.do = s.do || []; renderActions(card.querySelector('.st-doacts'), s.do); }
    else bindFields(card, s, s.type === 'label' ? () => renderSteps(el, d) : null);
    if (card.querySelector('.st-native-req')) condList(card.querySelector('.st-native-req'),s.requires,{mode:s.type==='flag'?'set':'check',expiration:true,minimum:1});
    else if (['flag','if'].includes(s.type)) stateField(card.querySelector('.st-state-field'),s,s.type==='flag'?'set':'check');
    const random=card.querySelector('[data-random-labels]'); if(random) random.oninput=()=>{s.labels=random.value.split('\n').map(x=>x.trim()).filter(Boolean);changed();};
  });
  wireVoices(el, { kind: 'd', d }, () => renderSteps(el, d));
  for (const b of el.querySelectorAll('[data-loc]')) b.onclick = () => {
    const who = String(steps[+b.dataset.loc].who || 'npc');
    if (who === 'jc') { log('JC is the player: he is not a character placed in the map.', 'warn'); return; }
    locate(who === 'npc' ? d.owner : who.replace(/^actor:/, ''));
  };
  for (const b of el.querySelectorAll('[data-ins]')) b.onclick = () => {
    const i = +b.dataset.ins;
    if (insertFor === d && insertAt === i + 1) { insertAt = null; insertFor = null; }
    else { insertAt = i + 1; insertFor = d; }
    renderSteps(el, d);
  };
  if (insertFor !== d) { insertAt = null; insertFor = null; }
  for (const b of el.querySelectorAll('[data-up]')) b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; changed(); renderSteps(el, d); } };
  for (const b of el.querySelectorAll('[data-down]')) b.onclick = () => { const i = +b.dataset.down; if (i < steps.length - 1) { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; changed(); renderSteps(el, d); } };
  for (const b of el.querySelectorAll('[data-x]')) b.onclick = () => { steps.splice(+b.dataset.x, 1); changed(); renderSteps(el, d); };
  for (const b of el.querySelectorAll('[data-oadd]')) b.onclick = () => {
    const s = steps[+b.dataset.oadd];
    s.options.push({ text: '', goto: addBranch(d) });
    changed(); renderSteps(el, d);
  };
  for (const b of el.querySelectorAll('[data-ox]')) b.onclick = () => {
    const [i, k] = b.dataset.ox.split(':').map(Number);
    steps[i].options.splice(k, 1);
    changed(); renderSteps(el, d);
  };
}

// ---------------------------------------------------------------- InfoLink editor
function usesOf(id) {                     // the events and dialogues that play an InfoLink
  const has = (list) => (list || []).some((a) => a.type === 'infolink' && a.infolink === id);
  return story.events.map((e, i) => has(e.do) ? { kind: 'e', i, text: 'event: ' + (e.title || e.id) } : null)
    .concat(story.dialogues.map((d, i) => (d.steps || []).some((s) => s.type === 'do' && has(s.do)) ? { kind: 'd', i, text: 'after the dialogue: ' + (d.title || d.id) } : null))
    .concat(story.infolinks.map((o, i) => o.id !== id && has(o.do) ? { kind: 'i', i, text: 'after the InfoLink: ' + (o.title || o.id) } : null))
    .filter(Boolean);
}
function renderInfo(el, il) {
  il.lines = il.lines || [];
  il.do = il.do || [];
  const known = CALLERS.some(([b]) => b === il.caller);
  const uses = usesOf(il.id);
  el.innerHTML = `
    <div class="f"><label>Title</label><input type="text" data-k="title" value="${esc(il.title)}"></div>
    <div class="f"><label>Caller</label><select id="st-caller">${CALLERS.map(([b, n]) => `<option value="${b}" ${b === il.caller ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        <option value="" ${known ? '' : 'selected'}>someone else (no portrait)...</option></select>
      <span id="st-other" style="${known ? 'display:none' : ''}">name shown <input type="text" id="st-oname" value="${esc(known ? '' : il.name)}" placeholder="e.g. Red Arrow contact" style="max-width:220px"></span>
      <label><input type="checkbox" data-k="once" ${il.once !== false ? 'checked' : ''}> only once</label>
      <label title="While it plays, clicking people starts no dialogue: a dialogue would hide the InfoLink window (and the game would cut it). They can be talked to again as soon as it ends."><input type="checkbox" data-k="hush" ${il.hush !== false ? 'checked' : ''}> no talking while it plays</label></div>
    <div class="tip">An InfoLink is one-way: only the caller speaks, JC never answers by radio (if JC has to report something, set a flag). Each line gets its own screen, timed like the game's.</div>
    <div id="st-ilines"></div>
    <div class="f"><button id="st-iadd">+ Line</button></div>
    <div class="tip">Actions: they happen as soon as the InfoLink starts (as in Deus Ex, an interrupted InfoLink counts as heard).</div>
    <div id="st-iacts"></div>
    <div class="f"><label>Plays when</label><div style="flex:1">${uses.length ? uses.map((u, k) => `<button data-use="${k}">${esc(u.text)}</button>`).join(' ') : '<span class="tip">nothing plays it yet: add an event</span>'}</div></div>
    <div class="f"><label>Heard flag</label><code title="true once the InfoLink has played: use it in the conditions of other dialogues and events">${esc(heardFlag(il))}</code></div>
    <div class="f"><button id="st-ievent">+ Event that plays it</button><span style="flex:1"></span><button id="st-deli" class="bad">Delete InfoLink</button></div>`;
  bindFields(el.querySelector('.f'), il);
  bindFields(el.querySelectorAll('.f')[1], il);
  $('#st-caller').onchange = () => {
    const b = $('#st-caller').value;
    if (b) { il.caller = b; il.name = (CALLERS.find((c) => c[0] === b) || [])[1] || b; $('#st-other').style.display = 'none'; }
    else { il.caller = 'Unknown'; il.name = $('#st-oname').value; $('#st-other').style.display = ''; }
    changed();
  };
  $('#st-oname').oninput = () => { il.name = $('#st-oname').value; changed(); };
  const lines = () => {
    const box = $('#st-ilines');
    box.innerHTML = il.lines.map((l, i) => `<div class="card info" data-l="${i}"><div class="ch"><b>${esc(il.name || il.caller)}</b>
      <button data-lu="${i}" title="up">↑</button><button data-ld="${i}" title="down">↓</button><button data-lx="${i}" title="remove">✕</button></div>
      <div class="f"><textarea data-k="text" placeholder="what the caller says">${esc(l.text)}</textarea></div>${voiceBar(l, 'i:' + i)}</div>`).join('')
      || '<div class="tip">No lines yet.</div>';
    il.lines.forEach((l, i) => bindFields(box.querySelector(`[data-l="${i}"]`), l));
    wireVoices(box, { kind: 'i', il }, lines);
    for (const b of box.querySelectorAll('[data-lu]')) b.onclick = () => { const i = +b.dataset.lu; if (i > 0) { [il.lines[i - 1], il.lines[i]] = [il.lines[i], il.lines[i - 1]]; changed(); lines(); } };
    for (const b of box.querySelectorAll('[data-ld]')) b.onclick = () => { const i = +b.dataset.ld; if (i < il.lines.length - 1) { [il.lines[i + 1], il.lines[i]] = [il.lines[i], il.lines[i + 1]]; changed(); lines(); } };
    for (const b of box.querySelectorAll('[data-lx]')) b.onclick = () => { il.lines.splice(+b.dataset.lx, 1); changed(); lines(); };
  };
  lines();
  $('#st-iadd').onclick = () => { il.lines.push({ text: '' }); changed(); lines(); };
  renderActions($('#st-iacts'), il.do);
  for (const b of el.querySelectorAll('[data-use]')) b.onclick = () => { const u = uses[+b.dataset.use]; current = { kind: u.kind, i: u.i }; render(); };
  $('#st-ievent').onclick = () => {
    const at = E().selectedLoc() || E().cameraPoint(160);
    story.events.push({ id: nextId('e', story.events), title: 'Play: ' + (il.title || il.id), when: { type: 'near', at, radius: 256 }, once: true, requires: [], do: [{ type: 'infolink', infolink: il.id }] });
    current = { kind: 'e', i: story.events.length - 1 };
    changed(); render();
  };
  $('#st-deli').onclick = () => { if (!confirm(`Delete the InfoLink "${il.title || il.id}"?`)) return; story.infolinks.splice(current.i, 1); current = null; changed(); render(); };
}

// ---------------------------------------------------------------- event editor
function renderEvent(el, e) {
  e.when = e.when || { type: 'near', at: [0, 0, 0], radius: 256 };
  e.requires = e.requires || [];
  e.do = e.do || [];
  const w = e.when;
  el.innerHTML = `
    <div class="f"><label>Title</label><input type="text" data-k="title" value="${esc(e.title)}"></div>
    <div class="f"><label>When</label><select id="st-wt"><option value="near" ${w.type === 'near' ? 'selected' : ''}>JC gets close to a point</option>
      <option value="flag" ${w.type === 'flag' ? 'selected' : ''}>a condition is met</option><option value="start" ${w.type === 'start' ? 'selected' : ''}>at map start</option>
      <option value="dead" ${w.type === 'dead' ? 'selected' : ''}>a character dies or is knocked out</option><option value="hostile" ${w.type === 'hostile' ? 'selected' : ''}>a faction turns hostile to JC</option><option value="item" ${w.type === 'item' ? 'selected' : ''}>JC has an item</option></select>
      <label><input type="checkbox" data-k="once" ${e.once !== false ? 'checked' : ''}> only once</label></div>
    <div id="st-wf"></div>
    <div class="f" style="align-items:flex-start"><label>Only if</label><div id="st-req" style="flex:1"></div></div>
    <div class="tip">What happens:</div><div id="st-acts"></div>
    <div class="f"><span style="flex:1"></span><button id="st-dele" class="bad">Delete event</button></div>`;
  bindFields(el.querySelector('.f'), e);
  bindFields(el.querySelectorAll('.f')[1], e);
  const wf = () => {
    const box = $('#st-wf');
    if (w.type === 'near') {
      w.at = w.at || [0, 0, 0];
      box.innerHTML = `<div class="f"><label>Point</label>X <input type="number" data-i="0" value="${w.at[0]}" style="width:90px"> Y <input type="number" data-i="1" value="${w.at[1]}" style="width:90px"> Z <input type="number" data-i="2" value="${w.at[2]}" style="width:90px">
        radius <input type="number" id="st-wr" value="${w.radius || 256}" style="width:80px"></div>
        <div class="f"><label></label><button id="st-wsel">Use the selected object</button><button id="st-wcam">Use the point in front of the camera</button></div>`;
      for (const i of box.querySelectorAll('[data-i]')) i.oninput = () => { w.at[+i.dataset.i] = +i.value; changed(); };
      $('#st-wr').oninput = () => { w.radius = +$('#st-wr').value; changed(); };
      $('#st-wsel').onclick = () => { const p = E().selectedLoc(); if (!p) { log('Select an object in the scene.', 'warn'); return; } w.at = p; changed(); wf(); };
      $('#st-wcam').onclick = () => { w.at = E().cameraPoint(160); changed(); wf(); };
    } else if (w.type === 'flag') {
      box.innerHTML = '<div class="st-state-field"></div>';
      stateField(box.firstElementChild, w);
    } else if (w.type === 'dead') {
      box.innerHTML = `<div class="f"><label>Who</label>${actorSelect(pawns(), w.actor, 'who')}${locButton('data-wloc="1"')}</div>`;
      bindFields(box, w);
      box.querySelector('[data-wloc]').onclick = () => locate(w.actor);
    } else if (w.type === 'item') {
      box.innerHTML = `<div class="f"><label>Item</label>${itemSelect(w.item)}</div>`;
      bindFields(box, w);
    } else if (w.type === 'hostile') {
      box.innerHTML = `<div class="f"><label>Faction</label>${facInput(w.faction)}<span class="tip" style="margin:0">e.g. JC attacked one of them, or the story turned them</span></div>`;
      bindFields(box, w);
    } else box.innerHTML = '';
  };
  $('#st-wt').onchange = () => { w.type = $('#st-wt').value; changed(); wf(); };
  wf();
  condList($('#st-req'), e.requires);
  renderActions($('#st-acts'), e.do);
  $('#st-dele').onclick = () => { if (!confirm(`Delete the event "${e.title || e.id}"?`)) return; story.events.splice(current.i, 1); current = null; changed(); render(); };
}

// ---------------------------------------------------------------- checks, save, apply
function problems() {
  const out = conditionProblems(story);
  for (const d of story.dialogues) {
    if (d.disabled) continue;
    const name = d.title || d.id;
    if (!d.owner) out.push(`"${name}": missing the speaker`);
    const labels = new Set(labelsOf(d).map(x=>x.toLowerCase()));
    for (const s of d.steps || []) {
      if (s.type === 'line' && !String(s.text || '').trim()) out.push(`"${name}": a line is empty`);
      for (const g of s.type === 'choice' ? (s.options || []).map((o) => o.goto) : (s.type === 'if' ? [s.goto] : s.type === 'goto' ? [s.label] : []))
        if (g && !s.conversation && !labels.has(g.toLowerCase()) && !(d.originalMissingLabels||[]).includes(g)) out.push(`"${name}": the label "${g}" does not exist`);
      if ((s.type === 'flag' || s.type === 'if') && !s.flag && !s.requires?.length) out.push(`"${name}": a flag with no name`);
      if (s.type === 'choice' && (s.options || []).some((o) => !String(o.text || '').trim())) out.push(`"${name}": one of JC's answers is empty`);
      if (s.type === 'choice' && !(s.options || []).length) out.push(`"${name}": a choice needs an answer`);
      if (s.type === 'give' && !s.item) out.push(`"${name}": missing the item to give JC`);
      if (s.type === 'do') { if (!(s.do || []).length) out.push(`"${name}": an "Actions" step is empty`); actionProblems(s.do, `"${name}"`, out); }
    }
    if (!d.replaces && !(d.steps || []).some((s) => s.type === 'line')) out.push(`"${name}": no lines`);
  }
  for (const il of story.infolinks) {
    const where = `InfoLink "${il.title || il.id}"`;
    if (!(il.lines || []).length) out.push(`${where}: no lines`);
    if ((il.lines || []).some((l) => !String(l.text || '').trim())) out.push(`${where}: a line is empty`);
    if (!il.caller || (il.caller === 'Unknown' && !il.name)) out.push(`${where}: missing the caller's name`);
    actionProblems(il.do, where, out);
  }
  for (const e of story.events) {
    const where = `event "${e.title || e.id}"`;
    if (!(e.do || []).length) out.push(`${where}: no actions`);
    const w = e.when || {};
    if (w.type === 'dead' && !w.actor) out.push(`${where}: missing who has to die`);
    if (w.type === 'item' && !w.item) out.push(`${where}: missing the item`);
    if (w.type === 'hostile' && !w.faction) out.push(`${where}: missing the faction`);
    if (w.type === 'flag' && !w.flag) out.push(`${where}: missing the flag`);
    actionProblems(e.do, where, out);
  }
  return out;
}
function normalize(target = story) {            // the conversation name of every character who speaks
  for (const d of target.dialogues) {
    if (!d.replaces) d.bind = bindOf(d.owner); // copies keep the original native binding, including radio calls
    for (const s of d.steps || []) if (s.type === 'line' && String(s.who || '').startsWith('actor:')) s.bind = bindOf(s.who.slice(6));
  }
}
// the voices that followed their line's new text (the server renamed them): the same order as story.py voiced_lines
function takeVoiceKeys(keys) {
  if (!Array.isArray(keys)) return;
  const lines = [];
  for (const d of story.dialogues) for (const s of d.steps || []) { if (s.type === 'line') lines.push(s); if(s.type==='choice') lines.push(...(s.options||[])); }
  for (const il of story.infolinks) for (const l of il.lines || []) lines.push(l);
  lines.forEach((l, i) => {
    const k = keys[i];
    if (typeof k === 'string' && typeof l.voice === 'string') voices[k] = voices[l.voice] || voices[k];
    if(k) l.voice=k; else delete l.voice;
  });
}
function saveContext() {
  if (!story || !mapLoaded || E()?.script !== mapLoaded) return null;
  return {script: mapLoaded, story, epoch: loadEpoch};
}
function sameSaveContext(context) {
  return !!context && context.epoch === loadEpoch && context.story === story &&
    context.script === mapLoaded && E()?.script === context.script;
}
function storySnapshot() {
  const snapshot = JSON.parse(JSON.stringify(story));
  normalize(snapshot);
  snapshot.route = $('#st-route').value;
  return snapshot;
}
function acceptSavedStory(context, savedRevision, snapshot, keys, clean) {
  if (!sameSaveContext(context) || revision !== savedRevision) return false;
  // Voice keys are positional. A reordered or edited line must never receive
  // the reply for an older snapshot; its old WAV remains available to rekey.
  takeVoiceKeys(keys);
  story.route = snapshot.route;
  if (clean) { dirty = false; $('#st-save').textContent = 'Save'; }
  return true;
}
function save({automatic = false} = {}) {
  const context = saveContext();
  if (!context) return Promise.resolve(false);
  return saveQueue.run(async () => {
    if (!sameSaveContext(context)) return false;
    if (automatic && !dirty) return true;
    const savedRevision = revision, snapshot = storySnapshot();
    const response = await fetch('/api/story?script=' + encodeURIComponent(context.script) + (automatic ? '&automatic=1' : ''), {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(snapshot),
    });
    const r = await response.json();
    if (!response.ok) throw new Error(r.error || 'The Story could not be saved.');
    const clean = acceptSavedStory(context, savedRevision, snapshot, r.voices, true);
    if (!automatic && sameSaveContext(context)) {
      if (r.lines?.length) log(r.lines);
      log(clean ? 'Story saved.' : 'Story saved; newer changes are still unsaved.', 'ok');
    }
    return true;
  });
}
function apply() {
  const context = saveContext();
  if (!context) return Promise.resolve({saved: false, skipped: true});
  return saveQueue.run(async () => {
    if (!sameSaveContext(context)) return {saved: false, skipped: true};
    const p = problems();
    if (p.length) { log(['Fix these first:'].concat(p), 'warn'); return {saved: false}; }
    const savedRevision = revision, snapshot = storySnapshot();
    const busyEl = document.getElementById('busy'), bt = document.getElementById('busytext');
    const busyMessage = `Generating the story code and compiling ${E().standalone ? 'your project' : 'the mod'} (about 2 minutes)...`;
    if (busyEl && bt) { bt.textContent = busyMessage; busyEl.style.display = 'flex'; }
    try {
      const response = await fetch('/api/story_apply?script=' + encodeURIComponent(context.script), {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({story: snapshot}),
      });
      const r = await response.json();
      if (!response.ok) throw new Error(r.error || 'The Story could not be applied.');
      const clean = acceptSavedStory(context, savedRevision, snapshot, r.voices, r.ok);
      if (sameSaveContext(context)) {
        log(r.lines || [], r.ok ? 'ok' : 'bad');
        log(r.ok ? (clean ? 'Done: open the game and go to the map to try it.' : 'Applied the saved story; newer changes are still unsaved.') : 'Something went wrong: read the messages above.', r.ok ? 'ok' : 'bad');
      }
      return {saved: !!r.ok, clean: !!r.ok && clean};
    } catch (e) {
      if (sameSaveContext(context)) log('Error: ' + e.message, 'bad');
      return {saved: false};
    } finally {
      // A map switch may have replaced this overlay with its own progress.
      if (busyEl && bt?.textContent === busyMessage) busyEl.style.display = 'none';
    }
  });
}

$('#st-save').onclick = () => {
  const context = saveContext();
  return save().catch(e => { if (sameSaveContext(context)) log(e.message, 'bad'); });
};
$('#st-apply').onclick = apply;
$('#st-close').onclick = () => { unpeek(); root.classList.remove('open'); };
$('#st-back').onclick = unpeek;
// Esc while a character is shown: back to the story (before the editor's own Esc, which deselects)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && root.classList.contains('peek')) { e.stopImmediatePropagation(); e.preventDefault(); unpeek(); }
}, true);
$('#st-route').onchange = changed;
$('#st-newd').onclick = () => {
  const s = E().selected, a = s && s.userData && s.userData.actor;
  const owner = a && a.talker !== false ? a.name : (talkers()[0] || {}).name;
  story.dialogues.push({ id: nextId('d', story.dialogues), title: 'New dialogue', owner, bind: bindOf(owner), start: 'talk', radius: 200, once: true, requires: [], steps: [{ type: 'line', who: 'npc', text: '' }, { type: 'line', who: 'jc', text: '' }] });
  current = { kind: 'd', i: story.dialogues.length - 1 };
  changed(); render();
};
$('#st-newi').onclick = () => {
  story.infolinks.push({ id: nextId('i', story.infolinks), title: 'New InfoLink', caller: 'AlexJacobson', name: 'Alex Jacobson', once: true, lines: [{ text: '' }], do: [] });
  current = { kind: 'i', i: story.infolinks.length - 1 };
  changed(); render();
};
$('#st-newe').onclick = () => {
  const at = E().selectedLoc() || E().cameraPoint(160);
  story.events.push({ id: nextId('e', story.events), title: 'New event', when: { type: 'near', at, radius: 256 }, once: true, requires: [], do: [] });
  current = { kind: 'e', i: story.events.length - 1 };
  changed(); render();
};

async function copyOriginal(con, disabled=false) {
  const existing=story.dialogues.findIndex(d=>d.original?.path===con.path);
  if (existing>=0) {
    if(disabled) { story.dialogues[existing].disabled=true; changed(); }
    current={kind:'d',i:existing}; render(); return;
  }
  try {
    const response=await fetch('/api/gamecons/copy?script='+encodeURIComponent(E().script),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation:con.path,disabled,actor:$('#gc-actor')?.value || ''})});
    const result=await response.json(); if(!response.ok) throw new Error(result.error || 'Could not copy the conversation.');
    if(result.losses?.length) { log(['This conversation needs manual corrections before it can replace the original:'].concat(result.losses),'warn'); return; }
    story.dialogues.push(result.dialogue); current={kind:'d',i:story.dialogues.length-1}; changed(); render();
    log(disabled?'Conversation switched off for this map. Apply in game to use the change.':'Editable copy created. Its original activation rules and voice references are preserved. Save and Apply in game to replace the original.','ok');
  } catch(e) { log(e.message,'bad'); }
}
function restoreOriginal(path) {
  const i=story.dialogues.findIndex(d=>d.original?.path===path); if(i<0) return;
  if(!confirm('Remove this map’s override and restore the original conversation? Save and Apply in game afterwards.')) return;
  story.dialogues.splice(i,1); current={kind:'o',path}; changed(); render();
}
function originalControls(target,con) {
  const override=story.dialogues.find(d=>d.original?.path===con.path);
  const bar=document.createElement('div'); bar.className='gc-original-actions';
  bar.innerHTML=`<button data-original-edit>${override&&!override.disabled?'Open editable copy':'Edit a copy'}</button><button data-original-disable ${override?.disabled?'disabled':''}>${override?.disabled?'Switched off':'Switch off'}</button>${override?'<button data-original-restore>Restore original</button>':''}<p class="tip">Record or import a voice below, then Apply in game with Revision closed. A dub affects matching speaker/text occurrences; copies and Switch off apply to this map.</p>`;
  target.querySelector('.gc-script header').after(bar);
  bar.querySelector('[data-original-edit]').onclick=async()=>{
    if(override?.disabled && !override.steps?.length) { // conversion must still pass before the off marker is removed
      const old=story.dialogues.indexOf(override); story.dialogues.splice(old,1); await copyOriginal(con); if(!story.dialogues.some(d=>d.original?.path===con.path))story.dialogues.splice(old,0,override);
    } else { if(override?.disabled){override.disabled=false;changed();} await copyOriginal(con); }
  };
  bar.querySelector('[data-original-disable]').onclick=()=>copyOriginal(con,true);
  bar.querySelector('[data-original-restore]')?.addEventListener('click',()=>restoreOriginal(con.path));
  const targets=[];
  for(const holder of target.querySelectorAll('[data-original-voice]')) {
    const speech=con.events.flatMap(e=>e.type==='Speech'?[e]:e.choices||[]).find(s=>s.path===holder.dataset.originalVoice);
    if(!speech) continue;
    const key=speech.dubKey;
    const line={text:speech.text,voice:voices[key]?key:undefined};
    holder.innerHTML=voiceBar(line,'o:'+targets.length);
    targets.push({line,who:speech.speaker,body:{original:{package:window.__gamecons.data.package,conversation:con.path,event:speech.event || speech.path},line:{text:speech.text}}});
  }
  wireVoices(target,{kind:'o',targets},()=>window.__gamecons.renderConversation(target,con.path));
}
window.__story = {
  originalControls,
  save,
  data: () => story,
  async open() { if (!(await ensure())) return; unpeek(); root.classList.add('open'); render(); await window.__gamecons?.load(); render(); },
  async showOriginal(path) { if (!(await ensure())) return; await window.__gamecons?.load(); current={kind:'o',path}; unpeek(); root.classList.add('open'); render(); },
  async openFor(actorName) {
    if (!(await ensure())) return;
    await window.__gamecons?.load();
    window.__gamecons?.setActor(actorName);
    unpeek();
    root.classList.add('open');
    const i = story.dialogues.findIndex((d) => d.owner === actorName);
    const originals = window.__gamecons?.actorConversations(actorName) || [];
    if (i >= 0) current = { kind: 'd', i };
    else if (originals.length) current = { kind: 'o', path: originals.find(c=>c.properties.bnoninteractive !== 'True' && c.group !== 'AIBarks')?.path || originals[0].path };
    else {
      story.dialogues.push({ id: nextId('d', story.dialogues), title: actorName + '\'s dialogue', owner: actorName, bind: bindOf(actorName), start: 'talk', radius: 200, once: true, requires: [], steps: [{ type: 'line', who: 'npc', text: '' }, { type: 'line', who: 'jc', text: '' }] });
      current = { kind: 'd', i: story.dialogues.length - 1 };
      changed();
    }
    render();
  },
  async count(actorName) { if (!(await ensure())) return 0; return story.dialogues.filter((d) => d.owner === actorName).length; },
  get dirty() { return dirty; },
  get saving() { return saveQueue.pending; },
  reset() { loadEpoch++; revision++; storyLoad=null; catalogFlags=[]; allMaps=null; for(const key of Object.keys(peopleCache))delete peopleCache[key]; story = null; mapLoaded = null; current = null; dirty = false; $('#st-save').textContent='Save'; root.classList.remove('open'); },
};

for(const event of ['deusedix:mission-flags','deusedix:original-conversations']) window.addEventListener(event,()=>{if(story){refreshFlags();$('#st-edit').refreshStateCatalog?.();}});

$('#st-state').onclick=()=>{current={kind:'state'};render();};
