// Play-test overrides keep the game's original comma/space/semicolon syntax. Editing one
// structured row must not normalize unrelated tokens, duplicates, or their ordering.
export function parsePlayStates(text = '') {
  const rows = [];
  for (const match of String(text).matchAll(/[^,\s;]+/gu)) {
    const raw = match[0], equals = raw.indexOf('='), flag = equals < 0 ? raw : raw.slice(0, equals);
    if (!/^[\p{L}\p{N}_]+$/u.test(flag)) continue;
    const value = equals < 0 ? '' : raw.slice(equals + 1);
    rows.push({ flag, is: !['0', 'false', 'False', 'no'].includes(value), start: match.index, end: match.index + raw.length });
  }
  return rows;
}

function token(value) {
  const flag = String(value.flag || '').trim();
  if (!/^[\p{L}\p{N}_]+$/u.test(flag)) throw new Error('Choose a state first.');
  return `${flag}=${value.is === false ? '0' : '1'}`;
}

export function updatePlayState(text, index, value) {
  const row = parsePlayStates(text)[index];
  if (!row) throw new Error('This starting state is no longer available.');
  return text.slice(0, row.start) + token(value) + text.slice(row.end);
}

export function removePlayState(text, index) {
  const row = parsePlayStates(text)[index];
  return row ? text.slice(0, row.start) + text.slice(row.end) : text;
}

export function appendPlayState(text, value) {
  return text + (text && !/[,\s;]$/u.test(text) ? ', ' : '') + token(value);
}

// The raw input is one representation of the same test overrides, not a second store.
// mountField is injected so Story, Interactions, and Play all use the same state picker.
export function mountPlayStates(host, { mountField, value = '' }) {
  host.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b>Starting states</b><button type="button" data-play-state-add>Add test state</button></div>
    <div class="hint" style="margin:4px 0 8px">Override states for this play test. Your story is unchanged.</div>
    <div data-play-state-list></div>
    <details style="margin-top:8px"><summary>Advanced: raw flags</summary>
      <label for="pflags" class="hint" style="display:block;margin:6px 0">Flag names and values, separated by commas, spaces or semicolons.</label>
      <textarea id="pflags" rows="2" spellcheck="false" style="width:100%;box-sizing:border-box" placeholder="TalkedToMax=1, DoorUnlocked=0"></textarea>
    </details>`;
  const input = host.querySelector('#pflags'), list = host.querySelector('[data-play-state-list]');
  input.value = value;
  let mounted = [], draft = false;
  function clearFields() { for (const field of mounted) field?.destroy?.(); mounted = []; }
  function render() {
    clearFields();
    list.replaceChildren();
    const rows = parsePlayStates(input.value);
    if (!rows.length && !draft) {
      const empty = document.createElement('div'); empty.className = 'hint'; empty.style.margin = '4px 0';
      empty.textContent = input.value.trim() ? 'Raw flags are preserved below.' : 'No test overrides.'; list.append(empty);
    }
    const addRow = (row, index) => {
      const line = document.createElement('div'), fieldHost = document.createElement('div'), remove = document.createElement('button');
      line.style.cssText = 'display:flex;align-items:flex-start;gap:6px;margin:6px 0';
      fieldHost.style.cssText = 'flex:1;min-width:0';
      remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remove test state'; remove.setAttribute('aria-label', 'Remove test state');
      remove.onclick = () => { if (index < 0) draft = false; else input.value = removePlayState(input.value, index); render(); };
      line.append(fieldHost, remove); list.append(line);
      const field = mountField(fieldHost, { flag: row.flag, is: row.is }, { mode: 'set', onChange: next => {
        if (!next.flag) return;
        input.value = index < 0 ? appendPlayState(input.value, next) : updatePlayState(input.value, index, next);
        draft = false; render();
      } });
      mounted.push(field);
      return field;
    };
    rows.forEach(addRow);
    return draft ? addRow({ flag: '', is: true }, -1) : null;
  }
  input.oninput = () => { draft = false; render(); };
  host.querySelector('[data-play-state-add]').onclick = () => { draft = true; render()?.open?.(); };
  render();
  return { get value() { return input.value; }, destroy: clearFields };
}
