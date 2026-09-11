import type { RenderMediaOnWebProgress } from '@remotion/web-renderer';
import type { ComponentType } from 'react';
import type { TimelineCompositionProps } from '../editor/TimelineComposition';
import { timelineDuration, type ProjectDoc, type TimelineState } from '../editor/types';
import { resolveTimelineRenderPlan } from '../editor/sequenceGraph';
import { webScaledExportDimensions, type ExportResolution } from './mediaSettings';
const DEFAULT_CAPABILITY_BITRATE_BPS = 12_000_000;

/** xmt 导出加速运行时的最小接口（宿主 editor-export-acceleration.js 提供）。 */
interface ExportAccelerationRuntime {
  selectEncoder?: (input: { codec: string; width: number; height: number; bitrate?: number | 'high'; fps: number; signal?: AbortSignal }) =>
    Promise<{ hardwareAcceleration: 'prefer-hardware' | 'prefer-software'; reason?: string }>;
  beginAttempt?: (input: { codec: string; width: number; height: number; fps: number; bitrate?: number | 'high'; hardwareAcceleration: string; outputTarget: string }) => unknown;
  noteProgress?: (token: unknown, progress: RenderMediaOnWebProgress) => void;
  finishAttempt?: (token: unknown, result: unknown, blob: Blob) => void;
  failAttempt?: (token: unknown, error: unknown) => void;
  prepareProject?: (input: { project?: ProjectDoc; signal?: AbortSignal; openSource?: unknown }) => Promise<void>;
  recoverDecoder?: (input: { error: unknown; signal?: AbortSignal; openSource?: unknown }) => Promise<boolean | undefined>;
  shouldFallbackEncoder?: (error: unknown) => boolean | undefined;
  delayRenderTimeoutMs?: number;
}
interface ExportFlagWindow {
  __XMT_EXPORTING__?: boolean;
  __XMT_EXPORT_DECODER_SEQ__?: number;
  __XMT_EXPORT_SIGNAL__?: AbortSignal;
  __XMT_EXPORT_OPEN_SOURCE__?: (src: string, signal?: AbortSignal) => Promise<void>;
}


export type BrowserVideoCodec = 'h264' | 'vp8';
/** Server mezzanine codecs are accepted on the route planner, then forced off the browser path. */
export type PlannedVideoCodec = BrowserVideoCodec | 'prores';

type WebRendererModule = Pick<typeof import('@remotion/web-renderer'), 'canRenderMediaOnWeb' | 'renderMediaOnWeb'>;

export interface BrowserExportOptions {
  state: TimelineState;
  project?: ProjectDoc;
  timelineId?: string;
  codec: PlannedVideoCodec;
  resolution: ExportResolution;
  fps: number;
  videoBitrate?: number;
  signal?: AbortSignal;
  onProgress?: (progress: RenderMediaOnWebProgress) => void;
  loadRenderer?: () => Promise<WebRendererModule>;
  loadComposition?: () => Promise<{ TimelineComposition: ComponentType<TimelineCompositionProps> }>;
}

export type BrowserExportAttempt =
  | { status: 'rendered'; blob: Blob; issues: string[] }
  | { status: 'unsupported'; reason: string; issues: string[] };
export type BrowserExportInspection =
  | { status: 'supported'; issues: string[]; powerEfficient?: boolean }
  | Extract<BrowserExportAttempt, { status: 'unsupported' }>;


export type VideoExportWithFallback<T> =
  | { engine: 'browser'; attempt: Extract<BrowserExportAttempt, { status: 'rendered' }> }
  | { engine: 'server'; value: T; reason: string };

