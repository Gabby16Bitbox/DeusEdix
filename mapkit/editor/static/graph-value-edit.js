// A value of a node edited where it is (the node graphs: the Story Graph's chips, the Logic window's next): a click on
// it opens a small box under it with the control the List view has for that value (the caller draws it: the same
// fields, never a copy of them). What is changed there is changed at once, as in the List; Enter or a click elsewhere
// closes the box, Esc closes it and puts the value back as it was. "More…" goes to everything of the node at the side.
//
// openValueEditor({host, at: [x, y] (in host: the value's bottom left), title, render(el) -> the element to focus or
// null, cancel() (put it back), onClose(cancelled), more?: {label, run}}) -> {close(cancelled?), el}
import { placeBox } from './graph-quick-add.js';

const STYLE = `
.gve { position:absolute; z-index:20; min-width:220px; max-width:360px; max-height:min(380px, calc(100% - 8px)); overflow:auto;
  background:var(--panel, #232833); border:1px solid var(--line, #3a4150); border-radius:8px; box-shadow:0 10px 26px #000a; padding:6px 8px 8px; }
.gve-h { display:flex; align-items:center; gap:6px; margin:0 0 4px; font-size:11px; color:var(--dim, #8b93a3); }
.gve-h b { flex:1; font-weight:500; }
.gve-h button { padding:1px 6px; font-size:11px; }
.gve-b .card { border:0; padding:0; margin:0; background:transparent; }
/* the List's own styles of its cards are stronger (#story ...): these win over them */
.gve-b .card > .ch, .gve-b .gve-off { display:none !important; }
.gve-only .f:not(.gve-keep), .gve-only .tip:not(.gve-keep), .gve-only details:not(.gve-keep), .gve-only .st-voice:not(.gve-keep) { display:none !important; }
.gve-foot { margin-top:6px; font-size:10.5px; color:var(--dim, #8b93a3); }
`;
let styled = false;
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function openValueEditor({ host, at, title = '', render, cancel = () => {}, onClose = () => {}, more = null }) {
  if (!styled) { const s = document.createElement('style'); s.textContent = STYLE; document.head.appendChild(s); styled = true; }
  const el = document.createElement('div');
  el.className = 'gve';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title || 'Edit');
  el.innerHTML = `<div class="gve-h"><b>${esc(title)}</b>${more ? `<button type="button" data-more>${esc(more.label)}</button>` : ''}</div>
    <div class="gve-b"></div><div class="gve-foot">Enter or a click outside: done · Esc: as it was</div>`;
  host.appendChild(el);
  let closed = false;
  const focus = render(el.querySelector('.gve-b'));
  function close(cancelled = false) {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', outside, true);
    if (cancelled) cancel();
    el.remove();
    onClose(cancelled);
  }
  const outside = (e) => { if (!el.contains(e.target)) close(false); };
  document.addEventListener('pointerdown', outside, true);
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();                         // the graph's keys and the editor's are not for the fields
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    // Enter closes, except in a text of several lines (Shift+Enter there is a new line, Enter too) and on a button
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      e.target.dispatchEvent?.(new Event('change', { bubbles: true }));
      close(false);
    } else if (e.key === 'Enter' && e.target.tagName === 'TEXTAREA' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); close(false); }
  });
  el.querySelector('[data-more]')?.addEventListener('click', () => { close(false); more.run(); });
  const room = [host.clientWidth || 600, host.clientHeight || 400];
  const p = placeBox(at || [20, 20], [el.offsetWidth || 260, el.offsetHeight || 160], room);
  el.style.left = p[0] + 'px';
  el.style.top = p[1] + 'px';
  if (focus) {
    focus.focus?.();
    if (focus.tagName === 'SELECT') { try { focus.showPicker?.(); } catch { /* not from this gesture: it stays a focused list */ } }
    else if (focus.select && focus.type !== 'checkbox') focus.select();
  }
  return { el, close };
}
