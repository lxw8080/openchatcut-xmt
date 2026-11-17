import { createExportFailure, ExportFailureError } from './exportFailure';

/** Browser capability/storage APIs have no native timeout or AbortSignal.
 * Own the waiting lifecycle here; late native results cannot resume an export. */
export async function withExportProbeDeadline<T>(probe: () => Promise<T>, options: {
  signal?: AbortSignal;
  timeoutMs: number;
  code: string;
  message: string;
}): Promise<T> {
  const { signal, timeoutMs, code, message } = options;
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(signal?.reason ?? new DOMException('Export cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(new ExportFailureError(createExportFailure({
      stage: 'preflight', code, retryable: true, message,
    }))), timeoutMs);
  });
  try {
    return await Promise.race([probe(), stopped]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

/** Called by the source-controlled web-renderer adapter while it owns the
 * browser render slot. Keep OPFS auto-selection; a stalled storage API must
 * fail explicitly instead of silently allocating a large movie in RAM. */
export async function withBrowserOutputStorage<T>(probe: () => Promise<T>): Promise<T> {
  const signal = (globalThis as { __XMT_EXPORT_SIGNAL__?: AbortSignal }).__XMT_EXPORT_SIGNAL__;
  let settled = false;
  try {
    return await withExportProbeDeadline(() => probe().then((value) => {
      // createWritable may finish after cancellation. Release that abandoned
      // writer; its late result must never start rendering or retain a lock.
      if ((settled || signal?.aborted) && value && typeof value === 'object'
        && 'close' in value && typeof value.close === 'function') {
        const close = value.close.bind(value);
        void Promise.resolve().then(() => close()).catch(() => {});
      }
      return value;
    }), {
      signal, timeoutMs: 10_000, code: 'browser_output_storage_timeout',
      message: '浏览器输出存储初始化超时，请重试导出或重新打开页面',
    });
  } finally { settled = true; }
}
