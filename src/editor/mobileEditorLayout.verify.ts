import assert from 'node:assert/strict';
import {
  adjacentMobileClip,
  canSplitMobileItem,
  clampMobileTimelinePx,
  fitMobileTimelinePx,
  formatMobileTime,
  mobileClipGestureGeometry,
  mobileFrameFromClientX,
  mobileTimelineTickFrames,
  mobileTimelineWidth,
  mobileTrackItems,
  primaryMobileTrackItems,
} from './mobileEditorLayout';
import type { TimelineItem, TimelineState } from './types';

const clips: TimelineItem[] = [
  { id: 'b', kind: 'video', name: '第二段', track: 'V1', startFrame: 90, durationInFrames: 60 },
  { id: 'a', kind: 'video', name: '第一段', track: 'V1', startFrame: 0, durationInFrames: 90 },
  { id: 'overlay', kind: 'image', name: '叠层', track: 'V2', startFrame: 0, durationInFrames: 90 },
  { id: 'mg', kind: 'motion-graphic', name: 'MG 动画', track: 'V2', startFrame: 90, durationInFrames: 60 },
  { id: 'music', kind: 'audio', name: '音乐', track: 'A1', startFrame: 0, durationInFrames: 180 },
];
const state = {
  fps: 30, width: 1920, height: 1080, selectedId: null,
  items: clips,
  trackOrder: ['V2', 'V1', 'A1'],
  tracks: { V2: { kind: 'video' }, V1: { kind: 'video' }, A1: { kind: 'audio' } },
} as TimelineState;

assert.deepEqual(primaryMobileTrackItems(state, 'video').map((item) => item.id), ['a', 'b']);
assert.deepEqual(primaryMobileTrackItems(state, 'audio').map((item) => item.id), ['music']);
assert.deepEqual(mobileTrackItems(state, 'V2').map((item) => item.id), ['overlay', 'mg']);
assert.equal(mobileTimelineWidth(150), 320);
assert.equal(mobileTimelineWidth(300), 452);
assert.equal(mobileTimelineWidth(0), 320);
assert.equal(mobileFrameFromClientX({ clientX: 100, left: 20, scrollLeft: 30 }), 28);
assert.equal(mobileFrameFromClientX({ clientX: 0, left: 20, scrollLeft: 0 }), 0);
assert.equal(mobileFrameFromClientX({ clientX: 9999, left: 0, scrollLeft: 0, totalFrames: 150 }), 149);
assert.equal(clampMobileTimelinePx(0.001), 0.02);
assert.equal(clampMobileTimelinePx(20), 6);
assert.equal(clampMobileTimelinePx(1.5), 1.5);
assert.equal(fitMobileTimelinePx(300, 392), 1);
assert.equal(fitMobileTimelinePx(3000, 392), 0.1);
assert.equal(fitMobileTimelinePx(1, 392), 6);
assert.equal(mobileTimelineTickFrames(30, 1.2), 60);
assert.equal(mobileTimelineTickFrames(30, 0.1), 900);
assert.deepEqual(mobileClipGestureGeometry(clips[0]!, 'move', 15), { startFrame: 105, durationInFrames: 60 });
assert.deepEqual(mobileClipGestureGeometry(clips[1]!, 'move', -15), { startFrame: 0, durationInFrames: 90 });
assert.deepEqual(mobileClipGestureGeometry(clips[0]!, 'trim-left', 15), { startFrame: 105, durationInFrames: 45 });
assert.deepEqual(mobileClipGestureGeometry(clips[0]!, 'trim-left', 100), { startFrame: 149, durationInFrames: 1 });
assert.deepEqual(mobileClipGestureGeometry(clips[0]!, 'trim-left', -100), { startFrame: 0, durationInFrames: 150 });
assert.deepEqual(mobileClipGestureGeometry(clips[1]!, 'trim-right', -89), { startFrame: 0, durationInFrames: 1 });
assert.deepEqual(mobileClipGestureGeometry(clips[1]!, 'trim-right', 30), { startFrame: 0, durationInFrames: 120 });
assert.equal(canSplitMobileItem(clips[1]!, 0), false);
assert.equal(canSplitMobileItem(clips[1]!, 1), true);
assert.equal(canSplitMobileItem(clips[1]!, 90), false);
assert.equal(adjacentMobileClip(clips.slice(0, 2), 80, 'previous')?.id, 'a');
assert.equal(adjacentMobileClip(clips.slice(0, 2), 80, 'next')?.id, 'b');
assert.equal(adjacentMobileClip(clips.slice(0, 2), 0, 'previous'), null);
assert.equal(formatMobileTime(12 * 30, 30), '00:12');
assert.equal(formatMobileTime(3661 * 30, 30), '1:01:01');
console.log('mobileEditorLayout.verify: OK');
