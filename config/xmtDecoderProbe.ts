import type { Plugin } from 'vite';

// xmt：Windows 网页导出的逐素材真实解帧预检，接在 @remotion/media 的 sink 工厂上。
//
// 为什么在这里而不在 src/：解码器是 @remotion/media 在 makeSinks() 里替每个素材
// 构造的（`new VideoSampleSink(videoTrack)`），mediabunny 的 hardwareAcceleration
// 偏好只能在那一行传进去；fork 源码碰不到那一行。丢失版 fork 用脚本手术已构建
// 的分片做同一件事（xmt-1/scripts/patch_editor_export_acceleration.mjs 的旧形态），
// 2026-09-12 重建时一度放弃了它——结果是 Windows 上每一次导出都在开跑前死在
// 「编辑器未提供素材预检入口」，再被上游的 server 回退改写成一条 404。
//
// 这份 transform 只动 @remotion/media 的三处锚点，逐字对照丢失版产物里已在
// 线上跑过的注入还原；mediabunny 本体一个字节不碰（它的解码背压曾被误改过，
// xmt 侧的产物检查会拒绝任何注入痕迹）。锚点漂移一律让构建失败——静默跳过
// 看起来是一次健康的构建，实则悄悄丢了 Windows 的整条防线。
//
// 运行时契约（xmt-1/app/static/js/editor-export-acceleration.js）：
//   window.__XMT_EXPORTING__       导出进行中（浏览器渲染主流程置位）
//   window.__XMT_EXPORT_SIGNAL__   本次导出的 AbortSignal
//   window.__XMT_EXPORT_ACCELERATION__.selectDecoder({ source, signal, probe })
//       硬解真实帧 → 软解真实帧 → DecoderProxyRequiredError，返回 mediabunny 的
//       VideoSinkDecoderOptions（{ hardwareAcceleration }）；同一素材只探一次。
//   globalThis.__XMT_EXPORT_OPEN_SOURCE__(src, signal)
//       prepareProject / recoverDecoder 用它逐素材「真的打开一次」：走与正式
//       渲染完全相同的 sink 工厂，探针作为副作用在里面跑完，随后 dispose。
// 三条纪律：只在 Windows + 导出中生效（其余场景传 {}，与上游逐字节相同）；
// 音轨探针只 warn 不否决（视频片段在时间线上一律 volume=0，第五类故障）；
// 探针先问轨道真实起点再取样，不在固定时间点取。

const MEDIA_MODULE = /[\\/]@remotion[\\/]media[\\/]dist[\\/]esm[\\/]index\.mjs$/;

const VIDEO_SINK_ANCHOR = '      const sampleSink = new VideoSampleSink(videoTrack);\n';
const VIDEO_SINK_PATCHED = '      const sampleSink = new VideoSampleSink(videoTrack, await xmtSelectDecoderOptions(src, input, videoTrack));\n';

const AUDIO_SINK_ANCHOR = [
  '      return {',
  '        sampleSink: new AudioSampleSink(audioTrack)',
  '      };',
  '',
].join('\n');
const AUDIO_SINK_PATCHED = [
  '      return {',
  '        sampleSink: new AudioSampleSink(audioTrack),',
  '        // xmt：音频探针要先问这条轨真正从哪儿开始（MP4 音轨不保证从 0 起）。',
  '        xmtFirstTimestamp: () => audioTrack.getFirstTimestamp()',
  '      };',
  '',
].join('\n');

// `// src/get-sink.ts` 这行注释在文件里出现两次（esbuild 把同名模块的注释也带进来），
// 所以锚在 makeSinks 的收尾上：钩子必须紧跟在它之后（要引用 makeSinks 本身）。
const GET_SINK_ANCHOR = '    dispose: () => input.dispose()\n  };\n};\n\n// src/get-sink.ts\n';
const GET_SINK_HEAD = '    dispose: () => input.dispose()\n  };\n};\n\n';

