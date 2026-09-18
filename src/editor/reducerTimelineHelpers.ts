import type { MediaAsset, MediaAssetRelinkPatch, TimelineItem, TimelineState, TrackId, TrackKind } from './types';
import { defaultTrackId, timelineTrackIds, trackKind } from './types';
import { remainingSourceFrames, sourceFramesToTimelineFrames, timelineFramesToSourceFrames } from './sourceLimit';
import { editedFrames, itemEditOpts } from '../transcript/edit';
import { hasOperationalTranscript } from '../transcript/types';
import type { CaptionsData } from '../captions/types';
import type { Action } from './reducerActions';

/** Default slot when no same-kind peers exist — keeps XMT's caption-at-bottom layout. */
function defaultInsertIndex(ids: TrackId[], s: TimelineState, kind: TrackKind): number {
  if (kind === 'caption') return ids.length;
  if (kind === 'video') {
    const i = ids.findIndex((id) => {
      const peer = trackKind(s, id);
      return peer === 'audio' || peer === 'caption';
    });
    return i < 0 ? ids.length : i;
  }
  const firstCaption = ids.findIndex((id) => trackKind(s, id) === 'caption');
  if (firstCaption >= 0) return firstCaption;
  let afterVideo = -1;
  for (let i = 0; i < ids.length; i++) {
    if (trackKind(s, ids[i]!) === 'video') afterVideo = i;
  }
  return afterVideo + 1;
}

/**
 * Insert/move a track by kind-relative `order` without regrouping other kinds.
 * Video order is inverted (larger → closer to timeline top); audio/caption grow downward.
 * Preserves existing relative positions of every other track (fixes caption jump-to-top on create).
 */
export function placeTrack(s: TimelineState, track: TrackId, kind: TrackKind, order?: number): TrackId[] {
  const ids = timelineTrackIds(s).filter((id) => id !== track);
  const sameKind = ids.filter((id) => trackKind(s, id) === kind);
  let insertAt: number;
  if (!sameKind.length) {
    insertAt = defaultInsertIndex(ids, s, kind);
  } else {
    const laneLen = sameKind.length;
    const sourceOrder = Math.max(0, Math.min(order ?? laneLen, laneLen));
    const posAmongKind = kind === 'video' ? laneLen - sourceOrder : sourceOrder;
    if (posAmongKind <= 0) insertAt = ids.indexOf(sameKind[0]!);
    else if (posAmongKind >= laneLen) insertAt = ids.indexOf(sameKind[laneLen - 1]!) + 1;
    else insertAt = ids.indexOf(sameKind[posAmongKind]!);
  }
  const next = [...ids];
  next.splice(insertAt, 0, track);
  return next;
}

/** Swap a track one slot in the full trackOrder (cross-kind layer reorder). */
export function moveTrackInOrder(s: TimelineState, track: TrackId, dir: -1 | 1): TrackId[] {
  const ids = [...timelineTrackIds(s)];
  const i = ids.indexOf(track);
  if (i < 0) return ids;
  const j = i + dir;
  if (j < 0 || j >= ids.length) return ids;
  ids.splice(i, 1);
  ids.splice(j, 0, track);
  return ids;
}

export function withTrackCaptions(s: TimelineState, captions: CaptionsData | null, track?: TrackId): TimelineState {
  const target = track ?? defaultTrackId(s, 'caption');
  if (!target) return { ...s, captions };
  const current = s.tracks?.[target] ?? { kind: 'caption' as const };
  const next = { ...s, tracks: { ...s.tracks, [target]: { ...current, captions } } };
  return target === defaultTrackId(s, 'caption') ? { ...next, captions } : next;
}

export const EMPTY_CURVE = { version: 1, timebase: 'effect-frame', coordinateSpace: 'composition-normalized', keyframes: [] } as const;

/** True when the item sits on a locked track; modifications must no-op. */
export const lockedItem = (s: TimelineState, id: string): boolean =>
  s.items.some((it) => it.id === id && s.tracks?.[it.track]?.locked);

export type RelinkableTimelineItem = TimelineItem & Pick<MediaAssetRelinkPatch, 'sourceSize' | 'sourceModifiedAt'> & {
  sourceTimecode?: MediaAsset['sourceTimecode'];
  captureClock?: MediaAsset['captureClock'];
};

export function isRelinkableMediaKind(kind: TimelineItem['kind']): kind is MediaAsset['kind'] {
  return kind === 'video'
    || kind === 'image'
    || kind === 'audio'
    || kind === 'motion-graphic'
    || kind === 'gif'
    || kind === 'svg';
}

/**
 * Preserve the authored timeline slot and source window whenever the new file
 * contains that window. A shorter source may only move the source window left
 * or shorten the clip; it must never grow the timeline slot.
 */
