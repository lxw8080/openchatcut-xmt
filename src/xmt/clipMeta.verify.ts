/**
 * 图文卡不跟随字幕总开关（PRD 018 / 2026-09-16）。
 *
 * 关字幕是不想要逐句念白的字幕条，不是不想要记分牌——图文卡是画面内容。其余屏上文字
 * 片段仍然跟随该开关（fork 既有策略），所以这条判据必须只认 XMT 写的
 * `props._xmt.matchStatus === 'graphic'`，不能放宽成「所有 motion-graphic」。
 */
import assert from 'node:assert/strict';
import { isXmtBackdrop, isXmtGraphicCard, xmtBackdropPairId, xmtClipMeta } from './clipMeta.ts';
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

// ── PRD 068 衬底（VB 轨布景层）─────────────────────────────────────────────
const scrim = { _xmt: { placement: 'backdrop', backdrop: 'scrim', pairedItemId: 'overlay-001', scriptSegmentId: 'script_000' } };
const bed = { _xmt: { placement: 'backdrop', backdrop: 'bed', pairedItemId: 'shot-001' } };
// 判据只看 placement==='backdrop'，不要求 scriptSegmentId
assert.equal(isXmtBackdrop(item(scrim)), true);
assert.equal(isXmtBackdrop(item(bed)), true);
assert.equal(isXmtBackdrop(item({ _xmt: { placement: 'overlay' } })), false);
assert.equal(isXmtBackdrop(item({ _xmt: { backdrop: 'bed' } })), false);
assert.equal(isXmtBackdrop(item(undefined)), false);
// 衬底不是素材条目：不给 meta → 替换菜单/替换流程/图文卡判据全部让路
assert.equal(xmtClipMeta(item(scrim)), null);
assert.equal(xmtClipMeta(item(bed)), null);
assert.equal(isXmtGraphicCard(item(scrim)), false);
// 配对 id：非空串才返回
assert.equal(xmtBackdropPairId(item(scrim)), 'overlay-001');
assert.equal(xmtBackdropPairId(item(bed)), 'shot-001');
assert.equal(xmtBackdropPairId(item({ _xmt: { placement: 'backdrop' } })), null);
assert.equal(xmtBackdropPairId(item({ _xmt: { placement: 'backdrop', pairedItemId: '' } })), null);
assert.equal(xmtBackdropPairId(item({ text: 'x' })), null);

console.log('clipMeta.verify.ts OK');
