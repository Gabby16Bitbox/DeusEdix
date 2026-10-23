// Projects > Mods: the mods installed in both games (mods.py), with Play and Remove, and Install mod...
// (a .dxmod file chosen or dropped on the page). A mod is a finished project made with File > Export mod...
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5-7-4.5Z"/></svg>';
const TRASH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';
const BOX = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 9 14 4l10 5v11l-10 5-10-5V9Zm0 0 10 5 10-5M14 14v11"/></svg>';

async function call(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'The request failed.'), { data: j, status: r.status });
  return j;
}

export function mountMods(section) {
  if (!section) return null;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/static/mods-hub.css'; document.head.appendChild(css);
  section.innerHTML = `<div class="mods-head"><h2>Mods</h2><span class="mods-status" role="status"></span>
    <button type="button" class="mods-install" title="Install a mod you downloaded: a .dxmod made with DeusEdix or a mod's .zip. You can also drop it on this page.">Install mod…</button>
    <input type="file" class="mods-file" accept=".dxmod,.zip" hidden></div><div class="mods-list"></div>`;
  const $ = (s) => section.querySelector(s);
  let mods = [], busy = false;
  const status = (text, kind = '') => { const s = $('.mods-status'); s.textContent = text || ''; s.dataset.kind = kind; };

  function render() {
    $('.mods-list').innerHTML = mods.length ? mods.map((m) => {
      const missing = m.missing?.length ? `<span class="mods-warn">Needs: ${esc(m.missing.join(', '))}</span>` : '';
      return `<article class="mods-card" data-game="${esc(m.game)}" data-id="${esc(m.id)}">
        <div class="mods-cover">${m.cover ? `<img src="/mods/cover?game=${encodeURIComponent(m.game)}&id=${encodeURIComponent(m.id)}&v=${Math.round(m.installed)}" alt="">` : BOX}</div>
        <div class="mods-copy"><b>${esc(m.name)}</b><small>${esc([m.author, m.kind === 'classic' ? 'downloaded mod' : 'v' + m.version, m.gameName].filter(Boolean).join(' · '))}</small>
          ${m.description ? `<p>${esc(m.description)}</p>` : ''}${missing}
          ${m.maps.length > 1 ? `<label class="mods-start">Starts on <select title="The map the game opens">${m.maps.map((x) => `<option ${x === m.start ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : ''}</div>
        <div class="mods-actions"><button type="button" class="mods-play" ${m.missing?.length ? 'disabled' : ''} title="Start ${esc(m.gameName)} on ${esc(m.start)}">${PLAY}<span>Play</span></button>
          <button type="button" class="mods-remove icon" title="Remove this mod (its saved games too)" aria-label="Remove ${esc(m.name)}">${TRASH}</button></div></article>`;
    }).join('') : '<p class="projects-empty">No mods installed yet. Install a .dxmod file, or make one from your campaign with File &gt; Export mod…</p>';
    for (const b of section.querySelectorAll('button')) b.disabled = busy || (b.classList.contains('mods-play') && b.closest('.mods-card')?.querySelector('.mods-warn'));
  }
  async function refresh() {
    try { mods = (await call('/api/mods')).mods || []; } catch (e) { status(e.message, 'bad'); }
    render();
  }
  async function install(file) {
    if (!file) return;
    if (!/\.(dxmod|zip)$/i.test(file.name)) { status('Choose a .dxmod or a .zip file.', 'bad'); return; }
    busy = true; render(); status(`Installing ${file.name}…`);
    const send = (replace) => fetch(`/api/mods/install?name=${encodeURIComponent(file.name)}${replace ? '&replace=1' : ''}`, { method: 'POST', body: file });
    try {
      let r = await send(false), j = await r.json().catch(() => ({}));
      if (r.status === 409 && j.exists) {
        const e = j.exists;
        if (!confirm(`${e.name} ${e.installed} is already installed. Replace it with ${e.incoming}?\nSaved games are kept.`)) { status(''); return; }
        r = await send(true); j = await r.json().catch(() => ({}));
      }
      if (!r.ok) throw new Error(j.error || 'The mod was not installed.');
      const left = j.skipped?.length ? ` Left out for safety: ${j.skipped.join(', ')}.` : '';
      status(`${j.manifest.name} ${j.replaced ? 'updated' : 'installed'} for ${j.manifest.game === 'vanilla' ? 'Deus Ex' : 'Revision'}.${left}`, left ? 'warn' : 'ok');
    } catch (e) { status(e.message, 'bad'); }
    finally { busy = false; await refresh(); }
  }

  $('.mods-install').onclick = () => $('.mods-file').click();
  $('.mods-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; install(f); };
  section.addEventListener('change', async (e) => {          // Starts on: the map the game opens
    const sel = e.target.closest('.mods-start select'), card = sel?.closest('.mods-card');
    if (!card) return;
    try { await call('/api/mods/start', { game: card.dataset.game, id: card.dataset.id, start: sel.value }); status('It now starts on ' + sel.value + '.', 'ok'); await refresh(); }
    catch (err) { status(err.message, 'bad'); }
  });
  section.addEventListener('click', async (e) => {
    const card = e.target.closest('.mods-card'), m = card && mods.find((x) => x.id === card.dataset.id && x.game === card.dataset.game);
    if (!m || busy) return;
    if (e.target.closest('.mods-play')) {
      busy = true; render(); status(`Starting ${m.name}…`);
      try { await call('/api/mods/play', { game: m.game, id: m.id }); status(`${m.name} is starting in ${m.gameName}.`, 'ok'); }
      catch (err) { status(err.message, 'bad'); }
      finally { busy = false; render(); }
    } else if (e.target.closest('.mods-remove')) {
      if (!confirm(`Remove ${m.name}? Its saved games are removed too.`)) return;
      busy = true; render();
      try { await call('/api/mods/uninstall', { game: m.game, id: m.id }); status(`${m.name} removed.`, 'ok'); }
      catch (err) { status(err.message, 'bad'); }
      finally { busy = false; await refresh(); }
    }
  });
  // a .dxmod dropped anywhere on the Projects page installs it
  const hub = section.closest('#projecthub') || document.body;
  hub.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); hub.classList.add('mods-drop'); } });
  hub.addEventListener('dragleave', (e) => { if (e.target === hub) hub.classList.remove('mods-drop'); });
  hub.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])], f = files.find((x) => /\.(dxmod|zip)$/i.test(x.name));
    hub.classList.remove('mods-drop');
    if (!files.length) return;
    e.preventDefault();                      // a dropped file never replaces the page
    if (f) install(f); else status('Drop a .dxmod or a mod\'s .zip to install it.', 'bad');
  });
  refresh();
  return { refresh, install };
}
