/**
 * 字幕总开关的判据：「没表态」不等于「关掉了」。
 *
 * 2026-09-16 实测的缺陷：ProjectDoc 的 C1 只有轨、没有 captions 块（成片任务关掉字幕时
 * 就是这样），旧判据 `every((e) => !e.captions?.enabled)` 把它读成「字幕被关掉了」，
 * 于是每个带文字的片段被按成 opacity 0——预览与导出的 MP4 里图文卡标题整条消失，
 * 而工具栏那半边判的是「有文字片段就算开」，界面上写着「开启」。
 */
import assert from 'node:assert/strict';
import { captionsHiddenForRender } from './timelineTypes.ts';
import type { CaptionsData, TimelineState } from './types.ts';

const captions = (enabled: boolean): CaptionsData => ({ enabled, cues: [] } as unknown as CaptionsData);

function state(partial: {
  captionsHidden?: boolean;
  c1?: CaptionsData | undefined;
  withCaptionTrack?: boolean;
}): TimelineState {
  const withTrack = partial.withCaptionTrack ?? true;
  return {
    id: 'main', fps: 30, width: 1920, height: 1080, items: [],
    captionsHidden: partial.captionsHidden,
    trackOrder: withTrack ? ['V1', 'C1'] : ['V1'],
    tracks: withTrack
      ? { V1: { kind: 'video' }, C1: { kind: 'caption', captions: partial.c1 } }
      : { V1: { kind: 'video' } },
  } as unknown as TimelineState;
}

// 1) 用户显式关 → 隐藏（不变）
assert.equal(captionsHiddenForRender(state({ captionsHidden: true, c1: captions(true) })), true);
// 2) 用户显式开 → 不隐藏（不变）
assert.equal(captionsHiddenForRender(state({ captionsHidden: false, c1: undefined })), false);
// 3) 未表态 + 配置过且启用 → 不隐藏（不变）
assert.equal(captionsHiddenForRender(state({ c1: captions(true) })), false);
// 4) 未表态 + 配置过但全部禁用 → 隐藏（不变，逐轨关字幕仍然连带隐藏屏上文字）
assert.equal(captionsHiddenForRender(state({ c1: captions(false) })), true);
// 5) 未表态 + 有字幕轨但从未配过 captions → **不隐藏**（本次修复；旧判据在这里返回 true）
assert.equal(captionsHiddenForRender(state({ c1: undefined })), false);
// 6) 未表态 + 根本没有字幕轨 → 不隐藏（不变）
assert.equal(captionsHiddenForRender(state({ withCaptionTrack: false })), false);

// 没表态时，多条轨里只要有一条配置过且启用就算开着。
assert.equal(
  captionsHiddenForRender({
    ...state({ c1: captions(false) }),
    trackOrder: ['V1', 'C1', 'C2'],
    tracks: {
      V1: { kind: 'video' },
      C1: { kind: 'caption', captions: captions(false) },
      C2: { kind: 'caption', captions: captions(true) },
    },
  } as unknown as TimelineState),
  false,
);

console.log('captionsGate.verify.ts OK');
