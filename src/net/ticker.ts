/** A steady interval that keeps running in background tabs (worker timers are not throttled like page timers). */
export function startTicker(fn: () => void, ms: number): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
    const worker = new Worker(url);
    let revoked = false;
    worker.onmessage = () => {
      if (!revoked) {
        revoked = true;
        URL.revokeObjectURL(url);
      }
      fn();
    };
    return () => worker.terminate();
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}
