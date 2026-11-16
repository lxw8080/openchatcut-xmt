import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ExportDialog } from '../export/ExportDialog';
import { Icon, type IconName } from '../components/icons';
import { InspectorPanel } from '../components/InspectorPanel';
import { PreviewPanel } from '../components/PreviewPanel';
import { DesignStylePanel } from '../components/settings/DesignStylePanel';
import { ShortcutsDialog } from '../shortcuts/ShortcutsDialog';
import { VersionHistory } from '../components/VersionHistory';
import { LibraryPanel } from '../library/LibraryPanel';
import { invokeAction } from '../shortcuts/actionRegistry';
import { useT } from '../i18n/locale';
import { usePersistedState } from '../hooks/usePersistedState';
import { AppToastHost } from '../ui/AppToastHost';
import { showAppToast } from '../ui/appToast';
import { ReplaceClipDialog, xmtClipMeta } from '../xmt/ReplaceClipDialog';
import type { EditorWorkspaceViewProps } from './EditorWorkspaceView';
import { MobileTimeline } from './MobileTimeline';
import {
  MobileCanvasPanel,
  MobileMorePanel,
  MobileSheet,
  MobileSpeedPanel,
  MobileVolumePanel,
  type MobileLibraryView,
} from './MobileEditorSheets';
import {
  adjacentMobileClip,
  canSplitMobileItem,
  formatMobileTime,
  mobileTimelineDuration,
  primaryMobileTrackItems,
} from './mobileEditorLayout';
import { useMobilePlayerState } from './useMobilePlayerState';

type SheetState =
  | { kind: 'library'; view: MobileLibraryView }
  | { kind: 'inspector' | 'canvas' | 'more' | 'speed' | 'volume' | 'replace' }
  | null;

function MobileIconButton({ icon, label, disabled, onClick }: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return <button type="button" className="cc-mobile-icon-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}><Icon name={icon} size={19} /></button>;
}

function MobileToolButton({ icon, label, accent, danger, disabled, onClick }: {
  icon: IconName;
  label: string;
  accent?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`cc-mobile-tool-button${accent ? ' accent' : ''}${danger ? ' danger' : ''}`} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={22} /><span>{label}</span>
    </button>
  );
}

function MobileTransport({ props, onOpenCanvas, onFocus }: { props: EditorWorkspaceViewProps; onOpenCanvas: () => void; onFocus: () => void }) {
  const t = useT();
  const { state, playerRef } = props.previewPanel;
  const commands = props.timeline.commands;
  const { frame, playing } = useMobilePlayerState(playerRef);
  const total = mobileTimelineDuration(state);
  const items = primaryMobileTrackItems(state, 'video');
  const navigate = (direction: 'previous' | 'next') => {
    const target = adjacentMobileClip(items, frame, direction);
    if (!target) {
      playerRef.current?.seekTo(direction === 'previous' ? 0 : Math.max(0, total - 1));
      return;
    }
    commands.selectItem(target.id);
    playerRef.current?.seekTo(target.startFrame);
  };
  return (
    <div className="cc-mobile-transport">
      <span className="cc-mobile-timecode">{formatMobileTime(frame, state.fps)}<span> / {formatMobileTime(total, state.fps)}</span></span>
      <div className="cc-mobile-transport-center">
        <MobileIconButton icon="prev" label={t('上一片段')} disabled={!items.length} onClick={() => navigate('previous')} />
        <button type="button" className="cc-mobile-play-button" aria-label={playing ? t('暂停') : t('播放')} disabled={!state.items.length} onClick={() => playerRef.current?.toggle()}>
          <Icon name={playing ? 'pause' : 'play'} size={23} />
        </button>
        <MobileIconButton icon="next" label={t('下一片段')} disabled={!items.length} onClick={() => navigate('next')} />
      </div>
      <div className="cc-mobile-transport-right">
        <MobileIconButton icon="aspect" label={t('画布比例')} onClick={onOpenCanvas} />
        <MobileIconButton icon="fullscreen" label={t('全屏预览')} disabled={!state.items.length} onClick={onFocus} />
      </div>
    </div>
  );
}

