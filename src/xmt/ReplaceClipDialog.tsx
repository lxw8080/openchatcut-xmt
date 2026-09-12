// xmt 替换素材面板：右键带 props._xmt 的片段 → 按该文案段现场重跑检索给 Top-10 候选，
// 选中即换源（保留槽位，matchStatus 标 manual），并按需把候选登记进媒体池。
// 列表左侧常显缩略图；悬停挂载唯一 video，seek 到 start_ms，播到 end_ms 暂停。
import { useEffect, useRef, useState } from 'react';
import { theme, themeAlpha } from '../theme';
import type { EditorCommands } from '../editor/store';
import type { TimelineItem, TimelineState } from '../editor/types';
import { useT } from '../i18n/locale';
import { showAppToast } from '../ui/appToast';
import { fetchXmtCandidates, searchXmtSegments, type XmtCandidate } from './projectBridge';

/** V1 片段携带的来源信息（editor_bridge.plan_to_project_doc 写入）。 */
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

interface ReplaceClipDialogProps {
  item: TimelineItem;
  commands: EditorCommands;
  timeline: TimelineState;
  onClose: () => void;
}

function fmtSeconds(ms: number | null | undefined, t: (s: string) => string): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
  return `${(ms / 1000).toFixed(1)}${t('秒')}`;
}

function candidateKey(candidate: XmtCandidate, index: number): string {
  if (candidate.video_segment_id != null) return `vs-${candidate.video_segment_id}`;
  if (candidate.asset_id != null) return `asset-${candidate.asset_id}-${index}`;
  return `idx-${index}`;
}

function releaseVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute('src');
  video.load();
}

/** 悬停预览：seek 到分段起点，播到终点暂停；卸载时释放解码器。 */
function SegmentHoverPreview({
  streamUrl,
  posterUrl,
  startMs,
  endMs,
}: {
  streamUrl: string;
  posterUrl: string | null;
  startMs: number | null;
  endMs: number | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const startSec = typeof startMs === 'number' && Number.isFinite(startMs) && startMs > 0
      ? startMs / 1000
      : 0;
    const endSec = typeof endMs === 'number' && Number.isFinite(endMs) && endMs / 1000 > startSec
      ? endMs / 1000
      : null;
    let seekPending = false;

    const playFromStart = (): void => {
      void video.play().catch(() => undefined);
    };
    const onSeeked = (): void => {
      seekPending = false;
      playFromStart();
    };
    // 等 seeked 再播，避免 currentTime 异步生效前从片头闪一帧。
    const seekThenPlay = (): void => {
      const nearStart = Math.abs(video.currentTime - startSec) < 0.05;
      if (nearStart && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        playFromStart();
        return;
      }
      if (seekPending) return;
      seekPending = true;
      video.addEventListener('seeked', onSeeked, { once: true });
      try {
        video.currentTime = startSec;
      } catch {
        seekPending = false;
        video.removeEventListener('seeked', onSeeked);
        playFromStart();
      }
    };
    // 缓存命中时 metadata 可能在挂载前已就绪，loadedmetadata 不会再发。
    const onMeta = (): void => {
      seekThenPlay();
    };
    const onTime = (): void => {
      if (endSec != null && video.currentTime >= endSec) {
        video.pause();
        try {
          video.currentTime = startSec;
        } catch {
          /* ignore */
        }
      }
    };

    video.addEventListener('timeupdate', onTime);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) onMeta();
    else video.addEventListener('loadedmetadata', onMeta);
    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('timeupdate', onTime);
      releaseVideo(video);
    };
  }, [streamUrl, startMs, endMs]);

  return (
    <video
      ref={ref}
      src={streamUrl}
      poster={posterUrl || undefined}
      muted
      playsInline
      preload="metadata"
      draggable={false}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}

function CandidateThumb({
  candidate,
  active,
}: {
  candidate: XmtCandidate;
  active: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const poster = candidate.thumb_url && !imgFailed ? candidate.thumb_url : null;
  const canPlay = active && Boolean(candidate.stream_url);

  return (
    <div style={{
      width: 96, height: 54, flexShrink: 0, borderRadius: 3, overflow: 'hidden',
      border: `0.5px solid ${theme.border}`, background: theme.bg, position: 'relative',
    }}>
      {canPlay && candidate.stream_url ? (
        <SegmentHoverPreview
          streamUrl={candidate.stream_url}
          posterUrl={poster}
          startMs={candidate.start_ms}
          endMs={candidate.end_ms}
        />
      ) : poster ? (
        <img
          src={poster}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setImgFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          background: `linear-gradient(135deg, ${theme.border} 0%, ${theme.bg} 100%)`,
        }} />
      )}
    </div>
  );
}

