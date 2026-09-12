export interface TimelineZoomLimits {
  min: number;
  max: number;
}

export const clampTimelineZoom = (
  zoom: number,
  limits: TimelineZoomLimits,
): number => Math.min(limits.max, Math.max(limits.min, zoom));

export const scaleTimelineZoom = (
  zoom: number,
  factor: number,
  limits: TimelineZoomLimits,
): number => clampTimelineZoom(zoom * factor, limits);

export function fitTimelineZoom(
  viewportWidth: number,
  headerWidth: number,
  padding: number,
  totalFrames: number,
  basePixelsPerFrame: number,
  limits: TimelineZoomLimits,
): number | null {
  const usable = viewportWidth - headerWidth - padding;
  if (usable <= 0 || totalFrames <= 0 || basePixelsPerFrame <= 0) return null;
  return clampTimelineZoom(usable / (totalFrames * basePixelsPerFrame), limits);
}

export function anchoredTimelineScrollLeft(
  currentScrollLeft: number,
  pointerViewportX: number,
  headerWidth: number,
  oldPixelsPerFrame: number,
  newPixelsPerFrame: number,
): number {
  if (oldPixelsPerFrame <= 0 || newPixelsPerFrame <= 0) return currentScrollLeft;
  const frame = (pointerViewportX + currentScrollLeft - headerWidth) / oldPixelsPerFrame;
  return Math.max(0, frame * newPixelsPerFrame + headerWidth - pointerViewportX);
}

/** Keep `frame` (e.g. playhead) at the same viewport X while pixels-per-frame changes. */
export function anchoredTimelineScrollLeftForFrame(
  currentScrollLeft: number,
  frame: number,
  headerWidth: number,
  oldPixelsPerFrame: number,
  newPixelsPerFrame: number,
): number {
  const anchorViewportX = headerWidth + frame * oldPixelsPerFrame - currentScrollLeft;
  return anchoredTimelineScrollLeft(
    currentScrollLeft, anchorViewportX, headerWidth, oldPixelsPerFrame, newPixelsPerFrame,
  );
}

export function defaultTimelineZoom(
  fps: number,
  basePixelsPerFrame: number,
  rulerLabelMinPx: number,
  limits: TimelineZoomLimits,
): number {
  const zoom = rulerLabelMinPx / (12 * Math.max(1, fps) * basePixelsPerFrame);
  return clampTimelineZoom(zoom, limits);
}
