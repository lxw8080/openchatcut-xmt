import type { BrowserExportEvent, DecoderRoute } from './exportLiveProgress';
import { createExportFailure, ExportFailureError } from './exportFailure';
import { xmtHost } from '../xmt/host';

export interface BrowserLifecycle {
  visibility: 'visible' | 'hidden';
  wakeLock: 'active' | 'unavailable' | 'released';
  hiddenMs: number;
  hiddenSince?: number;
  interrupted?: boolean;
}
interface RecordData {
  id: string; sequence: number; status: string; startedAt: number; updatedAt: number;
  elapsedMs: number; hiddenMs: number; stage: string; encodedFrames: number;
  routes: DecoderRoute[]; error?: string; outputBytes?: number; attempt: number;
  source?: string;
  materials: { source: string; state: string; stage?: string; reasons: string[] }[];
  lifecycle: BrowserLifecycle; stageMs: Record<string, number>;
  events: { stage: string; updatedAt: number; visibility: string }[];
  output?: unknown; encoder?: unknown; build: string; revision: string; environment: object;
}
const active = new Set<string>();
const recovered = new Map<string, RecordData>();
const keyFor = (jobId: string | number) => `xmt.browserExportSession.v1.${jobId}`;
function read(key: string): RecordData | null {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null') as RecordData | null; } catch { return null; }
}
function persist(key: string, value: RecordData) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {
    // A full store must not leave a completed export marked running forever.
    if (value.status !== 'running') {
      try { sessionStorage.setItem(key, JSON.stringify({ id: value.id, sequence: value.sequence,
        status: value.status, error: value.error, encodedFrames: value.encodedFrames,
        startedAt: value.startedAt, updatedAt: value.updatedAt })); } catch {
        try { sessionStorage.removeItem(key); } catch { /* Private browsing. */ }
      }
    }
  }
}
function send(record: RecordData, host: ReturnType<typeof xmtHost>) {
  if (!host) return;
  // Small bounded snapshots also fit the browser's keepalive budget at pagehide.
  const body = JSON.stringify(record);
  try { void fetch(`/editor/api/jobs/${host.jobId}/export-attempts`, {
    method: 'POST', credentials: 'same-origin', keepalive: new TextEncoder().encode(body).length <= 60_000,
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': host.csrfToken }, body,
  }).catch(() => {}); } catch { /* Observations must never interrupt rendering. */ }
}

/** A previous document's record is evidence of interruption, never an instruction
 * to start another render. sessionStorage isolates tabs using the same project. */
export function interruptedBrowserExport(): RecordData | null {
  if (typeof window === 'undefined') return null;
  const host = xmtHost();
  if (!host) return null;
  const key = keyFor(host.jobId);
  const record = read(key);
  if (!record || active.has(record.id)) return null;
  if (record.status === 'running') {
    record.status = 'interrupted';
    record.error = '页面已重新加载，上次浏览器导出未完成；当前没有可续接的分段文件。';
    record.sequence += 1;
    persist(key, record);
    send(record, host);
  }
  if (record.status === 'interrupted') recovered.set(key, record);
  else recovered.delete(key);
  return recovered.get(key) ?? null;
}

