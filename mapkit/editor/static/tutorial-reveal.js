// Bring tutorial controls into their own scrollable panels without taking focus
// or keeping the user's scroll position locked to the lesson.
export function revealDelta(start, end, low, high) {
  const margin = Math.min(8, Math.max(0, (high - low) / 4));
  low += margin; high -= margin;
  if (start <= low && end >= high) return 0; // An oversized target already fills the view.
  if (start < low) return start - low;
  if (end > high) return end - high;
  return 0;
}

function scrollers(el) {
  const list = [], doc = el.ownerDocument;
  for (let p = el.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
    const style = doc.defaultView.getComputedStyle(p);
    const x = /^(auto|scroll)$/.test(style.overflowX) && p.scrollWidth > p.clientWidth;
    const y = /^(auto|scroll)$/.test(style.overflowY) && p.scrollHeight > p.clientHeight;
    if (x || y) list.push({ el:p, x, y });
  }
  return list;
}

function laidOut(el) {
  if (!el.getClientRects().length) return false;
  const view = el.ownerDocument.defaultView;
  for (let p = el; p; p = p.parentElement) {
    const style = view.getComputedStyle(p);
    if (p.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function scrollTarget(el, parents) {
  const rect = el.getBoundingClientRect();
  let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
  const reduced = el.ownerDocument.defaultView.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  for (const { el:p, x, y } of parents) {
    const r = p.getBoundingClientRect(), x0 = r.left + p.clientLeft, y0 = r.top + p.clientTop;
    const dx = x ? revealDelta(left, right, x0, x0 + p.clientWidth) : 0;
    const dy = y ? revealDelta(top, bottom, y0, y0 + p.clientHeight) : 0;
    const nextX = Math.max(0, Math.min(p.scrollWidth - p.clientWidth, p.scrollLeft + dx));
    const nextY = Math.max(0, Math.min(p.scrollHeight - p.clientHeight, p.scrollTop + dy));
    const movedX = nextX - p.scrollLeft, movedY = nextY - p.scrollTop;
    // Account for the inner panel's planned movement before revealing its outer panel.
    left -= movedX; right -= movedX; top -= movedY; bottom -= movedY;
    if (movedX || movedY) p.scrollTo({ left:nextX, top:nextY, behavior:reduced ? 'instant' : 'smooth' });
  }
}

export function createTutorialRevealer(doc = document) {
  const handled = new Set();
  return {
    reset() { handled.clear(); },
    reveal(selectors, prepare = () => true) {
      const targets = [];
      for (const selector of selectors) {
        if (handled.has(selector)) continue;
        const matches = [...doc.querySelectorAll(selector)].filter(el => !el.matches(':disabled'));
        // Broad selectors (texture slots, crate results) guide to one useful item.
        const el = matches.find(laidOut) || matches[0];
        if (!el || prepare(el) === false) continue;
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (p.tagName === 'DETAILS') p.open = true;
        }
        if (laidOut(el)) targets.push({ selector, el });
      }
      const claimed = new Set();
      for (const { selector, el } of targets) {
        const parents = scrollers(el);
        handled.add(selector);
        // Two distant controls in one panel must not scroll back and forth.
        if (parents.some(p => claimed.has(p.el))) continue;
        scrollTarget(el, parents);
        for (const p of parents) claimed.add(p.el);
      }
    },
  };
}
