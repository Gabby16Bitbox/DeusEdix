// The Hierarchy's folders (the nests of edits.nests, each {id, label, items: keys}) as Unity's Hierarchy has them: the
// folder new things go in (Unity's Set as Default Parent: one per map, kept in the map's edits as edits.defaultFolder,
// a nest's id), and where a new thing or a copy goes among them. Without the page: app.js puts in it what is placed,
// pasted, drawn or made, and shows it in bold with a banner over the Hierarchy.

const nestsOf = (edits) => edits?.nests || [];

// the folder new things go in: its nest, or null (none set, or that folder is gone)
export function defaultFolder(edits) {
  const id = edits?.defaultFolder;
  return (typeof id === 'string' && nestsOf(edits).find((n) => n.id === id)) || null;
}
// new things go into the folder of this id from now on (null: into none, the top level again); false when there is no
// such folder (nothing changes)
export function setDefaultFolder(edits, id) {
  if (id === null) { delete edits.defaultFolder; return true; }
  if (!nestsOf(edits).some((n) => n.id === id)) return false;
  edits.defaultFolder = id;
  return true;
}
// a folder deleted, un-nested or emptied away takes the mark with it (a folder made later under its id must not get
// it); true when the mark went
export function forgetGoneDefault(edits) {
  if (!edits || !('defaultFolder' in edits) || defaultFolder(edits)) return false;
  delete edits.defaultFolder;
  return true;
}
// new things (their keys) at the end of a folder, each once; the folder (null: none, they stay at the top level)
export function putInFolder(folder, keys) {
  if (folder) for (const k of keys) if (!folder.items.includes(k)) folder.items.push(k);
  return folder;
}
// copies ([the original's key, the copy's key] each) in the folders their originals are in, each right after its
// original, as Unity's Duplicate: a copy stays beside what it copies. An original in no folder leaves its copy at the
// top level, as it is
export function putBeside(nests, pairs) {
  for (const [original, copy] of pairs) {
    const n = copy && nests.find((x) => x.items.includes(original));
    if (n && !n.items.includes(copy)) n.items.splice(n.items.indexOf(original) + 1, 0, copy);
  }
}
