/**
 * 替换素材（AI 候选）必须真的换掉时间线上的片段。
 *
 * 回归：早先新片段时长取候选分段的整段时长，候选比槽位长时压到下一个片段，
 * `setFullState` 被 reducer 的防重叠守卫原样退回，而对话框照样弹「已替换素材」。
 * 这里对 reducer 真跑一遍 setFullState，断言替换落进了状态。
 */
import assert from 'node:assert/strict';
import { reduce } from '../editor/reducerTimeline.ts';
import { planClipReplacement } from './replaceClip.ts';
import type { TimelineItem, TimelineState } from '../editor/types.ts';
import type { XmtCandidate } from './projectBridge.ts';

const fps = 30;
const meta = { scriptSegmentId: 'script_000', matchStatus: 'matched', assetId: 7, videoSegmentId: 70, fitMode: 'blur' };
const video = (id: string, start: number, dur: number, extra: Record<string, unknown> = {}): TimelineItem => ({
  id, track: 'V1', startFrame: start, durationInFrames: dur, name: id, kind: 'video',
  src: '/library/api/assets/7/stream', sourceAssetId: 'asset-7', srcInFrame: 0, volume: 0,
  props: { _xmt: { ...meta } }, ...extra,
} as unknown as TimelineItem);
const solid = (id: string, start: number, dur: number): TimelineItem => ({
  id, track: 'V1', startFrame: start, durationInFrames: dur, name: '待补素材', kind: 'solid',
  props: { color: '#222', _xmt: { ...meta, matchStatus: 'no_match', assetId: null, videoSegmentId: null } },
} as unknown as TimelineItem);
const state = (items: TimelineItem[]): TimelineState => ({
  fps, width: 1920, height: 1080, items, tracks: {},
  assets: [{ id: 'asset-7', name: 'a7', kind: 'video', src: '/library/api/assets/7/stream', durationInFrames: 3000 }],
} as unknown as TimelineState);
const cand = (over: Partial<XmtCandidate> = {}): XmtCandidate => ({
  video_segment_id: 91, asset_id: 9, start_ms: 12000, end_ms: 20000, duration_ms: 8000,
  event_summary: null, score: 0.8, rank: 1, stream_url: '/library/api/assets/9/stream', thumb_url: null,
  asset_title: '素材九', asset_duration_ms: 60000, asset_width: 1280, asset_height: 720, ...over,
});
const apply = (s: TimelineState, next: TimelineState): TimelineState => reduce(s, { type: 'setFullState', state: next } as never);

// 1. 候选分段（8s）比槽位（3s）长：替换必须落进状态，且槽位时长不变、不压下一个片段。
{
  const s = state([video('shot-001', 0, 90), video('shot-002', 90, 90)]);
  const plan = planClipReplacement(s, s.items[0]!, cand());
  assert.equal(plan.error, null);
  const out = apply(s, plan.next!);
  const replaced = out.items.find((it) => it.id === 'shot-001')!;
  assert.equal(replaced.src, '/library/api/assets/9/stream');
  assert.equal(replaced.durationInFrames, 90);
  assert.equal(replaced.startFrame, 0);
  assert.equal(replaced.srcInFrame, 360);
  assert.equal(plan.shortfallFrames, 0);
  const x = (replaced.props as { _xmt: Record<string, unknown> })._xmt;
  assert.equal(x.matchStatus, 'manual');
  assert.equal(x.assetId, 9);
  assert.equal(x.videoSegmentId, 91);
  assert.equal(x.scriptSegmentId, 'script_000');
  assert.equal(replaced.sourceAssetId, 'xmt-asset-9');
  assert.equal(plan.poolAsset?.id, 'xmt-asset-9');
  assert.equal(plan.poolAsset?.durationInFrames, 1800);
  // 未被替换的邻居原样保留
  assert.equal(out.items.find((it) => it.id === 'shot-002')!.src, '/library/api/assets/7/stream');
}

// 2. 旧算法（整段时长）在同一状态下确实会被 reducer 退回——钉住根因，防止守卫行为变了没人知道。
{
  const s = state([video('shot-001', 0, 90), video('shot-002', 90, 90)]);
  const longer = { ...s.items[0]!, src: '/x', durationInFrames: 240 };
  const out = apply(s, { ...s, items: [longer, s.items[1]!] });
  assert.equal(out, s);
}

