import assert from 'node:assert/strict';
import { createExportJobStore, type BackgroundExportExecution } from './backgroundExportStore';
import { applyBrowserExportEvent, exportOutputSummary, renderThroughput, type BrowserExportEvent } from './exportLiveProgress';
import { withBrowserRenderSlot } from './browserRenderQueue';

let now = 1000;
const store = createExportJobStore(() => now);
let execution!: BackgroundExportExecution;
let end!: () => void;
const jobId = store.start({ label: 'first.mp4', targetPath: null,
  execute: (value) => { execution = value; return new Promise<void>((resolve) => { end = resolve; }); } });
await Promise.resolve();
const send = (event: BrowserExportEvent) => execution.setters.setProgress((p) => p ? applyBrowserExportEvent(p, event) : p);
const current = () => store.getSnapshot().jobs.find((job) => job.id === jobId)!;
send({ type: 'output', output: { container: 'mp4', codec: 'h264', width: 960, height: 720, fps: 30 } });
send({ type: 'stage', stage: 'checking' });
send({ type: 'readiness', data: { assets: [{ asset_id: 7, state: 'waiting', proxy_status: 'running' }],
  uploads: [{ source: '/media/uploads/voice.wav', state: 'ok' }] } });
assert.deepEqual(current().progress.live?.materials.map((r) => r.stage), ['transcoding', 'ready']);
const firstSnapshot = current().progress;
now = 121_000;
send({ type: 'stage', stage: 'rendering', attempt: 1 });
now = 123_000;
execution.setters.setProgress((p) => p ? { ...p, processedFrames: 30, totalFrames: 300 } : p);
assert.equal(current().progress.startedAt, 1000);
assert.equal(renderThroughput(current().progress, now)?.fps, 15, 'two minutes of preparation excluded');
assert.equal(renderThroughput(current().progress, now)?.remainingMs, 18000);
assert.equal(firstSnapshot.live?.materials[0]?.stage, 'transcoding', 'old snapshots stay unchanged');
send({ type: 'decoders', total: 2, completed: 2, routes: [
  { source: '/library/api/assets/7/stream', mode: 'proxy-hardware' },
  { source: '/media/uploads/clip.mp4', mode: 'software', hardwareFailure: 'hardware unavailable' },
] });
send({ type: 'encoder', preference: 'prefer-software', reason: 'runtime fallback' });
now = 124_000;
send({ type: 'stage', stage: 'rendering', attempt: 2 });
assert.equal(current().progress.processedFrames, 0);
assert.equal(current().progress.stageStartedAt, now);
assert.equal(current().progress.startedAt, 1000);
assert.equal(renderThroughput(current().progress, now), null);
assert.equal(current().progress.live?.decoders.length, 2);
now = 125_000;
await new Promise((resolve) => setTimeout(resolve, 1100));
assert.equal(current().clock, now, 'running clock ticks without progress events');
now = 126_000;
const detach = store.subscribe(() => {});
assert.equal(current().clock, now, 'reopened UI refreshes immediately');
assert.equal(exportOutputSummary(current().progress.live!.output!), 'MP4 · H.264 · 960×720 · 30 fps',
  'reopened UI uses this job output, independent of form defaults');
detach();
assert.equal(store.cancel(jobId), true);
const cancelled = current().progress;
send({ type: 'encoder', preference: 'prefer-hardware', reason: 'late event' });
assert.equal(current().progress, cancelled, 'terminal task rejects late progress');
assert.equal(current().progress.finishedAt, now);
end();

const order: string[] = [];
let release!: () => void;
const one = withBrowserRenderSlot(async () => { order.push('one'); await new Promise<void>((resolve) => { release = resolve; }); });
await Promise.resolve();
const two = withBrowserRenderSlot(async () => { order.push('two'); }, undefined, () => order.push('two-waiting'));
const abort = new AbortController();
const three = withBrowserRenderSlot(async () => { order.push('three'); }, abort.signal);
const rejected = assert.rejects(three, { name: 'AbortError' });
abort.abort();
await rejected;
assert.deepEqual(order, ['one', 'two-waiting']);
release();
await Promise.all([one, two]);
assert.deepEqual(order, ['one', 'two-waiting', 'two'], 'only one browser task owns the runtime');
console.log('exportLiveProgress.verify: OK (phase clocks, retry, receipts, immutable snapshots, reopen, cancellation, FIFO)');
