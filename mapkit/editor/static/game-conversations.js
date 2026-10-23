// Original game content is read from the player's install and stays in the local cache.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const E = () => window.__editor;
let data = null, pending = null, map = null, error = '', epoch = 0, audio = null, playing = null, audioEpoch = 0;
let browserRows = [], searchEpoch = 0, searchTimer;
let browserMission = null, browserOwner = '', browserPackage = null, browserKind='all';
let selectedVoice = null;
async function request(url) { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Cannot read original conversations.'); return j; }
function stopAudio() {
  ++audioEpoch;
  audio?.pause(); audio = null;
  if (playing) { playing.textContent = '▶'; playing.setAttribute('aria-pressed','false'); }
  playing = null;
}
async function play(sound, button, packageName = data?.package || '') {
  if (playing === button) { stopAudio(); return; }
  stopAudio(); const token = audioEpoch; playing = button; button.textContent = '…';
  try {
    const item = await request('/api/gamevoice?sound=' + encodeURIComponent(sound) + '&package=' + encodeURIComponent(packageName));
    if (token !== audioEpoch) return;
    audio = new Audio(item.url); audio.onended = stopAudio; audio.onerror = stopAudio;
    window.__tutorialMusic?.hushWhile(audio);
    await audio.play(); button.textContent = '■'; button.setAttribute('aria-pressed','true');
  } catch (e) { if (token === audioEpoch) { stopAudio(); button.title = e.message; E()?.log('Original voice: ' + e.message, 'bad'); } }
}
function wireAudio(root, packageName) { for (const button of root.querySelectorAll('[data-original-sound]')) button.onclick = () => play(button.dataset.originalSound, button, packageName); }
function playButton(sound) { return sound ? `<button data-original-sound="${esc(sound)}" title="Play original voice" aria-label="Play original voice" aria-pressed="false">▶</button>` : '<small>Text only</small>'; }
function conditions(flags) { return (flags || []).map(f => `${f.flag} = ${f.value ? 'true' : 'false'}`).join(', ') || 'None'; }
function isBark(con) { return con.properties.bnoninteractive === 'True' || con.group === 'AIBarks'; }
function startText(con) {
  const p=con.properties;
  if (p.bdatalinkcon === 'True') return 'InfoLink' + (p.bdisplayonce === 'True' ? ' · Once' : '');
  if (isBark(con)) return 'Bark';
  return [
    p.binvokefrob === 'True' && 'Talk', p.binvokebump === 'True' && 'Touch', p.binvokesight === 'True' && 'Sight',
    p.binvokeradius === 'True' && `Radius ${p.radiusdistance}`, p.bdisplayonce === 'True' && 'Once'].filter(Boolean).join(' · ') || 'Script';
}
function actorConversations(name) { const paths = data?.actors[name] || []; return (data?.conversations || []).filter(c => paths.includes(c.path)); }
async function load() {
  const name = E()?.mapName;
  if (!name) return null;
  if (map === name && pending) return pending;
  if (map === name && data) return data;
  map = name; data = null; error = ''; const generation = ++epoch;
  pending = request('/api/gamecons?map=' + encodeURIComponent(name)).then(result => {
    if (generation !== epoch) return null;
    data = result; window.dispatchEvent(new CustomEvent('deusedix:original-conversations')); return result;
  }).catch(e => { if (generation === epoch) error = e.message; return null; }).finally(() => {
    if (generation === epoch) { pending = null; renderStoryList(); }
  });
  return pending;
}
function renderStoryList() {
  const target = $('#st-originals'); if (!target) return;
  if (!data) { target.innerHTML = `<p class="tip">${esc(error || 'Reading original conversations…')}</p>`; return; }
  const selected = E()?.selected?.userData?.actor;
  const name = target.dataset.actor ?? selected?.name ?? '';
  const cons = name ? actorConversations(name) : data.conversations.filter(c=>!isBark(c));
  target.innerHTML = `<select aria-label="Original conversations for actor" id="gc-actor"><option value="">All characters and InfoLinks</option>${Object.keys(data.actors).sort().map(n => `<option value="${esc(n)}" ${n===name?'selected':''}>${esc(n)}</option>`).join('')}</select>`
    + '<div class="gc-con-list">' + (cons.map(c=>`<button class="it" data-original-con="${esc(c.path)}">${esc(c.name)}<small>${esc(c.owner || 'Radio')} · ${esc(startText(c))}</small></button>`).join('') || '<p class="tip">No original conversations for this selection.</p>') + '</div>';
  window.__missionFlags?.render();
  $('#gc-actor').onchange = e => { target.dataset.actor = e.target.value; renderStoryList(); };
  for (const b of target.querySelectorAll('[data-original-con]')) b.onclick = () => window.__story.showOriginal(b.dataset.originalCon);
}
function eventSummary(e) {
  const p=e.properties;
  if(e.type === 'SetFlag') return 'Set ' + conditions(e.flags);
  if(e.type === 'CheckFlag') return 'If ' + conditions(e.flags) + ' → ' + p.setlabel;
  if(e.type === 'AddGoal') return (p.bgoalcompleted === 'True' ? 'Complete goal: ' : 'Add goal: ') + p.goalname;
  if(e.type === 'AddNote') return 'Add note: ' + p.notetext;
  if(e.type === 'Jump') return 'Go to ' + p.jumplabel;
  if(e.type === 'RandomLabel') return 'Random jump: ' + (e.labels || []).join(', ');
  if(e.type === 'TransferObject') return `Give ${p.transfercount} × ${p.objectname} · ${p.fromname} → ${p.toname}`;
  if(e.type === 'CheckObject') return 'Check item: ' + p.objectname;
  if(e.type === 'AddCredits') return 'Add credits: ' + p.creditstoadd;
  if(e.type === 'AddSkillPoints') return 'Add skill points: ' + p.pointstoadd;
  return e.type.replace(/([a-z])([A-Z])/g, '$1 $2');
}
function renderConversation(target, path) {
  const con=data?.conversations.find(c=>c.path===path);
  if (!con) { target.innerHTML='<p class="tip">This conversation is not available in the current map.</p>'; return; }
  const propsText = event => Object.entries(event.properties).filter(([k,v]) => !['conversation','nextevent','eventtype','label'].includes(k) && v !== '' && v !== 'None')
    .map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  target.innerHTML = `<div class="gc-script"><header><h2>${esc(con.name)}</h2><span class="gc-badge">Original</span></header>
    <p>${esc(con.owner || 'Radio call')} · ${esc(startText(con))}</p><p class="tip">Conditions: ${esc(conditions(con.requires))}</p>
    ${con.properties.bdatalinkcon === 'True' ? `<p class="tip">${esc(data.radioScope)}</p>` : ''}
    ${con.events.map(e=> e.type === 'Speech' ? `<article class="gc-line"><div>${playButton(e.sound)}<b>${esc(e.speaker)}</b><small>to ${esc(e.speakingTo)}</small>${e.label?`<code>${esc(e.label)}</code>`:''}</div><p>${esc(e.text)}</p><div data-original-voice="${esc(e.path)}"></div></article>`
      : e.type === 'Choice' ? `<article class="gc-line"><b>JC's answers</b>${e.choices.map(c=>`<p>${playButton(c.sound)} ${esc(c.text)} → <code>${esc(c.label)}</code></p><small>${esc(conditions(c.flags))}${c.skill ? ` · ${esc(c.skill)} level ${c.skillLevel}` : ''}</small>${c.properties.bdisplayasspeech==='True'?`<div data-original-voice="${esc(c.path)}"></div>`:''}`).join('')}</article>`
      : `<details class="gc-event"><summary>${esc(eventSummary(e))}${e.label ? ' · ' + esc(e.label) : ''}</summary><dl>${propsText(e)}</dl></details>`).join('')}</div>`;
  wireAudio(target);
  if (!isBark(con)) window.__story?.originalControls(target,con);
  else target.insertAdjacentHTML('afterbegin','<p class="tip">Ambient NPC phrase · Read-only. Reuse its voice from Game voices.</p>');
}
async function browser(append = false) {
  const target=$('#gamevoices'); if (!target) return;
  const token=++searchEpoch, q=$('#gvsearch')?.value.trim() || '';
  const mission=$('#gv-mission')?.value ?? browserMission ?? String(data?.mission ?? '');
  const owner=$('#gv-owner')?.value ?? browserOwner;
  const packageName=$('#gv-package')?.value ?? browserPackage ?? data?.package ?? '';
  const kind=$('#gv-kind')?.value ?? browserKind; browserKind=kind;
  browserMission=mission; browserOwner=owner; browserPackage=packageName;
  const offset=append?browserRows.length:0;
  if (!append) target.innerHTML='<p class="hint">Reading original voices…</p>';
  try {
    const params=new URLSearchParams({q,kind,limit:'100',offset:String(offset),package:packageName});
    if (mission) params.set('mission',mission);
    if (owner) params.set('owner',owner);
    const found=await request('/api/gamecons/search?'+params);
    if (token!==searchEpoch) return;
    browserRows=append?browserRows.concat(found.lines):found.lines;
    const groups=new Map();
    for (const line of browserRows) { const key=line.owner || 'Radio'; if(!groups.has(key))groups.set(key,new Map()); const cons=groups.get(key); if(!cons.has(line.conversation))cons.set(line.conversation,[]); cons.get(line.conversation).push(line); }
    target.innerHTML=`<div class="gc-filters"><label>Voices <select id="gv-package">${found.packages.map(p=>`<option value="${esc(p.name)}" ${p.name===packageName?'selected':''}>${esc(p.label)}</option>`).join('')}</select></label>
      <label>Type <select id="gv-kind">${[['all','All lines'],['conversations','Conversations'],['barks','Ambient NPC phrases']].map(([k,label])=>`<option value="${k}" ${k===kind?'selected':''}>${label}</option>`).join('')}</select></label>
      <label>Mission <select id="gv-mission"><option value="">All missions</option>${found.missions.map(m=>`<option value="${m.number}" ${String(m.number)===mission?'selected':''}>${String(m.number).padStart(2,'0')} · ${esc(m.title)}</option>`).join('')}</select></label>
      <label>Character <select id="gv-owner"><option value="">All characters</option>${found.owners.map(n=>`<option ${n===owner?'selected':''}>${esc(n)}</option>`).join('')}</select></label><small>${found.total} lines · Original voices stay in your game install.</small></div>
      ${kind==='barks'?'<p class="hint">Ambient reactions are read-only. Listen here, or reuse a voice by reference in your own dialogue.</p>':''}
      <div class="gc-results">${[...groups].map(([person,cons])=>`<details ${q?'open':''}><summary>${esc(person)}</summary>${[...cons].map(([name,lines])=>`<details ${q?'open':''}><summary>${esc(name)}</summary>${lines.map(l=>`<div class="gc-browser-line">${playButton(l.sound)}<span><b>${esc(l.speaker)}</b> ${esc(l.text)}</span></div>`).join('')}</details>`).join('')}</details>`).join('') || '<p class="hint">No matching lines.</p>'}</div>
      ${browserRows.length<found.total?'<button id="gv-more">Show more lines</button>':''}`;
    $('#gv-mission').onchange=()=>{ $('#gv-owner').value=''; browser(); };
    $('#gv-owner').onchange=()=>browser();
    $('#gv-kind').onchange=()=>{ $('#gv-mission').value=''; $('#gv-owner').value=''; browser(); }; 
    $('#gv-package').onchange=()=>{stopAudio(); $('#gv-owner').value=''; browser();};
    if ($('#gv-more')) $('#gv-more').onclick=()=>browser(true);
    wireAudio(target, packageName);
    for (const row of target.querySelectorAll('.gc-browser-line')) {
      const sound=row.querySelector('[data-original-sound]')?.dataset.originalSound; if(!sound) continue;
      row.draggable=true; row.title='Drag onto a Story voice bar, or select this voice and press Use game voice on your line.';
      const clip={ref:sound,package:packageName};
      row.ondragstart=e=>{e.dataTransfer.setData('application/x-deusedix-game-voice',JSON.stringify(clip));e.dataTransfer.effectAllowed='copy';};
      const pick=document.createElement('button');pick.textContent='Select voice';pick.onclick=()=>{selectedVoice=clip;target.querySelectorAll('[data-voice-selected]').forEach(b=>{b.textContent='Select voice';delete b.dataset.voiceSelected;});pick.dataset.voiceSelected='1';pick.textContent='Selected';};row.append(pick);
    }
  } catch(e) { if(token===searchEpoch)target.innerHTML=`<p class="hint bad">${esc(e.message)}</p>`; }
}
$('#gvsearch')?.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>browser(),220);});
window.addEventListener('deusedix:map-state',e=>{
  stopAudio();
  ++searchEpoch; clearTimeout(searchTimer); browserRows=[]; browserMission=null; browserOwner=''; browserPackage=null; browserKind='all';
  $('#st-originals')?.removeAttribute('data-actor');
  if(e.detail.open) load().then(()=>{ if($('#bottom [data-tab="gamevoices"]')?.classList.contains('on')) { $('#gamevoices').innerHTML=''; browser(); } });
  else { ++epoch; map=null; data=null; pending=null; error=''; if($('#gamevoices')) $('#gamevoices').innerHTML=''; }
});
window.addEventListener('deusedix:selection',()=>{ if($('#story')?.classList.contains('open')) { $('#st-originals')?.removeAttribute('data-actor'); renderStoryList(); } });
window.__gamecons={load,browser,renderStoryList,renderConversation,actorConversations,
  get selectedVoice(){return selectedVoice;},
  get data(){return data;}, setActor(name){const target=$('#st-originals');if(target)target.dataset.actor=name || '';renderStoryList();},
  stopAudio,play};
