import { Suspense, useEffect, useState } from 'react';
import Editor from './Editor';
import { useT } from './i18n/locale';
import { theme } from './theme';
import type { ProjectDoc } from './editor/types';
import { xmtHost } from './xmt/host';
import { fetchXmtProject, renameXmtProject } from './xmt/projectBridge';

// xmt fork：没有自有 server/agent 后端，编辑器永远跑在 /editor/<job> 外壳里，
// 工程从宿主契约加载、自动保存回宿主 API。上游的工程列表/Dashboard 已随 src/app 裁掉。
if (typeof console !== 'undefined') {
  console.info('xmt 构建未启用 Agent 运行时。');
}

function AppSplash({ text }: { text: string }) {
  return (
    <div style={{
      height: '100vh', display: 'grid', placeItems: 'center', background: theme.bg,
      color: theme.textDim, fontFamily: 'Geist, system-ui, sans-serif', fontSize: 13,
    }}>
      {text}
    </div>
  );
}

function AppError({ title, detail }: { title: string; detail?: string }) {
  return (
    <div style={{
      height: '100vh', display: 'grid', placeItems: 'center', background: theme.bg,
      color: theme.text, fontFamily: 'Geist, system-ui, sans-serif', fontSize: 13,
    }}>
      <div style={{ maxWidth: 480, textAlign: 'center', lineHeight: 1.7 }}>
        <div style={{ fontSize: 15, marginBottom: 8 }}>{title}</div>
        {detail && <div style={{ color: theme.textDim, fontSize: 12 }}>{detail}</div>}
      </div>
    </div>
  );
}

function isProjectDoc(value: unknown): value is ProjectDoc {
  return !!value && typeof value === 'object'
    && Array.isArray((value as ProjectDoc).timelines)
    && (value as ProjectDoc).timelines.length > 0
    && typeof (value as ProjectDoc).activeTimelineId === 'string';
}

type BootState =
  | { phase: 'loading' }
  | { phase: 'ready'; doc: ProjectDoc }
  | { phase: 'error'; message: string };

export default function App() {
  const t = useT();
  // 宿主契约由外壳在 Vite 入口之前注入、此后不再变，所以挂载时取一次固定住。
  // `xmtHost()` 每次调用都 normalize 出一个**新对象**，直接当 effect 依赖会自激：
  // setBoot 触发重渲染 → host 身份变化 → effect 重跑 → 再拉一次工程文档，周期就是
  // 一次网络往返。线上实测每个编辑器标签页对 GET .../project 打到每分钟约 1000 次
  // （22 小时约 41 万次），与预览档位无关。
  const [host] = useState(() => xmtHost());
  const [boot, setBoot] = useState<BootState>({ phase: 'loading' });

  useEffect(() => {
    if (!host) return;
    let alive = true;
    fetchXmtProject()
      .then((doc) => {
        if (!alive) return;
        if (!isProjectDoc(doc)) {
          setBoot({ phase: 'error', message: t('工程文档格式不兼容，无法加载。') });
          return;
        }
        setBoot({ phase: 'ready', doc });
      })
      .catch((error: unknown) => {
        if (alive) setBoot({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => { alive = false; };
  }, [host, t]);

  if (!host) {
    return <AppError title={t('编辑器加载失败')} detail="缺少宿主桥接（window.__XMT_EDITOR__），无法加载编辑器。" />;
  }
  if (boot.phase === 'loading') return <AppSplash text={t('加载工程…')} />;
  if (boot.phase === 'error') return <AppError title={t('编辑器加载失败')} detail={boot.message} />;
  return (
    <Suspense fallback={<AppSplash text={t('加载编辑器…')} />}>
      <Editor
        initial={boot.doc}
        project={{
          id: String(host.jobId),
          name: host.projectName || `工程 ${host.jobId}`,
          updatedAt: Date.now(),
        }}
        onHome={() => {
          // 宿主契约 libraryUrl 指向 /video-edit/projects（见 editor/index.html）。
          // 离开前 flushBeforeLeave 已由 handleHome 跑过；此处只做导航。
          const target = host.libraryUrl || '/video-edit/projects';
          window.location.assign(target);
        }}
        onRename={(name) => {
          void renameXmtProject(name).catch(() => undefined);
        }}
      />
    </Suspense>
  );
}
