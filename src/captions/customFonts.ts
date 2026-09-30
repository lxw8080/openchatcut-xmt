// xmt 自定义字幕字体：fork 只 bundle 内置的 9 款 woff2，用户上传的字体靠宿主
// 提供的同源 @font-face 表（/editor/api/subtitle-fonts.css，no-cache）进
// document.fonts。这里幂等注入一个 <link>，任何失败静默降级（上传字体只在
// 有网可用，内置字体永不依赖这条链路）。
import { useEffect, useState } from 'react';

const SUBTITLE_FONTS_CSS_URL = '/editor/api/subtitle-fonts.css';
// 与画布视频节点字体下拉同一个取数口：{ success, data: { builtin, custom: [{ family }] } }
const SUBTITLE_FONTS_LIST_URL = '/editor/api/subtitle-fonts';
const INJECTED_FLAG = 'xmt-subtitle-fonts';

let injected = false;

export function injectXmtSubtitleFonts(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  if (document.getElementById(INJECTED_FLAG)) return;
  const link = document.createElement('link');
  link.id = INJECTED_FLAG;
  link.rel = 'stylesheet';
  link.href = SUBTITLE_FONTS_CSS_URL;
  document.head.appendChild(link);
}

let familiesPromise: Promise<string[]> | null = null;

/** 已上传字体的族名。失败返回空表且不缓存，下次打开检查器再试。 */
export function loadXmtUploadedFontFamilies(): Promise<string[]> {
  if (familiesPromise) return familiesPromise;
  if (typeof fetch === 'undefined') return Promise.resolve([]);
  const promise = fetch(SUBTITLE_FONTS_LIST_URL, { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      const custom = (body as { data?: { custom?: unknown } } | null)?.data?.custom;
      if (!Array.isArray(custom)) throw new Error('subtitle font list unavailable');
      return custom
        .map((entry) => (entry as { family?: unknown })?.family)
        .filter((family): family is string => typeof family === 'string' && family.trim() !== '');
    })
    .catch(() => {
      familiesPromise = null;
      return [];
    });
  familiesPromise = promise;
  return promise;
}

export function useXmtUploadedFontFamilies(): string[] {
  const [families, setFamilies] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void loadXmtUploadedFontFamilies().then((list) => { if (alive) setFamilies(list); });
    return () => { alive = false; };
  }, []);
  return families;
}
