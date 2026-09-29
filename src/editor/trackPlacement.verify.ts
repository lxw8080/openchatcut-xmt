/**
 * 轨道放置与插入落轨回归：
 *
 * 1. track.create/track.update(order) 走 placeTrack。旧实现按 caption→video→audio
 *    把整个 trackOrder 重排一遍，凡当前顺序与分组不一致（legacy 状态的字幕轨
 *    fallback 排到底行），新增任意轨道都会把字幕轨瞬移到最顶行。
 * 2. 'add' 带 ripple（插入落轨）时，旧实现不看落点是否空闲，一律把落点之后的
 *    同轨片段整段后移——拖进放得下的空隙也会推走后面的素材。
 *
 * 这里对 reducer 真跑，断言新行为：新轨道只插进自己 kind 的组内，其他轨道原位不动；
 * ripple 只在落点真的压到已有片段时才让位。
 */
import assert from 'node:assert/strict';
import { reduce } from './reducerTimeline.ts';
import { laneMoveOrder } from './reducerTimelineHelpers.ts';
import { timelineTrackIds } from './types.ts';
import type { TimelineItem, TimelineState, TrackFlags, TrackId } from './types.ts';

const base = (over: Partial<TimelineState> = {}): TimelineState => ({
  fps: 30, width: 1920, height: 1080, items: [], tracks: {}, selectedId: null,
  ...over,
} as TimelineState);

const clip = (id: string, track: TrackId, start: number, dur: number): TimelineItem => ({
  id, track, startFrame: start, durationInFrames: dur, name: id, kind: 'video',
  src: `/x/${id}`, width: 1920, height: 1080, props: {},
} as unknown as TimelineItem);

const createTrack = (s: TimelineState, id: string, kind: TrackFlags['kind'], order?: number) =>
  reduce(s, { type: 'track.create', track: { id, kind }, order } as never);

// ── 1. 新增轨道不动别人：字幕轨留在原行位 ────────────────────────────────
// legacy 状态：无 trackOrder，字幕轨靠 tracks/items 兜底排到末尾（底行）。
{
  const s = base({ tracks: { C1: { kind: 'caption' } } });
  assert.deepEqual(timelineTrackIds(s), ['V2', 'V1', 'A1', 'A2', 'C1']);
  const out = createTrack(s, 'track-new', 'video');
  assert.deepEqual(timelineTrackIds(out), ['track-new', 'V2', 'V1', 'A1', 'A2', 'C1']);
  // 旧实现会把顺序重排成 [C1, track-new, V2, V1, A1, A2]，字幕轨跳到最顶行。
}

// 已是分组顺序的状态：新视频轨进视频组组顶，字幕轨仍居首。
{
  const s = base({
    trackOrder: ['C1', 'V2', 'V1', 'A1'],
    tracks: { C1: { kind: 'caption' }, V2: { kind: 'video' }, V1: { kind: 'video' }, A1: { kind: 'audio' } },
  });
  const out = createTrack(s, 'track-new', 'video');
  assert.deepEqual(timelineTrackIds(out), ['C1', 'track-new', 'V2', 'V1', 'A1']);
}

// 第一条字幕轨仍落在最顶（kind 边界），第一条音频轨落在最底。
{
  const s = base({ trackOrder: ['V2', 'V1', 'A1'], tracks: { V2: { kind: 'video' }, V1: { kind: 'video' }, A1: { kind: 'audio' } } });
  assert.deepEqual(timelineTrackIds(createTrack(s, 'track-cap', 'caption')), ['track-cap', 'V2', 'V1', 'A1']);
  const withAudioOnly = base({ trackOrder: ['C1', 'V1'], tracks: { C1: { kind: 'caption' }, V1: { kind: 'video' } } });
  assert.deepEqual(timelineTrackIds(createTrack(withAudioOnly, 'track-aud', 'audio')), ['C1', 'V1', 'track-aud']);
  // 视频组不存在时，新视频轨落在字幕组与音频组之间。
  const between = base({ trackOrder: ['C1', 'A1'], tracks: { C1: { kind: 'caption' }, A1: { kind: 'audio' } } });
  assert.deepEqual(timelineTrackIds(createTrack(between, 'track-vid', 'video')), ['C1', 'track-vid', 'A1']);
}

// ── 2. 层级调整（track.update order）：只在组内换位，别的轨道不动 ──────────
{
  const s = base({
    trackOrder: ['C1', 'V2', 'V1', 'A1', 'A2'],
    tracks: { C1: { kind: 'caption' }, V2: { kind: 'video' }, V1: { kind: 'video' }, A1: { kind: 'audio' }, A2: { kind: 'audio' } },
  });
  // V1（视频组底）上移一层。video order 从组底 0 起数（placeTrack 组内不含被移轨道），
  // 目标是组顶 → order 1。旧注释按「从底 1 起数」写成 order 2，恰被钳制到同一落点。
  const up = reduce(s, { type: 'track.update', track: 'V1', patch: { order: laneMoveOrder('video', 2, 0) } } as never);
  assert.deepEqual(timelineTrackIds(up), ['C1', 'V1', 'V2', 'A1', 'A2']);
  // 字幕轨在组内下移（order 从顶数），跨组轨道不动。
  const capDown = reduce(s, { type: 'track.update', track: 'C1', patch: { order: 0 } } as never);
  assert.deepEqual(timelineTrackIds(capDown), ['C1', 'V2', 'V1', 'A1', 'A2']);
}

