/**
 * Table-driven checks for stable placeTrack / moveTrackInOrder.
 * Run: npx tsx src/editor/placeTrack.verify.ts
 */
import assert from 'node:assert/strict';
import { moveTrackInOrder, placeTrack } from './reducerTimelineHelpers';
import type { TimelineState, TrackId, TrackKind } from './types';

function stateOf(
  order: TrackId[],
  kinds: Record<TrackId, TrackKind>,
): TimelineState {
  return {
    id: 'tl',
    name: 'test',
    fps: 30,
    width: 1920,
    height: 1080,
    items: [],
    selectedId: null,
    selectedIds: [],
    trackOrder: order,
    tracks: Object.fromEntries(
      Object.entries(kinds).map(([id, kind]) => [id, { kind }]),
    ),
    captions: null,
  } as TimelineState;
}

const xmt = stateOf(
  ['V2', 'V1', 'A1', 'C1'],
  { V2: 'video', V1: 'video', A1: 'audio', C1: 'caption' },
);

// Creating a video track must not yank caption to the top (the original bug).
assert.deepEqual(
  placeTrack(xmt, 'V_new', 'video'),
  ['V_new', 'V2', 'V1', 'A1', 'C1'],
  'new video inserts at top of videos; caption stays last',
);

assert.deepEqual(
  placeTrack(xmt, 'A_new', 'audio'),
  ['V2', 'V1', 'A1', 'A_new', 'C1'],
  'new audio appends after existing audio; caption stays last',
);

assert.deepEqual(
  placeTrack(xmt, 'C_new', 'caption'),
  ['V2', 'V1', 'A1', 'C1', 'C_new'],
  'new caption appends after existing caption',
);

// Kind-relative order for video is inverted (order 0 = bottom of video group).
assert.deepEqual(
  placeTrack(xmt, 'V_bot', 'video', 0),
  ['V2', 'V1', 'V_bot', 'A1', 'C1'],
  'video order 0 lands at end of video group',
);

// Empty peers: first video before audio/caption.
const audioOnly = stateOf(['A1', 'C1'], { A1: 'audio', C1: 'caption' });
assert.deepEqual(
  placeTrack(audioOnly, 'V1', 'video'),
  ['V1', 'A1', 'C1'],
  'first video slots before audio/caption',
);

// moveTrackInOrder swaps adjacent slots across kinds.
assert.deepEqual(
  moveTrackInOrder(xmt, 'C1', -1),
  ['V2', 'V1', 'C1', 'A1'],
  'caption can move above audio',
);
assert.deepEqual(
  moveTrackInOrder(xmt, 'V2', 1),
  ['V1', 'V2', 'A1', 'C1'],
  'top video can move down one',
);
assert.deepEqual(
  moveTrackInOrder(xmt, 'V2', -1),
  ['V2', 'V1', 'A1', 'C1'],
  'already-top track is a no-op on move up',
);
assert.deepEqual(
  moveTrackInOrder(xmt, 'C1', 1),
  ['V2', 'V1', 'A1', 'C1'],
  'already-bottom track is a no-op on move down',
);

console.log('placeTrack.verify: stable insert + moveTrackInOrder ok');
