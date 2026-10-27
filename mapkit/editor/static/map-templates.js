// Map templates (as Unity's scene templates): File > Save map as template... keeps the open map's place in the
// project with a picture of the 3D view and a description (editor/maptemplates.py says what it keeps and what it
// leaves out); New map (app.js openNewMap) shows the project's templates as tiles beside An empty room and A copy of
// a map, each with its picture, and a × that deletes it. The tiles and their words are pure (tests/test_map_templates.mjs).
import { escapeHtml } from './shortcut-bar.js';

// New map's "Start from": An empty room, A copy of a map, then the project's templates (a radio each, named nmfrom
// as before: a template's is "template" with its id). icons: {empty, copy}, the first two tiles' pictures (SVG)
export function startTiles(templates, icons = {}) {
  const tile = (value, label, picture, { id = '', title = '', checked = false } = {}) =>
    `<label class="nm-tile"${title ? ` title="${escapeHtml(title)}"` : ''}><input type="radio" name="nmfrom" value="${value}"`
    + `${id ? ` data-template="${escapeHtml(id)}"` : ''}${checked ? ' checked' : ''}>${picture}<span>${escapeHtml(label)}</span>`
    + `${id ? `<button type="button" class="nm-del" data-nmdel="${escapeHtml(id)}" title="Delete this template" aria-label="Delete the template ${escapeHtml(label)}">×</button>` : ''}</label>`;
  return [tile('empty', 'An empty room', `<span class="nm-pic">${icons.empty || ''}</span>`, { checked: true }),
    tile('copy', 'A copy of a map', `<span class="nm-pic">${icons.copy || ''}</span>`),
    ...templates.map((t) => tile('template', t.name, t.picture ? `<img class="nm-pic" src="${escapeHtml(t.picture)}" alt="">` : '<span class="nm-pic"></span>',
      { id: t.id, title: [t.description, templateBase(t)].filter(Boolean).join('\n') }))].join('');
}

// what a template starts a map with, in a few words
export function templateBase(t) {
  return t.room ? `The room of ${t.source} (${t.room.size.join(' x ')}) with its changes.` : `A copy of ${t.source} with its changes.`;
}

// what New map says of the template chosen: its description, then what it is (a line each)
export function templateNote(t) {
  return [t.description, `${templateBase(t)} Characters, Interactions, cutscenes and the Story are not in it.`
    + (t.room ? ' The room is built at once (about half a minute).' : '')].filter(Boolean).join('\n');
}

// File > Save map as template...: the dialog. api: app.js's; picture: a JPEG of the 3D view now (data URL) or '';
// done(template): when it is kept
let dialog = null;
export function openSaveTemplate({ api, script, mapName, edits, picture, done }) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'map-dialog map-template'; dialog.setAttribute('aria-labelledby', 'map-template-title');
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `<form method="dialog"><header><h2 id="map-template-title">Save map as template</h2><button type="button" data-close>Close</button></header>
    <main><label for="mt-name">Name</label><input type="text" id="mt-name" maxlength="80" required value="${escapeHtml(mapName.replace(/^\d\d_/, '').replace(/_/g, ' '))}">
      <label for="mt-desc">Description</label><textarea id="mt-desc" maxlength="2000" placeholder="What a new map gets from it (shown under its tile)"></textarea>
      <div class="mt-picture">${picture ? `<img src="${picture}" alt=""><label><input type="checkbox" id="mt-pic" checked> Use this view as its picture</label>`
        : '<span class="hint">Frame a nice view of the map to give the template a picture.</span>'}</div>
      <p class="hint">It keeps the place of ${escapeHtml(mapName)}: blocks, drawings, structures, objects, lights, the start, map exits, zones,
        sounds, the sky and Map settings, with the pictures they use. It leaves out what belongs to its story: the characters,
        Interactions, cutscenes, computers' and books' texts, and the Story. New map shows it beside An empty room.</p>
      <p class="hint bad" role="status"></p></main>
    <footer><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save template</button></footer></form>`;
  const $ = (s) => dialog.querySelector(s);
  for (const b of dialog.querySelectorAll('[data-close]')) b.onclick = () => dialog.close();
  $('form').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#mt-name').value.trim(), submit = $('button[type=submit]'), msg = $('[role=status]');
    if (!name) { msg.textContent = 'Give the template a name.'; return; }
    submit.disabled = true; msg.textContent = 'Saving…';
    try {
      const r = await api('/api/map_template', { script, name, description: $('#mt-desc').value.trim(),
        picture: picture && $('#mt-pic')?.checked ? picture : '', edits });
      dialog.close();
      done(r.template);
    } catch (err) { msg.textContent = err.message; submit.disabled = false; }
  };
  if (!dialog.open) dialog.showModal();
  $('#mt-name').select();
}
