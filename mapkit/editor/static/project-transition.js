// Retry only an explicitly classified, temporary refusal. A real game process,
// permission error or legacy ambiguous response must never be treated as loading.
export async function waitForProjectTransition(attempt, { onWait = () => {}, timeoutMs = 10000, intervalMs = 500,
  now = () => performance.now(), pause = delay, signal } = {}) {
  const started = now();
  for (;;) {
    if (signal?.aborted) throw new DOMException('Opening was cancelled.', 'AbortError');
    try {
      const result = await attempt();
      if (signal?.aborted) throw new DOMException('Opening was cancelled.', 'AbortError');
      return result;
    }
    catch (error) {
      if (signal?.aborted) throw new DOMException('Opening was cancelled.', 'AbortError');
      if (error.code !== 'project_busy' || error.retryable !== true) throw error;
      const remaining = timeoutMs - (now() - started);
      if (remaining <= 0) throw Object.assign(new Error('The current operation is still running. Let it finish, then try again.'),
        { code: 'project_wait_timeout', retryable: false });
      onWait();
      await pause(Math.min(intervalMs, remaining), signal);
    }
  }
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Opening was cancelled.', 'AbortError')); return; }
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Opening was cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
