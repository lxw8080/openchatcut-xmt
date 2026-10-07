import type { TimelineItem } from './types';

/** Volume keyframes override the static volume. Only provably silent sources
 * may skip decoding; a zero base volume with an audible keyframe is retained. */
export function isStaticallySilent(item: Pick<TimelineItem, 'volume' | 'keyframes'>): boolean {
  const points = item.keyframes?.volume;
  return points?.length ? points.every((point) => point.value === 0) : item.volume === 0;
}
