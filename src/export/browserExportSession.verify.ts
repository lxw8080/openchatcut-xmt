import assert from 'node:assert/strict';
import { interruptedBrowserExport, startBrowserExportSession } from './browserExportSession';
import { applyBrowserExportEvent } from './exportLiveProgress';

const previous = new Map(['window', 'document', 'navigator', 'sessionStorage', 'fetch'].map((key) =>
  [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
class Page extends EventTarget { hidden = false; }
class Wake extends EventTarget {
  released = false;
  async release() { this.released = true; this.dispatchEvent(new Event('release')); }
}
const doc = new Page();
const win = Object.assign(new EventTarget(), { __XMT_EDITOR__: { jobId: 1537, csrfToken: 'test', projectUrl: '/project' } });
const storage = new Map<string, string>();
const posts: Record<string, unknown>[] = [];
let resolveWake!: (value: Wake) => void;
let clock = 10_000;
const events: Parameters<typeof applyBrowserExportEvent>[1][] = [];
Object.defineProperties(globalThis, {
  window: { configurable: true, value: win }, document: { configurable: true, value: doc },
  navigator: { configurable: true, value: { userAgent: 'test iOS', wakeLock: { request: () => new Promise<Wake>((resolve) => { resolveWake = resolve; }) } } },
  sessionStorage: { configurable: true, value: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) } },
  fetch: { configurable: true, value: async (_url: string, init: RequestInit) => { posts.push(JSON.parse(String(init.body))); return { ok: true }; } },
});
try {
  const session = startBrowserExportSession({ now: () => clock, onStatus: (event) => events.push(event) });
  const wake = new Wake(); resolveWake(wake);
  await Promise.resolve();
  session.event({ type: 'stage', stage: 'rendering', attempt: 1 });
  session.progress(50);
  assert.equal(interruptedBrowserExport(), null, 'opening the dialog must not classify a live session as interrupted');
  clock += 2000; doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  clock += 10_000; await wake.release(); doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
  assert.throws(() => session.checkFailure(new Error('decoder lost')), /未自动重新渲染/);
  let interruption: unknown;
  try { session.checkFailure(new Error('decoder lost')); } catch (error) { interruption = error; }
  assert.throws(() => session.checkFailure(interruption), (error) => error === interruption,
    'nested export boundaries must preserve the original interruption instead of wrapping it repeatedly');
  session.progress(51);
  assert.doesNotThrow(() => session.checkFailure(new Error('unrelated failure')));
  session.finish('rendered', undefined, 1000);
  // A late wake-lock promise must release instead of resurrecting a finished job.
  const late = new Wake(); resolveWake(late); await Promise.resolve(); await Promise.resolve();
  assert.equal(late.released, true);
  assert.equal(posts.at(-1)?.status, 'rendered');
  assert.equal(posts.at(-1)?.hiddenMs, 10_000);
  assert.equal(interruptedBrowserExport(), null);
  const stored = JSON.parse([...storage.values()][0]);
  storage.set([...storage.keys()][0], JSON.stringify({ ...stored, id: 'previous-document-id', status: 'running' }));
  assert.equal(interruptedBrowserExport()?.status, 'interrupted');
  assert.equal(posts.at(-1)?.status, 'interrupted');
  const postCount = posts.length;
  interruptedBrowserExport();
  assert.equal(posts.length, postCount, 'reopening the dialog must not resubmit interruption observations');
  const progress = events.reduce((state, event) => applyBrowserExportEvent(state, event),
    { phase: 'preparing', percent: 0, startedAt: 10_000 } as Parameters<typeof applyBrowserExportEvent>[0]);
  assert.equal(progress.live?.lifecycle?.hiddenMs, 10_000);
  const cancelled = new AbortController();
  const second = startBrowserExportSession({ signal: cancelled.signal, now: () => clock });
  cancelled.abort(); assert.equal(second.signal.aborted, true); second.finish('cancelled');
  const finalWake = new Wake(); resolveWake(finalWake); await Promise.resolve(); await Promise.resolve();
  assert.equal(finalWake.released, true);
  console.log('browser export session: wake lifecycle, late cleanup, hidden timing, interruption and no automatic restart passed');
} finally {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
}
