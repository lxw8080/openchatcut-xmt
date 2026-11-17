import assert from 'node:assert/strict';
import { createExportFailure } from './exportFailure';
import { shouldUseMobileServerFallback } from './videoExportOperation';

const unavailable = createExportFailure({
  stage: 'preflight',
  code: 'browser_export_unavailable',
  retryable: false,
  message: 'unsupported',
});
const renderFailure = createExportFailure({
  stage: 'render',
  code: 'export_failed',
  retryable: true,
  message: 'failed',
});

assert.equal(shouldUseMobileServerFallback(unavailable, true, 'h264', true), true);
assert.equal(shouldUseMobileServerFallback(unavailable, false, 'h264', true), false);
assert.equal(shouldUseMobileServerFallback(unavailable, true, 'vp8', true), false);
assert.equal(shouldUseMobileServerFallback(unavailable, true, 'prores', true), false);
assert.equal(shouldUseMobileServerFallback(unavailable, true, 'h264', false), false);
assert.equal(shouldUseMobileServerFallback(renderFailure, true, 'h264', true), false);
assert.equal(shouldUseMobileServerFallback(new Error('VideoEncoder is not supported'), true, 'h264', true), false);
console.log('mobileExportFallback.verify: OK');
