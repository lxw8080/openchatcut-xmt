import type { ProjectDoc, TimelineItem } from './types';
/** Shared by the editor and XMT's generated gallery; canvas-relative transforms. */
export type Layout = { x: number; y: number; scale: number };
export type Bounds = { x: number; y: number; w: number; h: number };
export const SYSTEM_LAYOUT: Layout = { x: 0, y: 0, scale: 1 };
export const FULL_BOUNDS: Bounds = { x: 0, y: 0, w: 1, h: 1 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export function normalizeLayout(value: Partial<Layout> = {}): Layout {
  const number = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return { x: clamp(number(value.x, 0), -400, 400), y: clamp(number(value.y, 0), -400, 400), scale: clamp(number(value.scale, 1), .1, 8) };
}
export function layoutBounds(bounds: Bounds, layout: Layout): Bounds {
  return { x: .5 + (bounds.x - .5) * layout.scale + layout.x / 100,
    y: .5 + (bounds.y - .5) * layout.scale + layout.y / 100, w: bounds.w * layout.scale, h: bounds.h * layout.scale };
}
export function scaleAt(layout: Layout, scale: number, anchor: { x: number; y: number }): Layout {
  const next = normalizeLayout({ ...layout, scale });
  return normalizeLayout({ x: layout.x + (layout.scale - next.scale) * (anchor.x - .5) * 100,
    y: layout.y + (layout.scale - next.scale) * (anchor.y - .5) * 100, scale: next.scale });
}
export function cornerScale(layout: Layout, bounds: Bounds, corner: number, point: { x: number; y: number }): Layout {
  const corners = [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h }, { x: bounds.x, y: bounds.y + bounds.h }];
  const anchor = corners[(corner + 2) % 4], target = corners[corner];
  const origin = layoutBounds({ ...anchor, w: 0, h: 0 }, layout);
  const dx = target.x - anchor.x, dy = target.y - anchor.y;
  const scale = ((point.x - origin.x) * dx + (point.y - origin.y) * dy) / Math.max(1e-9, dx * dx + dy * dy);
  return scaleAt(layout, scale, anchor);
}
export function layoutWarnings(bounds: Bounds, layout: Layout, safeBottom = .13): string[] {
  const b = layoutBounds(bounds, layout), notes = [];
  if (b.x < -.0001 || b.y < -.0001 || b.x + b.w > 1.0001 || b.y + b.h > 1.0001) notes.push('部分内容超出画面');
  if (b.y + b.h > 1 - safeBottom) notes.push('内容进入字幕安全区，请回放检查');
  return notes;
}
export function measureContent(root: HTMLElement): Bounds | null {
  const area = root.getBoundingClientRect();
  if (!area.width || !area.height) return null;
  const rectangles: DOMRect[] = [];
  const transparent = (color: string) => color === 'transparent' || /rgba\([^)]*,\s*0\s*\)/.test(color);
  const visit = (node: Element) => {
    const style = getComputedStyle(node);
    if (style.display === 'none' || Number(style.opacity) === 0) return;
    const rect = node.getBoundingClientRect();
    const painted = ['IMG', 'SVG', 'CANVAS', 'VIDEO'].includes(node.tagName) || !transparent(style.backgroundColor)
      || style.backgroundImage !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].some(side =>
        parseFloat(style.getPropertyValue('border-' + side.toLowerCase() + '-width')) > 0 && !transparent(style.getPropertyValue('border-' + side.toLowerCase() + '-color')));
    if (painted && rect.width && rect.height) rectangles.push(rect);
    if (node.tagName === 'SVG') return;
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        const range = document.createRange(); range.selectNodeContents(child);
        rectangles.push(...Array.from(range.getClientRects()));
      } else if (child instanceof Element) visit(child);
    }
  };
  for (const child of root.children) visit(child);
  if (!rectangles.length) return null;
  const left = Math.max(area.left, Math.min(...rectangles.map(r => r.left)));
  const top = Math.max(area.top, Math.min(...rectangles.map(r => r.top)));
  const right = Math.min(area.right, Math.max(...rectangles.map(r => r.right)));
  const bottom = Math.min(area.bottom, Math.max(...rectangles.map(r => r.bottom)));
  if (right <= left || bottom <= top) return null;
  return { x: (left - area.left) / area.width, y: (top - area.top) / area.height, w: (right - left) / area.width, h: (bottom - top) / area.height };
}
const boundsById = new Map<string, Bounds>();
export const getMgBounds = (id: string): Bounds => boundsById.get(id) ?? FULL_BOUNDS;
const templateBounds = new Map<string, Bounds>();
export function registerTemplateBounds(key: string, aspect: string, box: number[]) {
  if (box?.length === 4) templateBounds.set(key + '/' + aspect, {x:box[0],y:box[1],w:box[2]-box[0],h:box[3]-box[1]});
}
export function getItemMgBounds(item: TimelineItem, width: number, height: number): Bounds {
  const measured = boundsById.get(item.id);
  if (measured) return measured;
  if (item.kind === 'sequence' && item.sequenceFit === 'native') {
    const w = (item.width ?? width)/width, h = (item.height ?? height)/height;
    return {x:(1-w)/2,y:(1-h)/2,w,h};
  }
  return templateBounds.get(item.templateId + '/' + (height > width ? 'portrait' : 'landscape')) ?? FULL_BOUNDS;
}
export function publishMgBounds(id: string, bounds: Bounds | null) {
  if (!bounds) return;
  const before = boundsById.get(id);
  if (before && JSON.stringify(before) === JSON.stringify(bounds)) return;
  boundsById.set(id, bounds);
  window.dispatchEvent(new Event('xmt-mg-bounds'));
}
export function mgLayoutKey(item: {kind: string; templateId?: string; props?: Record<string, unknown> }): string | null {
  const meta = item.props?._xmt as Record<string, unknown> | undefined;
  if (typeof meta?.layoutTemplateKey === 'string') return meta.layoutTemplateKey;
  return item.kind === 'motion-graphic' && item.templateId?.startsWith('xmt-') && item.templateId !== 'xmt-composition-node-v1' ? item.templateId : null;
}
export function mgLayoutEnabled(item: {kind: string; templateId?: string; props?: Record<string, unknown> }): boolean {
  const meta = item.props?._xmt as Record<string, unknown> | undefined;
  return !!mgLayoutKey(item) || (item.kind === 'sequence' && !!meta?.composition);
}

