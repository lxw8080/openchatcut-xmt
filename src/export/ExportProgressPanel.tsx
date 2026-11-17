import { useT } from '../i18n/locale';
import type { ExportProgress } from './exportWorkflowTypes';
import { EXPORT_STAGE_LABELS, exportStageKey, isExportTerminal, renderThroughput,
  sourceIdentity, type MaterialStage } from './exportLiveProgress';
import './export-progress.css';

export function formatExportDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const clock = `${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${clock}` : clock;
}

export function exportStageLabel(progress: ExportProgress): string {
  return EXPORT_STAGE_LABELS[exportStageKey(progress)] ?? '准备素材';
}

const MATERIAL_LABELS: Record<MaterialStage, string> = {
  checking: '检查中', queued: '等待处理', transcoding: '转码中', verifying: '校验副本', ready: '已就绪', failed: '失败',
};

function sourceLabel(source: string, labels?: Record<string, string>): string {
  const key = sourceIdentity(source);
  if (labels?.[key]) return labels[key];
  const id = key.match(/\/library\/api\/assets\/(\d+)\/stream/);
  if (id) return `素材 ${id[1]}`;
  try { return decodeURIComponent(key.split('/').at(-1) || source); } catch { return source; }
}

export function ExportProgressPanel({ progress, clock }: { progress: ExportProgress; clock: number }) {
  const t = useT();
  const live = progress.live;
  const terminal = isExportTerminal(progress.phase);
  const end = progress.finishedAt ?? clock;
  const stage = exportStageKey(progress);
  const label = t(exportStageLabel(progress));
  const materials = live?.materials ?? [];
  const ready = materials.filter((row) => row.stage === 'ready').length;
  const failed = materials.filter((row) => row.stage === 'failed').length;
  const routes = live?.decoders ?? [];
  const hardware = routes.filter((row) => row.mode === 'hardware' || row.mode === 'proxy-hardware').length;
  const software = routes.filter((row) => row.mode === 'software' || row.mode === 'proxy-software').length;
  const throughput = renderThroughput(progress, clock);
  const percent = progress.phase === 'completed' ? 100
    : progress.phase === 'rendering' ? Math.min(100, Math.round((progress.processedFrames ?? 0) * 100 / (progress.totalFrames || 1)))
      : stage === 'probing' && live?.decoderTotal ? Math.round(live.decoderCompleted * 100 / live.decoderTotal)
        : progress.phase === 'preparing' && materials.length ? Math.round(ready * 100 / materials.length) : null;
  const durations = { ...progress.stageDurations };
  if (!terminal) durations[stage] = (durations[stage] ?? 0) + Math.max(0, end - (progress.stageStartedAt ?? progress.startedAt));
  return (
    <section className={`cc-export-live ${progress.phase}`} aria-label={t('导出实时状态')}>
      <div className="cc-export-live-heading" role="status" aria-live="polite">
        <strong>{label}</strong>
        <span>{live && live.attempt > 1 ? t('第 {n} 次渲染', { n: live.attempt }) : t('导出任务')}</span>
      </div>
      <div className={`cc-export-progress-track${percent === null && !terminal ? ' indeterminate' : ''}`}
        role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percent ?? undefined}>
        <i style={percent === null ? undefined : { transform: `scaleX(${percent / 100})` }} />
      </div>
      <div className="cc-export-live-numbers">
        <span>{t('总耗时')} <b data-testid="export-total-time">{formatExportDuration(end - progress.startedAt)}</b></span>
        {!terminal && <span>{t('本阶段')} <b>{formatExportDuration(end - (progress.stageStartedAt ?? progress.startedAt))}</b></span>}
        {progress.phase === 'rendering' && <span>{t('渲染进度')} <b>{percent}%</b></span>}
      </div>
      {progress.processedFrames !== undefined && <p className="cc-export-live-note">
        {t('已编码 {done}/{total} 帧', { done: progress.processedFrames, total: progress.totalFrames ?? 0 })}
        {throughput && <> · {throughput.fps.toFixed(1)} fps · {t('预计剩余 {time}', { time: formatExportDuration(throughput.remainingMs) })}</>}
      </p>}
      {progress.phase === 'queued' && <p className="cc-export-live-note">{t('等待当前网页渲染完成后开始，可取消此任务')}</p>}
      {materials.length > 0 && <div className="cc-export-live-materials" role="status">
        <strong>{t('素材就绪 {done}/{total}', { done: ready, total: materials.length })}</strong>
        <span>{Object.entries(MATERIAL_LABELS).filter(([key]) => key !== 'ready')
          .map(([key, text]) => { const count = materials.filter((row) => row.stage === key).length;
            return count ? `${t(text)} ${count}` : null; }).filter(Boolean).join(' · ') || t('全部素材已就绪')}</span>
        {!!live?.decoderTotal && <span>{t('实解验证 {done}/{total}', { done: live.decoderCompleted, total: live.decoderTotal })}</span>}
      </div>}
      {live && <div className="cc-export-live-codecs">
        <div><span>{t('素材解码')}</span><strong>{routes.length
          ? t('硬件优先 {hardware} · 软件优先 {software}', { hardware, software }) : t('尚未验证')}</strong></div>
        <div><span>{t('成片编码')}</span><strong>{live.encoder
          ? t(live.encoder.preference === 'prefer-hardware' ? '硬件优先' : '软件优先') : t('尚未选择')}</strong></div>
        <small>{t('显示已选择的路线；浏览器未提供实际硬件使用确认。')}</small>
      </div>}
      {!live && progress.detail && <p className="cc-export-live-note">{progress.detail}</p>}
      {progress.outputSize !== undefined && <p className="cc-export-live-note">{t('文件大小 {size}', { size: `${(progress.outputSize / 1024 / 1024).toFixed(1)} MB` })}</p>}
      {(live || Object.keys(durations).length > 0) && <details className="cc-export-live-details" open={failed > 0 ? true : undefined}>
        <summary>{t('素材与运行详情')}</summary>
        {live?.currentSource && !terminal && <p>{t('当前素材')}：{sourceLabel(live.currentSource, live.labels)}</p>}
        {live?.encoder?.reason && <p>{t('编码选择原因')}：{live.encoder.reason}</p>}
        {live?.notice && <p>{live.notice}</p>}
        <ul>{materials.map((row) => {
          const route = routes.find((candidate) => sourceIdentity(candidate.originalSource ?? candidate.source) === sourceIdentity(row.source));
          return <li key={row.source} className={row.stage}>
            <div><strong>{sourceLabel(row.source, live?.labels)}</strong><span>{t(MATERIAL_LABELS[row.stage])}</span></div>
            {row.proxy && <small>{t('使用兼容副本')}</small>}
            {route && <small>{t(route.mode.endsWith('hardware') ? '硬件优先 · 实解验证通过' : route.mode.endsWith('software') ? '软件优先 · 实解验证通过' : '解码路线未确认')}</small>}
            {route?.hardwareFailure && <small>{t('软件回退原因')}：{route.hardwareFailure}</small>}
            {row.reasons.length > 0 && <small>{row.reasons.join('；')}</small>}
          </li>;
        })}</ul>
        <dl className="cc-export-live-timings">{Object.entries(durations).filter(([, ms]) => ms >= 1000).map(([key, ms]) => (
          <div key={key}><dt>{t(EXPORT_STAGE_LABELS[key] ?? key)}</dt><dd>{formatExportDuration(ms)}</dd></div>
        ))}</dl>
      </details>}
    </section>
  );
}
