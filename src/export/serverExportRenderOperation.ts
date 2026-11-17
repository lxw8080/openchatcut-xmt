import { isAbortError } from './browserExport';
import { cancelXmtServerExport, confirmedServerCancellation } from './serverExportCancellation';
import { fetchExportJson, readServerSnapshot, retryableServerRead, ServerExportTransportError, waitForServer } from './serverExportTransport';
import type { ExportDestination } from './exportDestination';
import {
  exportFailureFrom,
  ExportFailureError,
  isExportFailure,
  type ExportFailure,
} from './exportFailure';
import {
  markServerExportOutputReady,
  persistServerExportJob,
  retireServerExportJob,
  type PersistedServerExportJob,
} from './serverExportRecovery';
import type {
  ExportEngineInfo,
  ExportJobResult,
  ExportJobSnapshot,
  ExportPhase,
  ExportProgress,
  RenderEngine,
  StateSetter,
  Translate,
  UseExportWorkflowOptions,
} from './exportWorkflowTypes';
import { xmtHost } from '../xmt/host';
import { reportExportDiagnostic } from './exportDiagnostics';
import type { TimelineState } from '../editor/types';

export interface ServerExportContext {
  autoQaEnabled: boolean;
  createOperationId?: () => string;
  setServerRenderId?: (renderId: string) => void;
  destination: ExportDestination;
  options: UseExportWorkflowOptions;
  targetPath?: string | null;
  beginTargetCommit(): void;
  endTargetCommit(): void;
  markTargetCommitted(): void;
  setBusy: StateSetter<string | null>;
  setEngineInfo: StateSetter<ExportEngineInfo | null>;
  setEngineReason: StateSetter<string | null>;
  setProgress: StateSetter<ExportProgress | null>;
  setRenderEngine: StateSetter<RenderEngine>;
  t: Translate;
  verifyCompletedExport: (completed: ExportJobResult, signal?: AbortSignal) => Promise<void>;
}

export type ExportFormat = 'video' | 'audio';
export type ExportCodec = 'h264' | 'vp8' | 'prores' | 'mp3';

/** XMT renders the frozen ProjectDoc at its original dimensions and frame rate. */
export function setXmtServerExportMetadata(
  context: Pick<ServerExportContext, 'setEngineInfo' | 'setProgress'>, state: TimelineState,
): void {
  if (!xmtHost()) return;
  context.setEngineInfo({ id: 'xmt-project-doc', label: '服务端渲染', hardware: false, transport: 'server' });
  if (state.width > 0 && state.height > 0 && state.fps > 0) {
    context.setProgress((current) => current ? { ...current, output: {
      container: 'mp4', codec: 'h264', width: state.width, height: state.height, fps: state.fps,
    } } : current);
  }
}

function recoveryRecord(
  context: ServerExportContext,
  renderId: string,
  format: ExportFormat,
  codec: ExportCodec,
): PersistedServerExportJob {
  const projectId = context.options.projectId;
  const ext = format === 'audio' ? 'mp3' : codec === 'vp8' ? 'webm' : codec === 'prores' ? 'mov' : 'mp4';
  const now = Date.now();
  return {
    version: 1,
    renderId,
    projectId,
    label: `${context.options.base}.${ext}`,
    targetPath: context.targetPath ?? null,
    createdAt: now,
    updatedAt: now,
    format,
    codec,
    base: context.options.base,
    fps: context.options.fps,
    state: context.options.state,
    destination: context.destination,
    autoQaEnabled: context.autoQaEnabled,
    stage: 'polling',
  };
}

export class ServerRenderError extends Error {
  readonly failure?: ExportFailure;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'ServerRenderError';
    const failure = exportFailureFrom(cause);
    if (failure) this.failure = failure;
  }
}

export function isServerRenderError(error: unknown): error is ServerRenderError {
  return error instanceof ServerRenderError;
}

function submissionBody(
  context: ServerExportContext,
  format: ExportFormat,
  codec: ExportCodec,
  operationId: string,
) {
  const { state, project, timelineId, base, resolution, fps, requestedVideoBitrate } = context.options;
  const body: Record<string, unknown> = {
    state, format, codec, name: base, operationId,
    ...(project && timelineId ? { project, timelineId } : {}),
  };
  if (format !== 'video') return body;
  body.resolution = resolution;
  if (fps !== state.fps) body.fps = fps;
  if (requestedVideoBitrate !== undefined) body.videoBitrate = requestedVideoBitrate;
  return body;
}

