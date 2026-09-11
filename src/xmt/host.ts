// xmt 宿主契约（app/templates/editor/index.html 在 Vite 入口之前注入）。
// 工程读写、候选替换、素材搜索全部走本站 API；编辑器永远跑在 /editor/<job>
// 外壳里，没有独立后端。

export interface XmtEditorHost {
  jobId: number | string;
  projectName: string | null;
  csrfToken: string;
  projectUrl: string;
  reviewCommentsUrl: string;
  projectMetaUrl: string;
  projectLibraryUrl: string;
  candidatesUrl: (segmentId: string) => string;
  searchUrl: string;
  libraryUrl: string;
  previewProxyEndpoint: string;
}

interface XmtWindow {
  __XMT_EDITOR__?: Partial<XmtEditorHost>;
}

function normalize(value: Partial<XmtEditorHost> | undefined): XmtEditorHost | null {
  if (!value || typeof window === 'undefined') return null;
  if (typeof value.projectUrl !== 'string' || typeof value.csrfToken !== 'string') return null;
  return {
    jobId: value.jobId ?? '',
    projectName: typeof value.projectName === 'string' ? value.projectName : null,
    csrfToken: value.csrfToken,
    projectUrl: value.projectUrl,
    reviewCommentsUrl: value.reviewCommentsUrl ?? '',
    projectMetaUrl: value.projectMetaUrl ?? '',
    projectLibraryUrl: value.projectLibraryUrl ?? '',
    candidatesUrl: typeof value.candidatesUrl === 'function' ? value.candidatesUrl : () => '',
    searchUrl: value.searchUrl ?? '',
    libraryUrl: value.libraryUrl ?? '',
    previewProxyEndpoint: value.previewProxyEndpoint ?? '',
  };
}

export function xmtHost(): XmtEditorHost | null {
  return normalize((window as unknown as XmtWindow).__XMT_EDITOR__);
}

export function requireXmtHost(): XmtEditorHost {
  const host = xmtHost();
  if (!host) {
    throw new Error('缺少宿主桥接（window.__XMT_EDITOR__），无法加载编辑器。');
  }
  return host;
}
