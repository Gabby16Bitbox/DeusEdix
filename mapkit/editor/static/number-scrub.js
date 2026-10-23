// Numbers that follow the mouse, as in the map's Inspector and in Blender: hold a number's label (X, Y, Z,
// Scale...) and drag left or right. A slow drag moves a step every few pixels; the faster the mouse goes, the
// bigger each step. Shift: fine. Esc puts the value back. While dragging the field gets 'input' events (a live
// preview); letting go sends one 'change' (the field's own handler keeps it: one undo step).
export function attachNumberScrub(root, { onStart = () => {}, onCancel = () => {} } = {}) {
  let drag = null;
  const inputOf = (label) => {
    if (!label || !root.contains(label)) return null;
    const input = label.querySelector('input[type=number]')
      || (label.htmlFor && document.getElementById(label.htmlFor))
      || (label.nextElementSibling?.matches?.('input[type=number]') ? label.nextElementSibling : null);
    return input && input.type === 'number' && !input.disabled && !input.readOnly ? input : null;
  };
  const decimals = (step) => (String(step).split('.')[1] || '').length;
  const end = (cancel) => {
    const d = drag;
    if (!d) return;
    drag = null;
    document.body.classList.remove('number-scrubbing');
    window.removeEventListener('keydown', d.esc, true);
    if (d.label.hasPointerCapture?.(d.pointer)) d.label.releasePointerCapture(d.pointer);
    if (cancel) {
      if (d.input.value !== d.text) { d.input.value = d.text; d.input.dispatchEvent(new Event('input', { bubbles: true })); }
      if (d.started) onCancel(d.input);
      return;
    }
    if (d.input.value !== d.text) d.input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  root.addEventListener('pointerover', (e) => {
    const label = e.target.closest?.('label');
    if (label && e.target !== inputOf(label) && inputOf(label)) label.classList.add('num-scrub');
  });
  root.addEventListener('pointerdown', (e) => {
    const label = e.target.closest?.('label'), input = inputOf(label);
    if (!input || e.target === input || e.button !== 0 || drag) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const value = Number(input.value);
    drag = { input, label, pointer: e.pointerId, x: e.clientX, t: performance.now(), text: input.value, started: false,
      value: Number.isFinite(value) ? value : 0, step: parseFloat(input.step) || 1, travel: 0,
      esc: (k) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); end(true); } } };
    label.setPointerCapture(e.pointerId);
    window.addEventListener('keydown', drag.esc, true);
    document.body.classList.add('number-scrubbing');
  });
  root.addEventListener('pointermove', (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.pointer) return;
    if (!(e.buttons & 1)) { end(false); return; }
    const now = performance.now(), dx = e.clientX - d.x, dt = Math.max(1, now - d.t);
    d.x = e.clientX; d.t = now;
    if (!dx) return;
    // pixels per millisecond: 0.2 is a slow hand (a step every 4 pixels), 1 a quick move (4 times), 2 a flick (up to 15)
    const speed = Math.abs(dx) / dt, gain = Math.min(15, 1 + 3 * speed * speed);
    d.travel += dx * gain * (e.shiftKey ? 0.1 : 1);
    let v = d.value + Math.round(d.travel / 4) * d.step;
    if (d.input.min !== '') v = Math.max(+d.input.min, v);
    if (d.input.max !== '') v = Math.min(+d.input.max, v);
    const text = String(+v.toFixed(decimals(d.step)));
    if (text === d.input.value) return;
    if (!d.started) { d.started = true; onStart(d.input); }
    d.input.value = text;
    d.input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  root.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.pointer) end(false); });
  root.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pointer) end(true); });
  root.addEventListener('click', (e) => { if (e.target.closest?.('label.num-scrub') && e.target.tagName !== 'INPUT') e.preventDefault(); });
  return { cancel: () => end(true) };
}
