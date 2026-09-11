// xmt 自定义字幕字体：fork 只 bundle 内置的 9 款 woff2，用户上传的字体靠宿主
// 提供的同源 @font-face 表（/editor/api/subtitle-fonts.css，no-cache）进
// document.fonts。这里幂等注入一个 <link>，任何失败静默降级（上传字体只在
// 有网可用，内置字体永不依赖这条链路）。
const SUBTITLE_FONTS_CSS_URL = '/editor/api/subtitle-fonts.css';
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
