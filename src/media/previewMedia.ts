import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  getPreviewSourceMode,
  getQualityMode,
  shouldAutoRequestPreviewProxy,
  shouldPreferMasterPreview,
  subscribeQualityMode,
} from './qualityPolicy';
import type { ProjectDoc, TimelineState } from '../editor/types';
import { resolveTimelineRenderPlan } from '../editor/sequenceGraph';
import { isPreviewable } from './clipPreview';

export interface PreviewProxySource {
  src: string;
  durationMs: number;
  width: number;
  height: number;
  codec: string;
  longGop: boolean;
}

export type PreviewProxyReadiness =
  | { status: 'not-needed'; reason: string }
  | { status: 'ready'; reason: string; previewSrc: string }
  | { status: 'failed'; reason: string; error: string };

export interface PreviewProxyResponse {
  source: PreviewProxySource;
  proxy: PreviewProxyReadiness;
}

export type PreviewProxyState = PreviewProxyReadiness
  | { status: 'loading'; reason: string }
  | { status: 'unavailable'; reason: string };

interface ProxyEntry {
  response: PreviewProxyResponse | null;
  promise: Promise<void> | null;
  controller: AbortController | null;
  listeners: Set<() => void>;
  force: boolean;
}

const proxyEntries = new Map<string, ProxyEntry>();

const DEFAULT_PREVIEW_PROXY_ENDPOINT = '/api/preview-proxy';

// xmt 宿主提供 previewProxyEndpoint（/editor/api/preview-proxy）；开发/独立
// 运行时回落上游默认路径。
function previewProxyEndpoint(): string {
  if (typeof window !== 'undefined') {
    const host = (window as { __XMT_EDITOR__?: { previewProxyEndpoint?: string } }).__XMT_EDITOR__;
    if (host?.previewProxyEndpoint) return host.previewProxyEndpoint;
  }
  return DEFAULT_PREVIEW_PROXY_ENDPOINT;
}

