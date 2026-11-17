import assert from 'node:assert/strict';
import { subscribeMobileEditorLayout } from './useMobileEditorLayout';
import { previewAudioTagCount } from '../components/previewAudioPool';
import type { TimelineState } from './types';

const globals = globalThis as unknown as Record<string, unknown>;
const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
try {
  let legacyCallback: (() => void) | undefined;
  let removed = 0;
  globals.window = { matchMedia: () => ({
    matches: true,
    addListener: (callback: () => void) => { legacyCallback = callback; },
    removeListener: (callback: () => void) => { assert.equal(callback, legacyCallback); removed += 1; },
  }) };
  let calls = 0;
  const unsubscribe = subscribeMobileEditorLayout(() => { calls += 1; });
  legacyCallback?.();
  unsubscribe();
  assert.equal(calls, 1);
  assert.equal(removed, 1);

  let modernCallback: (() => void) | undefined;
  globals.window = { matchMedia: () => ({
    matches: true,
    addEventListener: (type: string, callback: () => void) => { assert.equal(type, 'change'); modernCallback = callback; },
    removeEventListener: (_type: string, callback: () => void) => { assert.equal(callback, modernCallback); removed += 1; },
  }) };
  const stopModern = subscribeMobileEditorLayout(() => { calls += 1; });
  modernCallback?.();
  stopModern();
  assert.equal(calls, 2);
  assert.equal(removed, 2);

  const state = { items: [
    { id: 'one', kind: 'audio', src: '/one.mp3', startFrame: 0, durationInFrames: 60, track: 'A1' },
    { id: 'two', kind: 'audio', src: '/two.mp3', startFrame: 30, durationInFrames: 60, track: 'A2' },
  ], tracks: { A1: {}, A2: {} } } as TimelineState;
  assert.equal(previewAudioTagCount(state), 4, 'only actual peak demand plus two shared audio tags');
} finally {
  if (prior) Object.defineProperty(globalThis, 'window', prior);
  else delete globals.window;
}
console.log('mobileEditorCompatibility.verify: OK (modern and legacy media queries; bounded audio pool)');
