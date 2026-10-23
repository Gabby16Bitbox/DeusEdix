// Tutorial-only list: native OS dropdowns cannot host the guide's option marker.
// Commit through the original select, so its validation, Undo and save handlers stay in charge.
export function createTutorialSelect(doc = document) {
  const win = doc.defaultView;
  const style = doc.createElement('style');
  style.textContent = `
  #tut-choice { position:fixed; z-index:9999; box-sizing:border-box; overflow:auto; overscroll-behavior:contain;
    background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:var(--radius-control);
    box-shadow:0 14px 30px #0009; padding:4px; font:12px/1.35 "Segoe UI",sans-serif; }
  #tut-choice .tut-choice-group { color:var(--dim); font-size:11px; padding:4px 8px; }
  #tut-choice button { display:flex; align-items:center; justify-content:flex-start; width:100%; height:22px;
    min-height:22px; padding:0 8px; margin:0; box-sizing:border-box; border:1px solid transparent;
    border-radius:var(--radius-row); background:transparent; color:var(--text); font:inherit; line-height:18px;
    white-space:nowrap; text-align:left; }
  #tut-choice button span { overflow:hidden; text-overflow:ellipsis; }
  #tut-choice button:hover { background:var(--hover); }
  #tut-choice button[aria-selected="true"] { background:var(--accent-soft); color:var(--heading); }
  #tut-choice button[data-recommended="true"], #tut-choice button:focus-visible { border-color:var(--acc); outline:none; }
  #tut-choice button:disabled { color:var(--dim); opacity:.6; }
  `;
  doc.head.appendChild(style);
  let choice = null, enabled = () => false, source = null, popup = null, signature = '', attrs = null;
  const pulse = () => doc.dispatchEvent(new win.Event('change', { bubbles:true }));
  const options = () => [...(popup?.querySelectorAll('button:not(:disabled)') || [])];
  function close(refocus = false) {
    const previous = source;
    popup?.remove(); popup = null; signature = '';
    if (previous && attrs) for (const [key, value] of Object.entries(attrs)) {
      if (value === null) previous.removeAttribute(key); else previous.setAttribute(key, value);
    }
    attrs = null;
    if (refocus && previous?.isConnected) previous.focus({ preventScroll:true });
  }
  function position() {
    if (!popup || !source) return;
    const r = source.getBoundingClientRect();
    if (!source.isConnected || !r.width || !r.height || !enabled()) { close(); return; }
    const width = Math.min(Math.max(r.width, 240), Math.max(80, win.innerWidth - 16));
    const below = win.innerHeight - r.bottom - 12, above = r.top - 12;
    const down = below >= Math.min(200, above);
    popup.style.width = width + 'px';
    popup.style.maxHeight = Math.min(308, Math.max(44, down ? below : above)) + 'px';
    popup.style.left = Math.max(8, Math.min(r.left, win.innerWidth - width - 8)) + 'px';
    popup.style.top = Math.max(8, down ? r.bottom + 4 : r.top - popup.offsetHeight - 4) + 'px';
  }
  function currentSignature() {
    return JSON.stringify([source?.value, [...(source?.options || [])].map(o => [o.value, o.text, o.disabled, o.parentElement?.label])]);
  }
  function open() {
    if (!source || source.disabled || !enabled() || !choice?.values?.length) return;
    close();
    popup = doc.createElement('div'); popup.id = 'tut-choice'; popup.dataset.select = choice.selector;
    popup.setAttribute('role', 'listbox'); popup.setAttribute('aria-label', choice.label || 'Choose an option');
    attrs = Object.fromEntries(['aria-expanded','aria-controls'].map(key => [key, source.getAttribute(key)]));
    source.setAttribute('aria-expanded','true'); source.setAttribute('aria-controls',popup.id);
    let group = null;
    for (const option of source.options) {
      const parent = option.parentElement, label = parent?.tagName === 'OPTGROUP' ? parent.label : '';
      if (label && label !== group) { const h = doc.createElement('div'); h.className = 'tut-choice-group'; h.textContent = label; popup.appendChild(h); }
      group = label;
      const button = doc.createElement('button'), text = doc.createElement('span');
      button.type = 'button'; button.setAttribute('role','option'); button.tabIndex = -1;
      button.dataset.value = option.value; button.dataset.recommended = String(choice.values.includes(option.value));
      button.setAttribute('aria-selected',String(option.selected));
      button.disabled = option.disabled || !!parent?.disabled;
      text.textContent = option.text; button.title = option.text; button.appendChild(text);
      button.onclick = () => {
        if (!source?.isConnected || source.disabled || button.disabled || !enabled()) { close(); return; }
        const select = source, value = option.value;
        close(true);
        select.value = value;
        select.dispatchEvent(new win.Event('input',{bubbles:true}));
        select.dispatchEvent(new win.Event('change',{bubbles:true}));
      };
      popup.appendChild(button);
    }
    doc.body.appendChild(popup); signature = currentSignature(); position();
    const target = options().find(b => b.dataset.recommended === 'true') || options().find(b => b.getAttribute('aria-selected') === 'true') || options()[0];
    target?.focus({preventScroll:true}); target?.scrollIntoView({block:'nearest'});
    pulse();
  }
  function onPointer(event) {
    if (popup?.contains(event.target)) return;
    if (enabled() && source && event.target === source && !source.disabled && choice?.values?.length) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (popup) close(true); else open();
      pulse();
    } else if (popup) { close(); pulse(); }
  }
  function onKey(event) {
    if (!popup) {
      if (event.target === source && enabled() && [' ','Enter','ArrowDown','ArrowUp','F4'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); open();
      }
      return;
    }
    if (event.key === 'Tab') { close(true); pulse(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); pulse(); return; }
    const list = options(); let index = list.indexOf(doc.activeElement);
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      index = event.key === 'Home' ? 0 : event.key === 'End' ? list.length-1 : Math.max(0,Math.min(list.length-1,index+(event.key === 'ArrowDown'?1:-1)));
      list[index]?.focus({preventScroll:true}); list[index]?.scrollIntoView({block:'nearest'});
    }
  }
  doc.addEventListener('pointerdown',onPointer,true);
  doc.addEventListener('keydown',onKey,true);
  win.addEventListener('resize',position);
  doc.addEventListener('scroll',position,true);
  win.addEventListener('blur',() => close());
  return {
    update(next, active) {
      const candidate = next ? doc.querySelector(next.selector) : null;
      if (source !== candidate || JSON.stringify(choice) !== JSON.stringify(next) || !active()) close();
      choice = next; enabled = active; source = candidate?.tagName === 'SELECT' ? candidate : null;
      if (popup && currentSignature() !== signature) open(); // Async options/model change.
      position();
    },
    close,
  };
}
