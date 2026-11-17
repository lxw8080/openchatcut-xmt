/** The Remotion sink flags and XMT decoder runtime are page-wide. Only one
 * browser export may own them; queued jobs retain their own UI state/cancel. */
type WaitingRender = { run(): void; cancel(): void };
const waiting: WaitingRender[] = [];
let active = false;

function drain(): void {
  if (!active) waiting.shift()?.run();
}

export function withBrowserRenderSlot<T>(operation: () => Promise<T>, signal?: AbortSignal,
  onWaiting?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => new DOMException('Browser export cancelled', 'AbortError');
    if (signal?.aborted) { reject(abort()); return; }
    const entry: WaitingRender = {
      cancel() {
        const index = waiting.indexOf(entry);
        if (index < 0) return;
        waiting.splice(index, 1);
        signal?.removeEventListener('abort', entry.cancel);
        reject(abort());
      },
      run() {
        signal?.removeEventListener('abort', entry.cancel);
        if (signal?.aborted) { reject(abort()); drain(); return; }
        active = true;
        void Promise.resolve().then(operation).then(resolve, reject).finally(() => {
          active = false;
          drain();
        });
      },
    };
    if (active || waiting.length) onWaiting?.();
    waiting.push(entry);
    signal?.addEventListener('abort', entry.cancel, { once: true });
    drain();
  });
}
