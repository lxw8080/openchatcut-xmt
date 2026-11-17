import { Icon } from '../components/icons';
import { useT } from '../i18n/locale';
import { EXPORT_ACTION_LABELS, type ExportWorkflowModel } from './useExportDialogModel';
import type { ExportTab } from './useExportWorkflow';
import { exportStageLabel } from './ExportProgressPanel';
import { exportOutputSummary } from './exportLiveProgress';

interface ExportFooterProps {
  tab: ExportTab;
  outputName: string;
  videoSummary: string;
  disabled: boolean;
  workflow: ExportWorkflowModel;
}

export function ExportFooter({ tab, outputName, videoSummary, disabled, workflow }: ExportFooterProps) {
  const t = useT();
  const { busy, cancelExport, progress, renderEngine, run } = workflow;
  const taskName = workflow.jobs.find((job) => job.id === workflow.selectedJobId)?.label ?? outputName;
  const output = progress?.output ?? progress?.live?.output;
  const summary = output ? exportOutputSummary(output) : videoSummary;
  const cancellablePhase = progress?.phase === 'queued'
    || progress?.phase === 'preparing'
    || progress?.phase === 'rendering'
    || progress?.phase === 'reconnecting';
  const cancellable = !!busy && cancellablePhase
    && (renderEngine === 'idle' || renderEngine === 'checking' || renderEngine === 'browser' || renderEngine === 'server');
  return (
    <footer className="cc-export-footer">
      <div className="cc-export-output">
        <span>{progress?.phase === 'completed' ? t('已生成') : tab === 'video' ? t('输出规格') : t('即将生成')}</span>
        <strong title={summary}>{tab === 'video' ? summary : taskName}</strong>
        {tab === 'video' && <small title={taskName}>{taskName}</small>}
      </div>
      {cancellable && (
        <button type="button" className="cc-export-cancel" onClick={cancelExport}>{t('取消')}</button>
      )}
      <button type="button" className="cc-export-cta" onClick={() => void run()} disabled={disabled}>
        {!busy && <Icon name={progress?.phase === 'completed' ? 'check' : 'download'} size={17} />}
        {busy ? t(progress ? exportStageLabel(progress, renderEngine) : '准备素材') : progress?.phase === 'completed' ? t('完成')
          : progress?.phase === 'failed' ? t('重试') : t(EXPORT_ACTION_LABELS[tab])}
      </button>
    </footer>
  );
}
