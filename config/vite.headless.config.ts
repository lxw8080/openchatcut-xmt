import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// xmt fork：服务端无头编辑 worker（src/headless/worker.ts）。Node 24 单文件 ESM，
// 产物由 xmt 仓 scripts/build_editor_worker.sh 拷进 editor_worker/dist/。
// 与浏览器构建同一套能力开关（全部 false）；依赖整体打包，只有原生模块留在外部。
const appPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: unknown };

function commit(): string {
  try {
    const sha = execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

const CAPS = {
  image: false,
  voice: false,
  video: false,
  music: false,
  sound: false,
  stock: false,
  transcription: false,
  sandbox: false,
  web: false,
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appPackage.version),
    __CONFIGURED_CAPS__: JSON.stringify(CAPS),
    __HEADLESS_BUILD__: JSON.stringify({ commit: commit(), builtAt: new Date().toISOString() }),
  },
  publicDir: false,
  ssr: {
    noExternal: true,
    external: ['onnxruntime-node', 'sqlite-vec', 'ffmpeg-static', 'better-sqlite3'],
  },
  build: {
    ssr: 'src/headless/worker.ts',
    outDir: 'dist-headless',
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      output: { format: 'esm', entryFileNames: 'editor-worker.mjs', codeSplitting: false },
    },
  },
});
