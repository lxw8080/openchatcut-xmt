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

export interface XmtBackdropMeta {
  placement?: string;
  backdrop?: string;
  pairedItemId?: string;
}

/** 这一条是不是 XMT 的衬底层（压暗 / 缺素材兜底床）。
 *
 * 衬底是布景不是素材条目：它跟着被配对的那一条走，自己没有 matchStatus、
 * 不该上「替换素材」菜单、也不该被字幕开关隐藏。判据只看
 * `props._xmt.placement === 'backdrop'`，不要求 scriptSegmentId——
 * bridge 写出来的衬底一定带 placement，别的工程里同名键也按同样语义读。
 */
export function isXmtBackdrop(item: TimelineItem): boolean {
  const meta = (item.props as { _xmt?: XmtBackdropMeta } | undefined)?._xmt;
  return !!meta && typeof meta === 'object' && meta.placement === 'backdrop';
}

/** 衬底配对的宿主条目 id（scrim→overlay-NNN，bed→shot-NNN）；没有或为空返回 null。 */
export function xmtBackdropPairId(item: TimelineItem): string | null {
  const meta = (item.props as { _xmt?: XmtBackdropMeta } | undefined)?._xmt;
  if (!meta || typeof meta !== 'object') return null;
  const id = meta.pairedItemId;
  return typeof id === 'string' && id ? id : null;
}

export function xmtClipMeta(item: TimelineItem): XmtClipMeta | null {
  // 衬底不是素材条目：不给 meta，替换菜单 / 替换流程 / 图文卡判据全部自动让路。
  if (isXmtBackdrop(item)) return null;
  const meta = (item.props as { _xmt?: XmtClipMeta } | undefined)?._xmt;
  if (!meta || typeof meta.scriptSegmentId !== 'string' || !meta.scriptSegmentId) return null;
  return meta;
}

/** Source image ids belong to the current URL; retain the shot's editorial metadata. */
export function xmtPropsAfterImageRelink(
  props: TimelineItem['props'],
  previousSrc: string | undefined,
  src: string,
): TimelineItem['props'] {
  const meta = props?._xmt;
  if (previousSrc === src || !meta || typeof meta !== 'object' || Array.isArray(meta)) return props;
  const oldMeta = meta as Record<string, unknown>;
  if (!('imageAssetId' in oldMeta) && !('stillId' in oldMeta)) return props;
  const nextMeta = { ...oldMeta };
  delete nextMeta.imageAssetId;
  delete nextMeta.stillId;
  const match = src.match(/\/library\/api\/images\/(\d+)\/(?:file|thumbnail)(?:[?#].*)?$/);
  if (match) nextMeta.imageAssetId = Number(match[1]);
  return { ...props, _xmt: nextMeta };
}

/** 这一条是不是 XMT 的图文卡（截图 / 数据卡 / 比分条这类「库里按定义不存在」的画面）。
 *
 * 图文卡是**画面内容**，不是字幕：关掉字幕是不想要逐句念白的字幕条，不是不想要记分牌。
 * 所以字幕总开关不连带隐藏它——其余屏上文字片段仍然跟随该开关（fork 既有策略）。
 */
export function isXmtGraphicCard(item: TimelineItem): boolean {
  return xmtClipMeta(item)?.matchStatus === 'graphic';
}