async function submitExport(
  context: ServerExportContext,
  format: ExportFormat,
  codec: ExportCodec,
  operationId: string,
  signal?: AbortSignal,
  onSubmitting?: () => void,
) {
  const host = xmtHost();
  if (host && (format !== 'video' || codec !== 'h264')) {
    throw new Error(context.t('本站没有服务端渲染进程，无法提取音轨或渲染 ProRes 母带；成片请用浏览器导出或「使用本机导出」'));
  }
  if (host) {
    const flush = (window as unknown as { __XMT_FLUSH_PROJECT__?: () => Promise<number> }).__XMT_FLUSH_PROJECT__;
    void reportExportDiagnostic('flush-started');
    await flush?.();
    void reportExportDiagnostic('flush-finished');
  }
  const body = submissionBody(context, format, codec, operationId);
  if (host) body.xmtJobId = host.jobId;
  signal?.throwIfAborted();
  onSubmitting?.();
  void reportExportDiagnostic('submit-started');
  const { response: submission, value: submitted } = await fetchExportJson(host ? '/editor/export/job' : '/export/job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(host ? { 'X-CSRFToken': host.csrfToken } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!submission.ok && submission.status >= 400 && submission.status < 500 && submission.status !== 408) {
    // Explicit rejection is different from a lost/timeout response after the
    // request may have been accepted. Only the former can discard its receipt.
    await retireServerExportJob(operationId).catch(() => false);
  }
  if (submitted && typeof submitted === 'object' && 'failure' in submitted && isExportFailure(submitted.failure)) {
    throw new ExportFailureError(submitted.failure);
  }
  const renderId = submitted && typeof submitted === 'object' && 'renderId' in submitted
    && typeof submitted.renderId === 'string'
    ? submitted.renderId
    : null;
  if (!submission.ok || !renderId || renderId !== operationId) {
    const error = submitted && typeof submitted === 'object' && 'error' in submitted
      && typeof submitted.error === 'string'
      ? submitted.error
      : context.t('导出失败 ({status})', { status: submission.status });
    throw new Error(error);
  }
  return renderId;
}

function activePhase(snapshot: ExportJobSnapshot): ExportPhase {
  if (snapshot.phase === 'cancelling') return 'cancelling';
  if (snapshot.phase === 'queued') return 'queued';
  if (snapshot.phase === 'finalizing') return 'finalizing';
  return snapshot.phase === 'rendering' ? 'rendering' : 'preparing';
}

function updateActiveProgress(context: ServerExportContext, snapshot: ExportJobSnapshot): void {
  context.setProgress((current) => current ? {
    ...current,
    phase: activePhase(snapshot),
    detail: snapshot.phase === 'cancelling' ? context.t('正在停止服务端渲染，等待确认') : undefined,
    percent: Math.min(99, Math.max(current.percent, Math.round(snapshot.progress))),
    processedFrames: snapshot.processedFrames,
    totalFrames: snapshot.totalFrames,
    output: snapshot.output ?? current.output,
  } : current);
}

function completeSnapshot(context: ServerExportContext, snapshot: ExportJobSnapshot): ExportJobResult {
  if (!snapshot.result?.path) throw new Error(context.t('导出完成，但没有可下载的文件'));
  const result = snapshot.result;
  context.setProgress((current) => current ? {
    ...current,
    phase: 'finalizing',
    percent: 99,
    processedFrames: snapshot.processedFrames,
    totalFrames: snapshot.totalFrames,
    output: snapshot.output ?? (result.width && result.height && result.fps && current.output
      ? { ...current.output, width: result.width, height: result.height, fps: result.fps } : current.output),
  } : current);
  return snapshot.result;
}

export async function finishServerCancellation(
  context: Pick<ServerExportContext, 'setBusy' | 'setProgress' | 't'>, renderId: string,
): Promise<never> {
  const snapshot = await cancelXmtServerExport(context, renderId);
  const cleaned = await retireAndDeleteExportJob(renderId).catch(() => false);
  if (snapshot.status === 'failed') throw new ServerRenderError(new Error(snapshot.error ?? context.t('导出失败')));
  throw confirmedServerCancellation(context.t, cleaned);
}

