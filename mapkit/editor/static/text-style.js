// Fonts and text drawing shared by the signs (app.js) and the Texture Editor's Text tool (texedit.js).
// Fonts: the ones installed on this PC (a list of the common Windows ones, kept when the PC has them) and
// the user's own (.ttf / .otf / .woff imported with "Import font...", kept by the editor: /api/fonts).
// The text becomes pixels of a texture, so the game never needs the font.
const COMMON = ['Bahnschrift', 'Arial', 'Arial Black', 'Arial Narrow', 'Impact', 'Segoe UI', 'Segoe UI Black', 'Segoe UI Semibold',
  'Segoe Print', 'Segoe Script', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium',
  'Gabriola', 'Georgia', 'Ink Free', 'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype', 'Sitka Text', 'Sylfaen', 'Tahoma',
  'Times New Roman', 'Trebuchet MS', 'Verdana', 'Comic Sans MS', 'Javanese Text', 'MV Boli', 'Microsoft YaHei', 'Microsoft JhengHei',
  'SimSun', 'SimHei', 'MS Gothic', 'Yu Gothic', 'Malgun Gothic', 'Stencil', 'OCR A Extended', 'Agency FB', 'Bauhaus 93', 'Broadway',
  'Old English Text MT', 'Showcard Gothic', 'Rockwell', 'Rockwell Extra Bold', 'Haettenschweiler', 'Eras Bold ITC', 'Britannic Bold',
  'Copperplate Gothic Bold', 'Engravers MT', 'Magneto', 'Chiller', 'Jokerman', 'Ravie', 'Snap ITC', 'Wide Latin'];
let families = null;

// is a font there? its width differs from the fallback's for at least one of two fallbacks
function installed(name) {
  const g = document.createElement('canvas').getContext('2d'), probe = 'mmmmmmmmmmlli WWW 0123 你好';
  for (const base of ['monospace', 'serif']) {
    g.font = `40px ${base}`;
    const w0 = g.measureText(probe).width;
    g.font = `40px "${name}", ${base}`;
    if (g.measureText(probe).width !== w0) return true;
  }
  return false;
}

// {own: [names], installed: [names]}: the user's fonts are loaded first (FontFace), once
export async function fontFamilies(refresh = false) {
  if (families && !refresh) return families;
  let own = [];
  try {
    const r = await fetch('/api/fonts');
    if (r.ok) own = (await r.json()).fonts || [];
  } catch (_) { /* no server list: the PC's fonts only */ }
  for (const f of own) {
    if ([...document.fonts].some((x) => x.family === f.family)) continue;
    try { document.fonts.add(await new FontFace(f.family, `url(${f.url})`).load()); } catch (_) { /* a broken file: left out */ }
  }
  families = { own: own.map((f) => f.family), installed: COMMON.filter(installed) };
  return families;
}

// the <option>s of a font picker (the current font stays even when this PC does not have it)
export function fontOptions(current) {
  const f = families || { own: [], installed: COMMON };
  const opt = (n) => `<option value="${n.replace(/"/g, '&quot;')}" ${n === current ? 'selected' : ''} style="font-family:'${n.replace(/'/g, '')}'">${n}</option>`;
  const known = new Set([...f.own, ...f.installed]);
  return (current && !known.has(current) ? opt(current) : '')
    + (f.own.length ? `<optgroup label="Your fonts">${f.own.map(opt).join('')}</optgroup>` : '')
    + `<optgroup label="On this PC">${f.installed.map(opt).join('')}</optgroup>`;
}

// a font file of the user's: kept by the editor, usable at once. Returns its family name.
export async function importFont(file) {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('A font is a .ttf, .otf, .woff or .woff2 file.');
  if (file.size > 20 * 1024 * 1024) throw new Error('That font file is too big (over 20 MB).');
  const data = await new Promise((ok, bad) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result).split(',')[1]); rd.onerror = bad; rd.readAsDataURL(file); });
  const r = await fetch('/api/font_import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, data }) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'The font was not imported.');
  await fontFamilies(true);
  return j.family;
}

// The text in a box: t = {text, font, bold, italic, size ('auto' or px), align 'left'|'center'|'right',
// valign 'top'|'middle'|'bottom', color, outline (colour or ''), outlineWidth (px), glow (bool), shadow (bool),
// lineHeight (1.15)}; box = {x, y, w, h}. 'auto': as big as fits the box.
export function drawText(g, t, box) {
  const lines = String(t.text ?? '').split('\n');
  const style = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}`;
  const family = `"${t.font || 'Bahnschrift'}", Bahnschrift, Arial, sans-serif`;
  const lh = t.lineHeight || 1.15;
  let size = +t.size || 0;
  if (!size || t.size === 'auto') {
    size = Math.floor(box.h / Math.max(1, lines.length) / lh);
    for (; size > 6; size--) {
      g.font = `${style}${size}px ${family}`;
      if (Math.max(...lines.map((l) => g.measureText(l).width)) <= box.w) break;
    }
  }
  g.save();
  g.font = `${style}${size}px ${family}`;
  g.textAlign = t.align || 'center';
  g.textBaseline = 'middle';
  const x = t.align === 'left' ? box.x : t.align === 'right' ? box.x + box.w : box.x + box.w / 2;
  const total = lines.length * size * lh;
  const top = t.valign === 'top' ? box.y : t.valign === 'bottom' ? box.y + box.h - total : box.y + (box.h - total) / 2;
  const at = (i) => top + (i + 0.5) * size * lh;
  if (t.shadow) {                           // a drop shadow under the letters
    g.save(); g.fillStyle = 'rgba(0,0,0,.65)';
    lines.forEach((l, i) => g.fillText(l, x + size * 0.06, at(i) + size * 0.06));
    g.restore();
  }
  const ow = t.outlineRatio ? size * t.outlineRatio : t.outlineWidth;     // px, or a share of the letters' size
  if (t.outline && ow > 0) {
    g.lineJoin = 'round'; g.strokeStyle = t.outline; g.lineWidth = ow * 2;
    lines.forEach((l, i) => g.strokeText(l, x, at(i)));
  }
  g.fillStyle = t.color || '#ffffff';
  for (const pass of t.glow ? [0, 1] : [1]) {
    g.shadowColor = t.color || '#ffffff';
    g.shadowBlur = !t.glow ? 0 : pass ? size * 0.25 : size * 0.8;
    lines.forEach((l, i) => g.fillText(l, x, at(i)));
  }
  g.restore();
  return { size, width: Math.max(...lines.map((l) => { g.font = `${style}${size}px ${family}`; return g.measureText(l).width; })), height: total };
}
