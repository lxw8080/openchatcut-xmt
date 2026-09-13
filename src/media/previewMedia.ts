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

// `pending` 是 xmt 服务端（app/routes/editor.py::preview_proxy）表达「副本正在
// 转码」的状态：同步等转码完会把请求线程挂死在长素材上，所以它立刻回 pending、
// 由前端轮询。fork 原本只有 not-needed/ready/failed 三态，于是新转出的副本在
// 手工刷新页面之前永远切不到 ready。
export type PreviewProxyReadiness =
  | { status: 'not-needed'; reason: string }
  | { status: 'pending'; reason: string }
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
  /** pending 轮询的定时器句柄；非 pending / 无订阅者时必须为 null。 */
  pollTimer: ReturnType<typeof setTimeout> | null;
  pollDelayMs: number;
}

// 这个模块级缓存有三条不变量，破坏任何一条都表现为「横幅每隔一次网络往返闪一下」：
// ① **effect 按 sources 内容键控，不按数组身份**——上游几乎每个派生 sources 的
//    memo 都随父级渲染换身份（activeEditorState(doc) 每次返回新对象），按身份
//    键控等于每渲染一次就重新请求一遍副本。
// ② **终态绝不因 force 重拉**——`not-needed`（服务端明确说这条不需要副本）与
//    `pending`（轮询接管）再问一百次也是同一个答案，而每问一次都会先清空
//    response、让 stateFor 回落 loading，横幅就会闪。只有 `failed` 才值得带
//    force 重排队。
// ③ **pending 轮询不清空 response**——刷新期间状态必须稳定停在 pending，
//    横幅才不会一亮一灭。
const proxyEntries = new Map<string, ProxyEntry>();

// 转码是分钟级的（服务端看门狗 30 分钟），所以轮询刻意不设次数上限，只做温和
// 退避；停手的唯一条件是状态变成终态或没人再看它。
const POLL_INITIAL_MS = 4000;
const POLL_MAX_MS = 10000;

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
    entry = {
      response: null, promise: null, controller: null, listeners: new Set(), force: false,
      pollTimer: null, pollDelayMs: POLL_INITIAL_MS,
    };
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

/** 不变量②：force 只对「还没问过」与「上一次明确失败」有意义。 */
function forceShouldRefetch(entry: ProxyEntry): boolean {
  return !entry.response || entry.response.proxy.status === 'failed';
}

function clearPoll(entry: ProxyEntry): void {
  if (entry.pollTimer === null) return;
  clearTimeout(entry.pollTimer);
  entry.pollTimer = null;
}

/** 仍是 pending 且仍有人在看时排下一轮轮询；其余情况一律停手。 */
function schedulePoll(src: string, entry: ProxyEntry): void {
  clearPoll(entry);
  if (entry.response?.proxy.status !== 'pending' || !entry.listeners.size) return;
  const delay = entry.pollDelayMs;
  entry.pollDelayMs = Math.min(POLL_MAX_MS, Math.round(delay * 1.5));
  entry.pollTimer = setTimeout(() => {
    entry.pollTimer = null;
    pollOnce(src, entry);
  }, delay);
}

function pollOnce(src: string, entry: ProxyEntry): void {
  if (!entry.listeners.size || entry.response?.proxy.status !== 'pending') return;
  // 与在飞请求并发会撞出两个 AbortController；那一次请求的 finally 自己会重新排期。
  if (entry.promise) return;
  // 标签页在后台时不问：转码是分钟级的，回到前台再问一次不会更晚。
  if (typeof document !== 'undefined' && document.hidden) {
    schedulePoll(src, entry);
    return;
  }
  // 不变量③：刻意不清空 entry.response，横幅整段转码期间稳定显示「正在准备…」。
  void fetchProxy(src, entry, false);
}

function fetchProxy(src: string, entry: ProxyEntry, force: boolean): Promise<void> {
  entry.force = force;
  const query = `src=${encodeURIComponent(src)}${force ? '&force=1' : ''}`;
  const controller = new AbortController();
  entry.controller = controller;
  entry.promise = fetch(`${previewProxyEndpoint()}?${query}`, { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(await responseError(response));
      entry.response = await response.json() as PreviewProxyResponse;
    })
    .catch((error) => {
      if (controller.signal.aborted) return;
      // 轮询途中的网络抖动不改状态：把「正在转码」翻成 failed 会让横幅消失，还会
      // 诱发一次没必要的 force 重排队。首次请求没有可保留的状态，照旧记 failed。
      if (entry.response?.proxy.status === 'pending') return;
      entry.response = failedResponse(src, error);
    })
    .finally(() => {
      if (entry.controller === controller) entry.controller = null;
      entry.promise = null;
      schedulePoll(src, entry);
      notify(entry);
    });
  return entry.promise;
}

