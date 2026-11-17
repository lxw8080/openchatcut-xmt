import { timelineDuration } from '../editor/types';
import { resolveTimelineRenderPlan, sequenceGraphError } from '../editor/sequenceGraph';
import { recordExport } from '../persist/exportHistoryStore';
import {
  browserScaledExportDimensions,
  renderTimelineInBrowser,
  type BrowserExportAttempt,
  type BrowserExportOptions,
} from './browserExport';
import { removeStagedBrowserExport, stageBrowserExport } from './browserExportStage';
import {
  exportDestinationFilename,
  exportHistoryDestinationId,
  writeBlobToDestination,
  type ExportDestination,
} from './exportDestination';
import { planVideoExportRoute, recordExportPerformance, type ExportRoutePlan } from './exportRoutePlanner';
import { createExportFailure, createSequenceGraphExportFailure, exportFailureFrom, ExportFailureError } from './exportFailure';
import { MOBILE_EDITOR_QUERY } from '../editor/useMobileEditorLayout';
import { applyBrowserExportEvent } from './exportLiveProgress';
import type {
  BrowserAbortRef,
  ExportEngineInfo,
  ExportJobResult,
  ExportProgress,
  ExportQaUiState,
  RenderEngine,
  StateSetter,
  Translate,
  UseExportWorkflowOptions,
} from './exportWorkflowTypes';

export interface VideoExportContext {
  autoQaEnabled: boolean;
  browserAbortRef: BrowserAbortRef;
  destination: ExportDestination;
  beginTargetCommit(): void;
  endTargetCommit(): void;
  markTargetCommitted(): void;
  options: UseExportWorkflowOptions;
  setBusy: StateSetter<string | null>;
  setEngineInfo: StateSetter<ExportEngineInfo | null>;
  setEngineReason: StateSetter<string | null>;
  setProgress: StateSetter<ExportProgress | null>;
  setQa: StateSetter<ExportQaUiState | null>;
  setRenderEngine: StateSetter<RenderEngine>;
  t: Translate;
  verifyCompletedExport: (completed: ExportJobResult, signal?: AbortSignal) => Promise<void>;
}

export function validateVideoExportSequenceGraph(options: Pick<UseExportWorkflowOptions, 'project'>): void {
  if (!options.project) return;
  const error = sequenceGraphError(options.project);
  if (error) throw new ExportFailureError(createSequenceGraphExportFailure(error), { cause: error });
}

function exportDuration(options: UseExportWorkflowOptions): number {
  return options.project && options.timelineId
    ? resolveTimelineRenderPlan(options.project, options.timelineId).durationInFrames
    : timelineDuration(options.state);
}

function browserProgress(context: VideoExportContext): NonNullable<BrowserExportOptions['onProgress']> {
  return (snapshot) => {
    context.setRenderEngine('browser');
    const percent = Math.min(98, Math.max(1, Math.round(snapshot.progress * 98)));
    context.setBusy(context.t('浏览器渲染中…'));
    context.setProgress((current) => current ? {
      ...current,
      phase: 'rendering',
      percent,
      processedFrames: snapshot.encodedFrames,
      totalFrames: Math.max(1, exportDuration(context.options)),
      detail: context.t('浏览器逐帧合成与编码'),
    } : current);
  };
}

function browserOptions(context: VideoExportContext, signal: AbortSignal): BrowserExportOptions {
  const { state, project, timelineId, codec, resolution, fps, requestedVideoBitrate } = context.options;
  return {
    state,
    project,
    timelineId,
    codec,
    resolution,
    fps,
    videoBitrate: requestedVideoBitrate,
    signal,
    onProgress: browserProgress(context),
    onStatus: (event) => context.setProgress((current) => {
      if (!current) return current;
      const updated = applyBrowserExportEvent(current, event);
      return event.type === 'stage' && event.stage === 'rendering'
        ? { ...updated, totalFrames: Math.max(1, exportDuration(context.options)) } : updated;
    }),
  };
}

function setPlannedRoute(context: VideoExportContext, plan: ExportRoutePlan): void {
  context.setRenderEngine('browser');
  context.setEngineInfo(plan.engine);
  context.setEngineReason(plan.reason);
  context.setProgress((current) => current ? { ...current, detail: context.t(plan.reason) } : current);
}

// 浏览器不可用统一落成 preflight 错误。桌面与不符合受限条件的请求保留原错误；
// 符合移动 H.264、原帧率条件的请求由 createVideoExporter 改走 XMT 服务端。
// 不沿用上游针对独立 server 的回退，渲染期错误也不换路重跑。
function browserExportUnavailable(context: VideoExportContext, reason: string): ExportFailureError {
  return new ExportFailureError(createExportFailure({
    stage: 'preflight',
    code: 'browser_export_unavailable',
    retryable: false,
    message: context.t('浏览器导出不可用：{reason}。可改用「使用本机导出」', { reason: context.t(reason) }),
  }));
}

function browserResult(context: VideoExportContext, path: string, sizeBytes: number, engine: ExportEngineInfo) {
  const { state, resolution, fps } = context.options;
  const dimensions = browserScaledExportDimensions(state, resolution);
  return {
    path,
    sizeBytes,
    durationSeconds: exportDuration(context.options) / state.fps,
    width: dimensions.width,
    height: dimensions.height,
    fps,
    sourceStartSeconds: 0,
    encoder: engine,
  } satisfies ExportJobResult;
}

