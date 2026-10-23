// File > Export mod...: the campaign as one .dxmod (mods.py export) in Documents\DeusEdix Mods, ready to
// install with Projects > Mods > Install mod... or to share. Loaded on demand by the menu.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let dialog = null;

async function call(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The request failed.');
  return j;
}

// the 3D view as the mod's picture (16:9, 480 wide): drawn again now so the WebGL canvas has it
function viewPicture() {
  const ed = window.__editor, canvas = ed?.renderer?.domElement;
  if (!canvas || !ed.script || !canvas.width) return null;
  try {
    ed.renderer.render(ed.scene, ed.camera);
    const out = document.createElement('canvas'); out.width = 480; out.height = 270;
    const k = Math.max(480 / canvas.width, 270 / canvas.height), w = canvas.width * k, h = canvas.height * k;
    out.getContext('2d').drawImage(canvas, (480 - w) / 2, (270 - h) / 2, w, h);
    return out.toDataURL('image/png');
  } catch (_) { return null; }
}

export async function openModExport() {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'map-dialog mod-export'; dialog.setAttribute('aria-labelledby', 'mod-export-title');
    document.body.appendChild(dialog);
    const css = document.createElement('style');
    css.textContent = `.mod-export main label { display:block; margin:8px 0 3px; }
      .mod-export main :is(input[type=text], textarea, select) { width:100%; }
      .mod-export textarea { min-height:54px; resize:vertical; }
      .mod-export .me-row { display:flex; gap:8px; } .mod-export .me-row > div { flex:1; min-width:0; }
      .mod-export .me-cover { display:flex; align-items:center; gap:10px; margin-top:8px; }
      .mod-export .me-cover img { width:128px; height:72px; object-fit:cover; border:1px solid var(--line); border-radius:3px; }
      .mod-export .me-note { color:var(--dim); font-size:11px; margin:6px 0 0; }
      .mod-export .me-warn { color:var(--warn); font-size:11px; margin:4px 0 0; }
      .mod-export .me-bad { color:var(--bad); margin:6px 0 0; }
      .mod-export .me-ok b { display:block; overflow-wrap:anywhere; margin-top:4px; }`;
    document.head.appendChild(css);
  }
  const picture = viewPicture();
  dialog.innerHTML = `<form method="dialog"><header><h2 id="mod-export-title">Export mod</h2><button type="button" data-close>Close</button></header>
    <main><p class="me-note">Checking the project…</p></main><footer><button type="button" data-close>Cancel</button><button type="submit" class="primary" disabled>Export</button></footer></form>`;
  const $ = (s) => dialog.querySelector(s);
  for (const b of dialog.querySelectorAll('[data-close]')) b.onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
  let info;
  try { info = await call('/api/mod_export'); } catch (e) { $('main').innerHTML = `<p class="me-bad">${esc(e.message)}</p>`; return; }
  if (!info.ok) { $('main').innerHTML = `<p class="me-bad">${esc(info.reason)}</p>`; return; }
  const pending = info.maps.filter((m) => m.pending);
  $('main').innerHTML = `<div class="me-row"><div><label for="me-name">Name</label><input type="text" id="me-name" maxlength="80" required value="${esc(info.name)}"></div>
      <div style="flex:0 0 96px"><label for="me-version">Version</label><input type="text" id="me-version" maxlength="32" required value="${esc(info.version)}"></div></div>
    <label for="me-author">Author</label><input type="text" id="me-author" maxlength="80" value="${esc(info.author)}" placeholder="Your name">
    <label for="me-desc">Description</label><textarea id="me-desc" maxlength="2000" placeholder="What the player will find">${esc(info.description)}</textarea>
    <label for="me-start">Starts on</label><select id="me-start">${info.maps.map((m) => `<option value="${esc(m.name)}" ${m.name === info.start ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    <div class="me-cover">${picture ? `<img src="${picture}" alt=""><label style="margin:0"><input type="checkbox" id="me-pic" checked> Use this view as its picture</label>` : '<span class="me-note" style="margin:0">Open a map and frame a nice view to give the mod a picture.</span>'}</div>
    ${pending.length ? `<p class="me-warn">Not installed yet: ${esc(pending.map((m) => m.name).join(', '))}. The mod takes their last installed version (Map &gt; Install map first to include the latest changes).</p>` : ''}
    <p class="me-note" id="me-info">For ${esc(info.gameName)}. ${info.maps.length} map${info.maps.length === 1 ? '' : 's'} and the project's packages, nothing of the game. Saved in ${esc(info.folder)}.</p>
    <p class="me-bad" role="status"></p>`;
  $('button[type=submit]').disabled = !info.maps.length;
  $('form').onsubmit = async (e) => {
    e.preventDefault();
    const submit = $('button[type=submit]'), msg = $('.me-bad');
    if (!$('#me-name').value.trim() || !$('#me-version').value.trim()) { msg.textContent = 'Give the mod a name and a version.'; return; }
    submit.disabled = true; msg.textContent = '';
    $('#me-info').textContent = 'Exporting… building the project\'s packages can take a minute.';
    try {
      const r = await call('/api/mod_export', { name: $('#me-name').value.trim(), version: $('#me-version').value.trim(),
        author: $('#me-author').value.trim(), description: $('#me-desc').value.trim(), start: $('#me-start').value,
        cover: picture && $('#me-pic')?.checked ? picture : '' });
      $('main').innerHTML = `<div class="me-ok">The mod is ready (${(r.size / 1048576).toFixed(1)} MB):<b>${esc(r.path)}</b></div>
        ${r.warnings.map((w) => `<p class="me-warn">${esc(w)}</p>`).join('')}
        <p class="me-note">Install it with Projects &gt; Mods &gt; Install mod… (or drop the file there), then Play. Share the file as it is.</p>`;
      $('footer').innerHTML = '<button type="button" data-reveal>Show in folder</button><button type="button" class="primary" data-close>Done</button>';
      $('[data-close]').onclick = () => dialog.close();
      $('[data-reveal]').onclick = () => call('/api/mods/reveal', { path: r.path }).catch(() => {});
    } catch (err) { msg.textContent = err.message; submit.disabled = false; $('#me-info').textContent = ''; }
  };
}
window.__modExport = { open: openModExport };
