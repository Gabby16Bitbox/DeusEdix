// A drag carries a local UTexture reference, never an asset copy or an external URL.
export const TEXTURE_MIME = 'application/x-deusedix-texture';
export const validTextureReference = value => typeof value === 'string' && value.length <= 240 &&
  /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(value) && value.toLowerCase() !== 'none';

export function createTextureTransfer({ canvas, context, targetAt, apply, status }) {
  let dragged = null, armed = null, hover = null, pending = null, gesture = 0;
  const hint = document.createElement('div');
  hint.id = 'texture-drop-hint'; hint.hidden = true; hint.setAttribute('role', 'status');
  document.body.appendChild(hint);
  const cancel = () => { gesture++; dragged = armed = hover = pending = null; hint.hidden = true; canvas.classList.remove('texture-drop'); };
  const active = source => source && source.gesture === gesture && source.context === context();
  function sourceOf(getTexture) {
    const texture = getTexture();
    if (!context() || !validTextureReference(texture?.ref)) return null;
    return { texture: { ...texture }, context: context(), gesture };
  }
  async function paint(event, source = armed) {
    if (!active(source)) { if (source?.gesture === gesture) cancel(); return false; }
    const target = targetAt(event);
    if (!target) return false;
    pending = source;
    try {
      await apply(source.texture, target, () => active(source));
      if (active(source)) status(`Texture ${source.texture.ref}: applied to ${target.label || `${target.brush} · face ${target.poly}`}. Ctrl+Z to undo; Rebuild for the game.`, 'ok');
      return true;
    } catch (error) { if (active(source)) status(error.message, 'warn'); return false; }
    finally { if (source.gesture === gesture) cancel(); }
  }
  canvas.addEventListener('dragover', event => {
    if (!active(dragged)) return;
    event.preventDefault();
    // Only our in-memory source can assign a material. Forged OS/cross-page drags do not.
    hover = targetAt(event, true);
    event.dataTransfer.dropEffect = hover ? 'copy' : 'none';
    canvas.classList.toggle('texture-drop', !!hover);
    hint.textContent = hover ? `Drop ${dragged.texture.ref} on this face · Ctrl+Z to undo` : 'Drop on an unlocked wall, floor, ceiling or block';
    hint.hidden = false;
  });
  canvas.addEventListener('dragleave', () => { hint.hidden = true; canvas.classList.remove('texture-drop'); });
  canvas.addEventListener('drop', event => {
    if (!dragged) return;
    event.preventDefault(); event.stopPropagation();
    const source = dragged;
    // Dragend is synchronous with drop, so capture the source before asynchronous work.
    dragged = null; hint.hidden = true; canvas.classList.remove('texture-drop');
    void paint(event, source);
  });
  window.addEventListener('dragend', () => { dragged = null; hint.hidden = true; canvas.classList.remove('texture-drop'); });
  window.addEventListener('blur', cancel);
  return {
    get armed() { if (armed && !active(armed)) cancel(); return !!armed; }, cancel, paint,
    get engaged() { return !!(armed || dragged || pending); },
    bind(button, getTexture) {
      button.draggable = true;
      button.addEventListener('dragstart', event => {
        cancel(); dragged = sourceOf(getTexture);
        if (!dragged) { event.preventDefault(); status('This texture is not ready to use.', 'warn'); return; }
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(TEXTURE_MIME, dragged.texture.ref);
        event.dataTransfer.setData('text/plain', dragged.texture.ref);
        status(`Drag ${dragged.texture.ref} onto a built face or a block.`, 'ok');
      });
      button.addEventListener('click', () => {
        cancel(); armed = sourceOf(getTexture);
        if (armed) status(`Texture ${armed.texture.ref}: click a built face or a block to apply. Esc cancels.`, 'ok');
        else status('This texture is not ready to use.', 'warn');
      });
    },
  };
}
