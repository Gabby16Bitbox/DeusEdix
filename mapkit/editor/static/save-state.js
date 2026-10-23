// One FIFO for every operation that writes the same document. A failed write
// rejects its caller but cannot prevent the next queued write from running.
export function createSaveQueue() {
  let tail = Promise.resolve(), pending = 0;
  return {
    get pending() { return pending; },
    run(task) {
      if (typeof task !== 'function') throw new TypeError('A save task must be a function.');
      pending++;
      const result = tail.then(task).finally(() => { pending--; });
      tail = result.catch(() => {});
      return result;
    },
  };
}
