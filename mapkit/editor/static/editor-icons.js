// Original desktop glyphs on a shared 20px grid. The 16px variant is for
// labelled Inspector actions; tool palettes keep the full 20px canvas.
const paths = {
  textureEdit: '<path d="M9 17H3V3h14v5M3 8h10M3 13h5M8 3v10M13 3v5"/><path d="m11 14 5.5-5.5 2 2L13 16l-3 1zM15 10l2 2"/>',
  brush: '<path d="m8 11 7-8a1.5 1.5 0 0 1 2 2l-7 8zM8 11l2 2M8 12c-4-1-2 4-5 5 4 1 7-1 7-3"/>',
  eraser: '<path d="m3 12 8-9 6 5-8 9H7zM7 8l6 5M8 17h10"/>',
  fill: '<path d="m3 10 7-7 6 7-6 6zM6 2l6 6M3 10h13M17 12s-2 2.5-2 3.5a2 2 0 0 0 4 0C19 14.5 17 12 17 12"/>',
  picker: '<path d="m5 12 7-7 3 3-7 7H6l-3 2 1-3zM11 4l5 5M13 5l2-2a1.5 1.5 0 0 1 2 2l-2 2"/>',
  clone: '<path d="M7 13V9c0-2-1-3-1-4a4 4 0 0 1 8 0c0 1-1 2-1 4v4M4 13h12l1 3H3zM4 19h12"/>',
  soften: '<path d="M10 2S4 9 4 12a6 6 0 0 0 12 0c0-3-6-10-6-10"/><path d="M7 12c0 2 1 3 3 3"/>',
  lighten: '<circle cx="10" cy="10" r="3.5"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2M4 4l1.5 1.5M14.5 14.5 16 16M4 16l1.5-1.5M14.5 5.5 16 4"/>',
  darken: '<path d="M17 12A7 7 0 1 1 8 3a6 6 0 0 0 9 9z"/>',
  text: '<path d="M3 6V3h14v3M10 3v14M7 17h6"/>',
  select: '<rect x="3" y="3" width="14" height="14" stroke-dasharray="2 2"/>',
  maximize: '<rect x="3" y="3" width="14" height="14"/><path d="M3 6h14"/>',
  restore: '<path d="M7 6V3h10v10h-3"/><rect x="3" y="7" width="10" height="10"/>',
};

export function editorIcon(name, size = 20) {
  return `<svg viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || ''}</svg>`;
}
