// Compact body/look controls. All mutations stay in app.js's Undo and map-generation boundaries.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function characterLookControls({ actor, mesh, props, characters }) {
  const templates = characters?.lookTemplates?.() || [];
  const body = templates.find(b => b.mesh.toLowerCase() === String(mesh || '').toLowerCase());
  if (!body) return '';
  const ref = value => { const match = /'([^']+)'/.exec(String(value || '')); return match ? match[1] : value === 'None' ? null : value; };
  const look = body.looks.find(p => p.skins.every((t,i) => ref(props[`MultiSkins(${i})`]) === t)) ||
    (!Object.keys(props).some(k => k.startsWith('MultiSkins(')) ? body.looks.find(p => p.id === actor.cls) : null);
  const label = person => body.looks.filter(p => p.name === person.name).length > 1
    ? person.id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2') : person.name;
  return `<div class="row"><label for="character-body">Body</label><select id="character-body" style="flex:1;min-width:0" title="Change the visual body. Actor class, dialogue, scripting tags, transform and collision stay unchanged.">${templates.map(b=>`<option value="${esc(b.mesh)}" ${b.mesh===body.mesh?'selected':''}>${esc(b.label)}</option>`).join('')}</select></div>
    <div class="row"><label for="character-look">Look</label><select id="character-look" style="flex:1;min-width:0" title="Complete character skin set for this body. Visual appearance only.">${look ? '' : '<option value="" selected disabled hidden>Custom / class default</option>'}${body.looks.map(p=>`<option value="${esc(p.id)}" title="${esc(p.id)}" ${look?.id===p.id?'selected':''}>${esc(label(p))}</option>`).join('')}</select></div>`;
}

export function wireCharacterLooks({ root = document, mesh, characters, apply }) {
  const body = root.querySelector('#character-body'), look = root.querySelector('#character-look');
  if (body) body.onchange = () => {
    const template = characters.lookTemplates().find(b => b.mesh === body.value);
    if (template) apply(template.mesh, template.default);
  };
  if (look) look.onchange = () => { if (look.value) apply(mesh, look.value); };
}
