import assert from 'node:assert/strict';
import { compositionSnapshot, reviewComposition } from './compositionReviewClient';
import type { TimelineState } from '../editor/types';

const state: TimelineState = { fps: 30, width: 1920, height: 1080, items: [], selectedId: null };
const before = structuredClone(state);
const snapshot = compositionSnapshot('main', state);
assert.deepEqual(state, before);
assert.equal(snapshot, compositionSnapshot('main', { ...state, selectedId: 'another', selectedIds: ['another'] }));
assert.notEqual(snapshot, compositionSnapshot('main', { ...state, width: 1080 }));
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = { __XMT_EDITOR__: { projectUrl: '/project', csrfToken: 'test', compositionReviewUrl: '/review' } };
let writes = 0;
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/review');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { project: JSON.parse(snapshot) });
    assert.ok(init?.signal);
    writes++;
    return new Response(JSON.stringify({ data: { findings: [], doc_sha256: 'a', evidence_sha256: 'b',
      coverage: { speech: false, visual_sources: false, audio_samples: false, rendered_frames: false } } }));
  };
  const report = await reviewComposition(snapshot, new AbortController().signal);
  assert.equal(report.findings.length, 0);
  assert.equal(writes, 1); // No flush/save request while reviewing unsaved edits.
  globalThis.fetch = async () => new Response(JSON.stringify({ error: '检查不可用' }), { status: 503 });
  await assert.rejects(reviewComposition(snapshot, new AbortController().signal), /检查不可用/);
} finally {
  globalThis.fetch = originalFetch;
  delete globals.window;
}
console.log('composition review snapshot and read-only transport: passed');
