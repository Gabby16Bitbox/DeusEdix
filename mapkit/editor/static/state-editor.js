import { FATE_PREDICATES, fateFlag, parseFate, stateLabel, normalizeCatalog, filterCatalog, validFlagName, applyStateValue } from './state-model.js';
export { fateCode, fateFlag, parseFate, stateLabel, FATE_PREDICATES } from './state-model.js';

let context = { getCatalog: async () => [], getMaps: async () => [], getPeople: async () => [], getCurrentMap: () => '' };
let knownMaps = [], knownCatalog = [], activeDialog = null, serial = 0;
const CATEGORY_NAMES = { all: 'All', story: 'Story flag', character: 'Character state', dialogue: 'Dialogue / InfoLink', original: 'Original game' };
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, handler, className = '') => {
  const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', handler); return node;
};
const option = (value, label) => { const node = el('option', '', label); node.value = value; return node; };
function loadCSS() {
  if (document.getElementById('state-editor-style')) return;
  const link = el('link'); link.id = 'state-editor-style'; link.rel = 'stylesheet'; link.href = '/static/state-editor.css'; document.head.append(link);
}
export function configureStateEditor(config) { context = { ...context, ...config }; knownMaps = []; knownCatalog = []; }
function sourceText(entry) {
  const source = typeof entry.source === 'string' ? entry.source : entry.source?.label || entry.source?.kind || '';
  return [source || CATEGORY_NAMES[entry.category], `${entry.uses} use${entry.uses === 1 ? '' : 's'}`,
    entry.selectable ? '' : `${entry.type} · not a yes/no flag`].filter(Boolean).join(' · ');
}
function unavailable(name) { return knownCatalog.find(entry => entry.name.toLowerCase() === String(name).toLowerCase() && !entry.selectable); }

export function mountStateField(host, initialValue, { onChange = () => {}, mode = 'check', allowEmpty = false, expiration = false } = {}) {
  loadCSS();
  let value = initialValue, destroyed = false, advancedOpen = false;
  const field = el('div', 'state-field'); host.replaceChildren(field);
  const commit = patch => {
    if (destroyed || host.isConnected === false) return;
    if (patch.flag && unavailable(patch.flag)) throw new Error('This state is not a yes/no flag. Use its original numeric condition.');
    applyStateValue(value, patch, { allowEmpty, expiration });
    render(); onChange(value);
  };
  const open = () => {
    if (destroyed || host.isConnected === false) return;
    return chooseState(value, { mode, allowEmpty }).then(patch => { if (patch && !destroyed) commit(patch); });
  };
  function render() {
    if (destroyed) return;
    field.replaceChildren();
    const fate = parseFate(value.flag, knownMaps);
    const catalogEntry = knownCatalog.find(entry => entry.name.toLowerCase() === String(value.flag).toLowerCase());
    const name = fate ? `${fate.actor}${fate.map ? ' · ' + fate.map : ''}` : catalogEntry?.label || value.flag || (allowEmpty ? 'No condition' : 'Choose state');
    const nameButton = button(name, open, 'state-name');
    nameButton.title = stateLabel(value, true, knownMaps);
    nameButton.setAttribute('aria-label', `Choose ${mode === 'set' ? 'state to change' : 'condition'}: ${name}`);
    // no state yet: its name typed right here, a new one or one the story already has (suggested); the button still
    // browses all of them (Crypt Test, 20 Oct 2026: a new flag took a search and "Use new story flag")
    if (!value.flag && !allowEmpty) {
      const quick = el('input', 'state-quick'); quick.type = 'text'; quick.spellcheck = false;
      quick.placeholder = 'type a name, Enter'; quick.setAttribute('aria-label', 'State name'); quick.style.cssText = 'flex:1;min-width:90px';
      const lists = [...document.querySelectorAll('datalist')].find((d) => /flag/i.test(d.id));
      if (lists) quick.setAttribute('list', lists.id);
      const apply = () => {
        const n = quick.value.trim();
        if (!n) return;
        if (!validFlagName(n)) { quick.setAttribute('aria-invalid', 'true'); quick.title = 'Letters, digits and _ (not starting with a digit)'; return; }
        try { commit({ flag: n, is: true }); } catch (e) { quick.title = e.message; quick.setAttribute('aria-invalid', 'true'); }
      };
      quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
      quick.addEventListener('change', apply);
      nameButton.textContent = 'Browse…';
      field.append(quick);
    }
    field.append(nameButton);
    const select = el('select'); select.setAttribute('aria-label', fate ? 'Character state' : mode === 'set' ? 'Set state to' : 'Required state');
    if (fate) {
      for (const predicate of FATE_PREDICATES) select.append(option(predicate.id, predicate.label));
      select.value = `${fate.kind}:${value.is !== false}`;
    } else {
      select.append(option('true', 'Yes'), option('false', 'No')); select.value = String(value.is !== false);
    }
    select.disabled = !value.flag;
    select.addEventListener('change', () => {
      if (fate) {
        const predicate = FATE_PREDICATES.find(p => p.id === select.value);
        commit({ flag: value.flag.replace(/_(Dead|KO|Down)$/i, '_' + predicate.kind), is: predicate.is });
      } else commit({ is: select.value === 'true' });
    });
    field.append(select);
    if (mode === 'set' && fate) field.append(el('p', 'state-note', 'Changes the recorded state only. It does not kill, knock out or revive the character.'));
    const details = el('details'), summary = el('summary', '', 'Advanced'); details.open = advancedOpen;
    details.addEventListener('toggle', () => { advancedOpen = details.open; });
    const advanced = el('div', 'state-advanced'), id = `state-id-${++serial}`;
    const label = el('label', '', 'Flag ID'); label.htmlFor = id;
    const input = el('input'); input.type = 'text'; input.id = id; input.value = value.flag || ''; input.spellcheck = false;
    input.setAttribute('aria-label', 'Technical flag ID');
    const error = el('p', 'state-error'); error.setAttribute('role', 'status');
    input.addEventListener('change', () => {
      try { commit({ flag: input.value }); } catch (e) { error.textContent = e.message; input.setAttribute('aria-invalid', 'true'); }
    });
    advanced.append(label, input);
    if (expiration) {
      const expires = el('input'); expires.type = 'number'; expires.min = '0'; expires.max = '99'; expires.step = '1'; expires.value = String(value.expiration ?? 0);
      const expiresId = `state-expiration-${serial}`; expires.id = expiresId;
      const expiryLabel = el('label', '', 'Expires after mission'); expiryLabel.htmlFor = expiresId;
      expires.title = '0: current mission. 99: permanent.';
      expires.addEventListener('change', () => { try { commit({ expiration: Number(expires.value) }); } catch (e) { error.textContent = e.message; } });
      advanced.append(expiryLabel, expires);
    }
    details.append(summary, advanced, error); field.append(details);
  }
  render();
  return { open, update(nextValue = value) { value = nextValue; render(); }, destroy() { destroyed = true; field.remove(); } };
}

