import type { Plugin } from 'vite';

/** Remotion keeps a live decoder in every cached keyframe bank. A byte budget
 * alone leaves many idle hardware decoders alive across cuts on phones.
 * Own eviction inside the existing manager, and only for XMT browser exports.
 * Preview caches and Mediabunny are unchanged. Anchors are for 4.0.509. */
export function adaptMediaExportResources(code: string): string {
  const replace = (before: string, after: string) => {
    if (code.split(before).length !== 2) throw new Error(`media export resource adapter drift: ${before}`);
    code = code.replace(before, after);
  };
  replace('var makeMediaCache = () => {', 'var makeMediaCache = (maxDecoderBanks = Infinity) => {');
  replace('var makeKeyframeManager = ({\n  getTotalCacheStats\n}) => {',
    'var makeKeyframeManager = ({\n  getTotalCacheStats, maxDecoderBanks = Infinity\n}) => {');
  replace('const keyframeManagerInstance = makeKeyframeManager({\n    getTotalCacheStats: getCacheStats\n  });',
    'const keyframeManagerInstance = makeKeyframeManager({\n    getTotalCacheStats: getCacheStats, maxDecoderBanks\n  });');
  replace('const resource = makeMediaCache();',
    'const resource = makeMediaCache(typeof window !== "undefined" && window.__XMT_EXPORTING__ ? (window.__XMT_EXPORT_DECODER_BANK_LIMIT__ ?? 2) : Infinity);');
  replace('sampleIterator.return();\n    frameTimestamps.length = 0;\n    return { framesDeleted };',
    'const released = sampleIterator.return();\n    frameTimestamps.length = 0;\n    return { framesDeleted, released };');
  replace('const { framesDeleted } = bank.prepareForDeletion(logLevel, "deleted oldest keyframe bank to stay under max cache size");',
    'const { framesDeleted, released } = bank.prepareForDeletion(logLevel, "deleted oldest keyframe bank to stay under max cache size");');
  replace('return { finish: false };\n  };\n  const ensureToStayUnderMaxCacheSize',
    'return { finish: false, released };\n  };\n  const ensureToStayUnderMaxCacheSize');
  replace('if (!existingBank) {\n      Internals14.Log.trace', `if (!existingBank) {
      // A cloned output frame no longer needs its decoder. Reclaim the least
      // recently used idle bank before opening a new one. Await the iterator's
      // cancellation receipt; native cleanup is owned by its decoder pump.
      while (getTheKeyframeBankMostInThePast().numberOfBanks >= maxDecoderBanks) {
        const eviction = deleteOldestKeyframeBank(logLevel);
        if (eviction.finish) break; // Busy banks must never be destroyed.
        await eviction.released;
      }
      Internals14.Log.trace`);
  // Upstream discards both the failing source time and the underlying exception.
  // Preserve these serializable fields so recovery can probe that exact seek.
  replace('return { type: "cannot-decode", durationInSeconds: mediaDurationInSeconds };\n  }\n};\nvar extractFrame =',
    'return { type: "cannot-decode", durationInSeconds: mediaDurationInSeconds, xmtDecodeTimeSeconds: timeInSeconds, xmtDecodeError: String(err?.name ? `${err.name}: ${err.message}` : err).slice(0, 600) };\n  }\n};\nvar extractFrame =');
  replace('type: "cannot-decode",\n        durationInSeconds: video.durationInSeconds',
    'type: "cannot-decode",\n        durationInSeconds: video.durationInSeconds, xmtDecodeTimeSeconds: video.xmtDecodeTimeSeconds, xmtDecodeError: video.xmtDecodeError');
  replace('new Error(`Cannot render video "${src}": The video could not be decoded by the browser.`)',
    'Object.assign(new Error(`Cannot render video "${src}": The video could not be decoded by the browser.${Number.isFinite(result.xmtDecodeTimeSeconds) ? ` Source time: ${result.xmtDecodeTimeSeconds}s.` : ""}${result.xmtDecodeError ? ` ${result.xmtDecodeError}` : ""}`), { xmtDecodeTimeSeconds: result.xmtDecodeTimeSeconds })');
  return code;
}

export function xmtMediaExportResources(): Plugin {
  return {
    name: 'xmt-media-export-resources', enforce: 'pre', apply: 'build',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/@remotion/media/dist/esm/index.mjs')) return null;
      return { code: adaptMediaExportResources(code), map: null };
    },
  };
}
