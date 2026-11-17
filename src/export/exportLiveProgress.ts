import type { ExportPhase, ExportProgress } from './exportWorkflowTypes';

export type PreparationStage = 'checking' | 'encoder-check' | 'transcoding' | 'probing' | 'recovering';
export type MaterialStage = 'checking' | 'queued' | 'transcoding' | 'verifying' | 'ready' | 'failed';
export interface MaterialReceipt {
  source: string;
  name?: string;
  stage: MaterialStage;
  reasons: string[];
  proxy?: boolean;
}
export interface DecoderRoute {
  source: string;
  originalSource?: string;
  mode: string;
  hardwareFailure?: string | null;
}
export interface LiveExportProgress {
  output?: { container: string; codec: string; width: number; height: number; fps: number; bitrate?: number };
  stage?: PreparationStage;
  materials: MaterialReceipt[];
  decoders: DecoderRoute[];
  decoderTotal: number;
  decoderCompleted: number;
  encoder?: { preference: 'prefer-hardware' | 'prefer-software'; reason: string };
  attempt: number;
  currentSource?: string;
  notice?: string;
  labels?: Record<string, string>;
}
interface ReadinessRow {
  asset_id?: number; source?: string; state: string; stage?: MaterialStage;
  reasons?: string[]; proxy_status?: string; proxy?: boolean;
}
export type BrowserExportEvent =
  | { type: 'output'; output: NonNullable<LiveExportProgress['output']> }
  | { type: 'stage'; stage: PreparationStage | 'queued' | 'rendering' | 'finalizing'; source?: string; attempt?: number }
  | { type: 'readiness'; data: { assets?: ReadinessRow[]; uploads?: ReadinessRow[] } }
  | { type: 'decoders'; total: number; completed: number; routes: DecoderRoute[] }
  | { type: 'encoder'; preference: 'prefer-hardware' | 'prefer-software'; reason: string }
  | { type: 'labels'; labels: Record<string, string> }
  | { type: 'detail'; message: string; detail?: string };

const TERMINAL = new Set<ExportPhase>(['completed', 'failed', 'cancelled']);
export function isExportTerminal(phase: ExportPhase): boolean { return TERMINAL.has(phase); }

export function exportStageKey(progress: ExportProgress): string {
  return progress.phase === 'preparing' ? progress.live?.stage ?? 'checking' : progress.phase;
}

/** All clock transitions are owned by the existing job store, including server
 * jobs and terminal updates. Renderer retries reset only the attempt clock. */
export function transitionExportProgress(previous: ExportProgress, next: ExportProgress, now: number): ExportProgress {
  const oldKey = exportStageKey(previous);
  const changed = oldKey !== exportStageKey(next) || previous.live?.attempt !== next.live?.attempt;
  const stageStartedAt = previous.stageStartedAt ?? previous.startedAt;
  const durations = { ...previous.stageDurations };
  if (changed) durations[oldKey] = (durations[oldKey] ?? 0) + Math.max(0, now - stageStartedAt);
  return { ...next, startedAt: previous.startedAt, stageDurations: durations,
    stageStartedAt: changed ? now : stageStartedAt };
}

export function sourceIdentity(source: string): string {
  return source.split(/[?#]/, 1)[0];
}

export function applyBrowserExportEvent(progress: ExportProgress, event: BrowserExportEvent): ExportProgress {
  if (isExportTerminal(progress.phase)) return progress;
  const live: LiveExportProgress = { materials: [], decoders: [], decoderTotal: 0, decoderCompleted: 0,
    attempt: 1, ...progress.live };
  let phase = progress.phase;
  let percent = progress.percent;
  let processedFrames = progress.processedFrames;
  if (event.type === 'stage') {
    phase = ['queued', 'rendering', 'finalizing'].includes(event.stage) ? event.stage as ExportPhase : 'preparing';
    live.stage = phase === 'preparing' ? event.stage as PreparationStage : undefined;
    live.currentSource = event.source;
    live.notice = undefined;
    if (event.attempt !== undefined) live.attempt = event.attempt;
    if (phase === 'rendering') { percent = 0; processedFrames = 0; }
  } else if (event.type === 'readiness') {
    const incoming = [...event.data.assets ?? [], ...event.data.uploads ?? []].map((row): MaterialReceipt => ({
      source: row.source ?? `/library/api/assets/${row.asset_id}/stream`,
      stage: row.state === 'ok' ? 'ready' : row.state === 'failed' ? 'failed'
        : row.stage ?? (row.proxy_status === 'running' ? 'transcoding' : row.proxy_status === 'pending' ? 'queued' : 'checking'),
      reasons: row.reasons ?? [], proxy: row.proxy,
    }));
    // A decoder repair may update one source; keep all other task receipts.
    const merged = new Map(live.materials.map((row) => [sourceIdentity(row.source), row]));
    for (const row of incoming) merged.set(sourceIdentity(row.source), row);
    live.materials = [...merged.values()];
    phase = 'preparing';
    live.stage = live.materials.some((row) => ['queued', 'transcoding', 'verifying'].includes(row.stage))
      ? 'transcoding' : 'checking';
  } else if (event.type === 'decoders') {
    live.decoders = event.routes.map((route) => ({ ...route }));
    live.decoderTotal = event.total;
    live.decoderCompleted = event.completed;
  } else if (event.type === 'encoder') {
    live.encoder = { preference: event.preference, reason: event.reason };
  } else if (event.type === 'output') live.output = { ...event.output };
  else if (event.type === 'labels') live.labels = { ...event.labels };
  else if (event.type === 'detail') live.notice = event.detail ? `${event.message} · ${event.detail}` : event.message;
  return { ...progress, phase, percent, processedFrames, live };
}

export function renderThroughput(progress: ExportProgress, now: number): { fps: number; remainingMs: number } | null {
  if (progress.phase !== 'rendering' || progress.stageStartedAt === undefined) return null;
  const frames = progress.processedFrames ?? 0;
  const total = progress.totalFrames ?? 0;
  const elapsed = Math.max(0, now - progress.stageStartedAt);
  if (frames < 5 || frames >= total || elapsed < 2000) return null;
  const fps = frames * 1000 / elapsed;
  return { fps, remainingMs: (total - frames) * 1000 / fps };
}

export const EXPORT_STAGE_LABELS: Record<string, string> = {
  queued: '等待网页渲染', checking: '检查素材', 'encoder-check': '检查输出编码',
  transcoding: '准备兼容素材', probing: '验证素材解码', recovering: '恢复解码并准备重试',
  preparing: '准备素材', rendering: '正在渲染', finalizing: '正在封装', verifying: '正在质量检查',
  downloading: '正在保存', completed: '导出完成', failed: '导出失败', cancelled: '已取消',
  reconnecting: '正在恢复连接', cancelling: '正在取消',
};

export function exportOutputSummary(output: NonNullable<LiveExportProgress['output']>): string {
  const codec = output.codec === 'h264' ? 'H.264' : output.codec.toUpperCase();
  return `${output.container.toUpperCase()} · ${codec} · ${output.width}×${output.height} · ${output.fps} fps`
    + (output.bitrate ? ` · ${(output.bitrate / 1_000_000).toFixed(1)} Mbps` : '');
}
