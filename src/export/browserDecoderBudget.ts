import { isAudioTransition, type ProjectDoc, type TimelineState } from '../editor/types';

/** A cache retention hint, not a claim about hardware capacity. Keep enough
 * banks for overlapping layers/nested sequences, but not for every past cut.
 * Transition spans are deliberately overestimated; rendering owns exact spans. */
export function browserDecoderBankBudget(state: Pick<TimelineState, 'items' | 'tracks' | 'transitions'>,
  project?: ProjectDoc, ancestors = new Set<string>()): number {
  const extension = Math.max(0, ...(state.transitions ?? [])
    .filter((transition) => transition.enabled !== false && !isAudioTransition(transition.type))
    .map((transition) => transition.durationInFrames));
  const events: [number, number][] = [];
  for (const item of state.items) {
    if (state.tracks?.[item.track]?.hidden || item.durationInFrames <= 0) continue;
    let weight = item.kind === 'video' ? 1 : 0;
    if (item.kind === 'sequence' && item.timelineId && !ancestors.has(item.timelineId)) {
      const child = project?.timelines.find((timeline) => timeline.id === item.timelineId);
      if (child) weight = browserDecoderBankBudget(child, project, new Set([...ancestors, item.timelineId]));
    }
    if (!weight) continue;
    events.push([item.startFrame - extension, weight], [item.startFrame + item.durationInFrames + extension, -weight]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let peak = 0;
  for (const [, delta] of events) { active += delta; peak = Math.max(peak, active); }
  return Math.max(2, peak);
}
