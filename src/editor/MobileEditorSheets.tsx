import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/icons';
import { TimelineTabs } from '../components/timeline/TimelineTabs';
import { ASPECT_PRESETS } from '../editor/types';
import type { EditorCommands } from './store';
import type { TimelineItem, TimelineState } from './types';
import { useT } from '../i18n/locale';

export type MobileLibraryView = 'media' | 'audio' | 'captions' | 'templates' | 'transcript' | 'effects';

export function MobileSheet({ title, subtitle, large, children, onClose }: {
  title: string;
  subtitle?: string;
  large?: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  const t = useT();
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]')?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previous?.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="cc-mobile-sheet-backdrop" onClick={onClose}>
      <section
        ref={panelRef}
        className={`cc-mobile-sheet${large ? ' large' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cc-mobile-sheet-grip" />
        <header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button type="button" onClick={onClose} aria-label={t('关闭')}><Icon name="x" size={19} /></button>
        </header>
        <div className="cc-mobile-sheet-body">{children}</div>
      </section>
    </div>
  );
}

export function MobileCanvasPanel({ state, commands }: { state: TimelineState; commands: EditorCommands }) {
  const t = useT();
  return (
    <div className="cc-mobile-canvas-panel">
      <div className="cc-mobile-panel-label">{t('画布比例')}<span>{state.width} × {state.height}</span></div>
      <div className="cc-mobile-choice-grid">
        {ASPECT_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.label}
            className={state.width === preset.width && state.height === preset.height ? 'active' : ''}
            onClick={() => commands.setAspect(preset.width, preset.height, state.fit)}
          >{preset.label}</button>
        ))}
      </div>
      <div className="cc-mobile-panel-label">{t('内容适配')}</div>
      <div className="cc-mobile-choice-grid two">
        <button type="button" className={state.fit !== 'cover' ? 'active' : ''} onClick={() => commands.setAspect(state.width, state.height, 'contain')}>{t('完整显示')}</button>
        <button type="button" className={state.fit === 'cover' ? 'active' : ''} onClick={() => commands.setAspect(state.width, state.height, 'cover')}>{t('铺满画布')}</button>
      </div>
    </div>
  );
}

export function MobileSpeedPanel({ item, commands }: { item: TimelineItem; commands: EditorCommands }) {
  const t = useT();
  const rate = item.playbackRate ?? 1;
  return (
    <div>
      <div className="cc-mobile-panel-label">{t('播放速度')}<span>{rate.toFixed(2)}×</span></div>
      <div className="cc-mobile-choice-grid">
        {[0.25, 0.5, 1, 1.5, 2, 4].map((preset) => (
          <button type="button" key={preset} className={Math.abs(rate - preset) < 0.001 ? 'active' : ''} onClick={() => commands.setItemSpeed(item.id, preset)}>{preset}×</button>
        ))}
      </div>
      <label className="cc-mobile-range-label">{t('自定义速度')}
        <input type="range" min="0.25" max="4" step="0.05" value={rate} onChange={(event) => commands.setItemSpeed(item.id, Number(event.target.value))} />
      </label>
    </div>
  );
}

export function MobileTimingPanel({ item, fps, commands, onClose }: {
  item: TimelineItem;
  fps: number;
  commands: EditorCommands;
  onClose: () => void;
}) {
  const t = useT();
  const [start, setStart] = useState((item.startFrame / fps).toFixed(2));
  const [duration, setDuration] = useState((item.durationInFrames / fps).toFixed(2));
  const end = (Number(start) || 0) + (Number(duration) || 0);
  return (
    <form className="cc-mobile-timing-panel" onSubmit={(event) => {
      event.preventDefault();
      const startFrame = Math.max(0, Math.round(Number(start) * fps));
      const durationInFrames = Math.max(1, Math.round(Number(duration) * fps));
      commands.batch([
        { type: 'move', id: item.id, startFrame },
        { type: 'retime', id: item.id, durationInFrames },
      ], t('调整片段时间'));
      onClose();
    }}>
      <label>{t('开始时间（秒）')}
        <input type="number" min="0" step="any" required value={start} onChange={(event) => setStart(event.target.value)} />
      </label>
      <label>{t('持续时间（秒）')}
        <input type="number" min={1 / fps} step="any" required value={duration} onChange={(event) => setDuration(event.target.value)} />
      </label>
      <div className="cc-mobile-panel-label">{t('结束时间')}<span>{end.toFixed(2)}s</span></div>
      <button type="submit" className="cc-mobile-timing-apply">{t('应用')}</button>
    </form>
  );
}

export function MobileVolumePanel({ item, commands }: { item: TimelineItem; commands: EditorCommands }) {
  const t = useT();
  const volume = item.volume ?? 1;
  return (
    <div>
      <div className="cc-mobile-panel-label">{t('片段音量')}<span>{Math.round(volume * 100)}%</span></div>
      <input className="cc-mobile-volume-range" type="range" min="0" max="2" step="0.01" value={volume} aria-label={t('片段音量')} onChange={(event) => commands.setItemVolume(item.id, Number(event.target.value))} />
      <div className="cc-mobile-choice-grid">
        {[0, 0.5, 1, 1.5].map((preset) => (
          <button type="button" key={preset} className={Math.abs(volume - preset) < 0.001 ? 'active' : ''} onClick={() => commands.setItemVolume(item.id, preset)}>{Math.round(preset * 100)}%</button>
        ))}
      </div>
    </div>
  );
}

function MoreButton({ icon, label, detail, disabled, onClick }: {
  icon: IconName;
  label: string;
  detail?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="cc-mobile-more-button" disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={21} />
      <span><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
      <Icon name="next" size={14} />
    </button>
  );
}

export function MobileMorePanel({
  timelineTabs,
  hasSelection,
  onOpenLibrary,
  onOpenInspector,
  onOpenHistory,
  onOpenDesign,
}: {
  timelineTabs: React.ComponentProps<typeof TimelineTabs>;
  hasSelection: boolean;
  onOpenLibrary: (view: MobileLibraryView) => void;
  onOpenInspector: () => void;
  onOpenHistory: () => void;
  onOpenDesign: () => void;
}) {
  const t = useT();
  return (
    <div className="cc-mobile-more-panel">
      {timelineTabs.doc.timelines.filter((timeline) => !timeline.hidden).length > 1 && (
        <div className="cc-mobile-sequence-picker"><div className="cc-mobile-panel-label">{t('序列')}</div><TimelineTabs {...timelineTabs} /></div>
      )}
      <div className="cc-mobile-more-grid">
        <MoreButton icon="folder" label={t('素材库')} detail={t('项目素材与上传')} onClick={() => onOpenLibrary('media')} />
        <MoreButton icon="sliders" label={t('片段属性')} detail={hasSelection ? t('变换、效果与关键帧') : t('先选中一个片段')} disabled={!hasSelection} onClick={onOpenInspector} />
        <MoreButton icon="sparkles" label={t('转场与特效')} detail={t('转场、滤镜、缩放和 LUT')} onClick={() => onOpenLibrary('effects')} />
        <MoreButton icon="filePlay" label={t('文字稿')} detail={t('转写、剪辑与字幕来源')} onClick={() => onOpenLibrary('transcript')} />
        <MoreButton icon="history" label={t('版本历史')} detail={t('查看和恢复自动版本')} onClick={onOpenHistory} />
        <MoreButton icon="palette" label={t('设计风格')} detail={t('品牌与视觉默认样式')} onClick={onOpenDesign} />
      </div>
    </div>
  );
}
