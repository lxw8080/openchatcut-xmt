// xmt 片段元数据（`props._xmt`）：由 XMT 的 editor_bridge 写入，标出这一条时间线条目
// 对应哪个文案段、以及它是实拍、人工替换还是图文卡。
//
// 放在独立模块而不是留在 ReplaceClipDialog 里，是因为渲染合成层（TimelineComposition）
// 也要读它——合成层 import 一个对话框组件只为了拿一个纯判据，会把 React 弹窗拖进渲染路径。
import type { TimelineItem } from '../editor/types';

export interface XmtClipMeta {
  scriptSegmentId: string;
  matchStatus?: string;
  assetId?: number | null;
}

export function xmtClipMeta(item: TimelineItem): XmtClipMeta | null {
  const meta = (item.props as { _xmt?: XmtClipMeta } | undefined)?._xmt;
  if (!meta || typeof meta.scriptSegmentId !== 'string' || !meta.scriptSegmentId) return null;
  return meta;
}

/** 这一条是不是 XMT 的图文卡（截图 / 数据卡 / 比分条这类「库里按定义不存在」的画面）。
 *
 * 图文卡是**画面内容**，不是字幕：关掉字幕是不想要逐句念白的字幕条，不是不想要记分牌。
 * 所以字幕总开关不连带隐藏它——其余屏上文字片段仍然跟随该开关（fork 既有策略）。
 */
export function isXmtGraphicCard(item: TimelineItem): boolean {
  return xmtClipMeta(item)?.matchStatus === 'graphic';
}
