import assert from 'node:assert/strict';
import { createExportFailure } from './exportFailure';
import { shouldUseMobileServerExport } from './mobileExportRoute';
import { createVideoExporter, shouldUseMobileServerFallback, type VideoExportContext } from './videoExportOperation';

const unavailable = createExportFailure({
  stage: 'preflight', code: 'browser_export_unavailable', retryable: false, message: 'unsupported',
});
const renderFailure = createExportFailure({
  stage: 'render', code: 'export_failed', retryable: true, message: 'failed',
});

for (const [mobile, codec, fps, sourceFps, expected] of [
  [true, 'h264', 30, 30, true], [false, 'h264', 30, 30, false],
  [true, 'vp8', 30, 30, false], [true, 'prores', 30, 30, false],
  [true, 'h264', 60, 30, false],
] as const) {
  assert.equal(shouldUseMobileServerExport({ mobile, codec, fps, sourceFps }), expected);
}
assert.equal(shouldUseMobileServerFallback(renderFailure, true, 'h264', true), false);
assert.equal(shouldUseMobileServerFallback(unavailable, false, 'h264', true), false);

const globals = globalThis as unknown as Record<string, unknown>;
const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
try {
  globals.window = {
    matchMedia: () => ({ matches: true }),
    __XMT_EDITOR__: { jobId: 42, csrfToken: 'csrf', projectUrl: '/editor/api/projects/42' },
  };
  const calls: string[] = [];
  const context = {
    options: { state: { fps: 30 }, codec: 'h264', fps: 30 },
    setRenderEngine: (value: string) => calls.push(`engine:${value}`),
    setEngineInfo: () => undefined,
    setEngineReason: () => undefined,
    setBusy: (value: string) => calls.push(value),
    setProgress: () => undefined,
    t: (value: string) => value,
  } as unknown as VideoExportContext;
  await createVideoExporter(context, async () => { calls.push('server'); })();
  assert.deepEqual(calls, ['engine:server', '正在提交服务端渲染…', 'server']);
} finally {
  if (previous) Object.defineProperty(globalThis, 'window', previous);
  else delete globals.window;
}
console.log('mobileExportFallback.verify: OK (direct mobile server route; desktop and unsupported formats unchanged; no render retry)');