// xmt 时间线的源是素材库直链（/library/api/assets/<id>/stream，见
// core/video_editing/editor_bridge.stream_url_for_asset），不是上游的本地上传件，
// 所以 `isPreviewable` 那条 `/media/uploads/` 判据在宿主里恒为 false——「流畅」档
// 因此曾经一个请求都不发、静默退回原画质（`unavailable` 不进 PreviewPanel 的横幅
// 统计，连提示都没有）。这里单独给**预览副本**放宽，刻意不复用 `isPreviewable`：
// 后者还门控着 `/api/media-poster`、`/api/waveform`、`/api/filmstrip` 三个上游
// server 插件端点，而 xmt 宿主没有实现它们，一起放宽只会换来一批 404。
// 形状必须与服务端 app/routes/editor.py::_PREVIEW_PROXY_SRC_RE 一致。
const XMT_LIBRARY_STREAM_RE = /^\/library\/api\/assets\/\d+\/stream(?:[?#]|$)/;

export function isPreviewProxyEligible(src: string | undefined): src is string {
  return isPreviewable(src) || (!!src && XMT_LIBRARY_STREAM_RE.test(src));
}

function proxyEntry(src: string): ProxyEntry {
  let entry = proxyEntries.get(src);
  if (!entry) {
    entry = { response: null, promise: null, controller: null, listeners: new Set(), force: false };
    proxyEntries.set(src, entry);
  }
  return entry;
}

function notify(entry: ProxyEntry): void {
  for (const listener of entry.listeners) listener();
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `preview proxy request failed (${response.status})`;
}

function failedResponse(src: string, error: unknown): PreviewProxyResponse {
  return {
    source: { src, durationMs: 0, width: 0, height: 0, codec: '', longGop: false },
    proxy: {
      status: 'failed',
      reason: 'proxy-request-failed',
      error: error instanceof Error ? error.message : String(error),
    },
  };
}

async function loadProxy(src: string, force: boolean, entry: ProxyEntry): Promise<void> {
  if (entry.promise) {
    await entry.promise;
    if (force && !entry.force && entry.response?.proxy.status !== 'ready') await loadProxy(src, true, entry);
    return;
  }
  if (entry.response && (!force || entry.response.proxy.status === 'ready')) return;
  entry.force = force;
  entry.response = null;
  notify(entry);
  const query = `src=${encodeURIComponent(src)}${force ? '&force=1' : ''}`;
  const controller = new AbortController();
  entry.controller = controller;
  entry.promise = fetch(`${previewProxyEndpoint()}?${query}`, { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(await responseError(response));
      entry.response = await response.json() as PreviewProxyResponse;
    })
    .catch((error) => {
      if (!controller.signal.aborted) entry.response = failedResponse(src, error);
    })
    .finally(() => {
      if (entry.controller === controller) entry.controller = null;
      entry.promise = null;
      notify(entry);
    });
  await entry.promise;
}

export function requestPreviewProxy(src: string, force = false): Promise<void> {
  if (!isPreviewProxyEligible(src)) return Promise.resolve();
  return loadProxy(src, force, proxyEntry(src));
}

export function reportPreviewPlaybackFailure(src: string, error = 'preview media failed to play'): void {
  if (!isPreviewProxyEligible(src)) return;
  const entry = proxyEntry(src);
  if (entry.response?.proxy.status !== 'ready') {
    if (entry.response?.proxy.status !== 'failed') void requestPreviewProxy(src, true);
    return;
  }
  entry.response = {
    ...entry.response,
    proxy: { status: 'failed', reason: 'proxy-playback-failed', error },
  };
  notify(entry);
}

export function mediaPosterUrl(src: string | undefined): string | undefined {
  return isPreviewable(src) ? `/api/media-poster?src=${encodeURIComponent(src)}` : undefined;
}

function stateFor(src: string | undefined, autoRequest: boolean): PreviewProxyState {
  if (!isPreviewProxyEligible(src)) return { status: 'unavailable', reason: 'non-local-source' };
  const entry = proxyEntry(src);
  if (!entry.response) {
    return autoRequest
      ? { status: 'loading', reason: 'checking-source' }
      : { status: 'not-needed', reason: 'preview-source-original' };
  }
  return entry.response.proxy;
}

function subscribe(sources: readonly string[], listener: () => void): () => void {
  for (const src of sources) proxyEntry(src).listeners.add(listener);
  return () => {
    for (const src of sources) {
      const entry = proxyEntries.get(src);
      if (!entry) continue;
      entry.listeners.delete(listener);
      if (!entry.listeners.size && entry.promise) {
        entry.controller?.abort();
        if (proxyEntries.get(src) === entry) proxyEntries.delete(src);
      }
    }
  };
}

function useQualitySnapshot() {
  // Separate stable snapshots: getSnapshot must return a cached value, or
  // useSyncExternalStore re-renders forever on every new object literal.
  const mode = useSyncExternalStore(subscribeQualityMode, getQualityMode, getQualityMode);
  const preview = useSyncExternalStore(subscribeQualityMode, getPreviewSourceMode, getPreviewSourceMode);
  return { mode, preview };
}

function useProxySources(sources: readonly string[]): number {
  const [revision, setRevision] = useState(0);
  const quality = useQualitySnapshot();
  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    const unsubscribe = subscribe(sources, bump);
    // Only fetch proxies when policy/source mode expects them.
    if (shouldAutoRequestPreviewProxy(quality.mode, quality.preview)) {
      for (const src of sources) void requestPreviewProxy(src, quality.preview === 'proxy');
    }
    return unsubscribe;
  }, [sources, quality.mode, quality.preview]);
  // Re-resolve preview src when quality/preview-source mode flips even if proxy cache is quiet.
  useEffect(() => {
    setRevision((value) => value + 1);
  }, [quality.mode, quality.preview]);
  return revision;
}

function resolvePreviewSrc(src: string | undefined, proxy: PreviewProxyState): string | undefined {
  if (shouldPreferMasterPreview() && src) return src;
  return proxy.status === 'ready' ? proxy.previewSrc : src;
}

