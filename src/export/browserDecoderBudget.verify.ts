import assert from 'node:assert/strict';
import { browserDecoderBankBudget } from './browserDecoderBudget';
import type { ProjectDoc, TimelineState } from '../editor/types';

const clip = (start: number, track = 'V1') => ({ id: `${track}-${start}`, kind: 'video', track,
  startFrame: start, durationInFrames: 30, src: '/test.mp4' });
const state = (items: unknown[], extra = {}) => ({ items, tracks: {}, transitions: [], ...extra } as unknown as TimelineState);
assert.equal(browserDecoderBankBudget(state(Array.from({ length: 30 }, (_, i) => clip(i * 30)))), 2);
const layers = state([clip(0), clip(0, 'V2'), clip(0, 'V3')]);
assert.equal(browserDecoderBankBudget(layers), 3, 'simultaneous layers must not thrash a two-bank cache');
assert.equal(browserDecoderBankBudget({ ...layers, tracks: { V3: { hidden: true } } } as TimelineState), 2);
const project = { timelines: [{ ...layers, id: 'child' }] } as unknown as ProjectDoc;
assert.equal(browserDecoderBankBudget(state([clip(0), { ...clip(0, 'V2'), kind: 'sequence', timelineId: 'child' }]), project), 4);
assert.equal(browserDecoderBankBudget(state([clip(0), clip(30), clip(60)], {
  transitions: [{ type: 'fade', durationInFrames: 30, enabled: true }],
})), 3, 'transition retention may conservatively overestimate overlap');
console.log('browserDecoderBudget.verify: OK (sequential cuts, layers, hidden tracks, nested sequences, transitions)');
