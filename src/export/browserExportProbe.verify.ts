import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { withExportProbeDeadline, withBrowserOutputStorage } from './browserExportProbe';
import { inspectBrowserExport, type BrowserExportOptions } from './browserExport';
import { planVideoExportRoute } from './exportRoutePlanner';
import { exportFailureFrom } from './exportFailure';
import { adaptBrowserExportStorage } from '../../config/xmtBrowserExportStorage';

const forever = () => new Promise<never>(() => {});
const deadline = { timeoutMs: 5, code: 'test_probe_timeout', message: 'timed out' };
assert.equal(await withExportProbeDeadline(async () => 42, deadline), 42);
await assert.rejects(withExportProbeDeadline(forever, deadline), (error: unknown) =>
  exportFailureFrom(error)?.code === 'test_probe_timeout' && exportFailureFrom(error)?.retryable === true);
const aborted = new AbortController();
aborted.abort();
let called = false;
await assert.rejects(withExportProbeDeadline(async () => { called = true; }, { ...deadline, signal: aborted.signal }),
  { name: 'AbortError' });
assert.equal(called, false);
const active = new AbortController();
const waiting = withExportProbeDeadline(forever, { ...deadline, timeoutMs: 5000, signal: active.signal });
active.abort();
await assert.rejects(waiting, { name: 'AbortError' });
const storageOwner = new AbortController();
const globalStorage = globalThis as { __XMT_EXPORT_SIGNAL__?: AbortSignal };
const previousSignal = globalStorage.__XMT_EXPORT_SIGNAL__;
try {
  globalStorage.__XMT_EXPORT_SIGNAL__ = storageOwner.signal;
  let resolveTarget!: (value: { close: () => void }) => void;
  let closed = false;
  const storage = withBrowserOutputStorage(() => new Promise<{ close: () => void }>((resolve) => { resolveTarget = resolve; }));
  storageOwner.abort();
  await assert.rejects(storage, { name: 'AbortError' });
  resolveTarget({ close: () => { closed = true; } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(closed, true, 'late storage writer must close after cancellation');
} finally { globalStorage.__XMT_EXPORT_SIGNAL__ = previousSignal; }

const options = {
  state: { width: 1920, height: 1080, fps: 30 }, codec: 'h264', resolution: '1080p', fps: 30,
  loadRenderer: async () => ({
    canRenderMediaOnWeb: async (config: { outputTarget?: string }) => {
      assert.equal(config.outputTarget, 'arraybuffer', 'codec capability must not probe storage');
      return { canRender: true, issues: [] };
    },
  }),
} as unknown as BrowserExportOptions;
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
try {
  // A nonessential power-efficiency query must not hold up a capable browser.
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaCapabilities: { encodingInfo: forever } } });
  const plan = await planVideoExportRoute(options);
  assert.equal(plan.route, 'browser');
  assert.equal(plan.browser.status, 'supported');
  assert.equal(plan.browser.status === 'supported' && plan.browser.powerEfficient, undefined);

  // Initialization errors remain errors, never a declaration of unsupported.
  const network = new TypeError('network');
  await assert.rejects(planVideoExportRoute({ ...options, loadRenderer: async () => { throw network; } }),
    (error: unknown) => error === network);
  const controller = new AbortController();
  const loading = planVideoExportRoute({ ...options, signal: controller.signal, loadRenderer: forever });
  controller.abort();
  await assert.rejects(loading, { name: 'AbortError' });
  const capabilityController = new AbortController();
  const probing = inspectBrowserExport({ ...options, signal: capabilityController.signal,
    loadRenderer: async () => ({ canRenderMediaOnWeb: forever }) as unknown as Awaited<ReturnType<NonNullable<BrowserExportOptions['loadRenderer']>>> });
  setTimeout(() => capabilityController.abort(), 5);
  await assert.rejects(probing, { name: 'AbortError' });
  const efficiencyController = new AbortController();
  const efficiency = inspectBrowserExport({ ...options, signal: efficiencyController.signal });
  setTimeout(() => efficiencyController.abort(), 5);
  await assert.rejects(efficiency, { name: 'AbortError' });
} finally {
  if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
}

// Validate the adapter against the installed upstream module, including syntax
// and drift rejection, rather than maintaining a second copy of its function.
const upstream = readFileSync(new URL('../../node_modules/@remotion/web-renderer/dist/esm/index.mjs', import.meta.url), 'utf8');
const adapted = adaptBrowserExportStorage(upstream);
await transform(adapted, { loader: 'js', format: 'esm' });
assert.equal(adapted.split('withBrowserOutputStorage(async () =>').length - 1, 3);
assert.throws(() => adaptBrowserExportStorage(adapted), /drift/);
console.log('browserExportProbe.verify: OK (deadlines, cancellation, optional hint, capability errors, upstream storage adapter)');
