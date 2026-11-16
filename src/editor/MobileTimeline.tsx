import { useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';
import { Icon } from '../components/icons';
import { ClipMediaLayers } from '../components/timeline/ClipMediaLayers';
import { CLIP_COLOR } from '../components/timeline/timelineUtil';
import { useT } from '../i18n/locale';
import type { EditorCommands } from './store';
import type { TimelineItem, TimelineState } from './types';
import {
  MOBILE_TIMELINE_GUTTER,
  MOBILE_TIMELINE_PX_PER_FRAME,
  formatMobileTime,
  mobileFrameFromClientX,
  mobileTimelineDuration,
  mobileTimelineWidth,
  primaryMobileTrackItems,
} from './mobileEditorLayout';
import { useMobilePlayerState } from './useMobilePlayerState';

interface MobileTimelineProps {
  state: TimelineState;
  commands: EditorCommands;
  playerRef: RefObject<PlayerRef | null>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenLibrary: () => void;
}

function MobileClip({ item, state, selected, audio, onSelect }: {
  item: TimelineItem;
  state: TimelineState;
  selected: boolean;
  audio?: boolean;
  onSelect: () => void;
}) {
  const px = MOBILE_TIMELINE_PX_PER_FRAME;
  const duration = item.durationInFrames;
  return (
    <button
      type="button"
      className={`cc-mobile-clip${selected ? ' selected' : ''}${audio ? ' audio' : ''}`}
      style={{
        left: MOBILE_TIMELINE_GUTTER + item.startFrame * px,
        width: Math.max(8, duration * px),
        backgroundColor: CLIP_COLOR[item.kind],
        backgroundImage: item.kind === 'image' && item.src ? `linear-gradient(90deg, transparent, rgba(0,0,0,.35)), url(${item.src})` : undefined,
      }}
      aria-pressed={selected}
      aria-label={`${item.name}，${(duration / state.fps).toFixed(1)} 秒`}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
    >
      {(item.kind === 'video' || item.kind === 'audio') && (
        <ClipMediaLayers
          item={item}
          px={px}
          fps={state.fps}
          height={audio ? 30 : 54}
          clipStartFrame={item.startFrame}
          durationInFrames={duration}
          srcInFrame={item.srcInFrame ?? 0}
          playbackRate={item.playbackRate ?? 1}
          visibleWindow={{ startFrame: 0, endFrame: item.startFrame + duration }}
        />
      )}
      <span className="cc-mobile-clip-name">{item.name}</span>
      <span className="cc-mobile-clip-duration">{(duration / state.fps).toFixed(1)}s</span>
    </button>
  );
}

function MobilePlayhead({ playerRef, state, scrollRef, onSeek }: {
  playerRef: RefObject<PlayerRef | null>;
  state: TimelineState;
  scrollRef: RefObject<HTMLDivElement | null>;
  onSeek: (clientX: number) => void;
}) {
  const { frame, playing } = useMobilePlayerState(playerRef);
  const px = MOBILE_TIMELINE_PX_PER_FRAME;
  const x = MOBILE_TIMELINE_GUTTER + Math.min(frame, mobileTimelineDuration(state)) * px;
  if (playing && scrollRef.current) {
    const scroll = scrollRef.current;
    if (x < scroll.scrollLeft + 24 || x > scroll.scrollLeft + scroll.clientWidth - 42) {
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
  const videoItems = useMemo(() => primaryMobileTrackItems(state, 'video'), [state]);
  const audioItems = useMemo(() => primaryMobileTrackItems(state, 'audio'), [state]);
  const total = mobileTimelineDuration(state);
  const width = mobileTimelineWidth(total);
  const tickSeconds = total / state.fps > 60 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(total / (tickSeconds * state.fps)) + 1 }, (_, index) => index * tickSeconds);

  const seek = (clientX: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frame = mobileFrameFromClientX({ clientX, left: rect.left, scrollLeft: 0, totalFrames: total });
    playerRef.current?.seekTo(frame);
  };
  const scrubMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event.clientX);
  };

  return (
    <section className={`cc-mobile-timeline${collapsed ? ' collapsed' : ''}`} aria-label={t('移动时间轴')}>
      <div className="cc-mobile-timeline-head">
        <button type="button" onClick={onToggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? t('展开时间轴') : t('收起时间轴')}>
          <span className="cc-mobile-timeline-grip" />
          <Icon name="chevronDown" size={13} />
          <span>{collapsed ? t('展开时间轴') : t('收起时间轴')}</span>
        </button>
        <span>{t('{n} 个片段', { n: videoItems.length })}</span>
      </div>
      {!collapsed && (
        <div className="cc-mobile-timeline-scroll" ref={scrollRef}>
          <div className="cc-mobile-timeline-content" ref={contentRef} style={{ width }}>
            <div
              className="cc-mobile-ruler"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                seek(event.clientX);
              }}
              onPointerMove={scrubMove}
            >
              {ticks.map((seconds) => (
                <span key={seconds} style={{ left: MOBILE_TIMELINE_GUTTER + seconds * state.fps * MOBILE_TIMELINE_PX_PER_FRAME }}>
                  {formatMobileTime(seconds * state.fps, state.fps)}
                </span>
              ))}
            </div>
            <div className="cc-mobile-track-label"><Icon name="video" size={11} />{t('主视频')}</div>
            <div className="cc-mobile-video-lane">
              {videoItems.length === 0 && (
                <button type="button" className="cc-mobile-empty-track" onClick={onOpenLibrary}>
                  <Icon name="plus" size={15} />{t('从素材库添加视频')}
                </button>
              )}
              {videoItems.map((item) => (
                <MobileClip
                  key={item.id}
                  item={item}
                  state={state}
                  selected={state.selectedId === item.id}
                  onSelect={() => commands.selectItem(item.id)}
                />
              ))}
            </div>
            <div className="cc-mobile-track-label audio"><Icon name="music" size={11} />{t('背景音乐')}</div>
            <div className="cc-mobile-audio-lane">
              {audioItems.map((item) => (
                <MobileClip
                  key={item.id}
                  item={item}
                  state={state}
                  selected={state.selectedId === item.id}
                  audio
                  onSelect={() => commands.selectItem(item.id)}
                />
              ))}
            </div>
            <MobilePlayhead playerRef={playerRef} state={state} scrollRef={scrollRef} onSeek={seek} />
          </div>
        </div>
      )}
    </section>
  );
}
