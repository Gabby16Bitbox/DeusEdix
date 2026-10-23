// Follow the actor's current pose, including a published layout or a live edit.
export function actorFrontView(editor, name, distance = 200) {
  const proxy = editor?.cutKit?.proxyOf?.(name) || editor?.proxies?.children?.find(p => p.userData?.actor?.name === name);
  const actor = proxy?.userData?.actor || editor?.baseActors?.find(a => a.name === name);
  if (!actor) return null;
  const edit = editor.edits?.moved?.[name];
  const loc = proxy?.position ? [proxy.position.x, proxy.position.z, proxy.position.y] : edit?.loc || actor.loc;
  const yaw = proxy?.rotation ? -proxy.rotation.y : ((edit?.rot || actor.rot)?.[1] || 0) * Math.PI * 2 / 65536;
  if (!loc?.every(Number.isFinite) || !Number.isFinite(yaw)) return null;
  return { from: [loc[0] + Math.cos(yaw) * distance, loc[1] + Math.sin(yaw) * distance, loc[2] + 65],
    at: [loc[0], loc[1], loc[2] + 18] };
}
