/** Preview-space pointer delta (pixels relative to pointerdown). */
export type MoveDelta = { x: number; y: number };

/**
 * When Shift is held, lock move to the dominant axis from the gesture origin
 * (|dx| >= |dy| → horizontal; otherwise vertical). Without Shift, return delta unchanged.
 */
export function constrainMoveDeltaToAxis(delta: MoveDelta, shiftKey: boolean): MoveDelta {
  if (!shiftKey) return delta;
  if (Math.abs(delta.x) >= Math.abs(delta.y)) return { x: delta.x, y: 0 };
  return { x: 0, y: delta.y };
}