async function verifyBrowserResult(
  context: VideoExportContext,
  blob: Blob,
  filename: string,
  engine: ExportEngineInfo,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!context.autoQaEnabled) return;
  let path: string | null = null;
  try {
    const staged = await stageBrowserExport(blob, filename, signal);
    signal?.throwIfAborted();
    path = staged.path;
    await context.verifyCompletedExport(
      browserResult(context, path, staged.sizeBytes, engine),
      signal,
    );
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    context.setQa({ status: 'error', attempts: 0, message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (path) {
      try {
        await removeStagedBrowserExport(path);
      } finally {
        signal?.throwIfAborted();
      }
    }
  }
}

export async function saveBrowserResult(
  context: VideoExportContext,
  attempt: Extract<BrowserExportAttempt, { status: 'rendered' }>,
  engine: ExportEngineInfo,
  startedAt: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const { base, codec, state, resolution } = context.options;
  const filename = `${base}.${codec === 'vp8' ? 'webm' : 'mp4'}`;
  await verifyBrowserResult(context, attempt.blob, filename, engine, signal);
  signal?.throwIfAborted();
  context.setBusy(context.t('正在保存…'));
  context.setProgress((current) => current ? {
    ...current,
    phase: 'downloading',
    percent: 99,
    outputSize: attempt.blob.size,
    detail: context.t('正在写入所选位置'),
  } : current);
  signal?.throwIfAborted();
  context.beginTargetCommit();
  try {
    await writeBlobToDestination(context.destination, filename, attempt.blob, signal);
    context.markTargetCommitted();
  } catch (error) {
    context.endTargetCommit();
    throw error;
  }
  const dimensions = browserScaledExportDimensions(state, resolution);
  recordExportPerformance(engine, {
    width: dimensions.width,
    height: dimensions.height,
    frames: Math.max(1, Math.round(timelineDuration(state) * context.options.fps / state.fps)),
    elapsedMs: performance.now() - startedAt,
  });
  const destinationId = exportHistoryDestinationId(context.destination);
  const historyName = exportDestinationFilename(context.destination, filename);
  void recordExport({
    name: historyName,
    format: 'video',
    codec,
    sizeBytes: attempt.blob.size,
    createdAt: Date.now(),
    ...(destinationId ? { destinationId } : {}),
  });
}

async function runBrowserRoute(
  context: VideoExportContext,
  controller: AbortController,
  engine: ExportEngineInfo,
): Promise<BrowserExportAttempt> {
  const attempt = await renderTimelineInBrowser(browserOptions(context, controller.signal));
  if (attempt.status === 'rendered') {
    context.setRenderEngine('browser');
    context.setEngineInfo(engine);
  }
  return attempt;
}

async function runBrowserOnly(
  context: VideoExportContext,
  controller: AbortController,
  plan: ExportRoutePlan,
): Promise<void> {
  if (plan.browser.status === 'unsupported') throw browserExportUnavailable(context, plan.browser.reason);
  const startedAt = performance.now();
  // 渲染期抛出的错误（解码预检、抽帧超时、编码器）原样向上：那才是要给人看的那一句。
  const attempt = await runBrowserRoute(context, controller, plan.browserEngine);
  if (attempt.status !== 'rendered') throw browserExportUnavailable(context, attempt.reason);
  await saveBrowserResult(context, attempt, plan.browserEngine, startedAt, controller.signal);
}

async function exportVideo(context: VideoExportContext, ownerSignal?: AbortSignal): Promise<void> {
  validateVideoExportSequenceGraph(context.options);
  const controller = new AbortController();
  const abortFromOwner = () => controller.abort(ownerSignal?.reason);
  if (ownerSignal?.aborted) abortFromOwner();
  else ownerSignal?.addEventListener('abort', abortFromOwner, { once: true });
  context.browserAbortRef.current = controller;
  context.setRenderEngine('checking');
  context.setEngineInfo(null);
  context.setEngineReason(null);
  try {
    const options = browserOptions(context, controller.signal);
    const plan = await planVideoExportRoute(options);
    controller.signal.throwIfAborted();
    setPlannedRoute(context, plan);
    await runBrowserOnly(context, controller, plan);
  } finally {
    ownerSignal?.removeEventListener('abort', abortFromOwner);
    if (context.browserAbortRef.current === controller) context.browserAbortRef.current = null;
  }
}

export function shouldUseMobileServerFallback(error: unknown, mobile: boolean, codec: string, fpsMatches: boolean): boolean {
  return mobile && codec === 'h264' && fpsMatches && exportFailureFrom(error)?.code === 'browser_export_unavailable';
}

export function createVideoExporter(context: VideoExportContext, fallback?: (signal?: AbortSignal) => Promise<unknown>) {
  return async (signal?: AbortSignal) => {
    try {
      await exportVideo(context, signal);
    } catch (error) {
      const mobile = typeof window !== 'undefined' && window.matchMedia(MOBILE_EDITOR_QUERY).matches;
      if (!fallback || !shouldUseMobileServerFallback(error, mobile, context.options.codec, context.options.fps === context.options.state.fps)) throw error;
      context.setEngineReason(context.t('当前浏览器不支持 WebCodecs，已切换服务端渲染'));
      context.setBusy(context.t('正在提交服务端渲染…'));
      await fallback(signal);
    }
  };
}
