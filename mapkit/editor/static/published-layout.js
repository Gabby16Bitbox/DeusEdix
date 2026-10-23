// Authored tutorial placement is the baseline, not recruit work. Built additions
// already exist as map actors: keep them out of added[] to avoid duplicate proxies.
const clone = value => JSON.parse(JSON.stringify(value));
const keyed = ['moved', 'deleted', 'groups', 'anims'];
const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]))) : value;
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

export function withPublishedLayout(scratch, published) {
  const out = clone(scratch || {});
  if (!published) return out;
  for (const field of keyed) {
    const own = out[field] || {};
    out[field] = clone(published[field] || {});
    for (const [name, entry] of Object.entries(own)) out[field][name] = { ...out[field][name], ...entry };
  }
  const pastes = new Map((published.prefabs || []).map(e => [e.pid, clone(e)]));
  for (const entry of out.prefabs || []) pastes.set(entry.pid, { ...pastes.get(entry.pid), ...entry });
  out.prefabs = [...pastes.values()].filter(entry => {
    const pose = out.groups['paste~' + entry.pid];
    if (pose) for (const key of ['offset', 'yaw', 'scale', 'stretch', 'deleted']) if (key in pose) entry[key] = clone(pose[key]);
    return !entry.deleted;
  });
  out.unnest = [...new Set([...(published.unnest || []), ...(out.unnest || [])])];
  return out;
}

export function exerciseOnly(working, published) {
  const out = clone(working);
  if (!published) return out;
  for (const field of keyed) {
    for (const [name, entry] of Object.entries(published[field] || {})) {
      if (equal(out[field]?.[name], entry)) delete out[field][name];
    }
  }
  const original = new Map((published.prefabs || []).map(e => [e.pid, e]));
  const present = new Set((out.prefabs || []).map(e => e.pid));
  out.prefabs = (out.prefabs || []).filter(e => !equal(e, original.get(e.pid)));
  for (const [pid] of original) if (!present.has(pid)) {
    out.groups ||= {};
    out.groups['paste~' + pid] = { ...out.groups['paste~' + pid], deleted: true };
  }
  const unnest = new Set(published.unnest || []);
  out.unnest = (out.unnest || []).filter(id => !unnest.has(id));
  return out;
}
