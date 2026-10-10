import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { measureContent, publishMgBounds } from './mgLayoutGeometry';

/** A paused, untransformed DOM copy; never part of the exported composition. */
export function StaticMgMeasure({ id, width, height, children }: { id: string; width: number; height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => publishMgBounds(id, measureContent(root));
    const resize = new ResizeObserver(measure);
    const changes = new MutationObserver(measure);
    resize.observe(root); changes.observe(root, { childList: true, subtree: true, attributes: true });
    root.addEventListener('load', measure, true);
    measure();
    document.fonts.ready.then(() => { if (root.isConnected) measure(); });
    return () => { resize.disconnect(); changes.disconnect(); root.removeEventListener('load', measure, true); };
  }, [id, width, height]);
  return createPortal(<div ref={ref} aria-hidden="true" style={{ position: 'fixed', left: -100000, top: 0,
    width, height, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }}>{children}</div>, document.body);
}
