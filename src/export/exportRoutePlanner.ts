import { inspectBrowserExport, isAbortError, type BrowserExportInspection, type BrowserExportOptions } from './browserExport';
import type { ExportEngineInfo } from './exportWorkflowTypes';

// xmt：成片导出只有一条路——浏览器 WebCodecs。
//
// 上游在这里还会探测 `/export/capabilities`，并在浏览器预检不过（或历史实测更
// 快）时改走 `/export/job`——那是随附 server / 桌面壳的渲染进程。本 fork 跑在
// xmt 的 /editor/<job> 外壳里，没有那个进程：这几条 URL 打到宿主上是 404，而
// 上游的回退把它当成「兼容渲染」的应答，用户看到的就是一句
// 「The requested URL was not found on the server」，真正的浏览器错误被吞掉
// （2026-09-12 Windows 全工程导不出的事故）。xmt 自己的「使用本机导出」由宿主
// 外壳经 xmt-renderer:// 协议唤起本地渲染器，不经过这个模块。
//
// 所以这里只回答一件事：浏览器这条路今天走不走得通、用不用得上硬件编码。走不通
// 的原因原样带回去，由 videoExportOperation 以 preflight 失败报给人，绝不回退。

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
