/**
 * XMT 衬底（VB 轨：scrim-NNN 压暗随 overlay-NNN、backdrop-NNN 兜底床随
 * shot-NNN）是布景不是素材——宿主被删 / 换掉 / 裁开 / 挪走而衬底没跟上时，
 * reducer 必须把孤儿衬底一并收掉；宿主与衬底一起动、或只动衬底本身，则保留。
 *
 * 用真实 bridge 生成的合成工程 fixture（scripts/gen_backdrop_fixture.py）：
 * shot-000（实拍槽 0..90f）、overlay-001（V2 卡 3..60f）、scrim-001（VB 3..60f）、
 * shot-001（no_match 占位 90..180f）、backdrop-001（VB 90..180f）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reduce } from '../editor/reducerTimeline.ts';
import { pruneStaleXmtBackdrops } from './backdropPairs.ts';
import { planClipReplacement } from './replaceClip.ts';
import type { TimelineItem, TimelineState } from '../editor/types.ts';
import type { XmtCandidate } from './projectBridge.ts';

const fixtureUrl = new URL('./fixtures/xmt-backdrop-project.json', import.meta.url);
const doc = JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8'));

function fixtureState(): TimelineState {
  const tl = doc.timelines[0];
  return {
    id: tl.id, fps: tl.fps, width: tl.width, height: tl.height,
    items: structuredClone(tl.items),
    tracks: tl.tracks, trackOrder: tl.trackOrder,
    assets: doc.assets ?? [],
    selectedId: null, selectedIds: [],
  } as unknown as TimelineState;
}

const ids = (s: TimelineState): string[] => s.items.map((i) => i.id);
const has = (s: TimelineState, id: string): boolean => s.items.some((i) => i.id === id);
const item = (s: TimelineState, id: string): TimelineItem => s.items.find((i) => i.id === id)!;
const apply = (s: TimelineState, next: TimelineState): TimelineState =>
  reduce(s, { type: 'setFullState', state: next } as never);

// ── 1. 删掉 overlay-001 → 配对的 scrim-001 一起收掉 ────────────────────────
{
  const s = fixtureState();
  const next = reduce(s, { type: 'remove', id: 'overlay-001' } as never);
  assert.equal(has(next, 'overlay-001'), false);
  assert.equal(has(next, 'scrim-001'), false, '宿主删掉后孤儿 scrim 必须一起收');
  assert.equal(has(next, 'backdrop-001'), true, '别的衬底不该被牵连');
}

// ── 2. planClipReplacement + setFullState 换掉 shot-001 → bed 一起收掉 ─────
{
  const s = fixtureState();
  const cand: XmtCandidate = {
    video_segment_id: 91, asset_id: 9, start_ms: 0, end_ms: 3000,
    duration_ms: 3000, event_summary: null, score: 0.8, rank: 1,
    stream_url: '/library/api/assets/9/stream', thumb_url: null,
    asset_title: '合成素材', asset_duration_ms: 30000,
    asset_width: 1920, asset_height: 1080,
  };
  const plan = planClipReplacement(s, item(s, 'shot-001'), cand);
  assert.equal(plan.error, null);
  const next = apply(s, plan.next!);
  assert.equal(item(next, 'shot-001').src, '/library/api/assets/9/stream');
  assert.equal(has(next, 'backdrop-001'), false, '床宿主被换掉（kind/src/matchStatus 变）→ bed 必须收');
}

// ── 3. 裁 / 挪 / 切开 shot-001 而衬底没跟上 → bed 收掉 ────────────────────
{
  const s = fixtureState();
  const trimmed = reduce(s, { type: 'retime', id: 'shot-001', durationInFrames: 60 } as never);
  assert.equal(has(trimmed, 'backdrop-001'), false, '宿主裁短没带上床 → bed 必须收');

  const moved = reduce(s, { type: 'move', id: 'shot-001', startFrame: 120 } as never);
  assert.equal(has(moved, 'backdrop-001'), false, '宿主挪走没带上床 → bed 必须收');

  const split = reduce(s, { type: 'split', id: 'shot-001', atFrame: 135, newId: 'shot-001-b' } as never);
  assert.equal(has(split, 'shot-001-b'), true);
  assert.equal(has(split, 'backdrop-001'), false, '宿主切开 → 原床不再跟随 → 收掉');
}

// ── 4. 只动衬底本身 → 保留（手动改布景不牵连宿主）─────────────────────────
{
  const s = fixtureState();
  const next = reduce(s, { type: 'move', id: 'backdrop-001', startFrame: 95 } as never);
  assert.equal(has(next, 'backdrop-001'), true, '床自己被动不该被当孤儿收掉');
}

// ── 5. 宿主与衬底同 delta 一起动（一次状态迁移）→ 保留 ────────────────────
{
  const s = fixtureState();
  const moved = structuredClone(s);
  for (const id of ['shot-001', 'backdrop-001']) {
    const it = moved.items.find((i) => i.id === id)!;
    it.startFrame += 30;
  }
  const next = apply(s, moved);
  assert.equal(has(next, 'backdrop-001'), true, '宿主与床同帧偏移 → 仍在跟随 → 保留');
  assert.equal(item(next, 'backdrop-001').startFrame, item(next, 'shot-001').startFrame);
}

// ── 6. 非 XMT 时间线：原对象返回，零开销零行为 ────────────────────────────
{
  const s = {
    fps: 30, width: 1920, height: 1080, items: [{
      id: 'a', track: 'V1', startFrame: 0, durationInFrames: 30, kind: 'video',
    }], tracks: {},
  } as unknown as TimelineState;
  const next = { ...s, items: [...s.items] } as TimelineState;
  assert.equal(pruneStaleXmtBackdrops(s, next), next, '无衬底工程必须原样返回（同一引用）');
  assert.equal(pruneStaleXmtBackdrops(s, s), s);
  const viaReduce = reduce(s, { type: 'remove', id: 'missing' } as never);
  assert.equal(viaReduce, s, '非 XMT 工程的 no-op reduce 返回原状态');
}

console.log('backdropPairs.verify.ts OK');
