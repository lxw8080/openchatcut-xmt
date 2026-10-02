import assert from 'node:assert/strict';
import { projectReduce } from '../editor/reducerProject.ts';
import { reduce } from '../editor/reducerTimeline.ts';
import type { ProjectDoc, TimelineItem, TimelineState } from '../editor/types.ts';
import { xmtPropsAfterImageRelink } from './clipMeta.ts';
import { planClipReplacement } from './replaceClip.ts';
import type { XmtCandidate } from './projectBridge.ts';

const src = '/library/api/images/7/file';
const props = { _xmt: { scriptSegmentId: 'script_000', matchStatus: 'graphic', imageAssetId: 7, stillId: 'lib-7' } };
const item = { id: 'shot-000', kind: 'image', track: 'V1', startFrame: 0, durationInFrames: 30,
  src, sourceAssetId: 'still-7', props } as TimelineItem;
const timeline = { id: 'main', name: 'Main', order: 0, width: 1920, height: 1080, fps: 30,
  items: [item], trackOrder: ['V1'], tracks: { V1: { kind: 'video' } } };
const doc = { version: 3, id: 'job-1', name: 'test', activeTimelineId: 'main', mediaFolders: [],
  assets: [{ id: 'still-7', kind: 'image', src, name: 'old', durationInFrames: 30, props }],
  timelines: [timeline] } as unknown as ProjectDoc;
const replacement = '/notes/images/replacement.png';
const metadata = (value: TimelineItem) => value.props?._xmt as Record<string, unknown>;

const relinked = projectReduce(doc, { type: 'pool.relinkAsset', id: 'still-7', src: replacement, kind: 'image' });
assert.equal(relinked.assets[0]!.src, replacement);
assert.equal((relinked.assets[0]!.props?._xmt as Record<string, unknown>).imageAssetId, undefined);
assert.equal(relinked.timelines[0]!.items[0]!.src, replacement);
assert.equal(metadata(relinked.timelines[0]!.items[0]!).imageAssetId, undefined);
assert.equal(metadata(relinked.timelines[0]!.items[0]!).stillId, undefined);
assert.equal(metadata(relinked.timelines[0]!.items[0]!).scriptSegmentId, 'script_000');
assert.equal(metadata(relinked.timelines[0]!.items[0]!).matchStatus, 'graphic');

const state = { ...timeline, assets: doc.assets } as unknown as TimelineState;
const standalone = reduce(state, { type: 'relinkTimelineItem', id: item.id, src: replacement, kind: 'image' });
assert.equal(metadata(standalone.items[0]!).imageAssetId, undefined);
const newLibraryImage = reduce(state, { type: 'relinkTimelineItem', id: item.id,
  src: '/library/api/images/9/file?cache=1', kind: 'image' });
assert.equal(metadata(newLibraryImage.items[0]!).imageAssetId, 9);
assert.strictEqual(xmtPropsAfterImageRelink(props, src, src), props);
assert.equal(props._xmt.imageAssetId, 7, 'relink must not mutate the undo snapshot');

const candidate = { stream_url: '/library/api/assets/11/stream', asset_id: 11,
  asset_duration_ms: 5000, start_ms: 0 } as XmtCandidate;
const replaced = planClipReplacement(state, item, candidate);
assert.equal(replaced.error, null);
assert.equal(metadata(replaced.next!.items[0]!).imageAssetId, undefined);
assert.equal(metadata(replaced.next!.items[0]!).stillId, undefined);
assert.equal(metadata(replaced.next!.items[0]!).matchStatus, 'manual');
console.log('image relink references verified');
