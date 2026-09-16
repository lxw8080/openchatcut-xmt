/**
 * 图文卡不跟随字幕总开关（PRD 018 / 2026-09-16）。
 *
 * 关字幕是不想要逐句念白的字幕条，不是不想要记分牌——图文卡是画面内容。其余屏上文字
 * 片段仍然跟随该开关（fork 既有策略），所以这条判据必须只认 XMT 写的
 * `props._xmt.matchStatus === 'graphic'`，不能放宽成「所有 motion-graphic」。
 */
import assert from 'node:assert/strict';
import { isXmtGraphicCard, xmtClipMeta } from './clipMeta.ts';
import type { TimelineItem } from '../editor/types.ts';

const item = (props: unknown): TimelineItem => ({
  id: 'x', track: 'V2', startFrame: 0, durationInFrames: 30, kind: 'text', props,
} as unknown as TimelineItem);

// 图文卡：豁免
assert.equal(isXmtGraphicCard(item({ _xmt: { scriptSegmentId: 'script_000', matchStatus: 'graphic' } })), true);
// 实拍镜头 / 人工替换 / 占位：不豁免
assert.equal(isXmtGraphicCard(item({ _xmt: { scriptSegmentId: 'script_000', matchStatus: 'matched' } })), false);
assert.equal(isXmtGraphicCard(item({ _xmt: { scriptSegmentId: 'script_000', matchStatus: 'manual' } })), false);
assert.equal(isXmtGraphicCard(item({ _xmt: { scriptSegmentId: 'script_000', matchStatus: 'no_match' } })), false);
// 非 XMT 工程里用户自己加的文字/动效：不豁免
assert.equal(isXmtGraphicCard(item({ text: 'hello' })), false);
assert.equal(isXmtGraphicCard(item(undefined)), false);
// 缺 scriptSegmentId 的残缺元数据不算数（与 xmtClipMeta 同一条判据）
assert.equal(isXmtGraphicCard(item({ _xmt: { matchStatus: 'graphic' } })), false);
assert.equal(xmtClipMeta(item({ _xmt: { matchStatus: 'graphic' } })), null);

console.log('clipMeta.verify.ts OK');
