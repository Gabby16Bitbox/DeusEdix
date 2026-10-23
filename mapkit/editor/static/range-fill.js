// The sliders' filled part: theme.css draws a slider's track in the accent up to --fill, set here from its
// value. It follows the hand (input), sliders that appear or change min/max, and values set by a script
// (el.value = ...), which fire no event.
const isRange = (el) => el instanceof HTMLInputElement && el.type === 'range';
function paint(el) {
  const min = el.min === '' ? 0 : +el.min, max = el.max === '' ? 100 : +el.max, v = +el.value;
  const share = max > min ? (v - min) / (max - min) * 100 : 0;
  el.style.setProperty('--fill', `${Math.max(0, Math.min(100, share || 0)).toFixed(2)}%`);
}
function scan(node) {
  if (isRange(node)) paint(node);
  if (node.querySelectorAll) for (const el of node.querySelectorAll('input[type=range]')) paint(el);
}
for (const type of ['input', 'change']) document.addEventListener(type, (e) => { if (isRange(e.target)) paint(e.target); }, true);
new MutationObserver((changes) => {
  for (const c of changes) {
    if (c.type === 'attributes') { if (isRange(c.target)) paint(c.target); }
    else for (const n of c.addedNodes) if (n.nodeType === 1) scan(n);
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'min', 'max', 'type'] });
for (const prop of ['value', 'valueAsNumber']) {
  const own = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, prop);
  if (!own?.set) continue;
  Object.defineProperty(HTMLInputElement.prototype, prop, { ...own, set(v) { own.set.call(this, v); if (this.type === 'range') paint(this); } });
}
scan(document);
