import assert from 'node:assert/strict';
import {
  adjacentMobileClip,
  canSplitMobileItem,
  formatMobileTime,
  mobileFrameFromClientX,
  mobileTimelineWidth,
  primaryMobileTrackItems,
} from './mobileEditorLayout';
import type { TimelineItem, TimelineState } from './types';

const clips: TimelineItem[] = [
  { id: 'b', kind: 'video', name: '第二段', track: 'V1', startFrame: 90, durationInFrames: 60 },
  { id: 'a', kind: 'video', name: '第一段', track: 'V1', startFrame: 0, durationInFrames: 90 },
  { id: 'overlay', kind: 'image', name: '叠层', track: 'V2', startFrame: 0, durationInFrames: 90 },
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
assert.equal(mobileTimelineWidth(150), 320);
assert.equal(mobileTimelineWidth(300), 384);
assert.equal(mobileTimelineWidth(0), 320);
assert.equal(mobileFrameFromClientX({ clientX: 100, left: 20, scrollLeft: 30 }), 82);
assert.equal(mobileFrameFromClientX({ clientX: 0, left: 20, scrollLeft: 0 }), 0);
assert.equal(mobileFrameFromClientX({ clientX: 9999, left: 0, scrollLeft: 0, totalFrames: 150 }), 149);
assert.equal(canSplitMobileItem(clips[1]!, 0), false);
assert.equal(canSplitMobileItem(clips[1]!, 1), true);
assert.equal(canSplitMobileItem(clips[1]!, 90), false);
assert.equal(adjacentMobileClip(clips.slice(0, 2), 80, 'previous')?.id, 'a');
assert.equal(adjacentMobileClip(clips.slice(0, 2), 80, 'next')?.id, 'b');
assert.equal(adjacentMobileClip(clips.slice(0, 2), 0, 'previous'), null);
assert.equal(formatMobileTime(12 * 30, 30), '00:12');
assert.equal(formatMobileTime(3661 * 30, 30), '1:01:01');
console.log('mobileEditorLayout.verify: OK');
