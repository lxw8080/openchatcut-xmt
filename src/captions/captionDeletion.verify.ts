/**
 * captionDeletion: Delete/Backspace on a caption selection removes manual cues
 * from their lane and hides generated (transcript-driven) cues through
 * wordOverrides — one patch per affected track, locked tracks skipped, source
 * transcripts/words untouched (display-only delete, undo restores the cue).
 */
import assert from 'node:assert/strict';
import { captionSelectionDeletePatches } from './captionDeletion.ts';
import { buildCues } from './captionCues.ts';
import type { CaptionSelectionRef } from './captionSelection.ts';
import type { CaptionsData } from './types.ts';
import type { TimelineItem, TimelineState } from '../editor/types.ts';

const FPS = 30;
const TRACK = 'C1';

function stateWith(
  captionsByTrack: Record<string, CaptionsData>,
  items: TimelineItem[] = [],
  lockedTracks: string[] = [],
): TimelineState {
  return {
    fps: FPS,
    width: 1920,
    height: 1080,
    items,
    trackOrder: Object.keys(captionsByTrack),
    tracks: Object.fromEntries(Object.entries(captionsByTrack).map(([id, captions]) => [
      id,
      { kind: 'caption' as const, captions, locked: lockedTracks.includes(id) || undefined },
    ])),
    selectedId: null,
    selectedIds: [],
  };
}

function mergePatch(captions: CaptionsData, patch: Partial<CaptionsData>): CaptionsData {
  return { ...captions, ...patch };
}

// ── Manual cues leave their lane's word list ────────────────────────────────
const manualCaptions: CaptionsData = {
  enabled: true,
  template: 'black-bar',
  pacing: 'phrase',
  sourceMode: 'item',
  sourceEntries: [{
    id: 'lane_1',
    itemId: 'manual:lane_1',
    words: [
      { id: 'mc_1', text: '第一句', start: 0, end: 1000 },
      { id: 'mc_2', text: '第二句', start: 1500, end: 2500 },
      { id: 'mc_3', text: '第三句', start: 3000, end: 4000 },
    ],
  }],
};
const manualState = stateWith({ [TRACK]: manualCaptions });
const manualSelections: CaptionSelectionRef[] = [
  { trackId: TRACK, kind: 'manual', laneId: 'lane_1', cueId: 'mc_3' },
  { trackId: TRACK, kind: 'manual', laneId: 'lane_1', cueId: 'mc_1' },
];
const manualPatches = captionSelectionDeletePatches(manualState, manualSelections);
assert.equal(manualPatches.length, 1);
assert.equal(manualPatches[0]!.trackId, TRACK);
const afterManual = mergePatch(manualCaptions, manualPatches[0]!.patch);
assert.deepEqual(
  afterManual.sourceEntries?.[0]?.words?.map((word) => word.id),
  ['mc_2'],
);

// Single manual selection removes only that cue.
const oneManual = captionSelectionDeletePatches(manualState, [
  { trackId: TRACK, kind: 'manual', laneId: 'lane_1', cueId: 'mc_2' },
]);
assert.equal(oneManual.length, 1);
assert.deepEqual(
  mergePatch(manualCaptions, oneManual[0]!.patch).sourceEntries?.[0]?.words?.map((word) => word.id),
  ['mc_1', 'mc_3'],
);