export function ReplaceClipDialog({ item, commands, timeline, onClose }: ReplaceClipDialogProps) {
  const t = useT();
  const meta = xmtClipMeta(item);
  const [candidates, setCandidates] = useState<XmtCandidate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hoveringId, setHoveringId] = useState<string | null>(null);

  useEffect(() => {
    if (!meta) return;
    let alive = true;
    setLoading(true);
    fetchXmtCandidates(meta.scriptSegmentId)
      .then((list) => { if (alive) { setCandidates(list); setError(null); } })
      .catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [meta]);

  if (!meta) return null;

  const fps = timeline.fps || 30;
  const poolAssetId = (assetId: number | null): string => `xmt-asset-${assetId}`;

  const registerPoolAsset = (candidate: XmtCandidate): void => {
    if (!candidate.asset_id || !candidate.stream_url) return;
    // addAsset 按 id 去重 —— 已在池里的候选重复登记是无操作。
    const durationMs = candidate.asset_duration_ms ?? candidate.duration_ms ?? 0;
    commands.addAsset({
      id: poolAssetId(candidate.asset_id),
      name: candidate.asset_title || `素材 ${candidate.asset_id}`,
      kind: 'video',
      src: candidate.stream_url,
      durationInFrames: Math.max(1, Math.round(durationMs / 1000 * fps)),
      width: candidate.asset_width ?? undefined,
      height: candidate.asset_height ?? undefined,
    });
  };

  const replace = (candidate: XmtCandidate): void => {
    if (!candidate.stream_url) return;
    try {
      registerPoolAsset(candidate);
      const srcInFrame = Math.max(0, Math.round((candidate.start_ms ?? 0) / 1000 * fps));
      const durationInFrames = Math.max(1, Math.round(
        (candidate.duration_ms && candidate.duration_ms > 0
          ? candidate.duration_ms
          : item.durationInFrames / fps * 1000) / 1000 * fps,
      ));
      const nextItem: TimelineItem = {
        ...item,
        kind: 'video',
        name: candidate.asset_title || item.name,
        src: candidate.stream_url,
        sourceAssetId: candidate.asset_id != null ? poolAssetId(candidate.asset_id) : undefined,
        srcInFrame,
        durationInFrames,
        volume: 0,
        props: { ...item.props, _xmt: { ...meta, matchStatus: 'manual', assetId: candidate.asset_id ?? null } },
      };
      const next: TimelineState = {
        ...timeline,
        items: timeline.items.map((candidate2) => (candidate2.id === item.id ? nextItem : candidate2)),
      };
      commands.applyState(next);
      showAppToast(t('已替换素材'));
      onClose();
    } catch (cause) {
      void cause;
      showAppToast(t('替换失败，请重试'), { error: true });
    }
  };

  const runSearch = (): void => {
    const text = query.trim();
    if (!text || searching) return;
    setSearching(true);
    setHoveringId(null);
    searchXmtSegments(text)
      .then((list) => { setCandidates(list); setError(null); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSearching(false));
  };

  const row = (candidate: XmtCandidate, index: number) => {
    const key = candidateKey(candidate, index);
    return (
      <div
        key={key}
        onPointerEnter={() => {
          if (candidate.stream_url) setHoveringId(key);
        }}
        onPointerLeave={() => {
          setHoveringId((current) => (current === key ? null : current));
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
          borderBottom: `0.5px solid ${theme.border}`,
        }}
      >
        <CandidateThumb candidate={candidate} active={hoveringId === key} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>
            {candidate.asset_title || `素材 ${candidate.asset_id ?? ''}`}
          </div>
          <div style={{ display: 'flex', gap: 8, fontSize: 11, color: theme.textDim, marginTop: 2 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
              {candidate.event_summary || t('（无事件摘要）')}
            </span>
            {typeof candidate.score === 'number' && (
              <span>{t('相似度')} {(candidate.score * 100).toFixed(0)}%</span>
            )}
            {fmtSeconds(candidate.duration_ms, t) && <span>{fmtSeconds(candidate.duration_ms, t)}</span>}
          </div>
        </div>
        <button type="button" onClick={() => replace(candidate)} style={{
          flexShrink: 0, border: `0.5px solid ${theme.accent}`, background: theme.accent,
          color: theme.onAccent, borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
        }}>{t('替换')}</button>
      </div>
    );
  };

  return (
    <div
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.45)',
        display: 'grid', placeItems: 'center',
      }}
    >
      <div style={{
        width: 540, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        background: theme.panel, border: `0.5px solid ${theme.borderLight}`, borderRadius: 6,
        boxShadow: `0 12px 36px ${themeAlpha.shadow(0.55)}`, overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 12px', borderBottom: `0.5px solid ${theme.border}`, fontWeight: 600, fontSize: 13 }}>
          {item.kind === 'solid' ? t('替换占位素材') : t('替换素材')}
        </div>
        <div style={{ padding: '8px 12px', display: 'flex', gap: 8 }}>
          <input
            value={query}
            placeholder={t('搜索素材库（语义检索，如「颁奖仪式」「观众欢呼」）')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
            style={{
              flex: 1, background: theme.bg, border: `0.5px solid ${theme.border}`,
              borderRadius: 4, padding: '6px 8px', color: theme.text, fontSize: 12,
            }}
          />
          <button type="button" disabled={!query.trim() || searching} onClick={runSearch} style={{
            border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
            borderRadius: 4, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
          }}>{searching ? t('搜索中…') : t('搜索')}</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 120 }}>
          {loading && <div style={{ padding: 16, fontSize: 12, color: theme.textDim, textAlign: 'center' }}>{t('正在加载 AI 候选…')}</div>}
          {!loading && error && <div style={{ padding: 16, fontSize: 12, color: theme.accent, textAlign: 'center' }}>{error}</div>}
          {!loading && !error && candidates && candidates.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: theme.textDim, textAlign: 'center' }}>{t('没有候选素材，试试上方搜索。')}</div>
          )}
          {!loading && !error && candidates?.map(row)}
        </div>
        <div style={{ padding: '8px 12px', borderTop: `0.5px solid ${theme.border}`, textAlign: 'right' }}>
          <button type="button" onClick={onClose} style={{
            border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
            borderRadius: 4, padding: '5px 14px', fontSize: 12, cursor: 'pointer',
          }}>{t('取消')}</button>
        </div>
      </div>
    </div>
  );
}