/** Old projects gain selection metadata only; transforms are never reapplied. */
export function annotateLayoutKeys(doc: ProjectDoc): ProjectDoc {
  const specs = new Map<string, Record<string, unknown>>();
  for (const t of doc.timelines) for (const i of t.items) {
    const m = i.props?._xmt as Record<string, unknown> | undefined;
    const spec = m?.composition as Record<string, unknown> | undefined;
    if (typeof spec?.id === 'string') specs.set(spec.id, spec);
  }
  return { ...doc, timelines: doc.timelines.map(t => ({ ...t, items: t.items.map(i => {
    const m = i.props?._xmt as Record<string, unknown> | undefined;
    if (i.kind !== 'sequence' || !m?.elementId || m.elementId !== m.partId) return i;
    const elements = specs.get(String(m.compositionId))?.elements as Array<Record<string, unknown>> | undefined;
    const element = elements?.find(e => e.id === m.elementId);
    if (!element?.component) return i;
    const rect = element.rect as Bounds;
    return { ...i, props: { ...i.props, _xmt: { ...m, layoutTemplateKey: 'xmt-composition-node-v1#' + element.component,
      layoutSystemTransform: m.layoutSystemTransform ?? { x: (rect.x + rect.w/2 - .5)*100, y: (rect.y + rect.h/2 - .5)*100, scale: 1 } } } };
  }) })) };
}
