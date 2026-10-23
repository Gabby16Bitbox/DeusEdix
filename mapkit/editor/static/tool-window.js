import { editorIcon } from './editor-icons.js';

// Keep the tools modal as before, but allow a bounded window with an explicit
// maximize action. Only window chrome changes; document/canvas state stays put.
export function attachToolWindow(root, header, closeButton) {
  root.classList.add('tool-window');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', header.querySelector('b').textContent);
  const backdrop = document.createElement('div');
  backdrop.className = 'tool-window-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  root.before(backdrop);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool-window-size';
  const refreshButton = () => {
    const large = root.classList.contains('tool-maximized');
    const label = large ? 'Restore window' : 'Maximize window';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(large));
    button.innerHTML = editorIcon(large ? 'restore' : 'maximize', 16);
  };
  button.onclick = () => {
    root.classList.toggle('tool-maximized');
    refreshButton();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };
  closeButton.before(button);
  refreshButton();
  // Existing open/close paths own display. Inert the surrounding editor while
  // either tool is open so its old full-screen input boundary is preserved.
  const synchronize = () => {
    const open = root.style.display === 'grid';
    backdrop.hidden = !open;
    if (open) {
      root._toolPreviousFocus = document.activeElement;
      for (const child of document.body.children) {
        if (child === root || child === backdrop || child.inert || child.matches('script,style,link,.tool-window,.tool-window-backdrop')) continue;
        child.inert = true;
        child.dataset.toolWindowInert = root.id;
      }
      button.focus({ preventScroll: true });
    } else {
      for (const child of document.body.children) {
        if (child.dataset.toolWindowInert !== root.id) continue;
        child.inert = false;
        delete child.dataset.toolWindowInert;
      }
      root._toolPreviousFocus?.focus?.({ preventScroll: true });
    }
  };
  backdrop.hidden = true;
  new MutationObserver(synchronize).observe(root, { attributes: true, attributeFilter: ['style'] });
}
