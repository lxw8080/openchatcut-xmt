import assert from 'node:assert/strict';
import { isStaticallySilent } from './staticSilence';

assert.equal(isStaticallySilent({ volume: 0 }), true);
assert.equal(isStaticallySilent({}), false);
assert.equal(isStaticallySilent({ volume: 1 }), false);
assert.equal(isStaticallySilent({ volume: 0, keyframes: { volume: [
  { frame: 0, value: 0 }, { frame: 20, value: 1 },
] } }), false);
assert.equal(isStaticallySilent({ volume: 1, keyframes: { volume: [
  { frame: 0, value: 0, easing: 'easeInOut' }, { frame: 20, value: 0 },
] } }), true);
assert.equal(isStaticallySilent({ volume: 0, keyframes: { volume: [] } }), true);
console.log('static silence: audible keyframes preserved');
