// The Rebuild chip in the status bar, as Unity's progress there: the stage the build is at, the time so far with the last
// build of the map as an estimate, and Cancel. It is not modal: while it shows, the 3D view stays usable for looking
// (app.js's look-only view, styled by build-chip.css). What it says comes from build-progress.js chipView.
//
// cancel(): its Cancel button. show(view): { stage, time, title, cancelling } shown; hide().
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./build-chip.css', import.meta.url).href;
document.head.appendChild(css);

export function createBuildChip({ cancel }) {
  const el = document.createElement('span');
  el.id = 'buildchip';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.innerHTML = '<span class="bc-turn" aria-hidden="true"></span><span class="bc-stage"></span><span class="bc-time"></span>'
    + '<button type="button" class="bc-cancel" title="Stop the build: the map stays as it was before it">Cancel</button>';
  const stage = el.querySelector('.bc-stage'), time = el.querySelector('.bc-time'), button = el.querySelector('.bc-cancel');
  button.onclick = () => cancel();

  function show(view) {
    stage.textContent = view.stage;
    time.textContent = view.time;
    el.title = view.title;
    button.disabled = view.cancelling;
    el.hidden = false;
  }
  function hide() { el.hidden = true; }
  return { el, show, hide };
}
