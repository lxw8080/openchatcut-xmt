import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

/** Remotion 4.0.509 probes OPFS even for an explicit arraybuffer capability
 * check. Keep codec checks independent, and bound actual output initialization.
 * This adapter is source-backed; never patch node_modules or shipped hashes. */
export function adaptBrowserExportStorage(code: string): string {
  const replaceOnce = (before: string, after: string) => {
    if (code.split(before).length !== 2) throw new Error(`web-renderer storage adapter drift: ${before}`);
    code = code.replace(before, after);
  };
  replaceOnce('const canUseWebFs = await canUseWebFsWriter();',
    'const canUseWebFs = options.outputTarget === "arraybuffer" ? false : await canUseWebFsWriter();');
  for (const [name, next] of [
    ['canUseWebFsWriter', '// src/check-webgl-support.ts'],
    ['cleanupStaleOpfsFiles', 'var createWebFsTarget ='],
    ['createWebFsTarget', '// src/render-media-on-web.tsx'],
  ]) {
    const start = `var ${name} = async () => {`;
    replaceOnce(start, `var ${name} = () => withBrowserOutputStorage(async () => {`);
    // Restrict the closing anchor to the function just replaced.
    const offset = code.indexOf(`var ${name} =`);
    const end = code.indexOf(next, offset);
    if (end < 0) throw new Error(`web-renderer storage adapter missing end: ${name}`);
    const block = code.slice(offset, end);
    if (!block.trimEnd().endsWith('};')) throw new Error(`web-renderer storage adapter invalid end: ${name}`);
    const closing = offset + block.lastIndexOf('};');
    code = code.slice(0, closing) + '});' + code.slice(closing + 2);
  }
  const helper = fileURLToPath(new URL('../src/export/browserExportProbe.ts', import.meta.url));
  return `import { withBrowserOutputStorage } from ${JSON.stringify(helper)};\n${code}`;
}

export function xmtBrowserExportStorage(): Plugin {
  return {
    name: 'xmt-browser-export-storage', enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/@remotion/web-renderer/dist/esm/index.mjs')) return null;
      return { code: adaptBrowserExportStorage(code), map: null };
    },
  };
}
