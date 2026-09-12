/** Hold policy for non-manual caption pages (preview + burn-in export). */

export type CaptionPacing = 'word' | 'phrase';

/**
 * - `until-next` (phrase / ASR karaoke): hold through gaps until the next page
 *   starts; the last page lingers `LINGER_MS` past its end.
 * - `until-end` (word pacing): each page's `end` is authoritative — intentional
 *   gaps (breath pauses, deleted cues) stay blank. Matches manual cues and SRT.
 *   XMT ships finalized display lines as `pacing: "word"`.
 */
export type CaptionHoldMode = 'until-next' | 'until-end';

export const LINGER_MS = 1500;

export function holdModeForPacing(pacing: CaptionPacing | undefined): CaptionHoldMode {
  return pacing === 'word' ? 'until-end' : 'until-next';
}

/** Inclusive upper bound (ms) for when a started page is still shown. */
export function pageVisibleUntil(
  end: number,
  nextStart: number | undefined,
  mode: CaptionHoldMode,
): number {
  if (mode === 'until-end') {
    return nextStart !== undefined ? Math.min(nextStart, end) : end;
  }
  return nextStart !== undefined ? nextStart : end + LINGER_MS;
}