export function usePreviewMediaSource(src: string | undefined, enabled = true) {
  // 素材面板刻意**不**用放宽后的判据：「预览画质」这个开关说的是预览画布的播放，
  // 而这里一次挂载会为面板里每条视频各发一次 interactive 优先级的副本请求（xmt
  // 服务端按需转码，A/C 上是真 CPU）。时间线上真正在放的那几条已由
  // usePreviewProjectDoc 覆盖；面板要不要跟进是另一个决定，需要单独量。
  const source = enabled && isPreviewable(src) ? src : '';
  const sources = useMemo(() => source ? [source] : [], [source]);
  const revision = useProxySources(sources);
  const proxy = stateFor(source || undefined, shouldAutoRequestPreviewProxy());
  const previewSrc = resolvePreviewSrc(src, proxy);
  return {
    sourceSrc: src,
    previewSrc,
    posterSrc: mediaPosterUrl(source || undefined),
    proxy,
    requestFallback: useCallback(() => {
      if (source) reportPreviewPlaybackFailure(source);
    }, [source]),
    revision,
  };
}

export function usePreviewTimelineState(state: TimelineState) {
  const sources = useMemo(() => [...new Set(state.items
    .filter((item) => item.kind === 'video' && isPreviewProxyEligible(item.src))
    .map((item) => item.src!))].sort(), [state.items]);
  const revision = useProxySources(sources);
  const previewState = useMemo<TimelineState>(() => {
    void revision; // recompute when the proxy cache bumps (proxies live in module state)
    return {
      ...state,
      items: state.items.map((item) => {
        if (item.kind !== 'video' || !item.src) return item;
        const proxy = stateFor(item.src, shouldAutoRequestPreviewProxy());
        const previewSrc = resolvePreviewSrc(item.src, proxy);
        return previewSrc && previewSrc !== item.src ? { ...item, src: previewSrc } : item;
      }),
    };
  }, [state, revision]);
  const proxies = sources.map((src) => ({ src, proxy: stateFor(src, shouldAutoRequestPreviewProxy()) }));
  return {
    state: previewState,
    proxies,
    requestFallback: (src: string) => { reportPreviewPlaybackFailure(src); },
  };
}

/** Resolve preview proxies across the complete reachable nested-sequence graph. */
export function usePreviewProjectDoc(project: ProjectDoc, timelineId: string) {
  const plan = useMemo(() => resolveTimelineRenderPlan(project, timelineId), [project, timelineId]);
  const reachable = useMemo(() => new Set(plan.timelineIds), [plan.timelineIds]);
  const sources = useMemo(() => [...new Set(project.timelines
    .filter((timeline) => reachable.has(timeline.id))
    .flatMap((timeline) => timeline.items)
    .filter((item) => item.kind === 'video' && isPreviewProxyEligible(item.src))
    .map((item) => item.src!))].sort(), [project.timelines, reachable]);
  const revision = useProxySources(sources);
  const previewProject = useMemo<ProjectDoc>(() => {
    void revision; // recompute when the proxy cache bumps (proxies live in module state)
    return {
      ...project,
      timelines: project.timelines.map((timeline) => ({
        ...timeline,
        items: timeline.items.map((item) => {
          if (item.kind !== 'video' || !item.src) return item;
          const proxy = stateFor(item.src, shouldAutoRequestPreviewProxy());
          const previewSrc = resolvePreviewSrc(item.src, proxy);
          return previewSrc && previewSrc !== item.src ? { ...item, src: previewSrc } : item;
        }),
      })),
    };
  }, [project, revision]);
  const state = previewProject.timelines.find((timeline) => timeline.id === timelineId)!;
  return {
    project: previewProject,
    state,
    plan,
    proxies: sources.map((src) => ({ src, proxy: stateFor(src, shouldAutoRequestPreviewProxy()) })),
    requestFallback: (src: string) => { reportPreviewPlaybackFailure(src); },
  };
}
