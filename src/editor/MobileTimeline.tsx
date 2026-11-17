import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';
import { Icon } from '../components/icons';
import { ClipMediaLayers } from '../components/timeline/ClipMediaLayers';
import { CLIP_COLOR, type DragMode } from '../components/timeline/timelineUtil';
import { commitTimelineDragGesture } from '../components/timeline/useTimelinePointer';
import { trackDeletePlan } from '../components/timeline/trackDelete';
import { captionPages } from '../captions/exportCaptions';
import { useT } from '../i18n/locale';
import { remainingSourceFrames } from './sourceLimit';
import type { EditorCommands } from './store';
import {
  captionsOnTrack,
  timelineTrackIds,
  trackAlias,
  trackKind,
  type TimelineItem,
  type TimelineState,
  type TrackId,
  type TrackKind,
} from './types';
import {
  MOBILE_TIMELINE_GUTTER,
  MOBILE_TIMELINE_PX_PER_FRAME,
  clampMobileTimelinePx,
  fitMobileTimelinePx,
  formatMobileTime,
  mobileClipGestureGeometry,
  mobileFrameFromClientX,
  mobileTimelineDuration,
  mobileTimelineTickFrames,
  mobileTimelineWidth,
  mobileTrackItems,
} from './mobileEditorLayout';
import { useMobilePlayerState } from './useMobilePlayerState';

interface MobileTimelineProps {
  state: TimelineState;
  commands: EditorCommands;
  playerRef: RefObject<PlayerRef | null>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenLibrary: (view: 'media' | 'audio' | 'captions') => void;
}

type MobileDragMode = Exclude<DragMode, 'slip'>;
interface MobileDrag {
  id: string;
  mode: MobileDragMode;
  startX: number;
  startY: number;
  startScrollLeft: number;
  baseStart: number;
  baseDur: number;
  baseSrcIn: number;
  baseTrack: TrackId;
  deltaF: number;
  targetTrack: TrackId;
  moved: boolean;
}

type ClipPointerEvent = ReactPointerEvent<HTMLButtonElement>;
const TRACK_HEIGHT: Record<TrackKind, number> = { video: 58, audio: 46, caption: 46 };
const RULER_HEIGHT = 26;

