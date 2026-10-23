// Checks that the text of every visible button sits in the vertical middle of the button (DESIGN.md:
// "Text in a button is always centred"). Paste it in the browser console of the editor (or run it with a
// browser tool) with the screens to check open; it lists the buttons whose capitals are off by 1px or more.
// Two-line rows (the map list's title + file name) show up too and are fine.
(() => {
  const cv = document.createElement('canvas').getContext('2d');
  const out = [];
  for (const b of document.querySelectorAll('button, summary, .mb-title, a.ib')) {
    if (!b.offsetParent) continue;
    const br = b.getBoundingClientRect();
    if (br.height < 8 || br.width < 8 || br.height > 60 || br.bottom < 0 || br.top > innerHeight) continue;
    const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? 1 : 3) });
    const text = walk.nextNode();
    if (!text) continue;
    const cs = getComputedStyle(text.parentElement);
    cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const range = document.createRange();
    range.selectNodeContents(text);
    const line = range.getClientRects()[0];
    if (!line) continue;
    const baseline = line.top + cv.measureText(text.textContent.trim()).fontBoundingBoxAscent;
    const capsMiddle = baseline - cv.measureText('H').actualBoundingBoxAscent / 2;
    const bs = getComputedStyle(b);
    const middle = (br.top + parseFloat(bs.borderTopWidth) + br.bottom - parseFloat(bs.borderBottomWidth)) / 2;
    const off = +(capsMiddle - middle).toFixed(1);
    if (Math.abs(off) >= 1) out.push({ text: text.textContent.trim().slice(0, 24), id: b.id || String(b.className), height: Math.round(br.height),
      off, padding: `${bs.paddingTop} / ${bs.paddingBottom}`, lineHeight: bs.lineHeight });
  }
  console.table(out);
  return out;
})();