function LibrarySheet({ view, props, onClose }: { view: MobileLibraryView; props: EditorWorkspaceViewProps; onClose: () => void }) {
  const t = useT();
  const titles: Record<MobileLibraryView, string> = {
    media: t('素材库'), audio: t('音频'), captions: t('字幕'), templates: t('视频模板'), transcript: t('文字稿'), effects: t('转场与特效'),
  };
  return (
    <MobileSheet title={titles[view]} large onClose={onClose}>
      <LibraryPanel key={view} {...props.libraryPanel} initialView={view} />
    </MobileSheet>
  );
}

export function MobileEditorWorkspace(props: EditorWorkspaceViewProps) {
  const t = useT();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [immersive, setImmersive] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = usePersistedState('cc.mobileTimelineCollapsed', false);
  const closeSheet = useCallback(() => setSheet(null), []);
  const { state, selectedItem, playerRef } = props.previewPanel;
  const commands = props.timeline.commands;
  const selectedId = selectedItem?.id ?? null;

  useEffect(() => {
    if (!selectedItem && sheet && ['inspector', 'speed', 'volume', 'replace'].includes(sheet.kind)) closeSheet();
  }, [selectedId, selectedItem, sheet, closeSheet]);
  useEffect(() => {
    if (!immersive) return undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setImmersive(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [immersive]);

  const openLibrary = (view: MobileLibraryView) => setSheet({ kind: 'library', view });
  const splitSelected = () => {
    if (!selectedItem) return;
    const frame = playerRef.current?.getCurrentFrame() ?? 0;
    if (!canSplitMobileItem(selectedItem, frame)) {
      showAppToast(t('把播放指针移到片段内部再分割'), { error: true });
      return;
    }
    commands.splitItem(selectedItem.id, Math.round(frame));
    showAppToast(t('已在播放指针处分割'));
  };
  const deleteSelected = () => {
    if (!selectedItem) return;
    commands.rippleDeleteItem(selectedItem.id);
    closeSheet();
    showAppToast(t('已删除片段，可撤销'));
  };
  const replaceSelected = () => {
    if (!selectedItem) return;
    if (!xmtClipMeta(selectedItem)) {
      showAppToast(t('当前片段没有 XMT 候选；可从素材库添加，或在属性中调整'), { error: true });
      return;
    }
    setSheet({ kind: 'replace' });
  };
  const beginEdit = () => {
    setTimelineCollapsed(false);
    if (selectedItem) return;
    const first = primaryMobileTrackItems(state, 'video')[0];
    if (first) commands.selectItem(first.id);
    else openLibrary('media');
  };

  let tools: ReactNode;
  if (selectedItem) {
    const canSpeed = selectedItem.kind === 'video' || selectedItem.kind === 'audio' || selectedItem.kind === 'sequence';
    const canVolume = selectedItem.kind === 'video' || selectedItem.kind === 'audio';
    tools = (
      <>
        <MobileToolButton icon="check" label={t('完成')} accent onClick={() => { commands.selectItem(null); closeSheet(); }} />
        <MobileToolButton icon="scissors" label={t('分割')} onClick={splitSelected} />
        <MobileToolButton icon="swap" label={t('替换')} accent onClick={replaceSelected} />
        <MobileToolButton icon="rateStretch" label={t('调速')} disabled={!canSpeed} onClick={() => setSheet({ kind: 'speed' })} />
        <MobileToolButton icon="volume" label={t('音量')} disabled={!canVolume} onClick={() => setSheet({ kind: 'volume' })} />
        <MobileToolButton icon="trim" label={t('裁剪')} disabled={selectedItem.kind === 'audio'} onClick={() => setSheet({ kind: 'inspector' })} />
        <MobileToolButton icon="trash" label={t('删除')} danger onClick={deleteSelected} />
      </>
    );
  } else {
    tools = (
      <>
        <MobileToolButton icon="scissors" label={t('剪辑')} onClick={beginEdit} />
        <MobileToolButton icon="music" label={t('音频')} onClick={() => openLibrary('audio')} />
        <MobileToolButton icon="text" label={t('字幕')} onClick={() => openLibrary('captions')} />
        <MobileToolButton icon="aspect" label={t('画面')} onClick={() => setSheet({ kind: 'canvas' })} />
        <MobileToolButton icon="grid" label={t('模板')} onClick={() => openLibrary('templates')} />
        <MobileToolButton icon="more" label={t('更多')} onClick={() => setSheet({ kind: 'more' })} />
      </>
    );
  }

  return (
    <div className={`cc-mobile-editor${immersive ? ' immersive' : ''}`}>
      <header className="cc-mobile-topbar">
        <MobileIconButton icon="back" label={t('返回工程列表')} onClick={() => props.topBar.onHome?.()} />
        <div className="cc-mobile-project-title"><strong>{props.topBar.projectName}</strong><span><i />{t('自动保存')}</span></div>
        <div className="cc-mobile-history-actions">
          <MobileIconButton icon="undo" label={t('撤销')} disabled={!props.topBar.canUndo} onClick={() => invokeAction('undo', undefined, 'toolbar')} />
          <MobileIconButton icon="redo" label={t('重做')} disabled={!props.topBar.canRedo} onClick={() => invokeAction('redo', undefined, 'toolbar')} />
        </div>
        <button type="button" className="cc-mobile-export-button" onClick={() => invokeAction('open-export', undefined, 'toolbar')}>
          <Icon name="export" size={16} />{props.topBar.exporting ? t('{n} 个导出', { n: Math.max(1, props.topBar.exportJobCount ?? 1) }) : t('导出')}
        </button>
      </header>

      <div className="cc-mobile-preview-wrap">
        <PreviewPanel {...props.previewPanel} />
        {immersive && (
          <button type="button" className="cc-mobile-immersive-exit" onClick={() => setImmersive(false)}>
            <Icon name="x" size={16} />{t('退出全屏')}
          </button>
        )}
      </div>
      <MobileTransport
        props={props}
        onOpenCanvas={() => setSheet({ kind: 'canvas' })}
        onFocus={() => setImmersive(true)}
      />
      <MobileTimeline
        state={state}
        commands={commands}
        playerRef={playerRef}
        collapsed={timelineCollapsed}
        onToggleCollapsed={() => setTimelineCollapsed((value) => !value)}
        onOpenLibrary={() => openLibrary('media')}
      />
      <nav className="cc-mobile-tools" aria-label={t('编辑工具')}>{tools}</nav>
      <div className="cc-mobile-safe-area" />

      {sheet?.kind === 'library' && <LibrarySheet view={sheet.view} props={props} onClose={closeSheet} />}
      {sheet?.kind === 'inspector' && props.inspectorPanel && (
        <MobileSheet title={t('片段属性')} large onClose={closeSheet}><InspectorPanel {...props.inspectorPanel} collapsed={false} /></MobileSheet>
      )}
      {sheet?.kind === 'canvas' && <MobileSheet title={t('画面与比例')} onClose={closeSheet}><MobileCanvasPanel state={state} commands={commands} /></MobileSheet>}
      {sheet?.kind === 'speed' && selectedItem && <MobileSheet title={t('片段速度')} onClose={closeSheet}><MobileSpeedPanel item={selectedItem} commands={commands} /></MobileSheet>}
      {sheet?.kind === 'volume' && selectedItem && <MobileSheet title={t('片段音量')} onClose={closeSheet}><MobileVolumePanel item={selectedItem} commands={commands} /></MobileSheet>}
      {sheet?.kind === 'more' && (
        <MobileSheet title={t('更多工具')} large onClose={closeSheet}>
          <MobileMorePanel
            timelineTabs={props.timelineTabs}
            hasSelection={!!selectedItem}
            onOpenLibrary={openLibrary}
            onOpenInspector={() => setSheet({ kind: 'inspector' })}
            onOpenHistory={() => { closeSheet(); invokeAction('open-history', undefined, 'toolbar'); }}
            onOpenDesign={() => { closeSheet(); invokeAction('open-design', undefined, 'toolbar'); }}
          />
        </MobileSheet>
      )}
      {sheet?.kind === 'replace' && selectedItem && (
        <ReplaceClipDialog item={selectedItem} commands={commands} timeline={state} onClose={closeSheet} />
      )}

      {props.exportDialog && <ExportDialog {...props.exportDialog} />}
      {props.designStylePanel && <DesignStylePanel {...props.designStylePanel} />}
      {props.versionHistory && <VersionHistory {...props.versionHistory} />}
      {props.shortcutsDialog && <ShortcutsDialog {...props.shortcutsDialog} />}
      <AppToastHost />
    </div>
  );
}
