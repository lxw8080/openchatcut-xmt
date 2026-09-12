// xmt 工程桥：编辑器的全部持久化与检索都直达宿主 API。
// 非 2xx 一律 throw —— 上游按「已保存」处理 2xx，静默吞错等于丢稿。
import type { ProjectDoc } from '../editor/types';
import { requireXmtHost, xmtHost } from './host';

/** 替换面板候选（GET candidatesUrl(segment_id) 的 data.candidates[]）。 */
export interface XmtCandidate {
  video_segment_id: number | null;
  asset_id: number | null;
  start_ms: number | null;
  end_ms: number | null;
  duration_ms: number | null;
  event_summary: string | null;
  score: number | null;
  rank: number | null;
  stream_url: string | null;
  thumb_url: string | null;
  asset_title: string | null;
  asset_duration_ms: number | null;
  asset_width: number | null;
  asset_height: number | null;
}

/** 项目素材库分页行（GET projectLibraryUrl）。 */
export interface XmtLibraryAsset {
  id: number;
  title: string;
  source_filename: string;
  sport: string | null;
  status: string;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  stream_url: string;
  thumb_url: string | null;
  already_imported: boolean;
}

interface XmtEnvelope<T> {
  success?: boolean;
  error?: string;
  message?: string;
  data?: T;
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as XmtEnvelope<unknown> | null;
  return body?.message ?? body?.error ?? '';
}

// ── 工程读写 ───────────────────────────────────────────────────────────────
// revision 落进全局：壳页的 editor-save-revision.js 用它注入乐观并发基线，
// editor-local-render.js 的 __XMT_FLUSH_PROJECT__ 靠它冻结工程。

export async function fetchXmtProject(): Promise<ProjectDoc> {
  const host = requireXmtHost();
  const response = await fetch(host.projectUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`工程加载失败（HTTP ${response.status}）。`);
  }
  const body = await response.json() as XmtEnvelope<{ project?: ProjectDoc; revision?: number }>;
  const data = body.data;
  if (!data || typeof data.project !== 'object' || data.project === null) {
    throw new Error('工程响应缺少 data.project 字段。');
  }
  if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>).__XMT_LATEST_PROJECT__ = data.project;
    (globalThis as Record<string, unknown>).__XMT_LATEST_PROJECT_REVISION__ = Number(data.revision) || 0;
  }
  return data.project;
}

export async function saveXmtProject(doc: ProjectDoc): Promise<number> {
  const host = requireXmtHost();
  if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>).__XMT_LATEST_PROJECT__ = doc;
  }
  const response = await fetch(host.projectUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': host.csrfToken },
    body: JSON.stringify({ project: doc }),
  });
  const body = await response.json().catch(() => ({})) as XmtEnvelope<{ revision?: number }>;
  if (!response.ok) {
    const detail = body?.message ?? body?.error;
    throw new Error(detail ? String(detail) : `工程保存失败（HTTP ${response.status}）。`);
  }
  const revision = Number(body.data?.revision) || 0;
  if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>).__XMT_LATEST_PROJECT_REVISION__ = revision;
  }
  return revision;
}

/** 本地渲染冻结入口：把最近一次保存的工程强制落库，返回可用 revision。 */
export async function flushXmtProject(): Promise<number> {
  const latest = (globalThis as Record<string, unknown> | undefined)?.__XMT_LATEST_PROJECT__ as ProjectDoc | undefined;
  if (!latest) {
    throw new Error('工程尚未加载完成。');
  }
  return saveXmtProject(latest);
}

// 宿主侧 editor-local-render.js 的取数口：拉起本地渲染器后用它冻结当前工程。
if (typeof globalThis !== 'undefined') {
  const globals = globalThis as Record<string, unknown>;
  globals.__XMT_FLUSH_PROJECT__ = (): Promise<number> => flushXmtProject();
}

export async function renameXmtProject(title: string): Promise<void> {
  const host = requireXmtHost();
  const response = await fetch(host.projectMetaUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': host.csrfToken },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    const detail = await errorMessage(response);
    throw new Error(detail ? String(detail) : `工程重命名失败（HTTP ${response.status}）。`);
  }
}

// ── 审片评论 ───────────────────────────────────────────────────────────────

export async function fetchXmtReviewComments(): Promise<unknown[]> {
  const host = requireXmtHost();
  const response = await fetch(host.reviewCommentsUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`评论加载失败（HTTP ${response.status}）。`);
  }
  const body = await response.json() as XmtEnvelope<{ comments?: unknown[] }>;
  if (!body.data || !Array.isArray(body.data.comments)) {
    throw new Error('评论响应缺少 data.comments 字段。');
  }
  return body.data.comments;
}

export async function saveXmtReviewComments(comments: unknown[]): Promise<void> {
  const host = requireXmtHost();
  const response = await fetch(host.reviewCommentsUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': host.csrfToken },
    body: JSON.stringify({ comments }),
  });
  if (!response.ok) {
    const detail = await errorMessage(response);
    throw new Error(detail ? String(detail) : `评论保存失败（HTTP ${response.status}）。`);
  }
}

// ── 候选替换 / 素材检索 ────────────────────────────────────────────────────

export async function fetchXmtCandidates(segmentId: string): Promise<XmtCandidate[]> {
  const host = requireXmtHost();
  const url = host.candidatesUrl(segmentId);
  if (!url) return [];
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`候选素材加载失败（HTTP ${response.status}）。`);
  }
  const body = await response.json() as XmtEnvelope<{ candidates?: XmtCandidate[] }>;
  return body.data?.candidates ?? [];
}

export async function searchXmtSegments(query: string): Promise<XmtCandidate[]> {
  const host = requireXmtHost();
  const response = await fetch(host.searchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': host.csrfToken },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(`素材搜索失败（HTTP ${response.status}）。`);
  }
  const body = await response.json() as XmtEnvelope<{ candidates?: XmtCandidate[] }>;
  return body.data?.candidates ?? [];
}

// ── 项目素材库 ─────────────────────────────────────────────────────────────

export async function fetchXmtLibraryAssets(params: {
  page?: number;
  perPage?: number;
  query?: string;
}): Promise<{ items: XmtLibraryAsset[]; page: number; pages: number; total: number }> {
  const host = requireXmtHost();
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.perPage) search.set('per_page', String(params.perPage));
  if (params.query) search.set('q', params.query);
  const response = await fetch(`${host.projectLibraryUrl}?${search.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`项目素材库加载失败（HTTP ${response.status}）。`);
  }
  const body = await response.json() as XmtEnvelope<{ items?: XmtLibraryAsset[]; page?: number; pages?: number; total?: number }>;
  return {
    items: body.data?.items ?? [],
    page: body.data?.page ?? 1,
    pages: body.data?.pages ?? 1,
    total: body.data?.total ?? 0,
  };
}

/** 编辑器外（脚本/测试）取宿主配置的便捷口。 */
export { xmtHost };
