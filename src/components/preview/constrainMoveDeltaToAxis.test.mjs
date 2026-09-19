import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { constrainMoveDeltaToAxis } from './constrainMoveDeltaToAxis.ts';

describe('constrainMoveDeltaToAxis', () => {
  it('passes through when Shift is not held', () => {
    assert.deepEqual(constrainMoveDeltaToAxis({ x: 12, y: -8 }, false), { x: 12, y: -8 });
  });

  it('locks to horizontal when |dx| > |dy|', () => {
    assert.deepEqual(constrainMoveDeltaToAxis({ x: 20, y: 5 }, true), { x: 20, y: 0 });
  });

  it('locks to vertical when |dy| > |dx|', () => {
    assert.deepEqual(constrainMoveDeltaToAxis({ x: 3, y: -18 }, true), { x: 0, y: -18 });
  });

  it('prefers horizontal on equal |dx| and |dy|', () => {
    assert.deepEqual(constrainMoveDeltaToAxis({ x: -10, y: 10 }, true), { x: -10, y: 0 });
  });

  it('handles zero delta with Shift', () => {
    assert.deepEqual(constrainMoveDeltaToAxis({ x: 0, y: 0 }, true), { x: 0, y: 0 });
  });
});
