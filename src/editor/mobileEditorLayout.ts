import { defaultTrackId, timelineDuration, type TimelineItem, type TimelineState, type TrackKind } from './types';

export const MOBILE_TIMELINE_PX_PER_FRAME = 1.2;
export const MOBILE_TIMELINE_GUTTER = 12;

export function mobileTimelineDuration(state: TimelineState): number {
  return timelineDuration(state);
}

export function primaryMobileTrackItems(state: TimelineState, kind: TrackKind): TimelineItem[] {
  const track = defaultTrackId(state, kind);
  if (!track) return [];
  return state.items
    .filter((item) => item.track === track)
    .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
}

export function mobileTimelineWidth(totalFrames: number, px = MOBILE_TIMELINE_PX_PER_FRAME): number {
  return Math.max(320, Math.ceil(Math.max(0, totalFrames) * px + MOBILE_TIMELINE_GUTTER * 2));
}

export function mobileFrameFromClientX(input: {
  clientX: number;
  left: number;
  scrollLeft: number;
  px?: number;
  totalFrames?: number;
}): number {
  const px = Math.max(0.001, input.px ?? MOBILE_TIMELINE_PX_PER_FRAME);
  const frame = Math.max(0, Math.round((input.clientX - input.left + input.scrollLeft - MOBILE_TIMELINE_GUTTER) / px));
  return input.totalFrames == null ? frame : Math.min(Math.max(0, input.totalFrames - 1), frame);
}

export function canSplitMobileItem(item: TimelineItem, frame: number): boolean {
  return frame > item.startFrame && frame < item.startFrame + item.durationInFrames;
}

export function adjacentMobileClip(
  items: readonly TimelineItem[],
  frame: number,
  direction: 'previous' | 'next',
): TimelineItem | null {
  const ordered = [...items].sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
  if (direction === 'previous') {
    return ordered.filter((item) => item.startFrame < frame - 1).at(-1) ?? null;
  }
  return ordered.find((item) => item.startFrame > frame + 1) ?? null;
}

export function formatMobileTime(frame: number, fps: number): string {
  const seconds = Math.max(0, Math.floor(frame / Math.max(1, fps)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
