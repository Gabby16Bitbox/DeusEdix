// Cosmetic preferences stay in the browser; they never become map edits.
import './range-fill.js';
const themePicker = document.getElementById('uitheme');
const menus = [...document.querySelectorAll('.tool-menu')];

function applyTheme(theme) {
  const name = ['classic', 'mankind', 'classic-rounded', 'mankind-rounded'].includes(theme) ? theme : 'classic';
  document.documentElement.dataset.theme = name.split('-')[0];
  document.documentElement.dataset.shape = name.endsWith('-rounded') ? 'rounded' : 'square';
  themePicker.value = name;
  try { localStorage.setItem('ucmap.theme', name); } catch (e) { /* no storage */ }
  const background = window.__editor?.scene.background;
  if (background) background.set(getComputedStyle(document.documentElement).getPropertyValue('--viewport').trim());
}
applyTheme(document.documentElement.dataset.theme + (document.documentElement.dataset.shape === 'rounded' ? '-rounded' : ''));
themePicker.addEventListener('change', () => applyTheme(themePicker.value));

for (const menu of menus) {
  menu.addEventListener('toggle', () => {
    if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('button')) menu.open = false; });
}
document.addEventListener('pointerdown', (e) => {
  for (const menu of menus) if (!menu.contains(e.target)) menu.open = false;
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = menus.find(menu => menu.open);
  if (!open) return;
  e.preventDefault();
  e.stopPropagation();
  open.open = false;
  open.querySelector('summary').focus();
}, true);
