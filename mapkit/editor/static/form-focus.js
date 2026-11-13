// The keys kept in a form that is drawn again (the Logic window's List, 13 Nov 2026): a change of a rule's field draws
// its rules again, the field that had the keys is gone, and the next key went to the editor (Esc put the maximized
// layout back, a letter was a shortcut). The graph's side panel does the same (logic-graph-edit.js showPanel, tabOut).
//
//   keepFocus(host)      before drawing host again: -> restore(), to call once it is drawn; the same field (by its
//                        data- marks, within its rule's card) has the keys again, with what was being typed in it
//   keepTab(host, keys)  Tab from a field of host: the next field is known before the change of the one it leaves,
//                        and has the keys after it (the same one, or the one at its place in the form drawn again)

const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (host) => [...host.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length);

// a field as a selector by its tag and its data- attributes (the List's forms name their fields so), within its rule's
// card (a rule's "If not" has fields of the same marks)
export function focusKey(el) {
  const data = Object.entries((el && el.dataset) || {});
  if (!data.length) return '';
  const attr = (k) => 'data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  const card = el.closest('.lk-rule[data-lk]');
  const within = card && card !== el ? `.lk-rule[data-lk="${CSS.escape(card.dataset.lk)}"] ` : '';
  return within + el.tagName.toLowerCase() + data.map(([k, v]) => `[${attr(k)}="${CSS.escape(v)}"]`).join('');
}
const find = (host, key) => { try { return key ? host.querySelector(key) : null; } catch { return null; } };
const selectText = (el) => { if (el.tagName === 'INPUT' && /^(text|search|number|)$/.test(el.type || '')) el.select?.(); };

export function keepFocus(host) {
  const was = document.activeElement;
  if (!was || !host.contains(was) || was === host) return () => {};
  const key = focusKey(was), index = focusables(host).indexOf(was), top = host.scrollTop;
  return () => {
    const now = document.activeElement;
    if (was.isConnected && now === was) return;                       // not drawn again
    if (now && now !== document.body && now !== host && !host.contains(now)) return;   // the keys went elsewhere on purpose
    if (now && now !== document.body && now !== host && now.isConnected && host.contains(now) && now !== was) return;
    const el = find(host, key) || (index >= 0 ? focusables(host)[index] : null);
    if (!el) return;
    host.scrollTop = top;
    el.focus({ preventScroll: true });
    // what was being typed in it and not yet taken (no change yet) goes on in the new field, and is taken when it
    // loses the keys, as if typed there
    const typing = /^(INPUT|TEXTAREA)$/.test(was.tagName) && !/^(checkbox|radio|button|range|color|file)$/.test(was.type)
      && was.value !== was.defaultValue ? { value: was.value, start: was.selectionStart, end: was.selectionEnd } : null;
    if (typing && el.value !== typing.value && el.tagName === was.tagName) {
      el.value = typing.value;
      try { el.setSelectionRange(typing.start, typing.end); } catch { /* a number field */ }
      let took = false;
      el.addEventListener('change', () => { took = true; }, { once: true });
      el.addEventListener('blur', () => { if (!took && el.value !== el.defaultValue) el.dispatchEvent(new Event('change', { bubbles: true })); }, { once: true });
    }
  };
}

export function keepTab(host) {
  if (host.dataset.keepTab) return;
  host.dataset.keepTab = '1';
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
    const list = focusables(host), at = list.indexOf(e.target);
    if (at < 0) return;
    const index = at + (e.shiftKey ? -1 : 1), to = list[index];
    if (!to) return;                     // out of the form: the browser's own Tab
    e.preventDefault();
    const key = focusKey(to);
    to.focus({ preventScroll: false });  // the change of the field left fires here
    if (document.activeElement === to) selectText(to);
    const again = () => {
      const now = document.activeElement;
      if (now && now !== document.body && now !== host) return;   // it has them, or they went somewhere on purpose
      const el = find(host, key) || focusables(host)[index];
      if (!el) return;
      el.focus({ preventScroll: false });
      selectText(el);
    };
    setTimeout(again, 0);
    setTimeout(again, 150);              // the List is drawn again after the rule is saved (soon)
  });
}
