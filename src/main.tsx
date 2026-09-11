import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { TranscriptWindowRoot } from './media/TranscriptWindowRoot';
import { loadProjectFonts } from './fonts/googleFonts';
import { hydratePlugins } from './plugins/store';
import { initSkins } from './skins';

// Inject skin variables and apply persistent skin before rendering to avoid flashing the default color in the first frame.
initSkins();

// Register local font faces; TimelineComposition loads used Google faces on demand.
loadProjectFonts();

// The installed content plugin is registered in the runtime registry (visible to resource library/agent). Timeline rendering does not wait for it —
// The applied content has been snapshotted into state, see docs/plugin-system-design.md.
void hydratePlugins().catch(() => {});

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
const isTranscriptWindow = new URLSearchParams(window.location.search).has('transcript-window');
// 幂等挂载守卫：外壳一旦带上查询串（历史 bug：editor.js?v=<mtime>），壳页加载的
// 入口与懒加载分片里的 `import "./editor.js"` 会成为两个模块 URL，入口被求值两次、
// 第二个 createRoot 把已挂载的编辑器整个抹掉。守卫让第二次求值直接放弃。
const mountFlagWindow = window as typeof window & { __XMT_EDITOR_MOUNTED__?: boolean };
if (!mountFlagWindow.__XMT_EDITOR_MOUNTED__) {
  mountFlagWindow.__XMT_EDITOR_MOUNTED__ = true;
  createRoot(root).render(
    <StrictMode>
      {isTranscriptWindow ? <TranscriptWindowRoot /> : <App />}
    </StrictMode>,
  );
}