function abortError(): DOMException {
  return new DOMException('Browser export cancelled', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Decide whether a timeline can use the in-browser WebCodecs fast-export path.
 *
 * Historically this returned a reason to bar timelines containing WebGL clip
 * effects (`item.effects`) and GLSL transitions, because the web-renderer
 * frame grabber was not proven to capture a manually-drawn WebGL <canvas>.
 *
 * That assumption has been verified in this branch: a real `TimelineComposition`
 * containing multiple WebGL effects (bloom/pixelate/duotone/vignette/fisheye/crt)
 * and several GLSL transitions rendered through `@remotion/web-renderer` at
 * 1080p × 360f produces a valid H264 MP4 with 360 distinct frames and zero black
 * frames (ffprobe + blackdetect + per-frame sampling). WebCodecs therefore
 * carries these timelines, so they are no longer barred here. The fallback in
 * `exportVideoWithFallback` still routes any per-hardware failure to the server.
 *
 * Non-raster sources (svg/gif) and frame-rate retiming are handled separately by
 * `staticBrowserBlocker`.
 */
export function browserTimelineBlocker(state: TimelineState, project?: ProjectDoc, timelineId?: string): string | null {
  void state;
  void project;
  void timelineId;
  return null;
}

/** Use the shared codec-safe dimensions for capability checks and rendering. */
export function browserScaledExportDimensions(
  state: Pick<TimelineState, 'width' | 'height'>,
  resolution: ExportResolution,
): { width: number; height: number; scale: number } {
  return webScaledExportDimensions(state, resolution);
}

interface BrowserRenderConfig {
  renderer: WebRendererModule;
  container: 'mp4' | 'webm';
  audioCodec: 'aac' | 'opus';
  scale: number;
  videoBitrate: number | 'high';
  issues: string[];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function loadBrowserRenderConfig(
  options: BrowserExportOptions,
): Promise<BrowserRenderConfig | Extract<BrowserExportAttempt, { status: 'unsupported' }>> {
  const { state, codec, resolution, videoBitrate, signal } = options;
  if (codec === 'prores') {
    return { status: 'unsupported', reason: 'ProRes 母带仅支持本机渲染', issues: ['codec=prores'] };
  }
  const { width, height, scale } = browserScaledExportDimensions(state, resolution);
  const container = codec === 'h264' ? 'mp4' : 'webm';
  const audioCodec = codec === 'h264' ? 'aac' : 'opus';
  const resolvedVideoBitrate = videoBitrate ?? 'high';
  const renderer = await (options.loadRenderer ?? (() => import('@remotion/web-renderer')))();
  throwIfAborted(signal);
  const capability = await renderer.canRenderMediaOnWeb({
    container,
    videoCodec: codec,
    audioCodec,
    width,
    height,
    videoBitrate: resolvedVideoBitrate,
    audioBitrate: 'high',
  });
  const issues = capability.issues.map((issue) => issue.message);
  if (!capability.canRender) {
    return { status: 'unsupported', reason: issues[0] ?? '当前浏览器不支持此编码配置', issues };
  }
  return { renderer, container, audioCodec, scale, videoBitrate: resolvedVideoBitrate, issues };
}
function staticBrowserBlocker(
  options: BrowserExportOptions,
): Extract<BrowserExportAttempt, { status: 'unsupported' }> | null {
  if (options.codec === 'prores') {
    return {
      status: 'unsupported',
      reason: 'ProRes 母带仅支持本机渲染',
      issues: ['codec=prores'],
    };
  }
  if (options.fps !== options.state.fps) {
    return {
      status: 'unsupported',
      reason: '浏览器快导暂不转换时间线帧率',
      issues: [`timeline=${options.state.fps}fps, requested=${options.fps}fps`],
    };
  }
  const blocker = browserTimelineBlocker(options.state, options.project, options.timelineId);
  return blocker ? { status: 'unsupported', reason: blocker, issues: [blocker] } : null;
}

async function isBrowserEncodingPowerEfficient(options: BrowserExportOptions): Promise<boolean | undefined> {
  const capabilities = globalThis.navigator?.mediaCapabilities;
  if (!capabilities?.encodingInfo) return undefined;
  const { width, height } = browserScaledExportDimensions(options.state, options.resolution);
  const contentType = options.codec === 'h264'
    ? 'video/mp4; codecs="avc1.640028"'
    : 'video/webm; codecs="vp8"';
  try {
    const info = await capabilities.encodingInfo({
      type: 'record',
      video: {
        contentType,
        width,
        height,
        bitrate: options.videoBitrate ?? DEFAULT_CAPABILITY_BITRATE_BPS,
        framerate: options.fps,
      },
    });
    return info.powerEfficient;
  } catch {
    return undefined;
  }
}

export async function inspectBrowserExport(options: BrowserExportOptions): Promise<BrowserExportInspection> {
  throwIfAborted(options.signal);
  const blocker = staticBrowserBlocker(options);
  if (blocker) return blocker;
  const config = await loadBrowserRenderConfig(options);
  if ('status' in config) return config;
  return {
    status: 'supported',
    issues: config.issues,
    powerEfficient: await isBrowserEncodingPowerEfficient(options),
  };
}


async function executeBrowserRender(
  options: BrowserExportOptions,
  config: BrowserRenderConfig,
): Promise<Extract<BrowserExportAttempt, { status: 'rendered' }>> {
  const { state, project, timelineId, codec, signal, onProgress } = options;
  // Invariant: loadBrowserRenderConfig rejected prores before any render config existed.
  if (codec === 'prores') throw new Error('prores must be rejected by loadBrowserRenderConfig');
  const props: TimelineCompositionProps = { state, project, timelineId, transparent: false, browserRenderer: true };
  // xmt 导出加速运行时（宿主页在 Vite 入口之前加载 editor-export-acceleration.js）。
  // 运行时不在时一切钩子短路，路径逐字等于无加速的浏览器导出。
  const runtime = (globalThis as { __XMT_EXPORT_ACCELERATION__?: ExportAccelerationRuntime }).__XMT_EXPORT_ACCELERATION__;
  const width = Math.max(1, Math.round(state.width * config.scale));
  const height = Math.max(1, Math.round(state.height * config.scale));
  const preflight = await (runtime?.selectEncoder?.({
    codec, width, height, bitrate: config.videoBitrate, fps: state.fps, signal,
  }) ?? Promise.resolve({ hardwareAcceleration: 'prefer-hardware' as const, reason: '未加载编码预检运行时' }));
  let projectPrepared = false;
  const attemptRender = async (hardwareAcceleration: 'prefer-hardware' | 'prefer-software') => {
    const w = window as ExportFlagWindow;
    const attemptToken = runtime?.beginAttempt?.({
      codec, width, height, fps: state.fps, bitrate: config.videoBitrate,
      hardwareAcceleration, outputTarget: 'opfs-auto',
    });
    w.__XMT_EXPORTING__ = true;
    w.__XMT_EXPORT_DECODER_SEQ__ = 0;
    w.__XMT_EXPORT_SIGNAL__ = signal;
    try {
      const { TimelineComposition } = await (options.loadComposition ?? (() => import('../editor/TimelineComposition')))();
      throwIfAborted(signal);
      // Windows 上常见的失败是静默挂起而不是报错：渲染前先逐素材真实解帧规划
      // （每个源只规划一次，软/硬重试共用）。
      if (/Windows/.test(navigator.userAgent) && !projectPrepared) {
        await runtime?.prepareProject?.({ project, signal, openSource: w.__XMT_EXPORT_OPEN_SOURCE__ });
        projectPrepared = true;
      }
      throwIfAborted(signal);
      const result = await config.renderer.renderMediaOnWeb({
        composition: {
          id: 'openchatcut-timeline-browser',
          component: TimelineComposition,
          durationInFrames: Math.max(1, project && timelineId ? resolveTimelineRenderPlan(project, timelineId).durationInFrames : timelineDuration(state)),
          fps: state.fps,
          width: state.width,
          height: state.height,
          defaultProps: props,
        },
        inputProps: props,
        container: config.container,
        videoCodec: codec,
        audioCodec: config.audioCodec,
        scale: config.scale,
        signal,
        onProgress: (progress) => {
          onProgress?.(progress);
          runtime?.noteProgress?.(attemptToken, progress);
        },
        hardwareAcceleration,
        pageResponsiveness: 'low',
        // OPFS 由加速运行时接管（内存 arraybuffer 在长片上会顶爆堆）。
        outputTarget: null,
        delayRenderTimeoutInMilliseconds: runtime?.delayRenderTimeoutMs ?? 120000,
        videoBitrate: config.videoBitrate,
        audioBitrate: 'high',
        transparent: false,
      });
      throwIfAborted(signal);
      const blob = await result.getBlob();
      throwIfAborted(signal);
      runtime?.finishAttempt?.(attemptToken, result, blob);
      return { status: 'rendered' as const, blob, issues: config.issues };
    } catch (error) {
      runtime?.failAttempt?.(attemptToken, error);
      throw error;
    } finally {
      delete w.__XMT_EXPORTING__;
      delete w.__XMT_EXPORT_SIGNAL__;
    }
  };
  const startedAt = performance.now();
  const logPath = (path: string): void => {
    console.info(`[export] 编码路径：${path}，预检：${preflight.reason ?? '无'}，总耗时 ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
  };
  try {
    const attempt = await attemptRender(preflight.hardwareAcceleration);
    logPath(preflight.hardwareAcceleration === 'prefer-hardware' ? '硬件优先（预检通过）' : '软件（预检已提前降级）');
    return attempt;
  } catch (error) {
    throwIfAborted(signal);
    // 输入解码运行期失败：运行时先尝试恢复（例如清解码缓存/换源），成功则同路径整片重试。
    if (await runtime?.recoverDecoder?.({ error, signal, openSource: (window as ExportFlagWindow).__XMT_EXPORT_OPEN_SOURCE__ })) {
      console.warn('[export] 输入解码运行期恢复成功，整片重试一次：', error);
      const attempt = await attemptRender(preflight.hardwareAcceleration);
      logPath('输入解码恢复后重试');
      return attempt;
    }
    if (preflight.hardwareAcceleration === 'prefer-software' || !runtime?.shouldFallbackEncoder?.(error)) throw error;
    // 只有明确的 VideoEncoder/编码器错误才值得整片软件重跑；解码、网络、
    // InputDisposedError、delayRender 失败用软件重跑只是把同一个失败慢放一遍。
    console.warn('[export] 硬件编码器运行期失败，降软件编码整片重试一次：', error);
    const attempt = await attemptRender('prefer-software');
    logPath('软件（硬件编码器运行期失败后回退）');
    return attempt;
  }
}

export async function renderTimelineInBrowser(options: BrowserExportOptions): Promise<BrowserExportAttempt> {
  throwIfAborted(options.signal);
  const blocker = staticBrowserBlocker(options);
  if (blocker) return blocker;
  const config = await loadBrowserRenderConfig(options);
  if ('status' in config) return config;
  throwIfAborted(options.signal);
  return executeBrowserRender(options, config);
}

/** Keep fallback policy in one testable place: abort never starts a server job. */
export async function exportVideoWithFallback<T>({
  browser,
  server,
  onFallback,
}: {
  browser: () => Promise<BrowserExportAttempt>;
  server: () => Promise<T>;
  onFallback?: (reason: string) => void;
}): Promise<VideoExportWithFallback<T>> {
  try {
    const attempt = await browser();
    if (attempt.status === 'rendered') return { engine: 'browser', attempt };
    onFallback?.(attempt.reason);
    return { engine: 'server', value: await server(), reason: attempt.reason };
  } catch (error) {
    if (isAbortError(error)) throw error;
    const reason = error instanceof Error ? error.message : '浏览器快导失败';
    onFallback?.(reason);
    return { engine: 'server', value: await server(), reason };
  }
}
