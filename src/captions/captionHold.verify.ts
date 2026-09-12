/**
 * Word-paced captions must respect page.end (XMT display lines + 「删除这句」).
 * Phrase pacing keeps the legacy hold-until-next-start karaoke behaviour.
 */
import assert from 'node:assert/strict';
import { holdModeForPacing, pageVisibleUntil } from './captionHold.ts';

assert.equal(holdModeForPacing('word'), 'until-end');
assert.equal(holdModeForPacing('phrase'), 'until-next');
assert.equal(holdModeForPacing(undefined), 'until-next');

assert.equal(pageVisibleUntil(2000, 2500, 'until-end'), 2000);
assert.equal(pageVisibleUntil(2000, 1800, 'until-end'), 1800);
assert.equal(pageVisibleUntil(2000, 2500, 'until-next'), 2500);
assert.equal(pageVisibleUntil(7000, undefined, 'until-end'), 7000);
assert.equal(pageVisibleUntil(7000, undefined, 'until-next'), 8500);

// Gap after cue end (breath) stays blank under word pacing.
const cue0End = 2000;
const cue1Start = 2500;
assert.ok(2200 >= pageVisibleUntil(cue0End, cue1Start, 'until-end'));
assert.ok(2200 < pageVisibleUntil(cue0End, cue1Start, 'until-next'));

// After middle cue deleted, previous end still stops before the deleted window.
const afterDeleteNextStart = 5000;
assert.ok(3000 >= pageVisibleUntil(cue0End, afterDeleteNextStart, 'until-end'));
assert.ok(3000 < pageVisibleUntil(cue0End, afterDeleteNextStart, 'until-next'));

console.log('captionHold.verify: word-paced end / delete-gap passed');
