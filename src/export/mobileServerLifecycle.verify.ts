import assert from 'node:assert/strict';
import { createExportJobStore } from './backgroundExportStore';
import { ExportFailureError } from './exportFailure';
import { exportFailureFrom } from './exportFailure';
import { finishServerCancellation, renderCompleted, retireAndDeleteExportJob, type ServerExportContext } from './serverExportRenderOperation';
import { resumePersistedServerExport } from './serverExportOperation';
import { listServerExportJobs, resetServerExportRecoveryMemory } from './serverExportRecovery';
import { fetchExportJson } from './serverExportTransport';
import type { ExportProgress } from './exportWorkflowTypes';

const globals = globalThis as unknown as Record<string, unknown>;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = globalThis.fetch;
globals.window = { __XMT_EDITOR__: { jobId: 1, projectUrl: '/project', csrfToken: 'test' },
  location: { origin: 'http://localhost', href: 'http://localhost/editor/1' } };
const ok = { status: 'succeeded', progress: 100, processedFrames: 60, totalFrames: 60,
  result: { path: '/media/output.mp4', name: 'test.mp4', sizeBytes: 5 } };
const active = { status: 'running', progress: 50, phase: 'rendering', processedFrames: 30, totalFrames: 60 };
const cancelled = { ...active, status: 'cancelled', phase: 'cancelled' };
const requests: string[] = [];
let read: (url: string, init?: RequestInit) => Promise<Response>;
let progress: ExportProgress;
let events: ExportProgress[];
function context(id: string): ServerExportContext {
  resetServerExportRecoveryMemory(); requests.length = 0; events = [];
  progress = { phase: 'preparing', percent: 0, startedAt: Date.now() };
  return {
    createOperationId: () => id, autoQaEnabled: false, destination: { type: 'downloads', label: 'Downloads' },
    beginTargetCommit() {}, endTargetCommit() {}, markTargetCommitted() {},
    setBusy() {}, setEngineInfo() {}, setEngineReason() {}, setRenderEngine() {}, t: (key) => key,
    setProgress(update) { progress = (typeof update === 'function' ? update(progress) : update)!; events.push(progress); },
    verifyCompletedExport: async () => {},
    options: { state: { width: 320, height: 240, fps: 30, items: [], tracks: {} } as never, projectId: 'mobile-test', projectName: 'Mobile',
      base: 'test', tab: 'video', codec: 'h264', resolution: '1080p', fps: 30, subtitleFormat: 'srt',
      subtitleCaptions: null, nleFormat: 'fcp_xml', includeMg: false, mgItems: [], onClose() {} },
  };
}
globalThis.fetch = (async (input, init) => {
  const url = String(input);
  if (url.includes('export-diagnostics')) return new Response(null, { status: 204 });
  requests.push(`${init?.method ?? 'GET'} ${url}`);
  return read(url, init);
}) as typeof fetch;
const records = () => listServerExportJobs('mobile-test');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
try {
  let ctx = context('network');
  let polls = 0;
  read = async (_url, init) => {
    if (init?.method === 'POST') return Response.json({ renderId: 'network' });
    polls++;
    if (polls === 1) return Response.json(active);
    if (polls === 2) return Response.json({ error: 'temporary' }, { status: 503 });
    return Response.json(ok);
  };
  await renderCompleted(ctx, 'video', 'h264');
  assert.equal(requests.filter((r) => r.startsWith('POST ')).length, 1);
  assert.equal(requests.some((r) => r.startsWith('DELETE ')), false);
  assert.equal((await records())[0]?.stage, 'output-ready');
  assert.equal(events.find((p) => p.phase === 'reconnecting')?.processedFrames, 30);
  assert.deepEqual(progress.output, { container: 'mp4', codec: 'h264', width: 320, height: 240, fps: 30 });

  ctx = context('auth-lost');
  read = async (_url, init) => init?.method === 'POST' ? Response.json({ renderId: 'auth-lost' })
    : Response.json({ error: 'login required' }, { status: 401 });
  await assert.rejects(renderCompleted(ctx, 'video', 'h264'), /login required/);
  assert.equal((await records())[0]?.renderId, 'auth-lost');
  read = async () => Response.json(active);
  await assert.rejects(retireAndDeleteExportJob('auth-lost'), /仍在渲染/);
  assert.equal((await records()).length, 1, 'active cleanup rejection must retain recovery');
  assert.equal(requests.some((r) => r.startsWith('DELETE ')), false);

  ctx = context('rejected');
  read = async () => Response.json({ error: 'invalid project' }, { status: 400 });
  await assert.rejects(renderCompleted(ctx, 'video', 'h264'), /invalid project/);
  assert.deepEqual(await records(), [], 'an explicitly rejected request is safe to replace');

  ctx = context('cancel-running');
  const abort = new AbortController();
  let stopping = false; let cancelReads = 0;
  read = async (url, init) => {
    if (url.endsWith('/cancel')) { stopping = true; return Response.json({ ...active, phase: 'cancelling' }, { status: 202 }); }
    if (init?.method === 'POST') return Response.json({ renderId: 'cancel-running' });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (!stopping) { setTimeout(() => abort.abort(), 0); return Response.json(active); }
    return Response.json(++cancelReads === 1 ? { ...active, phase: 'cancelling' } : cancelled);
  };
  await assert.rejects(renderCompleted(ctx, 'video', 'h264', abort.signal), { name: 'AbortError' });
  assert.ok(events.some((p) => p.phase === 'cancelling'));
  assert.equal(cancelReads, 3, 'two stop polls plus terminal confirmation before cleanup');
  assert.deepEqual(await records(), []);

  ctx = context('cancel-unknown');
  const unknownAbort = new AbortController();
  read = async (url, init) => {
    if (url.endsWith('/cancel')) return Response.json({ error: 'gateway' }, { status: 503 });
    if (init?.method === 'POST') return Response.json({ renderId: 'cancel-unknown' });
    setTimeout(() => unknownAbort.abort(), 0);
    return Response.json(active);
  };
  await assert.rejects(renderCompleted(ctx, 'video', 'h264', unknownAbort.signal),
    (e) => e instanceof ExportFailureError && e.failure.code === 'server_export_cancel_unconfirmed');
  assert.equal((await records())[0]?.cancelRequested, true);
  assert.equal(requests.some((r) => r.startsWith('DELETE ')), false);
  const submissions = requests.filter((r) => r === 'POST /editor/export/job').length;
  read = async (_url, init) => init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(cancelled);
  const recovered = createExportJobStore();
  await resumePersistedServerExport({ renderId: 'cancel-unknown', projectId: 'mobile-test', exportJobs: recovered, t: (key) => key });
  for (let n = 0; n < 30 && recovered.getActiveCount(); n++) await tick();
  assert.equal(recovered.getSnapshot().jobs[0]?.progress.phase, 'cancelled');
  assert.equal(recovered.getSnapshot().jobs[0]?.engineInfo?.transport, 'server');
  assert.equal(recovered.getSnapshot().jobs[0]?.progress.output?.width, 320);
  assert.equal(requests.filter((r) => r === 'POST /editor/export/job').length, submissions, 'retry resumes cancellation without another render');
  assert.deepEqual(await records(), []);

  ctx = context('cleanup-failed');
  const cleanupAbort = new AbortController();
  let requestedCleanup = false;
  read = async (url, init) => {
    if (url.endsWith('/cancel')) { requestedCleanup = true; return Response.json(cancelled); }
    if (init?.method === 'POST') return Response.json({ renderId: 'cleanup-failed' });
    if (init?.method === 'DELETE') return Response.json({ error: 'cleanup gateway failure' }, { status: 503 });
    if (!requestedCleanup) setTimeout(() => cleanupAbort.abort(), 0);
    return Response.json(requestedCleanup ? cancelled : active);
  };
  await assert.rejects(renderCompleted(ctx, 'video', 'h264', cleanupAbort.signal),
    (e) => e instanceof DOMException && e.name === 'AbortError' && exportFailureFrom(e)?.cleanupStatus === 'failed');

  ctx = context('finished-before-cancel');
  read = async (_url, init) => init?.method === 'POST' ? Response.json({ renderId: 'finished-before-cancel' }) : Response.json(ok);
  await renderCompleted(ctx, 'video', 'h264');
  read = async () => Response.json(ok);
  await assert.rejects(finishServerCancellation(ctx, 'finished-before-cancel'),
    (e) => e instanceof ExportFailureError && e.failure.code === 'server_export_already_completed');
  assert.equal((await records())[0]?.stage, 'output-ready');
  assert.equal((await records())[0]?.cancelRequested, false);

  read = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
  await assert.rejects(fetchExportJson('/pending', {}, 5), { name: 'TimeoutError' });
  read = async () => {
    const response = Response.json(ok);
    response.json = async () => { throw new TypeError('response body interrupted'); };
    return response;
  };
  await assert.rejects(fetchExportJson('/broken-body'), { name: 'TypeError' });

  const store = createExportJobStore();
  let release!: () => void;
  const id = store.start({ label: 'wait', targetPath: null, execute: async ({ setters }) => {
    await new Promise<void>((resolve) => { release = resolve; });
    setters.setProgress((p) => p ? { ...p, phase: 'failed', finishedAt: Date.now() } : p);
  } });
  await tick();
  store.cancel(id);
  assert.equal(store.getSnapshot().jobs[0]?.progress.phase, 'cancelling');
  assert.equal(store.getActiveCount(), 1);
  release(); await tick();
  assert.equal(store.getSnapshot().jobs[0]?.progress.phase, 'failed', 'unconfirmed cancellation cannot be changed to success');
  console.log('mobileServerLifecycle.verify: OK (reconnect, retained receipts, confirmed cancellation, retry and timeout)');
} finally {
  resetServerExportRecoveryMemory();
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globals.window;
}
