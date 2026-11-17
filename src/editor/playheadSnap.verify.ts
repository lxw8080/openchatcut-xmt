import assert from 'node:assert/strict';
import test from 'node:test';
import { snapPlayheadFrame, sortTimelineSnapPoints } from './snap';

const points = sortTimelineSnapPoints([
  { frame: 0, type: 'timeline-start' },
  { frame: 8, type: 'keyframe' },
  { frame: 300, type: 'item-start' },
  { frame: 1791, type: 'keyframe' },
  { frame: 1799, type: 'item-end' },
]);
const frameRange = { min: 0, max: 1799 };

for (const pixelsPerFrame of [0.2, 0.5, 1, 4]) {
  test(`playhead reaches both endpoints at ${pixelsPerFrame} px/frame`, () => {
    const thresholdFrames = 7 / pixelsPerFrame;
    for (const [near, endpoint, outside] of [[8, 0, -80], [1791, 1799, 1880]]) {
      const held = snapPlayheadFrame({ frame: near, points, thresholdFrames, frameRange });
      assert.equal(held.frame, near);
      assert.equal(held.hold?.frame, near);
      for (const frame of [endpoint, outside]) {
        const result = snapPlayheadFrame({ frame, points, thresholdFrames, frameRange, hold: held.hold });
        assert.deepEqual(result, { frame: endpoint, snapAt: endpoint, hold: null });
      }
    }
  });
}

test('interior sticky snap still holds and releases at its existing radius', () => {
  const held = snapPlayheadFrame({ frame: 300, points, thresholdFrames: 7, frameRange });
  const moving = { points, thresholdFrames: 7, frameRange, hold: held.hold };
  assert.equal(snapPlayheadFrame({ ...moving, frame: 310 }).frame, 300);
  assert.deepEqual(snapPlayheadFrame({ ...moving, frame: 311 }), {
    frame: 311, snapAt: null, hold: null,
  });
});

test('leaving an endpoint can acquire another guide in the same drag', () => {
  const atZero = snapPlayheadFrame({ frame: 0, points, thresholdFrames: 14, frameRange });
  const next = snapPlayheadFrame({ frame: 8, points, thresholdFrames: 14, frameRange, hold: atZero.hold });
  assert.equal(next.frame, 8);
  assert.equal(next.hold?.type, 'keyframe');
});

test('single-frame timelines stay on their only seekable frame', () => {
  for (const frame of [-20, 0, 20]) {
    assert.deepEqual(snapPlayheadFrame({
      frame, points, thresholdFrames: 14, frameRange: { min: 0, max: 0 },
      hold: { frame: 8, type: 'keyframe' },
    }), { frame: 0, snapAt: 0, hold: null });
  }
});