export function relinkTiming(
  item: TimelineItem,
  replacementDurationInFrames: number | undefined,
  replacementKind: MediaAsset['kind'],
): Pick<TimelineItem, 'durationInFrames' | 'srcInFrame'> | null {
  if (replacementDurationInFrames === undefined) {
    return { durationInFrames: item.durationInFrames, srcInFrame: item.srcInFrame };
  }
  if (!Number.isFinite(replacementDurationInFrames) || replacementDurationInFrames < 1) return null;
  if (replacementKind !== 'video' && replacementKind !== 'audio') {
    return { durationInFrames: item.durationInFrames, srcInFrame: item.srcInFrame };
  }

  const sourceDuration = Math.max(1, Math.floor(replacementDurationInFrames));
  const sourceStart = Math.max(0, item.srcInFrame ?? 0);
  const authoredSourceLength = timelineFramesToSourceFrames(item, item.durationInFrames);
  if (sourceStart + authoredSourceLength <= sourceDuration) {
    return { durationInFrames: item.durationInFrames, srcInFrame: item.srcInFrame };
  }
  if (authoredSourceLength <= sourceDuration) {
    const srcInFrame = Math.max(0, Math.floor(sourceDuration - authoredSourceLength));
    return {
      durationInFrames: item.durationInFrames,
      srcInFrame: item.srcInFrame === undefined && srcInFrame === 0 ? undefined : srcInFrame,
    };
  }
  return {
    durationInFrames: Math.min(
      item.durationInFrames,
      Math.max(1, Math.floor(sourceFramesToTimelineFrames(item, sourceDuration))),
    ),
    srcInFrame: item.srcInFrame === undefined ? undefined : 0,
  };
}

// recompute a transcript-edited clip's duration under its current edit state


export function editedDuration(it: TimelineItem, deleted: Set<number>, fps: number): number {
  if (!hasOperationalTranscript(it)) return it.durationInFrames;
  // Duration after word operation = Full length of word stream after editing − There is left clipping (only audio: the starting point of the window for word-driven rendering).
  // The left trim is retained after word deletion/silencing; the right trim is reset to "all remaining". video+transcript go
  // Continuous rendering, srcInFrame is media frame semantics and does not participate in the word flow window.
  const trim = it.kind === 'audio' ? (it.srcInFrame ?? 0) : 0;
  return Math.max(1, editedFrames(it.transcript!, deleted, fps, itemEditOpts(it)) - trim);
}

/**
 * Starting from `fromFrame`, collect the following same-track connected chain
 * until the first gap. Legacy overlapping clips still count as connected so
 * ripple edits can safely repair old project data.
 */
export function contiguousFollowers(
  items: readonly TimelineItem[],
  track: TrackId,
  fromFrame: number,
): Set<string> {
  const later = items
    .filter((it) => it.track === track && it.startFrame >= fromFrame)
    .toSorted((x, y) => x.startFrame - y.startFrame);
  const ids = new Set<string>();
  let chainEnd = fromFrame;
  for (const it of later) {
    if (it.startFrame > chainEnd) break;
    ids.add(it.id);
    chainEnd = Math.max(chainEnd, it.startFrame + it.durationInFrames);
  }
  return ids;
}

type RetimeAction = Extract<Action, { type: 'retime' }>;
export type OverwriteLaneAction = Extract<Action, { type: 'add' | 'retime' | 'remove' | 'split' }>;
type RetimePatch = Pick<TimelineItem, 'startFrame' | 'durationInFrames' | 'srcInFrame'>;

export function retimePatchForItem(s: TimelineState, target: TimelineItem, action: RetimeAction): RetimePatch {
  let srcInFrame = action.srcInFrame === undefined ? target.srcInFrame : Math.max(0, action.srcInFrame);
  let durationInFrames = Math.max(1, action.durationInFrames ?? target.durationInFrames);
  if (target.kind === 'audio' && hasOperationalTranscript(target)) {
    const total = editedFrames(
      target.transcript,
      new Set(target.deletedWordIdx ?? []),
      s.fps,
      itemEditOpts(target),
    );
    srcInFrame = Math.min(srcInFrame ?? 0, Math.max(0, total - 1));
    durationInFrames = Math.min(durationInFrames, Math.max(1, total - srcInFrame));
  }
  const sourceLimit = remainingSourceFrames(target, srcInFrame ?? 0, s.assets);
  if (sourceLimit !== null) durationInFrames = Math.min(durationInFrames, sourceLimit);
  return {
    startFrame: Math.max(0, action.startFrame ?? target.startFrame),
    durationInFrames,
    srcInFrame,
  };
}

