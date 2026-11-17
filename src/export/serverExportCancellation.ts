import { xmtHost } from '../xmt/host';
import { createExportFailure, ExportFailureError } from './exportFailure';
import { markServerExportCancellationRequested, markServerExportOutputReady } from './serverExportRecovery';
import { fetchExportJson, parseServerSnapshot, readServerSnapshot, retryableServerRead, waitForServer } from './serverExportTransport';
import type { ExportJobSnapshot, ExportProgress, StateSetter, Translate } from './exportWorkflowTypes';

interface CancellationContext {
  setBusy: StateSetter<string | null>;
  setProgress: StateSetter<ExportProgress | null>;
  t: Translate;
}

export function confirmedServerCancellation(t: Translate, cleaned: boolean): DOMException {
  return Object.assign(new DOMException('Export cancelled', 'AbortError'), {
    failure: createExportFailure({ stage: 'cancel', code: 'export_cancelled', retryable: false,
      cleanupStatus: cleaned ? 'succeeded' : 'failed',
      message: t(cleaned ? '已取消导出' : '已取消导出，但服务端任务记录清理未完成'),
    }),
  });
}

/** Persist intent before the request; a refresh must resume cancellation, not delivery. */
export async function cancelXmtServerExport(context: CancellationContext, renderId: string): Promise<ExportJobSnapshot> {
  const host = xmtHost();
  if (!host) throw new Error('XMT server cancellation requires a host');
  const detail = context.t('正在停止服务端渲染，等待确认');
  context.setBusy(detail);
  context.setProgress((current) => current ? { ...current, phase: 'cancelling', detail } : current);
  try {
    await markServerExportCancellationRequested(renderId, true);
    const deadline = Date.now() + 30_000;
    const { response, value } = await fetchExportJson(`/editor/export/job/${encodeURIComponent(renderId)}/cancel`, {
      method: 'POST', headers: { 'X-CSRFToken': host.csrfToken },
    });
    let snapshot = parseServerSnapshot(response, value, context.t);
    while (true) {
      context.setProgress((current) => current ? { ...current,
        percent: Math.max(current.percent, snapshot.progress),
        processedFrames: snapshot.processedFrames, totalFrames: snapshot.totalFrames,
        output: snapshot.output ?? current.output,
      } : current);
      if (snapshot.status !== 'queued' && snapshot.status !== 'running') break;
      if (Date.now() >= deadline) throw new Error('Cancellation confirmation timed out');
      await waitForServer(300);
      try {
        snapshot = await readServerSnapshot(renderId, context.t, undefined, Math.max(1, Math.min(5000, deadline - Date.now())));
      } catch (error) {
        if (!retryableServerRead(error)) throw error;
      }
    }
    if (snapshot.status === 'succeeded') {
      await markServerExportOutputReady(renderId);
      await markServerExportCancellationRequested(renderId, false);
      throw new ExportFailureError(createExportFailure({
        stage: 'cancel', code: 'server_export_already_completed', retryable: true,
        cleanupStatus: 'not-required', message: context.t('渲染已完成，成片已保留，可恢复下载'),
      }));
    }
    return snapshot;
  } catch (error) {
    if (error instanceof ExportFailureError && error.failure.code === 'server_export_already_completed') throw error;
    throw new ExportFailureError(createExportFailure({
      stage: 'cancel', code: 'server_export_cancel_unconfirmed', retryable: true,
      cleanupStatus: 'failed', message: context.t('取消尚未确认，服务端可能仍在渲染；重试将恢复原任务的取消确认'),
    }));
  }
}
