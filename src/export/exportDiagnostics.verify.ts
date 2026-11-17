import assert from 'node:assert/strict';
import { reportExportDiagnostic } from './exportDiagnostics';

const globals = globalThis as unknown as Record<string, unknown>;
const keys = ['window', 'fetch'];
const prior = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  globals.window = { __XMT_EDITOR__: { jobId: 7, csrfToken: 'csrf', projectUrl: '/editor/api/projects/7' } };
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globals.fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true };
  };
  await reportExportDiagnostic('submit-accepted', { elapsedMs: 42.8, code: 'Error /private/path' });
  assert.equal(calls[0]!.url, '/editor/api/export-diagnostics');
  assert.deepEqual(calls[0]!.body, {
    xmtJobId: 7, stage: 'submit-accepted', elapsedMs: 43, code: 'Errorprivatepath',
  });
  assert.equal('project' in calls[0]!.body, false);
  globals.fetch = async () => { throw new Error('offline'); };
  await reportExportDiagnostic('poll-failed', { code: 'TypeError' });
  globals.window = {};
  let called = false;
  globals.fetch = async () => { called = true; };
  await reportExportDiagnostic('mobile-route');
  assert.equal(called, false);
} finally {
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globals[key];
  }
}
console.log('exportDiagnostics.verify: OK (bounded metadata, offline-safe, no non-host telemetry)');
