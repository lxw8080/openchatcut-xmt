import assert from 'node:assert/strict';
import { createExportFailure } from './exportFailure';
import { createVideoExporter, shouldUseMobileServerFallback, type VideoExportContext } from './videoExportOperation';

const unavailable = createExportFailure({
  stage: 'preflight', code: 'browser_export_unavailable', retryable: false, message: 'unsupported',
});
const renderFailure = createExportFailure({
  stage: 'render', code: 'export_failed', retryable: true, message: 'failed',
});

for (const [mobile, codec, outputMatches, expected] of [
  [true, 'h264', true, true], [false, 'h264', true, false],
  [true, 'vp8', true, false], [true, 'prores', true, false],
  [true, 'h264', false, false],
] as const) {
  assert.equal(shouldUseMobileServerFallback(unavailable, mobile, codec, outputMatches), expected);
}
assert.equal(shouldUseMobileServerFallback(renderFailure, true, 'h264', true), false);
assert.equal(shouldUseMobileServerFallback(new DOMException('cancel', 'AbortError'), true, 'h264', true), false);
assert.equal(shouldUseMobileServerFallback(createExportFailure({
  stage: 'preflight', code: 'browser_capability_timeout', retryable: true, message: 'timeout',
}), true, 'h264', true), false);

const globals = globalThis as unknown as Record<string, unknown>;
const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
try {
  globals.window = {
    matchMedia: () => ({ matches: true }),
    __XMT_EDITOR__: { jobId: 42, csrfToken: 'csrf', projectUrl: '/editor/api/projects/42' },
  };
  const calls: string[] = [];
  const context = {
    options: { state: { fps: 30, width: 1920, height: 1080 }, codec: 'h264', fps: 30, resolution: '1080p' },
    browserAbortRef: { current: null },
    setRenderEngine: (value: string) => calls.push(`engine:${value}`),
    setEngineInfo: () => undefined,
    setEngineReason: () => undefined,
    setBusy: (value: string) => calls.push(value),
    setProgress: () => undefined,
    t: (value: string) => value,
  } as unknown as VideoExportContext;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createVideoExporter(context, async () => { calls.push('server'); })(controller.signal),
    { name: 'AbortError' });
  assert.deepEqual(calls, ['engine:checking'], 'mobile must enter browser preflight and honor cancellation before any server submission');
  assert.equal(context.browserAbortRef.current, null);
} finally {
  if (previous) Object.defineProperty(globalThis, 'window', previous);
  else delete globals.window;
}
console.log('mobileExportFallback.verify: OK (browser first; confirmed unsupported only; matching output; abort/timeout/render failures never submit)');