// 3. 分段起点 + 槽位超出素材尾部：源窗口往回挪到刚好放得下。
{
  const s = state([video('shot-001', 0, 90), video('shot-002', 90, 90)]);
  const plan = planClipReplacement(s, s.items[0]!, cand({ start_ms: 58000, asset_duration_ms: 60000 }));
  const replaced = apply(s, plan.next!).items[0]!;
  assert.equal(replaced.srcInFrame, 1800 - 90);
  assert.equal(replaced.durationInFrames, 90);
}

// 4. 整条素材都短于槽位：缩短片段并报缺口，仍然替换成功、不重叠。
{
  const s = state([video('shot-001', 0, 150), video('shot-002', 150, 90)]);
  const plan = planClipReplacement(s, s.items[0]!, cand({ start_ms: 0, asset_duration_ms: 2000 }));
  const replaced = apply(s, plan.next!).items[0]!;
  assert.equal(replaced.src, '/library/api/assets/9/stream');
  assert.equal(replaced.durationInFrames, 60);
  assert.equal(replaced.srcInFrame, 0);
  assert.equal(plan.shortfallFrames, 90);
}

// 5. 池里已有同源素材（plan 投影出的 asset-<id>）：复用它，不再登记第二份。
{
  const s = state([video('shot-001', 0, 90), video('shot-002', 90, 90)]);
  const plan = planClipReplacement(s, s.items[1]!, cand({ asset_id: 7, stream_url: '/library/api/assets/7/stream' }));
  assert.equal(plan.poolAsset, null);
  assert.equal(apply(s, plan.next!).items[1]!.sourceAssetId, 'asset-7');
}

// 6. 占位卡：换成 video、去掉纯色、blur 工程补画幅填充。
{
  const s = state([video('shot-001', 0, 90), solid('shot-002', 90, 90)]);
  const plan = planClipReplacement(s, s.items[1]!, cand());
  const replaced = apply(s, plan.next!).items[1]!;
  assert.equal(replaced.kind, 'video');
  assert.equal((replaced.props as Record<string, unknown>).color, undefined);
  assert.equal(replaced.backgroundFill, true);
  assert.equal(replaced.backgroundFillStrength, 50);
}

// 7. 绑旧源的字段不跟着搬到新素材上；槽位级编辑（变换、淡入淡出）保留。
{
  const old = video('shot-001', 0, 90, {
    denoisedSrc: '/old-denoised', sourceContentHash: 'sha256:old', transcript: [{ w: 'x' }],
    fadeInFrames: 5, transform: { x: 10, y: 0, scale: 1.2, rotation: 0 },
  });
  const s = state([old, video('shot-002', 90, 90)]);
  const replaced = apply(s, planClipReplacement(s, old, cand()).next!).items[0]! as unknown as Record<string, unknown>;
  assert.equal(replaced.denoisedSrc, undefined);
  assert.equal(replaced.sourceContentHash, undefined);
  assert.equal(replaced.transcript, undefined);
  assert.equal(replaced.fadeInFrames, 5);
  assert.deepEqual(replaced.transform, { x: 10, y: 0, scale: 1.2, rotation: 0 });
  assert.equal(replaced.width, 1280);
}

// 8. 变速片段按源帧消耗算放不放得下（2× 的 3s 槽位要 6s 素材）。
{
  const s = state([video('shot-001', 0, 90, { playbackRate: 2 }), video('shot-002', 90, 90)]);
  const plan = planClipReplacement(s, s.items[0]!, cand({ start_ms: 57000, asset_duration_ms: 60000 }));
  const replaced = apply(s, plan.next!).items[0]!;
  assert.equal(replaced.srcInFrame, 1800 - 180);
  assert.equal(replaced.durationInFrames, 90);
}

// 9. 没有可播放地址：不产出状态。
assert.equal(planClipReplacement(state([video('a', 0, 30)]), video('a', 0, 30), cand({ stream_url: null })).error, 'no_stream');

console.log('replaceClip.verify.ts OK');
