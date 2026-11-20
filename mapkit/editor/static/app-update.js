// A newer DeusEdix on GitHub (editor/app_update.py): asked once when DeusEdix starts (the Projects page, unless turned
// off in this dialog) and from Help > Check for updates...; shows the changelog of every newer release, then downloads
// the installer, checks its SHA-256 and starts it. The installer offers Update and closes DeusEdix itself.
const AUTO_KEY = 'deusedix.update.auto', SKIP_KEY = 'deusedix.update.skip', SHOWN_KEY = 'deusedix.update.shown';
const QUIET_MS = 20 * 3600 * 1000;      // Later: the start's check shows the same version again the next day
const store = {
  get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
  set(key, value) { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (_) { /* optional */ } },
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const desktop = () => !!(window.pywebview && window.pywebview.api);
function openUrl(url) {
  if (!/^https:\/\/github\.com\//.test(url)) return;
  if (desktop()) window.pywebview.api.open_url(url); else window.open(url, '_blank', 'noopener');
}
function megabytes(n) { return n ? `${(n / 1048576).toFixed(1)} MB` : ''; }

// the release notes are Markdown (GitHub's): headings, lists (nested by indent), bold, code, links shown as text
export function notesHtml(text) {
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1');
  const out = []; let depth = 0, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const close = to => { while (depth > to) { out.push('</li></ul>'); depth--; } };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const item = raw.match(/^(\s*)[-*] (.*)$/), head = raw.match(/^#{1,4}\s+(.*)$/);
    if (item) {
      flush();
      const level = Math.min(4, Math.floor(item[1].length / 2) + 1);
      if (level > depth) { while (depth < level) { out.push('<ul><li>'); depth++; } }
      else { close(level); out.push('</li><li>'); }
      out.push(inline(item[2]));
    } else if (head) { flush(); close(0); out.push(`<h4>${inline(head[1])}</h4>`); }
    else if (!raw.trim()) { flush(); close(0); }
    else if (depth && /^\s+/.test(raw)) out.push(' ' + inline(raw.trim()));      // a list item going on
    else { close(0); para.push(raw.trim()); }
  }
  flush(); close(0);
  return out.join('');
}

let dialog = null, checking = false;
async function call(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The update request failed.');
  return result;
}
function frame(title, body, buttons) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'update-dialog'; dialog.className = 'map-dialog project-dialog update-dialog';
    dialog.setAttribute('aria-labelledby', 'update-dialog-title');
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `<form method="dialog"><header><h2 id="update-dialog-title">${esc(title)}</h2></header><main>${body}</main>
    <footer>${buttons}</footer></form>`;
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function showAvailable(info) {
  const latest = info.releases[0];
  const title = r => r.name || 'DeusEdix ' + r.version;
  // a release's notes start with its own name again ("DeusEdix 0.1.73"): shown once, as the heading
  const body = r => String(r.notes || '').replace(/^\s*#*\s*(.*)\r?\n/, (line, first) => first.trim() === title(r).trim() ? '' : line);
  const notes = info.releases.map(r => `<section class="update-release"><h3>${esc(title(r))}</h3>${notesHtml(body(r))}</section>`).join('');
  const auto = store.get(AUTO_KEY) !== '0';
  const d = frame(`DeusEdix ${latest.version} is available`,
    `<p>You have DeusEdix ${esc(info.current)}.${info.releases.length > 1 ? ` ${info.releases.length} newer versions, newest first:` : ''}</p>
     <div class="update-notes">${notes}</div>
     <p class="project-note">The installer (${esc(megabytes(latest.size))}) is downloaded from GitHub and checked before it starts. It updates DeusEdix in place: your projects stay as they are.</p>
     <label class="update-auto"><input type="checkbox" id="update-auto"${auto ? ' checked' : ''}> Check for updates when DeusEdix starts</label>
     <p class="project-error" role="status"></p>`,
    `<button type="button" data-act="skip">Skip this version</button><button type="button" data-act="page">View on GitHub</button>
     <button type="button" data-act="later">Later</button><button type="button" class="primary" data-act="get">Download and install</button>`);
  d.querySelector('#update-auto').onchange = e => store.set(AUTO_KEY, e.target.checked ? null : '0');
  d.querySelector('[data-act=skip]').onclick = () => { store.set(SKIP_KEY, latest.version); d.close(); };
  d.querySelector('[data-act=later]').onclick = () => d.close();
  d.querySelector('[data-act=page]').onclick = () => openUrl(latest.url);
  d.querySelector('[data-act=get]').onclick = () => download(latest.version, info);
  d.querySelector('[data-act=get]').focus();
}

async function download(version, info) {
  const d = frame(`Downloading DeusEdix ${version}`,
    `<p class="update-progress-text">Starting the download…</p><progress class="update-progress" max="1" value="0"></progress>
     <p class="project-error" role="status"></p>`,
    `<button type="button" data-act="cancel">Close</button>`);
  d.querySelector('[data-act=cancel]').onclick = () => d.close();
  const text = d.querySelector('.update-progress-text'), bar = d.querySelector('.update-progress');
  try {
    let state = await call('/api/app/update/download', { version });
    while (state.state === 'downloading') {
      if (state.total) { bar.max = state.total; bar.value = state.done || 0; }
      text.textContent = `${megabytes(state.done || 0)} of ${megabytes(state.total) || '…'}`;
      await new Promise(resolve => setTimeout(resolve, 400));
      state = await call('/api/app/update/status');
    }
    if (state.state === 'error') throw new Error(state.error);
    if (state.state !== 'ready') throw new Error('The download stopped.');
    ready(version, state, info);
  } catch (e) {
    if (!d.open) return;
    d.querySelector('.project-error').textContent = `${e.message} You can also download it from GitHub.`;
    d.querySelector('footer').innerHTML = `<button type="button" data-act="cancel">Close</button><button type="button" class="primary" data-act="page">Open the release page</button>`;
    d.querySelector('[data-act=cancel]').onclick = () => d.close();
    d.querySelector('[data-act=page]').onclick = () => openUrl(info.releases[0].url);
  }
}

function ready(version, state, info) {
  const d = frame(`DeusEdix ${version} is ready to install`,
    `<p>${state.verified ? 'The installer was downloaded and matches the SHA-256 published with it.' : 'The installer was downloaded.'}</p>
     <p>Save your work first. The installer asks to close DeusEdix, updates it, then starts it again.</p>
     <p class="project-error" role="status"></p>`,
    `<button type="button" data-act="later">Later</button><button type="button" class="primary" data-act="run">Install now</button>`);
  d.querySelector('[data-act=later]').onclick = () => d.close();
  d.querySelector('[data-act=run]').onclick = async () => {
    try {
      await call('/api/app/update/install', {});
      frame('Installer started', `<p>Follow the installer's steps. When it asks, let it close DeusEdix.</p>`,
        `${desktop() ? '<button type="button" data-act="exit">Close DeusEdix now</button>' : ''}<button type="button" class="primary" data-act="ok">OK</button>`);
      dialog.querySelector('[data-act=ok]').onclick = () => dialog.close();
      dialog.querySelector('[data-act=exit]')?.addEventListener('click', () => window.pywebview.api.exit());
    } catch (e) { d.querySelector('.project-error').textContent = e.message; }
  };
  d.querySelector('[data-act=run]').focus();
}

// manual: Help > Check for updates... (always answers); otherwise the start's check (quiet, respects the switches)
async function check(manual = false) {
  if (checking || dialog?.open) return;
  if (!manual && store.get(AUTO_KEY) === '0') return;
  checking = true;
  try {
    const info = await call('/api/app/update' + (manual ? '?fresh=1' : ''));
    if (!info.installed) { if (manual) frame('Check for updates', '<p>This copy of DeusEdix is not an installed one, so it does not update itself.</p>', '<button class="primary">OK</button>'); return; }
    if (info.error) { if (manual) frame('Check for updates', `<p>${esc(info.error)}</p>`, '<button class="primary">OK</button>'); return; }
    if (!info.available) { if (manual) frame('Check for updates', `<p>DeusEdix ${esc(info.current)} is the newest version.</p>`, '<button class="primary">OK</button>'); return; }
    if (!manual) {
      if (store.get(SKIP_KEY) === info.latest) return;
      let shown = null; try { shown = JSON.parse(store.get(SHOWN_KEY) || 'null'); } catch (_) { /* none */ }
      if (shown?.v === info.latest && Date.now() - shown.at < QUIET_MS) return;
    }
    store.set(SHOWN_KEY, JSON.stringify({ v: info.latest, at: Date.now() }));
    showAvailable(info);
  } catch (e) {
    if (manual) frame('Check for updates', `<p>${esc(e.message)}</p>`, '<button class="primary">OK</button>');
  } finally { checking = false; }
}

if (typeof window !== "undefined") window.__appUpdate = { check };
export { check };