const OPEN_SOURCE_BLOCK = `// ── xmt：Windows 导出逐素材真实解帧预检（config/xmtDecoderProbe.ts 构建期注入）──
async function xmtSelectDecoderOptions(src, input, videoTrack) {
  if (typeof window === "undefined" || !window.__XMT_EXPORTING__ || !/Windows/.test(navigator.userAgent)) return {};
  const runtime = window.__XMT_EXPORT_ACCELERATION__;
  if (!runtime?.selectDecoder) return {};
  return runtime.selectDecoder({
    source: src,
    signal: window.__XMT_EXPORT_SIGNAL__,
    probe: async (candidate) => {
      const probeSink = new VideoSampleSink(videoTrack, candidate);
      const start = await input.getFirstTimestamp([videoTrack]);
      let frames = 0;
      const startedAt = performance.now();
      for await (const sample of probeSink.samples(start, start + 1)) {
        try {
          frames += 1;
        } finally {
          sample.close();
        }
        if (frames >= 16) break;
      }
      if (!frames) throw new Error("真实解帧探针没有产出画面");
      return { frames, elapsedMs: performance.now() - startedAt };
    }
  });
}
async function xmtOpenExportSource(src, signal) {
  const sinks = makeSinks(src, void 0, void 0, { signal });
  try {
    const resolved = await sinks.promise;
    if (typeof resolved === "string") throw new Error(\`素材打开失败：\${resolved}（\${src}）\`);
    const video = await resolved.getVideo();
    if (typeof video === "string") throw new Error(\`素材视频轨打开失败：\${video}（\${src}）\`);
    const audio = await resolved.getAudio(null);
    if (typeof audio === "string") {
      if (audio !== "no-audio-track") {
        console.warn(\`[export] 素材音轨打开失败：\${audio}（\${src}）——视频片段在时间线上是 volume=0，不阻断导出\`);
      }
      return;
    }
    let start = 0;
    try {
      start = await audio.xmtFirstTimestamp();
    } catch {
      start = 0;
    }
    let sample = null;
    try {
      sample = await audio.sampleSink.getSample(start);
    } catch (error) {
      console.warn(\`[export] 音频探针出错（\${src}）\`, error);
    }
    try {
      if (!sample) console.warn(\`[export] 音频探针在 \${start} 处没有产出采样（\${src}）——不阻断导出\`);
    } finally {
      sample?.close();
    }
  } finally {
    sinks.dispose();
  }
}
if (typeof globalThis !== "undefined") globalThis.__XMT_EXPORT_OPEN_SOURCE__ = xmtOpenExportSource;

`;

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) {
    count += 1;
  }
  return count;
}

function replaceExactlyOnce(code: string, anchor: string, replacement: string, what: string): string {
  const occurrences = countOccurrences(code, anchor);
  if (occurrences !== 1) {
    throw new Error(
      `xmtDecoderProbe：@remotion/media 锚点「${what}」命中 ${occurrences} 次（需要恰好 1 次）。`
      + '上游版本变了——对照丢失版注入重新定位锚点，不要放宽匹配。',
    );
  }
  return code.replace(anchor, replacement);
}

export function xmtDecoderProbe(): Plugin {
  let applied = false;
  return {
    name: 'xmt-decoder-probe',
    // 只管 build：dev 的依赖预打包不经过 transform，buildEnd 在 dev 关服时也会跑。
    apply: 'build',
    transform(code, id) {
      if (!MEDIA_MODULE.test(id)) return null;
      let patched = replaceExactlyOnce(code, VIDEO_SINK_ANCHOR, VIDEO_SINK_PATCHED, 'VideoSampleSink 构造');
      patched = replaceExactlyOnce(patched, AUDIO_SINK_ANCHOR, AUDIO_SINK_PATCHED, 'AudioSampleSink 返回');
      patched = replaceExactlyOnce(patched, GET_SINK_ANCHOR, GET_SINK_HEAD + OPEN_SOURCE_BLOCK + '// src/get-sink.ts\n', 'makeSinks 收尾');
      applied = true;
      return { code: patched, map: null };
    },
    buildEnd(error) {
      // transform 只对进入模块图的文件调用：@remotion/media 若被裁掉，钩子就
      // 悄悄消失了。这里把「没打上」也变成构建失败——但构建已经因为别的原因
      // 失败时让位，否则这句会顶替掉真正的错误（锚点不匹配时正是如此）。
      if (error) return;
      if (!applied) this.error('xmtDecoderProbe：本次构建没有遇到 @remotion/media/dist/esm/index.mjs，Windows 解码预检钩子未注入。');
    },
  };
}
