/**
 * 预览副本缓存的三条不变量（见 previewMedia.ts 模块内注释）：
 *   ① effect 按 sources **内容**键控，同内容不同身份不得重新请求；
 *   ② 终态（not-needed / ready）与 pending 绝不因 force 重拉；只有 failed 才重排队；
 *   ③ pending 由轮询接管，轮询期间状态稳定停在 pending，绝不回落 loading。
 * 跑法：`npx tsx src/media/previewMedia.verify.ts`（约 9 秒，含两次真实轮询等待）。
 */
import assert from 'node:assert/strict';
import { setPreviewSourceMode } from './qualityPolicy.ts';
import {
  previewProxyStateFor,
  proxySourcesKey,
  reportPreviewPlaybackFailure,
  requestPreviewProxy,
  subscribeProxyState,
} from './previewMedia.ts';

setPreviewSourceMode('proxy'); // 「流畅」档：stateFor 的 autoRequest 为真

const calls: string[] = [];
let nextProxy: Record<string, unknown> = { status: 'pending', reason: 'generating' };

(globalThis as { fetch?: unknown }).fetch = (async (url: string) => {
  calls.push(String(url));
  return {
    ok: true,
    json: async () => ({
      source: { src: 'x', durationMs: 0, width: 0, height: 0, codec: '', longGop: false },
      proxy: nextProxy,
    }),
  };
}) as unknown as typeof fetch;

function src(id: number): string {
  return `/library/api/assets/${id}/stream`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── ① 键控只看内容 ────────────────────────────────────────────────
const a = [src(1), src(2)];
const b = [src(1), src(2)]; // 同内容、不同数组身份（上游每次渲染都换身份）
assert.notEqual(a, b);
assert.equal(proxySourcesKey(a), proxySourcesKey(b));
assert.notEqual(proxySourcesKey(a), proxySourcesKey([src(2), src(1)]));

// ── ② force 不重拉终态 ───────────────────────────────────────────
nextProxy = { status: 'not-needed', reason: 'source-already-light' };
calls.length = 0;
await requestPreviewProxy(src(10), true);
assert.equal(calls.length, 1);
assert.equal(previewProxyStateFor(src(10)).status, 'not-needed');
await requestPreviewProxy(src(10), true); // job 197 素材 724 的形状：长边未超阈值
await requestPreviewProxy(src(10), true);
assert.equal(calls.length, 1, 'not-needed 是终态，force 不得重拉');
assert.equal(previewProxyStateFor(src(10)).status, 'not-needed', '状态不得闪回 loading');

nextProxy = { status: 'ready', reason: 'ok', previewSrc: '/p.mp4' };
calls.length = 0;
await requestPreviewProxy(src(11), true);
await requestPreviewProxy(src(11), true);
assert.equal(calls.length, 1, 'ready 不得重拉');

// failed 是唯一值得带 force 重排队的状态
nextProxy = { status: 'failed', reason: 'generation-failed', error: 'boom' };
calls.length = 0;
await requestPreviewProxy(src(12), true);
assert.equal(calls.length, 1);
await requestPreviewProxy(src(12), true);
assert.equal(calls.length, 2, 'failed + force 应重新排队');
assert.ok(calls[1].includes('force=1'));

// 播放失败上报：只有「还没问过」才值得再问一次
calls.length = 0;
reportPreviewPlaybackFailure(src(10)); // not-needed
reportPreviewPlaybackFailure(src(12)); // failed
assert.equal(calls.length, 0, 'not-needed / failed 的播放失败不得触发 force 重请求');

// ── ③ pending 轮询 ──────────────────────────────────────────────
nextProxy = { status: 'pending', reason: 'generating' };
calls.length = 0;
const states: string[] = [];
const unsubscribe = subscribeProxyState([src(20)], () => {
  states.push(previewProxyStateFor(src(20)).status);
});
await requestPreviewProxy(src(20), true);
assert.equal(calls.length, 1);
assert.equal(previewProxyStateFor(src(20)).status, 'pending');

nextProxy = { status: 'ready', reason: 'ok', previewSrc: '/p20.mp4' };
await sleep(4300); // POLL_INITIAL_MS = 4000
assert.ok(calls.length >= 2, `pending 应被轮询，实际请求 ${calls.length} 次`);
assert.ok(!calls[1].includes('force=1'), '轮询不得带 force');
assert.equal(previewProxyStateFor(src(20)).status, 'ready', '轮询到货后应切 ready');
// 首次请求那一下的 loading 是对的（还没问过）；pending 一旦建立，轮询就不得再把它
// 清回 loading——横幅就是这样一亮一灭的。
const afterPending = states.slice(states.indexOf('pending'));
assert.ok(!afterPending.includes('loading'), `轮询期间状态不得回落 loading：${states.join(',')}`);
assert.equal(afterPending.at(-1), 'ready');

// 终态之后停表：再等一轮不应有新请求
const settled = calls.length;
await sleep(4300);
assert.equal(calls.length, settled, '切到终态后必须停止轮询');
unsubscribe();

console.log('previewMedia.verify: 内容键控 / 终态不重拉 / pending 轮询 全部通过');
