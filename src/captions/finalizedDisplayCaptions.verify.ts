/**
 * finalizedDisplayCaptions: XMT standalone word cues lock phrase pacing.
 */
import assert from 'node:assert/strict';
import { isFinalizedDisplayCaptions } from './finalizedDisplayCaptions.ts';

assert.equal(isFinalizedDisplayCaptions(null), false);
assert.equal(isFinalizedDisplayCaptions({
  enabled: true, template: 'plain', pacing: 'word', sourceItemId: null,
  words: [{ text: '一句', start: 0, end: 1000 }],
}), true);
assert.equal(isFinalizedDisplayCaptions({
  enabled: true, template: 'plain', pacing: 'word', sourceItemId: 'audio-1',
  words: [{ text: '一句', start: 0, end: 1000 }],
}), false);
assert.equal(isFinalizedDisplayCaptions({
  enabled: true, template: 'plain', pacing: 'word', sourceItemId: null,
  sourceEntries: [{ id: 'e1', itemId: 'audio-1', visible: true }],
  words: [{ text: '一句', start: 0, end: 1000 }],
}), false);
assert.equal(isFinalizedDisplayCaptions({
  enabled: true, template: 'plain', pacing: 'phrase', sourceItemId: null,
  words: [],
}), false);

console.log('finalizedDisplayCaptions.verify: passed');