function MobileClip({ item, state, px, selected, locked, drag, onSelect, onBegin, onMove, onEnd, onCancel }: {
  item: TimelineItem;
  state: TimelineState;
  px: number;
  selected: boolean;
  locked: boolean;
  drag: MobileDrag | null;
  onSelect: () => void;
  onBegin: (event: ClipPointerEvent, item: TimelineItem, mode: MobileDragMode) => void;
  onMove: (event: ClipPointerEvent) => void;
  onEnd: (event: ClipPointerEvent) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const audio = item.kind === 'audio';
  const base = drag ? { ...item, startFrame: drag.baseStart, durationInFrames: drag.baseDur } : item;
  const geometry = drag ? mobileClipGestureGeometry(base, drag.mode, drag.deltaF) : item;
  const gestureProps = {
    onPointerMove: onMove,
    onPointerUp: onEnd,
    onPointerCancel: onCancel,
  };
  return (
    <div
      className={`cc-mobile-clip${selected ? ' selected' : ''}${audio ? ' audio' : ''}${drag ? ' dragging' : ''}`}
      data-mobile-clip={item.id}
      style={{
        left: MOBILE_TIMELINE_GUTTER + geometry.startFrame * px,
        width: Math.max(10, geometry.durationInFrames * px),
        backgroundColor: CLIP_COLOR[item.kind],
        backgroundImage: item.kind === 'image' && item.src ? `linear-gradient(90deg, transparent, rgba(0,0,0,.35)), url(${item.src})` : undefined,
      }}
    >
      <button
        type="button"
        className="cc-mobile-clip-select"
        aria-pressed={selected}
        aria-label={`${item.name}，${(geometry.durationInFrames / state.fps).toFixed(1)} 秒`}
        title={locked ? t('轨道已锁定') : t('拖动移动片段，选中后拖动两端调整时长')}
        onClick={(event) => { event.stopPropagation(); onSelect(); }}
        onPointerDown={(event) => onBegin(event, item, 'move')}
        {...gestureProps}
      >
        {(item.kind === 'video' || item.kind === 'audio') && (
          <ClipMediaLayers
            item={item}
            px={px}
            fps={state.fps}
            height={audio ? 30 : 42}
            clipStartFrame={geometry.startFrame}
            durationInFrames={geometry.durationInFrames}
            srcInFrame={item.srcInFrame ?? 0}
            playbackRate={item.playbackRate ?? 1}
            visibleWindow={{ startFrame: 0, endFrame: geometry.startFrame + geometry.durationInFrames }}
          />
        )}
        <span className="cc-mobile-clip-name">{item.name}</span>
        <span className="cc-mobile-clip-duration">{(geometry.durationInFrames / state.fps).toFixed(1)}s</span>
      </button>
      {selected && !locked && (
        <>
          <button
            type="button"
            className="cc-mobile-trim-handle left"
            aria-label={t('调整 {name} 起点', { name: item.name })}
            onPointerDown={(event) => onBegin(event, item, 'trim-left')}
            onClick={(event) => event.stopPropagation()}
            {...gestureProps}
          />
          <button
            type="button"
            className="cc-mobile-trim-handle right"
            aria-label={t('调整 {name} 终点', { name: item.name })}
            onPointerDown={(event) => onBegin(event, item, 'trim-right')}
            onClick={(event) => event.stopPropagation()}
            {...gestureProps}
          />
        </>
      )}
    </div>
  );
}

function MobileCaptionLane({ state, trackId, px, locked, onOpen }: {
  state: TimelineState;
  trackId: TrackId;
  px: number;
  locked: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const captions = captionsOnTrack(state, trackId);
  const pages = useMemo(
    () => captions ? captionPages(captions, state.items, state.fps) : [],
    [captions, state.items, state.fps],
  );
  if (!pages.length) {
    return <button type="button" className="cc-mobile-empty-track" disabled={locked} onClick={onOpen}><Icon name="plus" size={14} />{t('编辑字幕')}</button>;
  }
  return pages.map((page, index) => {
    const text = page.words.map((word) => word.text).join(' ');
    const startFrame = page.start * state.fps / 1000;
    const duration = Math.max(1, (page.end - page.start) * state.fps / 1000);
    return (
      <button
        type="button"
        key={`${page.start}-${page.end}-${index}`}
        className="cc-mobile-caption-clip"
        style={{ left: MOBILE_TIMELINE_GUTTER + startFrame * px, width: Math.max(12, duration * px) }}
        disabled={locked}
        onClick={onOpen}
        aria-label={t('字幕：{text}', { text })}
      >{text}</button>
    );
  });
}

function MobilePlayhead({ playerRef, state, px, scrollRef, onSeek }: {
  playerRef: RefObject<PlayerRef | null>;
  state: TimelineState;
  px: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  onSeek: (clientX: number) => void;
}) {
  const { frame, playing } = useMobilePlayerState(playerRef);
  const x = MOBILE_TIMELINE_GUTTER + Math.min(frame, mobileTimelineDuration(state)) * px;
  if (playing && scrollRef.current) {
    const scroll = scrollRef.current;
    if (x < scroll.scrollLeft + MOBILE_TIMELINE_GUTTER || x > scroll.scrollLeft + scroll.clientWidth - 24) {
      scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
    }
  }
  const t = useT();
  return (
    <div className="cc-mobile-playhead" style={{ transform: `translate3d(${x}px,0,0)` }}>
      <button
        type="button"
        aria-label={t('拖动播放指针')}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          onSeek(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(event.clientX);
        }}
      />
    </div>
  );
}

export function MobileTimeline({ state, commands, playerRef, collapsed, onToggleCollapsed, onOpenLibrary }: MobileTimelineProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MobileDrag | null>(null);
  const [drag, setDrag] = useState<MobileDrag | null>(null);
  const [px, setPx] = useState(MOBILE_TIMELINE_PX_PER_FRAME);
  const [addingTrack, setAddingTrack] = useState(false);
  const trackIds = timelineTrackIds(state);
  const total = mobileTimelineDuration(state);
  const width = mobileTimelineWidth(total, px);
  const tickFrames = mobileTimelineTickFrames(state.fps, px);
  const ticks = Array.from({ length: Math.floor(total / tickFrames) + 1 }, (_, index) => index * tickFrames);
  const contentHeight = RULER_HEIGHT + trackIds.reduce((sum, id) => sum + TRACK_HEIGHT[trackKind(state, id)], 0);

  const updateDrag = (next: MobileDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  const trackFromClientY = (clientY: number): TrackId | null => {
    const lanes = scrollRef.current?.querySelectorAll<HTMLElement>('[data-mobile-track]');
    if (!lanes) return null;
    for (const lane of lanes) {
      const rect = lane.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return lane.dataset.mobileTrack ?? null;
    }
    return null;
  };
  const beginDrag = (event: ClipPointerEvent, item: TimelineItem, mode: MobileDragMode) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    commands.selectItem(item.id);
    if (state.tracks?.[item.track]?.locked) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDrag({
      id: item.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      baseStart: item.startFrame,
      baseDur: item.durationInFrames,
      baseSrcIn: item.srcInFrame ?? 0,
      baseTrack: item.track,
      deltaF: 0,
      targetTrack: item.track,
      moved: false,
    });
  };
  const moveDrag = (event: ClipPointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    event.stopPropagation();
    const scroll = scrollRef.current;
    if (scroll) {
      const rect = scroll.getBoundingClientRect();
      if (event.clientX > rect.right - 22) scroll.scrollLeft += 14;
      else if (event.clientX < rect.left + 22) scroll.scrollLeft = Math.max(0, scroll.scrollLeft - 14);
    }
    let deltaF = Math.round((event.clientX - current.startX + (scroll?.scrollLeft ?? current.startScrollLeft) - current.startScrollLeft) / px);
    if (current.mode === 'trim-right') {
      const item = state.items.find((candidate) => candidate.id === current.id);
      const remaining = item ? remainingSourceFrames(item, current.baseSrcIn, state.assets) : null;
      let cap = remaining === null ? Number.POSITIVE_INFINITY : remaining - current.baseDur;
      const next = state.items
        .filter((item) => item.track === current.baseTrack && item.id !== current.id && item.startFrame >= current.baseStart + current.baseDur)
        .sort((a, b) => a.startFrame - b.startFrame)[0];
      if (next) cap = Math.min(cap, next.startFrame - current.baseStart - current.baseDur);
      deltaF = Math.min(deltaF, cap);
    }
    const candidate = current.mode === 'move' ? trackFromClientY(event.clientY) : current.baseTrack;
    const validTrack = candidate && trackKind(state, candidate) === trackKind(state, current.baseTrack) && !state.tracks?.[candidate]?.locked;
    updateDrag({
      ...current,
      deltaF,
      targetTrack: validTrack ? candidate : current.baseTrack,
      moved: current.moved || Math.abs(event.clientX - current.startX) > 3 || Math.abs(event.clientY - current.startY) > 3,
    });
  };
  const endDrag = (event: ClipPointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    event.stopPropagation();
    updateDrag(null);
    if (!current.moved) return;
    commitTimelineDragGesture(state, commands, {
      id: current.id,
      mode: current.mode,
      baseStart: current.baseStart,
      baseDur: current.baseDur,
      baseSrcIn: current.baseSrcIn,
      baseTrack: current.baseTrack,
      startX: current.startX,
      deltaF: current.deltaF,
      targetTrack: current.targetTrack,
      snapAt: null,
    }, 'selection');
  };
  const seek = (clientX: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frame = mobileFrameFromClientX({ clientX, left: rect.left, scrollLeft: 0, px, totalFrames: total });
    playerRef.current?.seekTo(frame);
  };
  const zoomTo = (nextValue: number, fit = false) => {
    const scroll = scrollRef.current;
    const next = clampMobileTimelinePx(nextValue);
    const centerFrame = scroll ? Math.max(0, (scroll.scrollLeft + scroll.clientWidth / 2 - MOBILE_TIMELINE_GUTTER) / px) : 0;
    setPx(next);
    requestAnimationFrame(() => {
      if (!scroll) return;
      scroll.scrollLeft = fit ? 0 : Math.max(0, centerFrame * next + MOBILE_TIMELINE_GUTTER - scroll.clientWidth / 2);
      if (fit) scroll.scrollTop = 0;
    });
  };
  const deleteTrack = (trackId: TrackId) => {
    const plan = trackDeletePlan(state, trackId);
    if (plan.blockedReason) return;
    if (plan.requiresConfirmation && !window.confirm(t('删除轨道会同时删除其中的片段、字幕和转场，确认继续吗？'))) return;
    if (plan.actions.length) commands.batch(plan.actions, t('删除轨道'));
  };

  return (
    <section className={`cc-mobile-timeline${collapsed ? ' collapsed' : ''}`} aria-label={t('移动时间轴')}>
      <div className="cc-mobile-timeline-head">
        <button type="button" className="cc-mobile-timeline-collapse" onClick={onToggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? t('展开时间轴') : t('收起时间轴')}>
          <span className="cc-mobile-timeline-grip" />
          <Icon name="chevronDown" size={13} />
          <span>{collapsed ? t('展开') : t('收起')}</span>
        </button>
        <span className="cc-mobile-timeline-count">{t('{n} 条轨道', { n: trackIds.length })} · {t('{n} 个片段', { n: state.items.length })}</span>
        <div className="cc-mobile-timeline-actions">
          <button type="button" aria-label={t('新增轨道')} aria-expanded={addingTrack} onClick={() => { setAddingTrack((value) => !value); if (collapsed) onToggleCollapsed(); }}><Icon name="plus" size={14} /><span>{t('轨道')}</span></button>
          <button type="button" aria-label={t('缩小时间轴')} disabled={collapsed || px <= 0.0201} onClick={() => zoomTo(px / 1.5)}><Icon name="zoomOut" size={15} /></button>
          <button type="button" className="cc-mobile-fit-button" disabled={collapsed} onClick={() => zoomTo(fitMobileTimelinePx(total, scrollRef.current?.clientWidth ?? 390), true)}>{t('全览')}</button>
          <button type="button" aria-label={t('放大时间轴')} disabled={collapsed || px >= 5.999} onClick={() => zoomTo(px * 1.5)}><Icon name="zoomIn" size={15} /></button>
        </div>
      </div>
      {!collapsed && addingTrack && (
        <div className="cc-mobile-track-add" aria-label={t('选择轨道类型')}>
          {(['video', 'audio', 'caption'] as const).map((kind) => (
            <button
              type="button"
              key={kind}
              onClick={() => {
                commands.createTrack(kind, { name: t(kind === 'video' ? '视频轨道' : kind === 'audio' ? '音频轨道' : '字幕轨道') });
                setAddingTrack(false);
              }}
            >
              <Icon name={kind === 'video' ? 'video' : kind === 'audio' ? 'music' : 'captions'} size={15} />
              {t(kind === 'video' ? '视频轨道' : kind === 'audio' ? '音频轨道' : '字幕轨道')}
            </button>
          ))}
        </div>
      )}
      {!collapsed && (
        <div className="cc-mobile-timeline-scroll" ref={scrollRef}>
          <div className="cc-mobile-timeline-content" ref={contentRef} style={{ width, height: contentHeight }}>
            <div
              className="cc-mobile-ruler"
              style={{ height: RULER_HEIGHT }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                seek(event.clientX);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event.clientX);
              }}
            >
              {ticks.map((frame) => (
                <span key={frame} style={{ left: MOBILE_TIMELINE_GUTTER + frame * px }}>
                  {formatMobileTime(frame, state.fps)}
                </span>
              ))}
            </div>
            {trackIds.map((trackId) => {
              const kind = trackKind(state, trackId);
              const config = state.tracks?.[trackId] ?? {};
              const alias = trackAlias(state, trackId);
              const captions = kind === 'caption' ? captionsOnTrack(state, trackId) : null;
              const hidden = kind === 'caption' ? captions?.enabled === false : config.hidden === true;
              const locked = config.locked === true;
              const items = mobileTrackItems(state, trackId);
              const deletePlan = trackDeletePlan(state, trackId);
              const kindLabel = kind === 'video' ? t('视频') : kind === 'audio' ? t('音频') : t('字幕');
              const title = config.name || (alias === 'V1' ? t('主视频') : `${kindLabel}${alias.slice(1)}`);
              return (
                <div
                  className={`cc-mobile-track-row ${kind}${hidden ? ' hidden' : ''}${locked ? ' locked' : ''}${drag?.targetTrack === trackId && drag.baseTrack !== trackId ? ' drop-target' : ''}`}
                  style={{ height: TRACK_HEIGHT[kind] }}
                  key={trackId}
                >
                  <div className="cc-mobile-track-label">
                    <button
                      type="button"
                      className="cc-mobile-track-name"
                      title={hidden ? t('显示轨道') : t('隐藏轨道')}
                      aria-label={`${hidden ? t('显示轨道') : t('隐藏轨道')} ${title}`}
                      onClick={() => commands.toggleTrackFlag(trackId, 'hidden')}
                    >
                      <strong>{alias}</strong><span>{title}</span>
                    </button>
                    <div className="cc-mobile-track-buttons">
                      <button type="button" aria-label={`${locked ? t('解锁轨道') : t('锁定轨道')} ${title}`} onClick={() => commands.toggleTrackFlag(trackId, 'locked')}><Icon name={locked ? 'lock' : 'unlock'} size={12} /></button>
                      <button
                        type="button"
                        aria-label={`${t('删除轨道')} ${title}`}
                        disabled={!!deletePlan.blockedReason}
                        title={deletePlan.blockedReason === 'last-video' ? t('至少保留一条视频轨道') : deletePlan.blockedReason === 'locked' ? t('轨道已锁定') : t('删除轨道')}
                        onClick={() => deleteTrack(trackId)}
                      ><Icon name="trash" size={12} /></button>
                    </div>
                  </div>
                  <div className="cc-mobile-track-lane" data-mobile-track={trackId}>
                    {kind === 'caption' ? (
                      <MobileCaptionLane state={state} trackId={trackId} px={px} locked={locked} onOpen={() => onOpenLibrary('captions')} />
                    ) : (
                      <>
                        {!items.length && (
                          <button type="button" className="cc-mobile-empty-track" onClick={() => onOpenLibrary(kind === 'audio' ? 'audio' : 'media')}>
                            <Icon name="plus" size={14} />{t(kind === 'audio' ? '添加音频或配音' : '添加视频、图片或 MG')}
                          </button>
                        )}
                        {items.map((item) => (
                          <MobileClip
                            key={item.id}
                            item={item}
                            state={state}
                            px={px}
                            selected={state.selectedId === item.id}
                            locked={locked}
                            drag={drag?.id === item.id ? drag : null}
                            onSelect={() => commands.selectItem(item.id)}
                            onBegin={beginDrag}
                            onMove={moveDrag}
                            onEnd={endDrag}
                            onCancel={() => updateDrag(null)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            <MobilePlayhead playerRef={playerRef} state={state} px={px} scrollRef={scrollRef} onSeek={seek} />
          </div>
        </div>
      )}
    </section>
  );
}
