import type { TimelineState } from '../editor/types';
import { isStaticallySilent } from '../editor/staticSilence';

/**
 * Remotion requires this value to stay immutable for the mounted Player.
 * Desktop and nested compositions keep this ceiling. Mobile can use a smaller
 * pool but must remount the Player before committing a change in demand.
 */
export const PREVIEW_SHARED_AUDIO_TAGS = 32;

/** Use the same silence predicate as the actual audio/video playback layers. */
export function previewAudioTagCount(state: TimelineState): number {
  const events: Array<{ frame: number; delta: 1 | -1 }> = [];
  for (const item of state.items) {
    if ((item.kind !== 'audio' && item.kind !== 'video') || !item.src || isStaticallySilent(item)) continue;
    const track = state.tracks?.[item.track];
    if (track?.hidden || track?.muted) continue;
    events.push({ frame: item.startFrame, delta: 1 });
    events.push({ frame: item.startFrame + item.durationInFrames, delta: -1 });
  }
  events.sort((a, b) => a.frame - b.frame || a.delta - b.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  return Math.min(PREVIEW_SHARED_AUDIO_TAGS, Math.max(4, peak + 2));
}
