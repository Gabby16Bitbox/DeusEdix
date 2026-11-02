// Models are visuals; a living game body is placed on a real ScriptedPawn.
// Corpse meshes and explicit death poses never acquire AI automatically.
export const deadModel = (mesh, props = {}) => /carcass|corpse/i.test(mesh || '') ||
  /^(?:dead|death|die|dying|unconscious)/i.test(String(props.IdleAnim || props.AnimSequence || '').replace(/^.*'([^']+)'$/, '$1'));

export function characterType(mesh, models = [], templates = [], props = {}) {
  if (deadModel(mesh, props)) return null;
  const same = value => String(value || '').toLowerCase() === String(mesh || '').toLowerCase();
  return models.find(m => same(m.mesh))?.character || templates.find(b => same(b.mesh))?.actor || null;
}

export function characterModelItem(mesh, info, type, extra = {}) {
  if (!type || deadModel(mesh, extra)) return null;
  const name = info.label || mesh.split('.').pop(), quoted = value => `"${String(value).replace(/["\r\n]/g, '')}"`;
  const preset = {
    ...(info.appearance || {}), Mesh: `${info.cls}'${mesh}'`, Skin: info.appearance?.Skin || 'None',
    CollisionRadius: String(type.radius), CollisionHeight: String(type.height),
    PrePivot: '(X=0,Y=0,Z=0)', DrawScale: String(type.scale || 1),
    Orders: 'Standing', OrderTag: 'None', FamiliarName: quoted(name), UnfamiliarName: quoted(name),
  };
  if (type.lookBody) preset.LookBody = `Class'${type.lookBody}'`;
  return { cls: type.cls, character: true, name, mesh, scale: 1,
    radius: type.radius, height: type.height, base: { r: type.radius, h: type.height }, preset };
}

// Decoration physics/idle state must not freeze the new pawn. Keep all visual,
// transform, identity and scripting properties which the pawn class supports.
export function characterConversionProps(current, item, has, name) {
  const decoration = /^(?:IdleAnim|IdleRate|Physics|bInvincible|bPushable|bHighlight|bFlammable|bCollideWorld|AnimSequence|AnimFrame|AnimRate|bAnimLoop|Health)$/i;
  const result = { ...item.preset };
  for (const [key, value] of Object.entries(current)) {
    if (!decoration.test(key) && has(key.split('(')[0])) result[key] = value;
  }
  result.Orders = 'Standing'; result.OrderTag = 'None';
  result.BindName ||= `"UCEd_${name}"`;
  return result;
}
