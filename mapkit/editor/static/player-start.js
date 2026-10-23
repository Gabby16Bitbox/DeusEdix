export const PLAYER_START_REQUIRED = 'This map has no enabled Player start. Add one from Objects, or enable an existing one, before pressing Play.';
export function usablePlayerStarts(actors = [], edits = {}, chains = {}) {
  const enabled = value => !['false','0'].includes(String(Array.isArray(value) ? value[0] : value).toLowerCase());
  const all = new Map([...actors, ...(edits.added || [])].map(a => [a.name, a]));
  return [...all.values()].filter(a => {
    const cls = String(a.cls || '').split('.').at(-1);
    if (cls !== 'PlayerStart' && !chains[a.cls]?.includes('PlayerStart')) return false;
    if (edits.deleted?.[a.name] || edits.disabled?.[a.name]) return false;
    const props = { ...a.props, ...edits.props?.[a.name] };
    return enabled(props.bEnabled ?? true) && enabled(props.bSinglePlayerStart ?? true);
  });
}
