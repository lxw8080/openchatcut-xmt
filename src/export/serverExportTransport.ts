import { xmtHost } from '../xmt/host';
import { ExportFailureError, isExportFailure } from './exportFailure';
import type { ExportJobSnapshot, Translate } from './exportWorkflowTypes';

export class ServerExportTransportError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

/** Bound both response headers and body reads, without requiring AbortSignal.any. */
export async function fetchExportJson(url: string, init: RequestInit = {}, timeoutMs = 15_000) {
  init.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Export request timed out', 'TimeoutError')), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let value: unknown = null;
    try { value = await response.json(); } catch (error) {
      controller.signal.throwIfAborted();
      if (error instanceof TypeError) throw error; // Interrupted response body is retryable too.
    }
    return { response, value };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

export function retryableServerRead(error: unknown): boolean {
  return error instanceof ServerExportTransportError ? error.retryable
    : error instanceof TypeError || error instanceof Error && error.name === 'TimeoutError';
}

export function parseServerSnapshot(response: Response, value: unknown, t: Translate): ExportJobSnapshot {
  const snapshot = value as Partial<ExportJobSnapshot> | null;
  const valid = snapshot && typeof snapshot === 'object'
    && ['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(snapshot.status ?? '')
    && typeof snapshot.progress === 'number' && Number.isFinite(snapshot.progress);
  if (!response.ok || !valid) {
    // Temporary gateway/rate-limit errors are transport failures even if they
    // contain a structured failure. They do not prove the render has stopped.
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retryable && isExportFailure(snapshot?.failure)) throw new ExportFailureError(snapshot.failure);
    throw new ServerExportTransportError(snapshot?.error
      ?? t('无法读取导出进度 ({status})', { status: response.status }), response.status, retryable);
  }
  return snapshot as ExportJobSnapshot;
}

export async function readServerSnapshot(renderId: string, t: Translate, signal?: AbortSignal, timeoutMs?: number) {
  const base = xmtHost() ? '/editor/export/job' : '/export/job';
  const { response, value } = await fetchExportJson(`${base}/${encodeURIComponent(renderId)}`, { signal }, timeoutMs);
  return parseServerSnapshot(response, value, t);
}

export function waitForServer(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Export cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
