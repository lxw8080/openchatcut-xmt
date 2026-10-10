import type { AtomicAction } from './reduce';
import type { ClipTransform, TimelineItem, TimelineState } from './types';
import { mgLayoutEnabled } from './mgLayoutGeometry';

/** Move the entire animation curve, keeping its timing and relative motion. */
export function mgLayoutActions(state: TimelineState, id: string, patch: ClipTransform): AtomicAction[] {
  const item = state.items.find(i => i.id === id);
  if (!item || !mgLayoutEnabled(item)) return [{ type: 'setTransform', id, patch }];
  const meta = item.props?._xmt as Record<string, unknown> | undefined;
  const peers = meta?.stillId ? state.items.filter(i => {
    const m = i.props?._xmt as Record<string, unknown> | undefined;
    return i.id !== id && m?.stillId === meta.stillId && (i.kind === 'image' || i.templateId === 'xmt-still-marks');
  }) : [];
  const actions: AtomicAction[] = [];
  for (const target of [item, ...peers]) {
    const next: ClipTransform = target === item ? { ...patch } : {};
    const uniformRatio = patch.scale === undefined ? 1 : patch.scale / Math.max(.0001, item.transform?.scale ?? 1);
    for (const prop of ['x', 'y', 'scale', 'scaleX', 'scaleY'] as const) {
      if ((prop === 'scaleX' || prop === 'scaleY') && patch.scale !== undefined) {
        // Static axes take precedence over the uniform animation curve.
        next[prop] = undefined;
        for (const kf of target.keyframes?.[prop] ?? []) actions.push({ type:'setKeyframe',id:target.id,prop,frame:kf.frame,value:kf.value*uniformRatio,easing:kf.easing });
        continue;
      }
      if (patch[prop] === undefined && !(patch.scale !== undefined && (prop === 'x' || prop === 'y'))) continue;
      const original = item.transform?.[prop] ?? (prop.startsWith('scale') ? item.transform?.scale ?? 1 : 0);
      const base = target.transform?.[prop] ?? (prop.startsWith('scale') ? target.transform?.scale ?? 1 : 0);
      const ratio = prop.startsWith('scale') ? patch[prop]! / Math.max(.0001, original) : 1;
      next[prop] = prop.startsWith('scale') ? base * ratio : (patch[prop] ?? original) + (base - original) * uniformRatio;
      for (const kf of target.keyframes?.[prop] ?? []) {
        actions.push({ type: 'setKeyframe', id: target.id, prop, frame: kf.frame,
          value: prop.startsWith('scale') ? kf.value * ratio : (kf.value - base) * uniformRatio + next[prop]!, easing: kf.easing });
      }
    }
    actions.push({ type: 'setTransform', id: target.id, patch: next });
  }
  return actions;
}

export function layoutBase(item: TimelineItem) {
  const meta = item.props?._xmt as Record<string, unknown> | undefined;
  const spec = meta?.composition as {rect?:{x:number;y:number;w:number;h:number}} | undefined;
  const rect = spec?.rect;
  return (meta?.layoutSystemTransform as ClipTransform | undefined) ?? (rect ? {x:(rect.x+rect.w/2-.5)*100,y:(rect.y+rect.h/2-.5)*100,scale:1} : { x: 0, y: 0, scale: 1 });
}