async function chooseState(value, { mode, allowEmpty }) {
  loadCSS();
  activeDialog?.close();
  const dialog = el('dialog', 'state-chooser'); activeDialog = dialog;
  const titleId = `state-title-${++serial}`, header = el('header'), title = el('h2', '', mode === 'set' ? 'Change state' : 'Choose condition');
  title.id = titleId; dialog.setAttribute('aria-labelledby', titleId);
  const close = button('×', () => dialog.close()); close.setAttribute('aria-label', 'Cancel state selection');
  header.append(title, close);
  const main = el('main'), tabs = el('div', 'state-tabs'), content = el('div');
  tabs.setAttribute('aria-label', 'State categories');
  main.append(tabs, content); dialog.append(header, main); document.body.append(dialog);
  let result = null, category = parseFate(value.flag) ? 'character' : 'all', query = '', disposed = false, charVersion = 0;
  const previousFocus = document.activeElement;
  const done = new Promise(resolve => dialog.addEventListener('close', () => {
    disposed = true; dialog.remove(); if (activeDialog === dialog) activeDialog = null;
    previousFocus?.focus(); resolve(result);
  }, { once: true }));
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  } });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); });
  const choose = patch => { result = patch; dialog.close(); };
  dialog.showModal(); content.append(el('p', 'state-tip', 'Loading states…'));
  const results = await Promise.allSettled([context.getCatalog(), context.getMaps()]);
  if (disposed) return done;
  knownCatalog = results[0].status === 'fulfilled' ? normalizeCatalog(results[0].value || []) : [];
  knownMaps = results[1].status === 'fulfilled' ? (results[1].value || []).filter(map => typeof map === 'string') : [];
  const currentMap = context.getCurrentMap?.() || '';
  if (currentMap && !knownMaps.includes(currentMap)) knownMaps.unshift(currentMap);
  const fate = parseFate(value.flag, knownMaps), selected = context.getSelectedPerson?.();
  let characterMap = fate ? fate.map || '@' + fate.code : selected?.map || currentMap;
  let characterName = fate?.actor || selected?.name || '';
  let characterPredicate = fate ? `${fate.kind}:${value.is !== false}` : 'Dead:true';
  const categories = ['all', 'story', 'character', 'dialogue'];
  if (knownCatalog.some(entry => entry.category === 'original')) categories.push('original');
  for (const key of categories) {
    const tab = button(CATEGORY_NAMES[key], () => { category = key; draw(); }); tab.dataset.category = key; tabs.append(tab);
  }
  function draw() {
    charVersion++;
    for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab.dataset.category === category));
    content.replaceChildren();
    if (category === 'character') { drawCharacter(); return; }
    const search = el('input', 'state-search'); search.type = 'search'; search.placeholder = 'Find a state or enter a new flag ID'; search.value = query; search.setAttribute('aria-label', 'Search states');
    const list = el('div', 'state-results'); list.setAttribute('aria-label', 'Matching states');
    const add = button('', () => choose({ flag: query.trim(), is: value.is !== false }), 'state-new');
    const renderResults = () => {
      list.replaceChildren();
      const matches = filterCatalog(knownCatalog, query, category);
      for (const entry of matches) {
        const row = button('', () => choose({ flag: entry.name, is: value.is !== false }), 'state-result'); row.disabled = !entry.selectable;
        row.append(el('b', '', parseFate(entry.name) ? stateLabel(entry.name, value.is !== false, knownMaps) : entry.label), el('small', '', sourceText(entry)));
        if (entry.description) row.append(el('small', '', entry.description));
        list.append(row);
      }
      if (!matches.length) list.append(el('p', 'state-tip', 'No matching states.'));
      const name = query.trim(); add.hidden = !validFlagName(name) || knownCatalog.some(entry => entry.name.toLowerCase() === name.toLowerCase());
      add.textContent = `Use new story flag “${name}”`;
    };
    search.addEventListener('input', () => { query = search.value; renderResults(); });
    content.append(search, list, add);
    if (results[0].status === 'rejected') content.append(el('p', 'state-error', 'The state catalog could not be loaded. You can enter a flag ID or choose a character.'));
    if (allowEmpty) content.append(button('No condition', () => choose({ flag: '' }), 'state-new'));
    renderResults(); search.focus();
  }
  async function drawCharacter() {
    const version = charVersion, form = el('div', 'state-form');
    const mapSelect = el('select'); mapSelect.setAttribute('aria-label', 'Character map');
    mapSelect.append(option('', 'Choose map'));
    if (characterMap.startsWith('@')) mapSelect.append(option(characterMap, `Unlisted map (${characterMap.slice(1)})`));
    for (const map of knownMaps) mapSelect.append(option(map, map));
    if (characterMap && !characterMap.startsWith('@') && !knownMaps.includes(characterMap)) mapSelect.append(option(characterMap, characterMap));
    mapSelect.value = characterMap;
    const person = el('input'); person.type = 'text'; person.value = characterName; person.placeholder = 'Choose a character or enter its actor name'; person.setAttribute('aria-label', 'Character actor name');
    const dataId = `state-people-${++serial}`, people = el('datalist'); people.id = dataId; person.setAttribute('list', dataId);
    const predicate = el('select'); predicate.setAttribute('aria-label', 'Character state');
    for (const p of FATE_PREDICATES) predicate.append(option(p.id, p.label)); predicate.value = characterPredicate;
    form.append(el('span', '', 'Map'), mapSelect, el('span', '', 'Character'), person, el('span', '', mode === 'set' ? 'Record' : 'Check'), predicate, people);
    const note = el('p', 'state-tip', mode === 'set' ? 'Changes the recorded state only. It does not kill, knock out or revive the character.' : 'Checks what was recorded about this character, in this map or a later one. “Not killed” does not mean conscious.');
    const error = el('p', 'state-error'); error.setAttribute('role', 'status');
    const actions = el('div', 'state-actions'), apply = button(mode === 'set' ? 'Use state' : 'Use condition', () => {
      const name = person.value.trim(), p = FATE_PREDICATES.find(item => item.id === predicate.value);
      if (!characterMap || !validFlagName(name)) { error.textContent = 'Choose a map and enter a valid character actor name.'; return; }
      const flag = characterMap.startsWith('@') ? `UCFate${characterMap.slice(1)}_${name}_${p.kind}` : fateFlag(characterMap, name, p.kind);
      choose({ flag, is: p.is });
    });
    actions.append(button('Cancel', () => dialog.close()), apply); content.append(form, note, error, actions);
    mapSelect.addEventListener('change', () => { characterMap = mapSelect.value; characterName = ''; draw(); });
    person.addEventListener('input', () => { characterName = person.value; });
    predicate.addEventListener('change', () => { characterPredicate = predicate.value; });
    person.focus();
    if (!characterMap || characterMap.startsWith('@')) return;
    try {
      const rows = await context.getPeople(characterMap);
      if (disposed || version !== charVersion) return;
      for (const row of rows || []) { const item = option(row.name, row.label || row.name); people.append(item); }
    } catch { if (!disposed && version === charVersion) error.textContent = 'Could not load characters. You can still enter the actor name.'; }
  }
  draw(); return done;
}
