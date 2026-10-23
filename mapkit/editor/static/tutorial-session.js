// Training edits live only for one open map. The server owns their scratch
// files; this controller owns the token and protects against late responses.
export const TUTORIAL_SCRIPT = 'deusedix_tutorial';
export const TUTORIAL_HEADER = 'X-DeusEdix-Tutorial';
export function isTemporaryTutorial(project, script) {
  const target = project?.target || 'revision';
  return ((['training','training-revision'].includes(project?.id) && target === 'revision') || (project?.id === 'training-vanilla' && target === 'vanilla'))
    && ['training', 'tutorial'].includes(project?.kind) && script === TUTORIAL_SCRIPT;
}
const cancelled = () => Object.assign(new Error('The training session was closed.'), { name: 'AbortError' });

export function createTutorialSession({ fetch: transport = (...args) => globalThis.fetch(...args) } = {}) {
  let token = null, revision = 0, pending = null;
  async function request(path, body, { keepalive = false, session = token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (session) headers[TUTORIAL_HEADER] = session;
    const response = await transport(path, { method: 'POST', headers, body: JSON.stringify(body), keepalive });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The training session could not be updated.');
    return result;
  }
  const discard = (session, keepalive = false) => session
    ? request('/api/tutorial_end', { session }, { session, keepalive }) : Promise.resolve();
  function adopt(session) {
    if (typeof session !== 'string' || !session) throw new Error('The tutorial did not return a session token.');
    if (token !== session) { token = session; revision++; }
    return token;
  }
  function end({ keepalive = false, session = token } = {}) {
    // An old cleanup must never invalidate a later session in this page.
    if (session && session !== token) return discard(session, keepalive);
    const closingRevision = ++revision;
    pending = null;
    if (keepalive) token = null;
    return discard(session, keepalive).then(result => {
      if (revision === closingRevision && token === session) token = null;
      return result;
    });
  }
  function requestStart({ fresh = false } = {}) {
    if (pending) return pending.promise;
    const old = fresh ? token : null;
    if (fresh && token) revision++;
    const ticket = { revision, promise: null };
    ticket.promise = (async () => {
      if (old) await discard(old);
      if (ticket.revision !== revision) throw cancelled();
      if (old && token === old) token = null;
      const existing = token;
      const result = await request('/api/tutorial_start', existing ? { session: existing } : {}, { session: existing });
      if (ticket.revision !== revision) {
        // The build may finish after Close map. Retire only that old build.
        if (result.session !== token) await discard(result.session).catch(() => {});
        throw cancelled();
      }
      adopt(result.session);
      return result;
    })().finally(() => { if (pending === ticket) pending = null; });
    pending = ticket;
    return ticket.promise;
  }
  return { get token() { return token; }, get revision() { return revision; }, get preparing() { return !!pending; },
    adopt, end, requestStart };
}

export function tutorialRequestHeaders(input, init = {}, token, origin) {
  if (!token) return init;
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin);
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/api/')) return init;
  const headers = new Headers(init.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
  if (!headers.has(TUTORIAL_HEADER)) headers.set(TUTORIAL_HEADER, token);
  return { ...init, headers };
}

export function clearTutorialViewPreferences(storage, projectId) {
  try {
    const prefix = `deusedix.project:${encodeURIComponent(projectId || 'manager')}:`;
    storage.removeItem(prefix + 'objects.' + TUTORIAL_SCRIPT);
    storage.removeItem(prefix + 'clipboard');
    const old = JSON.parse(storage.getItem(prefix + 'tutorial') || 'null');
    if (old && ('step' in old || 'map' in old || 'offered' in old))
      storage.setItem(prefix + 'tutorial', JSON.stringify({ muted: !!old.muted }));
  } catch (_) { /* Training also works with browser storage disabled. */ }
}

export const tutorialSession = createTutorialSession();
const installed = new WeakSet();
export function installTutorialSession(target = window, session = tutorialSession) {
  if (installed.has(target)) return;
  installed.add(target);
  const original = target.fetch.bind(target);
  target.fetch = (input, init = {}) => original(input, tutorialRequestHeaders(input, init, session.token, target.location.href));
  let discardedOnHide = false;
  target.addEventListener('pagehide', () => {
    discardedOnHide = !!session.token || session.preparing;
    if (discardedOnHide) session.end({ keepalive: true }).catch(() => {});
  });
  target.addEventListener('pageshow', event => {
    if (event.persisted && discardedOnHide) {
      // The browser can revive the old JS heap after its server scratch was
      // discarded. Return to Projects instead of exposing those stale tools.
      target.location.replace(target.__projectContext?.homeUrl || target.location.pathname);
    }
  });
}
