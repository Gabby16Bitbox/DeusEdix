// A saved prefab is a built snapshot, not references back into the source level.
// Keep collection separate from the UI so nested selections can be regression-tested.
export function collectPrefabSelection(objects, structures) {
  const result = { structures: [], actors: [], boxes: [] };
  const seen = new Set();
  for (const object of objects) {
    const d = object?.userData || {};
    let kind, name;
    if (d.kind === 'structure') {
      const st = structures[d.name];
      if (!st || st.dissolved || !st.built || st.pendingCopy || st.pendingPiece || st.pendingPaste)
        throw new Error('Rebuild first: every structure in the selection must be built.');
      if (!st.copyable || st.rotatable === false || st.gameplay)
        throw new Error(`"${st.label || d.name}" contains doors, lifts or mission objects. Save only reusable scenery.`);
      kind = 'structures'; name = d.name;
    } else if (d.box) {
      throw new Error('Authored blocks cannot yet be saved directly. Rebuild, then select their built structure in the Hierarchy.');
    } else if (d.actor) {
      kind = 'actors'; name = d.actor.name;
    } else {
      throw new Error('The selection contains an unsupported object.');
    }
    const key = `${kind}:${name}`;
    if (!seen.has(key)) { seen.add(key); result[kind].push(name); }
  }
  if (!result.structures.length && !result.actors.length)
    throw new Error('Select a nest or a built structure first.');
  return result;
}
