/** Linear clip volume ceiling shared by persist validation, reducer, inspector,
 *  keyframes and agent tools. 1 = 100%; 8 = 800% ≈ +18 dB.
 *  Values above this make `isTimelineItem` fail and the whole ProjectDoc unload. */
export const MAX_ITEM_VOLUME = 8;
export const MIN_ITEM_VOLUME = 0;

export function clampItemVolume(value: number): number {
  return Math.max(MIN_ITEM_VOLUME, Math.min(MAX_ITEM_VOLUME, value));
}