// 2b. 菜单「上移/下移一层」的 order 数学（laneMoveOrder）：三条视频轨各挪一格。
// 旧实现按「从底 1 起数」给 video 发 groupLength - targetIndex，比 placeTrack 的
// 0 基多 1：下移一层算出来的落点就是自己当前槽位（no-op，用户点了下移没反应），
// 上移一层则直接冲到组顶。
{
  const s = base({
    trackOrder: ['C1', 'V3', 'V2', 'V1', 'A1'],
    tracks: { C1: { kind: 'caption' }, V3: { kind: 'video' }, V2: { kind: 'video' }, V1: { kind: 'video' }, A1: { kind: 'audio' } },
  });
  // V1（组底）上移一层 → 中间层，不再冲顶。
  const v1Up = reduce(s, { type: 'track.update', track: 'V1', patch: { order: laneMoveOrder('video', 3, 1) } } as never);
  assert.deepEqual(timelineTrackIds(v1Up), ['C1', 'V3', 'V1', 'V2', 'A1']);
  // V3（组顶）下移一层 → 中间层；旧实现发 order 2 被 placeTrack 读成组顶 → 原地不动。
  const v3Down = reduce(s, { type: 'track.update', track: 'V3', patch: { order: laneMoveOrder('video', 3, 1) } } as never);
  assert.deepEqual(timelineTrackIds(v3Down), ['C1', 'V2', 'V3', 'V1', 'A1']);
  // 两条视频轨：组顶下移一层 → 组底。
  const two = base({
    trackOrder: ['C1', 'V2', 'V1', 'A1'],
    tracks: { C1: { kind: 'caption' }, V2: { kind: 'video' }, V1: { kind: 'video' }, A1: { kind: 'audio' } },
  });
  const v2Down = reduce(two, { type: 'track.update', track: 'V2', patch: { order: laneMoveOrder('video', 2, 1) } } as never);
  assert.deepEqual(timelineTrackIds(v2Down), ['C1', 'V1', 'V2', 'A1']);
  // 音频轨（从顶数）不受该修复影响：A1 下移一层落到 A2 之下。
  const audioState = base({
    trackOrder: ['C1', 'V2', 'V1', 'A1', 'A2'],
    tracks: { C1: { kind: 'caption' }, V2: { kind: 'video' }, V1: { kind: 'video' }, A1: { kind: 'audio' }, A2: { kind: 'audio' } },
  });
  const a1Down = reduce(audioState, { type: 'track.update', track: 'A1', patch: { order: laneMoveOrder('audio', 2, 1) } } as never);
  assert.deepEqual(timelineTrackIds(a1Down), ['C1', 'V2', 'V1', 'A2', 'A1']);
}

// ── 3. 插入落轨（ripple）：空隙放得下就不再推后面的素材 ──────────────────
// 轨道 0-90 与 120-210，中间 30 帧空隙；拖一段 20 帧到 95——区间空闲，后面的 120-210 必须原位。
{
  const s = base({ items: [clip('a', 'V1', 0, 90), clip('b', 'V1', 120, 90)] });
  const out = reduce(s, {
    type: 'add',
    item: clip('new', 'V1', 0, 20),
    startFrame: 95,
    ripple: true,
  } as never);
  assert.equal(out.items.find((it) => it.id === 'new')!.startFrame, 95);
  assert.equal(out.items.find((it) => it.id === 'b')!.startFrame, 120); // 旧实现会推到 140
  assert.equal(out.items.find((it) => it.id === 'a')!.startFrame, 0);
}

// 落点真压到已有片段：插入语义保留，后续片段整体让位（后移新片段时长）。
{
  const s = base({ items: [clip('a', 'V1', 0, 90), clip('b', 'V1', 120, 90)] });
  const out = reduce(s, {
    type: 'add',
    item: clip('new', 'V1', 0, 30),
    startFrame: 80,
    ripple: true,
  } as never);
  // b 让位（120 → 150）；new 自身被空隙钳到 90 起（80 起会压 a 的尾巴，空隙 90-120 改造后正好放下）
  assert.equal(out.items.find((it) => it.id === 'b')!.startFrame, 150);
  assert.equal(out.items.find((it) => it.id === 'a')!.startFrame, 0);
  const placed = out.items.find((it) => it.id === 'new')!;
  assert.ok(placed.startFrame >= 90 && placed.startFrame + placed.durationInFrames <= 120, `new placed in gap: ${placed.startFrame}+${placed.durationInFrames}`);
}

// 空轨道上插入落轨：直接放置，无片段可推。
{
  const out = reduce(base(), { type: 'add', item: clip('new', 'V1', 0, 60), startFrame: 0, ripple: true } as never);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0]!.startFrame, 0);
}

console.log('trackPlacement.verify.ts OK');