// ── Generated (standalone-word) cues hide via wordOverrides ─────────────────
const automaticCaptions: CaptionsData = {
  enabled: true,
  template: 'plain',
  pacing: 'word',
  words: [
    { id: 'w1', text: '你', start: 0, end: 400 },
    { id: 'w2', text: '好', start: 400, end: 800 },
    { id: 'w3', text: '世', start: 1200, end: 1600 },
    { id: 'w4', text: '界', start: 1600, end: 2000 },
  ],
  offsetFrames: 0,
};
const automaticState = stateWith({ [TRACK]: automaticCaptions });
const rows = buildCues(automaticCaptions, [], FPS);
assert.equal(rows.length, 4);
const automaticSelections: CaptionSelectionRef[] = [
  { trackId: TRACK, kind: 'single', pageId: rows[1]!.id },
  { trackId: TRACK, kind: 'single', pageId: rows[3]!.id },
];
const automaticPatches = captionSelectionDeletePatches(automaticState, automaticSelections);
assert.equal(automaticPatches.length, 1);
const automaticPatch = automaticPatches[0]!.patch;
assert.ok(automaticPatch.wordOverrides);
assert.equal(automaticPatch.sourceEntries, undefined);
const afterAutomatic = mergePatch(automaticCaptions, automaticPatch);
assert.deepEqual(
  buildCues(afterAutomatic, [], FPS).map((cue) => cue.text),
  ['你', '世'],
);
// Display-only: the standalone source words survive untouched.
assert.equal(afterAutomatic.words?.length, 4);
// Stable word identities are persisted so the hide follows the word.
assert.ok(Object.values(automaticPatch.wordOverrides!).every((override) => override.wordRef));

// ── Locked tracks are skipped ───────────────────────────────────────────────
const lockedState = stateWith({ [TRACK]: automaticCaptions }, [], [TRACK]);
assert.equal(captionSelectionDeletePatches(lockedState, automaticSelections).length, 0);

// Unresolvable selections (unknown cue id) produce nothing.
assert.equal(captionSelectionDeletePatches(manualState, [
  { trackId: TRACK, kind: 'manual', laneId: 'lane_1', cueId: 'mc_missing' },
]).length, 0);
assert.equal(captionSelectionDeletePatches(manualState, []).length, 0);

// ── Mixed lanes: one patch carries lane removal + generated-cue hides ───────
const asrItem: TimelineItem = {
  id: 'item_1',
  kind: 'video',
  track: 'V1',
  startFrame: 0,
  durationInFrames: 6 * FPS,
  transcript: [
    { id: 'tw_1', text: '大家好', start: 0, end: 900 },
    { id: 'tw_2', text: '欢迎收看', start: 1000, end: 1900 },
  ],
  transcriptGenerationId: 'tg_1',
} as TimelineItem;
const mixedCaptions: CaptionsData = {
  enabled: true,
  template: 'plain',
  pacing: 'word',
  sourceMode: 'item',
  sourceEntries: [
    { id: 'lane_asr', itemId: 'item_1' },
    {
      id: 'lane_manual',
      itemId: 'manual:lane_manual',
      words: [{ id: 'mc_9', text: '手动条', start: 2000, end: 3000 }],
    },
  ],
};
const mixedState = stateWith({ [TRACK]: mixedCaptions }, [asrItem]);
const mixedRows = buildCues(mixedCaptions, [asrItem], FPS).filter((cue) => !cue.manual);
assert.equal(mixedRows.length, 2);
const mixedPatches = captionSelectionDeletePatches(mixedState, [
  { trackId: TRACK, kind: 'single', pageId: mixedRows[0]!.id },
  { trackId: TRACK, kind: 'manual', laneId: 'lane_manual', cueId: 'mc_9' },
]);
assert.equal(mixedPatches.length, 1);
const afterMixed = mergePatch(mixedCaptions, mixedPatches[0]!.patch);
assert.equal(afterMixed.sourceEntries?.find((entry) => entry.id === 'lane_manual')?.words?.length, 0);
assert.ok(afterMixed.wordOverrides && Object.keys(afterMixed.wordOverrides).length === 1);
assert.deepEqual(
  buildCues(afterMixed, [asrItem], FPS).map((cue) => cue.text),
  ['欢迎收看'],
);
// The ASR item's transcript is never modified.
assert.equal(asrItem.transcript?.length, 2);

console.log('captionDeletion.verify: manual removal + generated hide + locked skip passed');