async function loadProxy(src: string, force: boolean, entry: ProxyEntry): Promise<void> {
  if (entry.promise) {
    await entry.promise;
    if (force && !entry.force && forceShouldRefetch(entry)) await loadProxy(src, true, entry);
    return;
  }
  if (entry.response && !(force && forceShouldRefetch(entry))) return;
  clearPoll(entry);
  entry.pollDelayMs = POLL_INITIAL_MS;
  entry.response = null;
  notify(entry);
  await fetchProxy(src, entry, force);
}

export function requestPreviewProxy(src: string, force = false): Promise<void> {
  if (!isPreviewProxyEligible(src)) return Promise.resolve();
  return loadProxy(src, force, proxyEntry(src));
}

export function reportPreviewPlaybackFailure(src: string, error = 'preview media failed to play'): void {
  if (!isPreviewProxyEligible(src)) return;
  const entry = proxyEntry(src);
  if (entry.response?.proxy.status !== 'ready') {
    // 只有「还没问过」值得再问一次（不变量②）：pending 由轮询接管，
    // not-needed / failed 重问只会拿回同一个答案，还要让横幅闪一下。
    if (!entry.response) void requestPreviewProxy(src, true);
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
  for (const src of sources) {
    const entry = proxyEntry(src);
    entry.listeners.add(listener);
    // 上一批订阅者全退订时轮询已停表，缓存里却可能留着一条 pending：新订阅者
    // 接手时必须把它重新排上，否则这条素材要等到刷新页面才会切到 ready。
    if (!entry.promise && entry.pollTimer === null) schedulePoll(src, entry);
  }
  return () => {
    for (const src of sources) {
      const entry = proxyEntries.get(src);
      if (!entry) continue;
      entry.listeners.delete(listener);
      if (entry.listeners.size) continue;
      // 没人看这个状态了，定时器必须停：否则每次挂载都留下一条永不回收的轮询。
      clearPoll(entry);
      if (entry.promise) {
        entry.controller?.abort();
        if (proxyEntries.get(src) === entry) proxyEntries.delete(src);
      }
    }
  };
}

/** 订阅一批源的副本状态；useProxySources 与 previewMedia.verify.ts 共用这一份。 */
export function subscribeProxyState(sources: readonly string[], listener: () => void): () => void {
  return subscribe(sources, listener);
}

/** 读单条源当前的副本状态（同 hooks 内部用的 stateFor）。 */
export function previewProxyStateFor(
  src: string | undefined,
  autoRequest = shouldAutoRequestPreviewProxy(),
): PreviewProxyState {
  return stateFor(src, autoRequest);
}

/**
 * 不变量①的落点：副本请求 effect 的 key 只由 sources 的**内容**决定。
 * 抽成具名函数是为了让 previewMedia.verify.ts 能直接钉住「同内容不同身份的两个
 * 数组给出同一个 key」，而不必去渲染 React。
 */
export function proxySourcesKey(sources: readonly string[]): string {
  return sources.join('\n');
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
  // 不变量①：按 sources **内容**键控而不是数组身份。上游派生 sources 的 memo 依赖
  // 的是每次父级渲染都换身份的对象（activeEditorState(doc) 就是其一），按身份键控
  // 会让「流畅」档每渲染一次就重新请求一遍副本。换行符不可能出现在 URL 里，所以
  // 拼成一个 key 再在 effect 内拆回数组是安全的。
  const sourcesKey = proxySourcesKey(sources);
  useEffect(() => {
    const list = sourcesKey ? sourcesKey.split('\n') : [];
    const bump = () => setRevision((value) => value + 1);
    const unsubscribe = subscribe(list, bump);
    // Only fetch proxies when policy/source mode expects them.
    if (shouldAutoRequestPreviewProxy(quality.mode, quality.preview)) {
      for (const src of list) void requestPreviewProxy(src, quality.preview === 'proxy');
    }
    return unsubscribe;
  }, [sourcesKey, quality.mode, quality.preview]);
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