export function startBrowserExportSession({ signal, onStatus, revision = 'unknown', now = Date.now }: {
  signal?: AbortSignal; onStatus?: (event: BrowserExportEvent) => void;
  revision?: string; now?: () => number;
}) {
  const host = typeof window === 'undefined' ? null : xmtHost();
  const doc = typeof document === 'undefined' ? null : document;
  const nav = typeof navigator === 'undefined' ? null : navigator;
  interruptedBrowserExport();
  const controller = new AbortController();
  const relay = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', relay, { once: true });
  if (signal?.aborted) relay();
  const began = now();
  let hiddenSince: number | undefined = doc?.hidden ? began : undefined;
  let hiddenMs = 0;
  let backgroundSinceProgress = Boolean(doc?.hidden);
  let finished = false;
  let wasInterrupted = false;
  let wake: WakeLockSentinel | null = null;
  let wakePending = false;
  let wakeState: BrowserLifecycle['wakeLock'] = 'unavailable';
  let stageStart = began;
  let lastSent = 0;
  const id = globalThis.crypto?.randomUUID?.() ?? `export-${began}-${Math.random().toString(36).slice(2)}`;
  const key = host ? keyFor(host.jobId) : '';
  const record: RecordData = {
    id, sequence: 0, status: 'running', startedAt: began, updatedAt: began,
    elapsedMs: 0, hiddenMs: 0, stage: 'capability-check', encodedFrames: 0,
    routes: [], materials: [], events: [], stageMs: {}, attempt: 1, lifecycle: { visibility: doc?.hidden ? 'hidden' : 'visible', wakeLock: wakeState, hiddenMs },
    build: import.meta.url.split('/').at(-1) ?? 'unknown', revision,
    environment: { ua: nav?.userAgent, hardwareConcurrency: nav?.hardwareConcurrency,
      maxTouchPoints: nav?.maxTouchPoints, secureContext: globalThis.isSecureContext === true,
      webCodecs: typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined',
      mediaCapabilities: Boolean(nav?.mediaCapabilities?.decodingInfo), wakeLockAvailable: Boolean(nav?.wakeLock?.request) },
  };
  active.add(id);
  const snapshot = (force = false) => {
    const clock = now();
    record.updatedAt = clock;
    record.elapsedMs = Math.max(0, clock - began);
    record.hiddenMs = hiddenMs + (hiddenSince === undefined ? 0 : Math.max(0, clock - hiddenSince));
    record.lifecycle = { visibility: hiddenSince === undefined ? 'visible' : 'hidden', wakeLock: wakeState,
      hiddenMs, ...(hiddenSince !== undefined ? { hiddenSince } : {}), ...(wasInterrupted ? { interrupted: true } : {}) };
    if (force || clock - lastSent >= 5000) {
      lastSent = clock;
      record.sequence += 1;
      if (key) persist(key, record);
      send(record, host);
    }
  };
  const lifecycle = () => {
    snapshot(true);
    onStatus?.({ type: 'lifecycle', lifecycle: { ...record.lifecycle } });
  };
  const acquire = async () => {
    if (finished || doc?.hidden || wake || wakePending || !nav?.wakeLock?.request) return;
    wakePending = true;
    try {
      const acquired = await nav.wakeLock.request('screen');
      if (finished || doc?.hidden) { await acquired.release(); return; }
      wake = acquired;
      wakeState = 'active';
      acquired.addEventListener('release', () => {
        if (wake !== acquired) return;
        wake = null; wakeState = 'released';
        if (!finished) lifecycle();
      });
      lifecycle();
    } catch { wakeState = 'unavailable'; if (!finished) lifecycle(); }
    finally { wakePending = false; }
  };
  const visibility = () => {
    if (doc?.hidden) {
      hiddenSince ??= now();
      backgroundSinceProgress = true;
    } else {
      if (hiddenSince !== undefined) hiddenMs += Math.max(0, now() - hiddenSince);
      hiddenSince = undefined;
      void acquire();
    }
    record.events.push({ stage: record.stage, updatedAt: now(), visibility: doc?.hidden ? 'hidden' : 'visible' });
    record.events = record.events.slice(-60);
    lifecycle();
  };
  const interrupted = (cause: unknown) => cause instanceof ExportFailureError && cause.failure.code === 'browser_background_interrupted'
    ? cause : new ExportFailureError(createExportFailure({
    stage: 'render', code: 'browser_background_interrupted', retryable: true,
    message: `页面切入后台或熄屏后导出中断，未自动重新渲染。请保持页面在前台后重试。${cause instanceof Error ? ` 原因：${cause.message}` : ''}`,
  }));
  const pagehide = (event: PageTransitionEvent) => {
    snapshot(true);
    if (!event.persisted) controller.abort(interrupted(new Error('页面已离开')));
  };
  doc?.addEventListener('visibilitychange', visibility);
  if (typeof window !== 'undefined') window.addEventListener?.('pagehide', pagehide);
  const heartbeat = setInterval(() => snapshot(), 5000);
  (heartbeat as unknown as { unref?: () => void }).unref?.();
  lifecycle();
  void acquire();
  return {
    signal: controller.signal,
    event(event: BrowserExportEvent) {
      if (event.type === 'stage') {
        const clock = now();
        record.stageMs[record.stage] = (record.stageMs[record.stage] ?? 0) + Math.max(0, clock - stageStart);
        stageStart = clock;
        record.stage = event.stage;
        record.source = event.source;
        if (event.attempt !== undefined) record.attempt = event.attempt;
        record.events.push({ stage: event.stage, updatedAt: clock, visibility: doc?.hidden ? 'hidden' : 'visible' });
        record.events = record.events.slice(-60);
      } else if (event.type === 'decoders') record.routes = event.routes.slice(0, 200).map((row) => ({ ...row,
        source: row.source.slice(0, 300), originalSource: row.originalSource?.slice(0, 300),
        hardwareFailure: row.hardwareFailure?.slice(0, 250), optimization: row.optimization?.slice(0, 220) }));
      else if (event.type === 'readiness') {
        const materials = new Map(record.materials.map((row) => [row.source.split('?')[0], row]));
        for (const row of [...event.data.assets ?? [], ...event.data.uploads ?? []]) {
          const source = row.source ?? `/library/api/assets/${row.asset_id}/stream`;
          materials.set(source.split('?')[0], { source: source.slice(0, 300), state: row.state,
            stage: row.stage, reasons: (row.reasons ?? []).slice(0, 2).map((reason) => reason.slice(0, 200)) });
        }
        record.materials = [...materials.values()].slice(0, 200);
      }
      else if (event.type === 'output') record.output = event.output;
      else if (event.type === 'encoder') record.encoder = event;
      else if (event.type === 'retry') record.error = event.reason;
      snapshot();
      onStatus?.(event);
    },
    progress(frames: number) {
      if (!doc?.hidden && frames > record.encodedFrames) backgroundSinceProgress = false;
      record.encodedFrames = frames;
      snapshot();
    },
    checkFailure(error: unknown) {
      if (backgroundSinceProgress || doc?.hidden) throw interrupted(error);
    },
    finish(status: string, error?: unknown, bytes?: number) {
      if (finished) return;
      finished = true;
      wasInterrupted = status === 'interrupted';
      record.status = status;
      if (error) record.error = (error instanceof Error ? error.message : String(error)).slice(0, 600);
      record.outputBytes = bytes;
      record.stageMs[record.stage] = (record.stageMs[record.stage] ?? 0) + Math.max(0, now() - stageStart);
      snapshot(true);
      if (wasInterrupted) onStatus?.({ type: 'lifecycle', lifecycle: { ...record.lifecycle } });
      active.delete(id);
      clearInterval(heartbeat);
      doc?.removeEventListener('visibilitychange', visibility);
      if (typeof window !== 'undefined') window.removeEventListener?.('pagehide', pagehide);
      signal?.removeEventListener('abort', relay);
      void wake?.release().catch(() => {});
    },
  };
}