export async function pollExport(
  context: ServerExportContext,
  renderId: string,
  signal?: AbortSignal,
): Promise<ExportJobResult> {
  let failures = 0;
  let terminalObserved = false;
  try {
    while (true) {
      let snapshot: ExportJobSnapshot;
      try {
        snapshot = await readServerSnapshot(renderId, context.t, signal);
      } catch (error) {
        if (signal?.aborted || !xmtHost() || !retryableServerRead(error)) throw error;
        const detail = context.t('连接中断，正在恢复原导出任务；不会重复提交');
        context.setBusy(detail);
        context.setProgress((current) => current ? { ...current, phase: 'reconnecting', detail } : current);
        await waitForServer(Math.min(5000, 500 * 2 ** Math.min(failures++, 4)), signal);
        continue;
      }
      failures = 0;
      if (snapshot.status === 'cancelled') {
        terminalObserved = true;
        updateActiveProgress(context, { ...snapshot, phase: 'cancelling' });
        const cleaned = await retireAndDeleteExportJob(renderId).catch(() => false);
        throw confirmedServerCancellation(context.t, cleaned);
      }
      if (snapshot.status === 'failed') {
        terminalObserved = true;
        const cause = snapshot.failure
          ? new ExportFailureError(snapshot.failure)
          : new Error(snapshot.error ?? context.t('导出失败'));
        throw new ServerRenderError(cause);
      }
      if (snapshot.status === 'succeeded') return completeSnapshot(context, snapshot);
      context.setBusy(context.t(snapshot.phase === 'cancelling' ? '正在停止服务端渲染，等待确认' : '正在渲染…'));
      updateActiveProgress(context, snapshot);
      await waitForServer(300, signal);
    }
  } catch (error) {
    if (xmtHost() && signal?.aborted && !terminalObserved) return finishServerCancellation(context, renderId);
    throw error;
  }
}

async function deleteExportJob(renderId: string): Promise<void> {
  const host = xmtHost();
  const base = host ? '/editor/export/job' : '/export/job';
  const { response } = await fetchExportJson(`${base}/${encodeURIComponent(renderId)}`, {
    method: 'DELETE',
    headers: host ? { 'X-CSRFToken': host.csrfToken } : undefined,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`server export cleanup failed (${response.status})`);
  }
}

export async function retireAndDeleteExportJob(renderId: string): Promise<boolean> {
  if (xmtHost()) {
    // Confirm termination before retiring the only recovery receipt. DELETE is
    // cleanup, not cancellation, and an HTTP failure proves nothing about work.
    const snapshot = await readServerSnapshot(renderId, (key) => key).catch((error: unknown) => {
      if (error instanceof ServerExportTransportError && error.status === 404) return null;
      throw error;
    });
    if (snapshot?.status === 'queued' || snapshot?.status === 'running') {
      throw new Error('服务端仍在渲染，请恢复原任务或等待取消确认');
    }
  }
  if (!await retireServerExportJob(renderId)) return false;
  await deleteExportJob(renderId);
  return true;
}

export async function renderCompleted(
  context: ServerExportContext,
  format: ExportFormat,
  codec: ExportCodec,
  signal?: AbortSignal,
): Promise<{ renderId: string; completed: ExportJobResult }> {
  const renderId = context.createOperationId?.() ?? globalThis.crypto.randomUUID();
  const startedAt = performance.now();
  let submissionAccepted = false;
  let submissionStarted = false;
  context.setServerRenderId?.(renderId);
  setXmtServerExportMetadata(context, context.options.state);
  try {
    void reportExportDiagnostic('mobile-route');
    await persistServerExportJob(recoveryRecord(context, renderId, format, codec));
    await submitExport(context, format, codec, renderId, signal, () => { submissionStarted = true; });
    submissionAccepted = true;
    void reportExportDiagnostic('submit-accepted', { elapsedMs: performance.now() - startedAt });
    const completed = await pollExport(context, renderId, signal);
    await markServerExportOutputReady(renderId);
    void reportExportDiagnostic('render-finished', { elapsedMs: performance.now() - startedAt });
    return { renderId, completed };
  } catch (error) {
    const code = exportFailureFrom(error)?.code ?? (error instanceof Error ? error.name : 'Error');
    void reportExportDiagnostic(submissionAccepted ? 'poll-failed' : 'submit-failed', {
      elapsedMs: performance.now() - startedAt, code,
    });
    if (!submissionStarted) {
      await retireServerExportJob(renderId).catch(() => false);
    } else if (isServerRenderError(error)) {
      await retireAndDeleteExportJob(renderId).catch(() => false);
    } else if (!submissionAccepted && isAbortError(error) && xmtHost()) {
      // The POST may have been accepted even if its response was interrupted.
      return finishServerCancellation(context, renderId);
    } else if (!xmtHost() && submissionAccepted && isAbortError(error)) {
      await retireAndDeleteExportJob(renderId).catch(() => false);
    }
    throw error;
  }
}
