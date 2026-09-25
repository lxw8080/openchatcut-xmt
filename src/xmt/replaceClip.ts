// xmt 替换素材的纯计算：给定时间线、被替换的片段与一条 AI 候选，算出替换后的时间线。
//
// 放在对话框之外是因为它要被 node 直接验证（replaceClip.verify.ts），而对话框是 React 组件。
//
// 契约与 XMT 服务端 `timeline_ops._replace_source`（外部 agent 的 replace_source）同口径：
//
// 1. **槽位时长不变。** 片段的 startFrame / durationInFrames 就是配音切出来的槽位，换的是
//    素材不是时长。早先这里拿候选分段的整段时长当新时长——候选几乎总比槽位长（分段 4~15s，
//    镜头 2~5s），新片段就压到下一个片段上，而 `setFullState` 在 reducer 的防重叠守卫名单里
//    （OVERLAP_GUARDED_ACTIONS），整次替换被原样退回；对话框却照样弹「已替换素材」。
// 2. **源窗口从分段起点开始**，超出素材尾部就整体往回挪到刚好放得下（服务端此时回落到分段
//    起点、再放不下就报错；这里多挪一步，因为人已经明确选了这条素材）。
// 3. **整条素材都短于槽位时才缩短片段**，缩短量交给调用方告诉人（留出的是可见的空隙，
//    不是末帧定格）。素材时长未知时不猜，按槽位时长照放。
// 4. **派发前用 reducer 同一份判据预检重叠**：reducer 静默退回的状态，这里必须先说出来。
import type { MediaAsset, TimelineItem, TimelineState } from '../editor/types';
import { introducesTrackOverlap } from '../editor/trackCollision';
import { xmtClipMeta } from './clipMeta';
import type { XmtCandidate } from './projectBridge';

/** 与 XMT editor_bridge.BACKGROUND_FILL_STRENGTH 同值（blur 画幅填充的衬底强度）。 */
const BACKGROUND_FILL_STRENGTH = 50;

/**
 * 换源之后就不再属于新素材的字段：来源指纹、降噪副本、时间码、转写与基于转写的剪辑、
 * 原片尺寸、MG / 序列的来源。沿用它们等于把旧素材的属性挂到新素材上
 * （fork 自己的 relink 路径同样剥掉降噪与时间码）。
 */
const SOURCE_BOUND_FIELDS = [
  'sourceRevision', 'sourceContentHash', 'sourceFilename', 'originalFilePath',
  'sourceTimecode', 'captureClock', 'denoisedSrc', 'denoiseStrength',
  'transcript', 'transcriptGenerationId', 'transcriptStale', 'deletedWordIdx', 'variants',
  'silenceFrames', 'cutPadFrames', 'gapCapsMs', 'transcriptPlayOrder',
  'width', 'height', 'templateId', 'code', 'timelineId',
] as const;

export type ReplaceClipError = 'no_stream' | 'not_on_timeline' | 'overlap';

export interface ReplaceClipPlan {
  /** 替换后的整条时间线；失败时为 null。 */
  next: TimelineState | null;
  /** 需要先登记进媒体池的素材；池里已有同源素材时为 null（直接复用它的 id）。 */
  poolAsset: MediaAsset | null;
  /** 素材整条短于槽位时缩短的帧数（0 = 槽位被填满）。 */
  shortfallFrames: number;
  error: ReplaceClipError | null;
}

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

export function xmtPoolAssetId(assetId: number): string {
  return `xmt-asset-${assetId}`;
}

