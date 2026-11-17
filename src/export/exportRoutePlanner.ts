import { inspectBrowserExport, isAbortError, type BrowserExportInspection, type BrowserExportOptions } from './browserExport';
import type { ExportEngineInfo } from './exportWorkflowTypes';

// xmt：默认成片导出路线是浏览器 WebCodecs。
//
// 不沿用上游 `/export/capabilities` 与 `/export/job` 的自动回退：独立 server /
// 桌面壳在 XMT 宿主里不存在。移动布局下，若 H.264、原时间线帧率的浏览器预检明确
// 不支持，videoExportOperation 会改走 XMT 自己的 `/editor/export/job` ProjectDoc
// 服务端；已经开始渲染后的错误仍原样上报，绝不换路重跑。
//
// 所以这里只回答浏览器路线是否可用、是否支持硬件编码；移动预检失败的受限回退
// 在 videoExportOperation 统一判断。

const PERFORMANCE_STORAGE_KEY = 'cc.exportPerformance.v1';
const MIN_SAMPLE_MS = 250;
const MAX_PERFORMANCE_SAMPLES = 20;
const PREVIOUS_SAMPLE_WEIGHT = 0.7;
const CURRENT_SAMPLE_WEIGHT = 1 - PREVIOUS_SAMPLE_WEIGHT;

interface EnginePerformance {
  samples: number;
  workPerMillisecond: number;
}

type PerformanceStore = Record<string, EnginePerformance>;

export interface ExportRoutePlan {
  route: 'browser';
  engine: ExportEngineInfo;
  browserEngine: ExportEngineInfo;
  browser: BrowserExportInspection;
  reason: string;
}

function browserEngine(powerEfficient?: boolean): ExportEngineInfo {
  return {
    id: 'webcodecs',
    label: powerEfficient ? 'WebCodecs · 硬件加速' : 'WebCodecs · 本机编码',
    hardware: powerEfficient === true,
    transport: 'browser',
  };
}

async function inspectBrowser(options: BrowserExportOptions): Promise<BrowserExportInspection> {
  try {
    return await inspectBrowserExport(options);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {
      status: 'unsupported',
      reason: error instanceof Error ? error.message : '浏览器快导失败',
      issues: [],
    };
  }
}

function loadPerformance(): PerformanceStore {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(PERFORMANCE_STORAGE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
      if (!value || typeof value !== 'object') return false;
      const candidate = value as Partial<EnginePerformance>;
      return Number.isFinite(candidate.samples) && Number.isFinite(candidate.workPerMillisecond);
    })) as PerformanceStore;
  } catch {
    return {};
  }
}

function performanceKey(engine: ExportEngineInfo): string {
  return `${engine.transport}:${engine.id}`;
}

export async function planVideoExportRoute(options: BrowserExportOptions): Promise<ExportRoutePlan> {
  const browser = await inspectBrowser(options);
  const engine = browserEngine(browser.status === 'supported' ? browser.powerEfficient : undefined);
  const reason = browser.status === 'unsupported'
    ? browser.reason
    : browser.powerEfficient ? '浏览器确认支持硬件高效编码' : '浏览器 WebCodecs 导出';
  return { route: 'browser', engine, browserEngine: engine, browser, reason };
}

export function recordExportPerformance(engine: ExportEngineInfo, metrics: {
  width: number;
  height: number;
  frames: number;
  elapsedMs: number;
}): void {
  if (metrics.elapsedMs < MIN_SAMPLE_MS || metrics.frames < 1) return;
  const key = performanceKey(engine);
  const store = loadPerformance();
  const previous = store[key];
  const current = metrics.width * metrics.height * metrics.frames / metrics.elapsedMs;
  store[key] = {
    samples: Math.min(MAX_PERFORMANCE_SAMPLES, (previous?.samples ?? 0) + 1),
    workPerMillisecond: previous
      ? previous.workPerMillisecond * PREVIOUS_SAMPLE_WEIGHT + current * CURRENT_SAMPLE_WEIGHT
      : current,
  };
  try {
    localStorage.setItem(PERFORMANCE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Performance history is optional; export routing still uses live capability probes.
  }
}
