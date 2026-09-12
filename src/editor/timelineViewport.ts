/** Pure viewport helpers for CapCut-like timeline navigation. */

export const FOLLOW_EDGE_MARGIN_PX = 48;

/** scrollLeft that places `frame` at the horizontal center of the viewport. */
export function scrollLeftToCenterFrame(
  frame: number,
  headerWidth: number,
  pixelsPerFrame: number,
  viewportWidth: number,
): number {
  if (pixelsPerFrame <= 0 || viewportWidth <= 0) return 0;
  return Math.max(0, headerWidth + frame * pixelsPerFrame - viewportWidth / 2);
}

/**
 * Adjust scrollLeft so the playhead stays inside [margin, viewportWidth - margin].
 * Returns null when no change is needed (or follow should not run).
 * CapCut-style: only push when the needle hits an edge — do not pin to center.
 */
export function followPlayheadScrollLeft(
  scrollLeft: number,
  playheadFrame: number,
  headerWidth: number,
  pixelsPerFrame: number,
  viewportWidth: number,
  margin = FOLLOW_EDGE_MARGIN_PX,
): number | null {
  if (pixelsPerFrame <= 0 || viewportWidth <= 0) return null;
  const contentX = headerWidth + playheadFrame * pixelsPerFrame;
  const viewportX = contentX - scrollLeft;
  const left = margin;
  const right = Math.max(margin + 1, viewportWidth - margin);
  if (viewportX < left) return Math.max(0, contentX - left);
  if (viewportX > right) return Math.max(0, contentX - right);
  return null;
}

/** Whether a wheel event should become horizontal timeline scroll. */
export function wheelShouldHorizontalScroll(event: {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.shiftKey) return true;
  return Math.abs(event.deltaX) > Math.abs(event.deltaY);
}

export function wheelHorizontalDelta(event: {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
}): number {
  if (event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY)) return event.deltaY;
  return event.deltaX !== 0 ? event.deltaX : event.deltaY;
}