export function planClipReplacement(
  timeline: TimelineState,
  item: TimelineItem,
  candidate: XmtCandidate,
): ReplaceClipPlan {
  const fail = (error: ReplaceClipError): ReplaceClipPlan => ({ next: null, poolAsset: null, shortfallFrames: 0, error });
  if (!candidate.stream_url) return fail('no_stream');
  if (!timeline.items.some((it) => it.id === item.id)) return fail('not_on_timeline');

  const fps = timeline.fps || 30;
  const slotFrames = Math.max(1, item.durationInFrames);
  const rate = item.playbackRate && item.playbackRate > 0 ? item.playbackRate : 1;
  // 变速片段每一帧时间线要吃掉 rate 帧源素材。
  const sourceFramesFor = (frames: number): number => Math.ceil(frames * rate);

  const assetFrames = typeof candidate.asset_duration_ms === 'number' && candidate.asset_duration_ms > 0
    ? Math.floor((candidate.asset_duration_ms / 1000) * fps)
    : null;
  let srcInFrame = Math.max(0, msToFrames(candidate.start_ms ?? 0, fps));
  let durationInFrames = slotFrames;
  if (assetFrames != null) {
    if (sourceFramesFor(slotFrames) <= assetFrames) {
      srcInFrame = Math.min(srcInFrame, assetFrames - sourceFramesFor(slotFrames));
    } else {
      srcInFrame = 0;
      durationInFrames = Math.max(1, Math.floor(assetFrames / rate));
    }
  }

  // 复用池里已有的同源素材（plan 投影出来的是 `asset-<id>`），避免同一条素材在池里出现两份。
  const existing = (timeline.assets ?? []).find((asset) => asset.src === candidate.stream_url);
  const poolAsset: MediaAsset | null = existing || candidate.asset_id == null
    ? null
    : {
        id: xmtPoolAssetId(candidate.asset_id),
        name: candidate.asset_title || `素材 ${candidate.asset_id}`,
        kind: 'video',
        src: candidate.stream_url,
        durationInFrames: Math.max(1, assetFrames ?? srcInFrame + sourceFramesFor(durationInFrames)),
        width: candidate.asset_width ?? undefined,
        height: candidate.asset_height ?? undefined,
      } as MediaAsset;
  const sourceAssetId = existing?.id ?? poolAsset?.id;

  const meta = xmtClipMeta(item);
  const { color: _placeholderColor, ...keptProps } = (item.props ?? {}) as Record<string, unknown>;
  const props = item.kind === 'solid' ? keptProps : { ...(item.props ?? {}) };
  const base: Record<string, unknown> = { ...item };
  for (const field of SOURCE_BOUND_FIELDS) delete base[field];

  const nextItem = {
    ...base,
    kind: 'video',
    name: candidate.asset_title || item.name,
    src: candidate.stream_url,
    sourceAssetId,
    srcInFrame,
    durationInFrames,
    volume: 0,
    ...(candidate.asset_width && candidate.asset_height
      ? { width: candidate.asset_width, height: candidate.asset_height }
      : {}),
    props: meta
      ? {
          ...props,
          _xmt: {
            ...meta,
            matchStatus: 'manual',
            assetId: candidate.asset_id ?? null,
            // 服务端按 (assetId, videoSegmentId) 识别换片并记 replaced 埋点；沿用旧值会让
            // 「同素材换分段」检不出、「换素材」记成错的分段。
            videoSegmentId: candidate.video_segment_id ?? null,
          },
        }
      : props,
  } as TimelineItem;
  if (!sourceAssetId) delete (nextItem as { sourceAssetId?: string }).sourceAssetId;
  // 占位卡是 solid，本来没有画幅填充；blur 模式的工程里实拍片段都带衬底（同服务端 replace_source）。
  const fitMode = (meta as { fitMode?: unknown } | null)?.fitMode;
  if (item.kind === 'solid' && fitMode === 'blur' && nextItem.backgroundFill === undefined) {
    nextItem.backgroundFill = true;
    nextItem.backgroundFillStrength = BACKGROUND_FILL_STRENGTH;
  }

  const next: TimelineState = {
    ...timeline,
    items: timeline.items.map((it) => (it.id === item.id ? nextItem : it)),
  };
  if (introducesTrackOverlap(timeline, next)) return fail('overlap');
  return { next, poolAsset, shortfallFrames: slotFrames - durationInFrames, error: null };
}
