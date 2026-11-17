import assert from 'node:assert/strict';
import { verifyExportVideoSeek } from './browserDecoderProbe';

let closed = 0;
const sample = { close: () => { closed++; } };
await verifyExportVideoSeek({ getSample: async (seconds) => { assert.equal(seconds, 15.364); return sample; } }, 15.364);
assert.equal(closed, 1);
await assert.rejects(verifyExportVideoSeek({ getSample: async () => null }, 25.713), /25\.713.*未能解出/);

for (const cancel of [true, false]) {
  const controller = new AbortController();
  let finish!: (value: typeof sample) => void;
  const probe = verifyExportVideoSeek({ getSample: () => new Promise((resolve) => { finish = resolve; }) },
    32, controller.signal, cancel ? 1000 : 5);
  if (cancel) controller.abort();
  await assert.rejects(probe, cancel ? { name: 'AbortError' } : /32\.000.*超时/);
  finish(sample);
  await new Promise((resolve) => setTimeout(resolve, 0));
}
assert.equal(closed, 3, 'late samples must close after cancellation and timeout');
console.log('browserDecoderProbe.verify: OK (exact seek, missing frame, cancellation, timeout, late sample cleanup)');
