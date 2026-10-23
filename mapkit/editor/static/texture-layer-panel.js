// A small view over TextureLayers. The host owns history, dirty state and
// refresh timing, so painting does not repeatedly encode thumbnails or rebuild
// the controls. No project/model state is stored in the DOM.
export function mountTextureLayers(container, { getModel, onSelect, onMutation, onImport }) {
  container.classList.add('te-layer-panel');
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, title, action, disabled = false) => {
    const node = make('button', '', text);
    node.type = 'button'; node.title = title; node.setAttribute('aria-label', title);
    node.disabled = !!disabled; node.onclick = action;
    return node;
  };
  const change = mutate => onMutation(mutate);
  function rename(layer, selectButton) {
    if (!selectButton.isConnected) return;
    const input = make('input', 'te-layer-rename');
    input.type = 'text'; input.maxLength = 80; input.value = layer.name;
    input.setAttribute('aria-label', 'Layer name');
    let finished = false;
    const finish = save => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (save && name && name !== layer.name) change(model => model.update(layer.id, { name }));
      else refresh();
    };
    input.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter');
    };
    input.onblur = () => finish(true);
    selectButton.replaceWith(input); input.focus(); input.select();
  }
  function refresh() {
    const model = getModel();
    if (!model) { container.replaceChildren(); return; }
    const layers = model.layers, active = model.active, index = layers.findIndex(layer => layer.id === active.id);
    const fragment = document.createDocumentFragment();
    const heading = make('div', 'te-layer-heading');
    heading.append(make('b', '', 'Layers'), make('span', 'hint', String(layers.length)));
    fragment.append(heading);
    const actions = make('div', 'te-layer-actions');
    actions.append(
      button('+ Layer', 'Add a transparent paint layer above the selected layer', () => change(current => {
        const names = new Set(current.layers.map(layer => layer.name));
        let number = 1;
        while (names.has('Paint layer ' + number)) number++;
        current.add('Paint layer ' + number);
      })),
      button('Image…', 'Import a picture as a new layer', () => onImport?.(), !onImport),
      button('Duplicate', 'Duplicate the selected layer', () => change(current => current.duplicate(active.id))),
    );
    fragment.append(actions);
    const list = make('div', 'te-layer-list');
    list.setAttribute('role', 'list'); list.setAttribute('aria-label', 'Texture layers, top to bottom');
    const display = layers.slice().reverse();
    let activeButton;
    for (const [position, layer] of display.entries()) {
      const row = make('div', 'te-layer-row');
      row.dataset.layerId = layer.id;
      row.classList.toggle('active', layer.id === active.id);
      row.classList.toggle('is-hidden', !layer.visible);
      row.classList.toggle('is-locked', layer.locked);
      row.setAttribute('role', 'listitem');
      const visibility = make('input', 'te-layer-visible');
      visibility.type = 'checkbox'; visibility.checked = layer.visible;
      visibility.title = 'Show or hide ' + layer.name;
      visibility.setAttribute('aria-label', 'Show ' + layer.name);
      visibility.onchange = () => change(current => current.update(layer.id, { visible: visibility.checked }));
      const select = button('', 'Select ' + layer.name + (layer.locked ? ' (locked)' : ''), () => {
        if (getModel()?.activeId !== layer.id) onSelect(layer.id);
      });
      select.className = 'te-layer-select';
      select.setAttribute('aria-pressed', String(layer.id === active.id));
      const thumbnail = make('canvas', 'te-layer-thumb');
      thumbnail.width = thumbnail.height = 32;
      thumbnail.setAttribute('aria-hidden', 'true');
      const context = thumbnail.getContext('2d');
      if (context) {
        const scale = Math.min(32 / layer.canvas.width, 32 / layer.canvas.height);
        const width = layer.canvas.width * scale, height = layer.canvas.height * scale;
        context.imageSmoothingEnabled = true;
        context.drawImage(layer.canvas, (32 - width) / 2, (32 - height) / 2, width, height);
      }
      select.append(thumbnail, make('span', 'te-layer-name', layer.name));
      select.ondblclick = event => { event.preventDefault(); rename(layer, select); };
      select.onkeydown = event => {
        const nextPosition = event.key === 'ArrowUp' ? position - 1 : event.key === 'ArrowDown' ? position + 1
          : event.key === 'Home' ? 0 : event.key === 'End' ? display.length - 1 : -1;
        if (nextPosition < 0 || nextPosition >= display.length) return;
        event.preventDefault(); event.stopPropagation();
        const next = display[nextPosition]; onSelect(next.id);
        queueMicrotask(() => container.querySelector(`[data-layer-id="${next.id}"] .te-layer-select`)?.focus());
      };
      const lock = button(layer.locked ? 'Locked' : 'Lock', (layer.locked ? 'Unlock ' : 'Lock ') + layer.name
        + ' to ' + (layer.locked ? 'allow painting' : 'prevent painting'),
      () => change(current => current.update(layer.id, { locked: !layer.locked })));
      lock.className = 'te-layer-lock';
      lock.setAttribute('aria-pressed', String(layer.locked));
      row.append(visibility, select, lock); list.append(row);
      if (layer.id === active.id) activeButton = select;
    }
    fragment.append(list);
    const properties = make('div', 'te-layer-properties');
    const opacityLabel = make('label', 'te-layer-property');
    const opacity = make('input'); opacity.type = 'range'; opacity.min = 0; opacity.max = 100; opacity.step = 1;
    opacity.value = Math.round(active.opacity * 100); opacity.setAttribute('aria-label', 'Layer opacity');
    const opacityValue = make('output', '', opacity.value + '%');
    opacity.oninput = () => { opacityValue.textContent = opacity.value + '%'; };
    // One undo item per slider gesture, rather than one per percentage point.
    opacity.onchange = () => {
      const value = Number(opacity.value) / 100;
      if (value !== getModel()?.active.opacity) change(current => current.update(active.id, { opacity: value }));
    };
    opacityLabel.append(make('span', '', 'Opacity'), opacity, opacityValue);
    const blendLabel = make('label', 'te-layer-property'), blend = make('select');
    blend.setAttribute('aria-label', 'Layer blend mode');
    for (const [value, name] of [['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen']]) {
      const option = make('option', '', name); option.value = value; blend.append(option);
    }
    blend.value = active.blend;
    blend.title = 'Normal: paint over · Multiply: darken · Screen: lighten';
    blend.onchange = () => change(current => current.update(active.id, { blend: blend.value }));
    blendLabel.append(make('span', '', 'Blend'), blend);
    properties.append(opacityLabel, blendLabel); fragment.append(properties);
    const order = make('div', 'te-layer-actions');
    const mergeReason = model.mergeDownReason(active.id);
    order.append(
      button('↑', 'Move selected layer up', () => change(current => current.move(active.id, index + 1)), active.id === 'original' || index === layers.length - 1),
      button('↓', 'Move selected layer down', () => change(current => current.move(active.id, index - 1)), index <= 1),
      button('Merge down', mergeReason || 'Merge into the layer below, keeping the visible appearance', () => change(current => current.mergeDown(active.id)), !!mergeReason),
      button('Rename', 'Rename the selected layer', () => rename(active, activeButton)),
      button('Delete', active.id === 'original' ? 'Keep Original; hide it to use a transparent base'
        : active.locked ? 'Unlock this layer before deleting it' : 'Delete the selected layer (Undo restores it)',
      () => change(current => current.remove(active.id)), active.id === 'original' || active.locked),
    );
    fragment.append(order);
    const message = active.locked ? 'Locked: unlock this layer or select another to paint.'
      : !active.visible ? 'Hidden: show this layer to see your painting.'
        : active.opacity === 0 ? 'Opacity is 0%: painting on this layer is invisible.' : 'Paint on the selected layer. Apply flattens the image for the game.';
    fragment.append(make('div', 'te-layer-footnote hint', message));
    const scrollTop = container.querySelector('.te-layer-list')?.scrollTop || 0;
    container.replaceChildren(fragment); list.scrollTop = scrollTop;
  }
  refresh();
  return { refresh };
}
