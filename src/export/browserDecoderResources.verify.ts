import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { adaptMediaExportResources } from '../../config/xmtMediaExportResources';

const upstream = readFileSync(new URL('../../node_modules/@remotion/media/dist/esm/index.mjs', import.meta.url), 'utf8');
const adapted = adaptMediaExportResources(upstream);
await transform(adapted, { loader: 'js', format: 'esm' });
assert.throws(() => adaptMediaExportResources(adapted), /drift/);
const start = adapted.indexOf('var RECENTLY_USED_REQUEST_COUNT =');
const managerCode = adapted.slice(start, adapted.indexOf('// src/caches.ts', start));

// Exercise the installed manager's real eviction policy with asynchronous
// iterator cancellation receipts, including the unchanged preview policy.
for (const limit of [2, Infinity]) {
  let open = 0;
  let peak = 0;
  let clock = 0;
  let released = 0;
  const busy = new Set<string>();
  const makeManager = runInNewContext(`${managerCode}\nmakeKeyframeManager`, {
    Internals14: { Log: { verbose() {}, trace() {}, warn() {} } },
    getSafeWindowOfMonotonicity: () => 0.2,
    makeSerializedQueue: () => (run: () => unknown) => Promise.resolve().then(run),
    makeKeyframeBank: async ({ src }: { src: string }) => {
      open++;
      peak = Math.max(peak, open);
      const lastUsed = ++clock;
      return {
        src, isBusy: () => busy.has(src), getLastUsed: () => lastUsed,
        getOpenFrameCount: () => ({ size: 1, timestamps: [0] }),
        getRangeOfTimestamps: () => ({ firstTimestamp: 0, lastTimestamp: 1 }),
        canSatisfyTimestamp: () => true, deleteFramesBeforeTimestamp() {},
        prepareForDeletion: () => ({ framesDeleted: 1, released: new Promise<void>((resolve) => {
          setTimeout(() => { open--; released++; resolve(); }, 1);
        }) }),
      };
    },
  });
  const manager = makeManager({ getTotalCacheStats: () => ({ totalSize: 0 }), maxDecoderBanks: limit });
  for (let i = 0; i < 12; i++) {
    await manager.requestKeyframeBank({ src: `video-${i}`, timestamp: 0, fps: 30, maxCacheSize: 1_000_000, videoSampleSink: {} });
  }
  assert.equal(peak, limit === 2 ? 2 : 12);
  assert.equal(open, limit === 2 ? 2 : 12);
  assert.equal(released, limit === 2 ? 10 : 0);
  if (limit === 2) {
    // The budget is soft while every bank is actively being read. It must
    // never close a sample under another request; reclaim on the next cut.
    busy.add('video-10'); busy.add('video-11');
    await manager.requestKeyframeBank({ src: 'video-12', timestamp: 0, fps: 30, maxCacheSize: 1_000_000, videoSampleSink: {} });
    assert.equal(open, 3);
    assert.equal(released, 10);
    busy.clear();
    await manager.requestKeyframeBank({ src: 'video-13', timestamp: 0, fps: 30, maxCacheSize: 1_000_000, videoSampleSink: {} });
    assert.equal(open, 2);
    assert.equal(released, 12);
  }
  manager.dispose('error');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(open, 0);
}
console.log('browserDecoderResources.verify: OK (installed manager, awaited eviction, busy protection, preview unchanged, syntax and drift)');
