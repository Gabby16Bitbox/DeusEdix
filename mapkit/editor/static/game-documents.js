// Original text stays read-only until the user saves a per-map copy.
const cached = new Map();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plainMarkup = s => '<P>' + String(s || '').replace(/\r/g,'').split(/\n|\|n/).map(x=>x.replace(/</g,'(').replace(/>/g,')')).join('<P>');
function readable(s) {
  return String(s || '').replace(/\r?\n/g,' ').replace(/<P\s*>/gi,'\n\n')
    .replace(/<FIRSTNAME>/gi,'[player first name]').replace(/<PLAYERNAME>/gi,'[player name]').replace(/<[^>]*>/g,'').trim();
}
async function mount(root, context) {
  const {actor, tag, packageName, special, current, save} = context;
  root.innerHTML='<p class="hint">Reading game text…</p>';
  let original = {found:false,text:'',source:''}, error='';
  if (tag && tag.toLowerCase()!=='none') {
    const params = new URLSearchParams({cls:actor.cls, tag, package:packageName || '',map:window.__editor?.mapName || ''});
    const key=params.toString();
    if (!cached.has(key)) cached.set(key,fetch('/api/gametext?'+params).then(async r=>{
      const data=await r.json(); if(!r.ok) throw Error(data.error || 'Cannot read game text.'); return data;
    }).catch(e=>{cached.delete(key);throw e;}));
    try { original=await cached.get(key); } catch(e) { error=e.message; }
  }
  if (!root.isConnected) return;
  const sourceText=(original.text || '') + (special ? plainMarkup(special) : '');
  const initial=current?.text ?? sourceText;
  function show() {
    root.innerHTML=`<div class="gd-heading"><b>${current ? 'Your text' : 'Game document'}</b><small>${esc(original.source || (special ? 'Map text' : 'No game text'))}</small></div>
      ${error || (!original.found && tag && tag!=='None') ? `<p class="hint bad">${esc(error || original.message)}</p>` : ''}
      <div class="gd-preview">${esc(readable(initial) || '(empty text)')}</div>
      <div class="row"><button data-doc-edit>${current ? 'Edit text' : sourceText ? 'Edit a copy' : 'Write text'}</button>${current ? '<button data-doc-restore>Restore original</button>' : ''}</div>
      <details><summary>Game text format</summary><p class="hint">Paragraphs use &lt;P&gt;. Keep existing tags for player names, colours and formatting. Editing this copy replaces this object’s text after Build.</p><pre class="gd-source"></pre></details>`;
    root.querySelector('pre').textContent=initial;
    root.querySelector('[data-doc-edit]').onclick=edit;
    root.querySelector('[data-doc-restore]')?.addEventListener('click',()=>save(null));
  }
  function edit() {
    root.innerHTML=`<label>Document text <textarea aria-label="Document text" rows="12" maxlength="55000" spellcheck="true"></textarea></label>
      <p class="hint">Use &lt;P&gt; for paragraphs. Existing game tags are kept. Save text, then Build to see the result in game.</p>
      <div class="row"><button data-doc-save>Save text</button><button data-doc-cancel>Cancel</button><button data-doc-paragraph>Insert paragraph</button></div><div class="gd-preview"></div>`;
    const input=root.querySelector('textarea'), preview=root.querySelector('.gd-preview');
    input.value=initial; const update=()=>{preview.textContent=readable(input.value);}; input.oninput=update; update();
    root.querySelector('[data-doc-save]').onclick=()=>save({text:input.value});
    root.querySelector('[data-doc-cancel]').onclick=show;
    root.querySelector('[data-doc-paragraph]').onclick=()=>{input.setRangeText('<P>',input.selectionStart,input.selectionEnd,'end');update();input.focus();};
    input.focus();
  }
  show();
}
window.__gameDocuments={mount};
window.addEventListener('deusedix:map-state',()=>cached.clear());
