import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { xmtDecoderProbe } from './xmtDecoderProbe';

const appPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: unknown };
if (typeof appPackage.version !== 'string') throw new Error('package.json is missing a valid version');

// xmt fork：浏览器产物是宿主页面（xmt /editor/<job> 外壳）里唯一的交付物，
// 没有随附 server —— 上游的 serverPlugins / keystore / product-assets /
// runtime-profile 全部不参与构建。能力开关因此在构建期恒为 false：宿主
// 环境里没有任何 API key，agent UI 会据此隐藏 key-gated 功能。
const FORK_CONFIGURED_CAPS = {
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

// public/ = 用户运行时目录（media/uploads）。构建输出卫生：Vite 会把整个
// public/ 拷进 dist/，这里在构建结束后剥掉运行时子树，不改变任何 URL 语义。
function excludeUserMediaFromBuild(): Plugin {
  let outDir = resolve(process.cwd(), 'dist');
  return {
    name: 'openchatcut-exclude-user-media',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      for (const rel of ['media/uploads', 'media/asr-models']) {
        const target = resolve(outDir, rel);
        if (existsSync(target)) {
          try {
            rmSync(target, { recursive: true, force: true });
            process.stdout.write(`[vite] pruned runtime media out of build output: ${rel}\n`);
          } catch {
            // 清理失败绝不失败构建：运行时本来也不读 dist/media/。
          }
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => {
  return {
    define: {
      __APP_VERSION__: JSON.stringify(appPackage.version),
      __CONFIGURED_CAPS__: JSON.stringify(FORK_CONFIGURED_CAPS),
    },
    publicDir: 'public',
    plugins: [react(), excludeUserMediaFromBuild(), xmtDecoderProbe()],
    server: {
      port: 5199,
      strictPort: true,
      fs: {
        // Worktree 可能把 node_modules 软链到主检出；保留被 import 的运行时资源
        // （例如 ONNX Runtime WASM）可读。
        allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')],
      },
    },
    build: {
      // 单一 editor.css：宿主外壳只引用一个样式表，懒加载模块的样式合并进入口。
      cssCodeSplit: false,
      // xmt 外壳用裸 URL 加载固定名入口（editor.js），懒加载分片里的
      // `import "./editor.js"` 才不会与外壳 script 标签形成两个模块 URL。
      rolldownOptions: {
        input: { editor: 'src/main.tsx' },
        checks: {
          // 该诊断报告的是宿主 I/O 时序而非正确性问题，在本地与 CI 上都不稳定。
          pluginTimings: false,
        },
        output: {
          // 入口必须是固定名 editor.js：xmt 外壳用裸 URL 引用它（懒加载分片里的
          // `import "./editor.js"` 与 script 标签必须解析为同一个模块 URL）。
          // 分片统一 editor-<hash>.js；CSS 入口随之固定为 editor.css。
          entryFileNames: 'editor.js',
          chunkFileNames: 'editor-[hash].js',
          assetFileNames: 'editor[extname]',
          codeSplitting: {
            groups: [
              { name: 'babel', test: /node_modules[\\/]@babel[\\/]standalone/, priority: 30 },
              { name: 'templates', test: /openchatcut-templates\.json/, priority: 25, includeDependenciesRecursively: false },
              // mediabunny 单独成片：xmt 侧的产物检查要能分清「@remotion/media 的 sink 工厂
              // 带着解码预检钩子」与「mediabunny 本体一个字节没动」（见 config/xmtDecoderProbe.ts）。
              { name: 'mediabunny', test: /node_modules[\\/]mediabunny[\\/]/, priority: 21 },
              { name: 'remotion', test: /node_modules[\\/](?:@remotion|remotion)[\\/]/, priority: 20 },
              { name: 'anthropic', test: /node_modules[\\/]@anthropic-ai[\\/]sdk/, priority: 15 },
              { name: 'react', test: /node_modules[\\/](?:react|react-dom)[\\/]/, priority: 10 },
            ],
          },
        },
      },
    },
  };
});
