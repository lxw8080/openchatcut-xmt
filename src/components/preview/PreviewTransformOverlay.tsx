import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { PlayerRef } from '@remotion/player';
import type { ClipCrop, ClipTransform, KeyframeProp, TimelineItem, TimelineState } from '../../editor/types';
import { cornerScale, mgLayoutEnabled } from '../../editor/mgLayoutGeometry';
import { t } from '../../i18n/locale';
import {
  constrainMoveDeltaToAxis,
  cyclePreviewCandidate,
  edgeCropPreviewTransform,
  hitPreviewCandidates,
  movePreviewTransform,
  previewCandidateGeometry,
  previewEdgeMidpoints,
  rotatePreviewTransform,
  uniformScaleAxesPreviewTransform,
  visiblePreviewCandidates,
  type ClickCycleState,
  type EffectivePreviewTransform,
  type PreviewPoint,
  type PreviewScaleEdge,
  type PreviewSize,
} from './previewTransform';
import { canPreviewTextEdit, previewTextEditFields } from './previewTextEdit';
import { PreviewTextEditBar } from './PreviewTextEditBar';

export interface PreviewTransformOverlayProps {
  state: TimelineState;
  playerRef: RefObject<PlayerRef | null>;
  onSelectItem: (id: string | null) => void;
  onSetItemTransform: (id: string, patch: ClipTransform) => void;
  onSetItemKeyframe: (id: string, prop: KeyframeProp, localFrame: number, value: number) => void;
  onBeginHistoryGesture: () => void;
  onEndHistoryGesture: () => void;
  /** Live text style edits for text / text-like MG clips. */
  onItemPropChange?: (id: string, key: string, value: unknown) => void;
  onSeedChat?: (text: string) => void;
}

const DOUBLE_CLICK_MS = 320;

type GestureMode = 'move' | 'scale' | 'crop-edge' | 'rotate';

interface GestureState {
  pointerId: number;
  item: TimelineItem;
  mode: GestureMode;
  /** When mode is crop-edge, which edge is being dragged. */
  edge?: PreviewScaleEdge;
  /** Crop snapshot at pointer-down (edge crop keeps the opposite side fixed). */
  startCrop?: ClipCrop;
  corner?: number;
  baseRect?: {x:number;y:number;width:number;height:number};
  startUi: PreviewPoint;
  /** Latest pointer position in overlay UI space (for Shift keyup/keydown without move). */
  lastUi: PreviewPoint;
  startComposition: PreviewPoint;
  center: PreviewPoint;
  previewSize: PreviewSize;
  transform: EffectivePreviewTransform;
  localFrame: number;
  moved: boolean;
}

type TransformWriteProp = 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotation';

interface PendingValues {
  item: TimelineItem;
  localFrame: number;
  values: Partial<Record<TransformWriteProp, number>>;
  /** Edge crop writes the full crop object (or undefined to clear). */
  crop?: ClipCrop | undefined;
  cropTouched?: boolean;
}

const CLICK_TOLERANCE = 4;
const DRAG_THRESHOLD = 3;

const uiPoint = (event: ReactPointerEvent, rect: DOMRect): PreviewPoint => ({
  x: event.clientX - rect.left,
  y: event.clientY - rect.top,
});

const compositionPoint = (
  point: PreviewPoint,
  rect: DOMRect,
  state: Pick<TimelineState, 'width' | 'height'>,
): PreviewPoint => ({
  x: rect.width > 0 ? point.x / rect.width * state.width : 0,
  y: rect.height > 0 ? point.y / rect.height * state.height : 0,
});

const EDGE_HANDLES = new Set<string>(['crop-n', 'crop-s', 'crop-e', 'crop-w']);

const handleMode = (target: EventTarget | null): { mode: GestureMode; edge?: PreviewScaleEdge } | null => {
  const handle = target instanceof Element ? target.closest<HTMLElement>('[data-preview-handle]') : null;
  const value = handle?.dataset.previewHandle;
  if (value === 'rotate') return { mode: 'rotate' };
  if (value && EDGE_HANDLES.has(value)) {
    return { mode: 'crop-edge', edge: value.slice('crop-'.length) as PreviewScaleEdge };
  }
  if (value?.startsWith('scale-')) return { mode: 'scale' };
  return null;
};

export function PreviewTransformOverlay({
  state,
  playerRef,
  onSelectItem,
  onSetItemTransform,
  onSetItemKeyframe,
  onBeginHistoryGesture,
  onEndHistoryGesture,
  onItemPropChange,
  onSeedChat,
}: PreviewTransformOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(() => Math.round(playerRef.current?.getCurrentFrame() ?? 0));
  const [previewSize, setPreviewSize] = useState<PreviewSize>({ width: state.width, height: state.height });
  const [boundsVersion, setBoundsVersion] = useState(0);
  useEffect(() => { const refresh = () => setBoundsVersion(n => n + 1); window.addEventListener('xmt-mg-bounds', refresh); return () => window.removeEventListener('xmt-mg-bounds', refresh); }, []);
  const [textAutoEdit, setTextAutoEdit] = useState(false);
  const lastClickRef = useRef<{ id: string; at: number } | null>(null);
  const cycleRef = useRef<ClickCycleState | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const pendingRef = useRef<PendingValues | null>(null);
  const commitRafRef = useRef(0);
  const endHistoryRef = useRef(onEndHistoryGesture);
  endHistoryRef.current = onEndHistoryGesture;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setPreviewSize({ width: root.clientWidth, height: root.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return undefined;
    setFrame(Math.round(player.getCurrentFrame()));
    let paintRaf = 0;
    let pendingFrame: number | null = null;
    const onFrame = (event: { detail: { frame: number } }) => {
      pendingFrame = Math.round(event.detail.frame);
      if (paintRaf) return;
      paintRaf = requestAnimationFrame(() => {
        paintRaf = 0;
        if (pendingFrame != null) setFrame(pendingFrame);
        pendingFrame = null;
      });
    };
    player.addEventListener('frameupdate', onFrame);
    return () => {
      if (paintRaf) cancelAnimationFrame(paintRaf);
      player.removeEventListener('frameupdate', onFrame);
    };
  }, [playerRef]);

  const candidates = useMemo(() => visiblePreviewCandidates(state, frame), [frame, state]);
  const selectedCandidate = useMemo(
    () => state.width > 0 && state.height > 0
      ? candidates.find(({ item }) => item.id === state.selectedId) ?? null
      : null,
    [candidates, state.height, state.selectedId, state.width],
  );
  const selection = useMemo(
    () => selectedCandidate ? previewCandidateGeometry(state, selectedCandidate) : null,
    [selectedCandidate, state, boundsVersion],
  );

  useEffect(() => {
    cycleRef.current = null;
  }, [frame, state.height, state.width]);

  useEffect(() => {
    setTextAutoEdit(false);
    lastClickRef.current = null;
  }, [state.selectedId]);

  const commitPending = useCallback(() => {
    if (commitRafRef.current) {
      cancelAnimationFrame(commitRafRef.current);
      commitRafRef.current = 0;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const patch: ClipTransform = {};
    for (const [prop, value] of Object.entries(pending.values) as Array<[TransformWriteProp, number]>) {
      if (mgLayoutEnabled(pending.item)) {
        patch[prop] = value;
      } else if (pending.item.keyframes?.[prop]?.length) {
        onSetItemKeyframe(pending.item.id, prop, pending.localFrame, value);
      } else {
        patch[prop] = value;
      }
    }
    if (pending.cropTouched) patch.crop = pending.crop;
    if (Object.keys(patch).length) onSetItemTransform(pending.item.id, patch);
  }, [onSetItemKeyframe, onSetItemTransform]);

  const queueValues = useCallback((pending: PendingValues) => {
    if (mgLayoutEnabled(pending.item)) {
      const g = gestureRef.current;
      if (g) {
        const ratio = (pending.values.scale ?? g.transform.scale) / Math.max(.0001,g.transform.scale);
        const base = pending.item.transform ?? {};
        if (pending.values.x !== undefined) pending.values.x = (base.x ?? 0) + pending.values.x - g.transform.x + (ratio-1)*((base.x ?? 0)-g.transform.x);
        if (pending.values.y !== undefined) pending.values.y = (base.y ?? 0) + pending.values.y - g.transform.y + (ratio-1)*((base.y ?? 0)-g.transform.y);
        if (pending.values.scale !== undefined) {
          pending.values.scale = (base.scale ?? 1)*ratio;
          delete pending.values.scaleX; delete pending.values.scaleY;
        }
      }
    }
    pendingRef.current = pending;
    if (commitRafRef.current) return;
    commitRafRef.current = requestAnimationFrame(() => {
      commitRafRef.current = 0;
      commitPending();
    });
  }, [commitPending]);

  const finishGesture = useCallback((resetCycle: boolean) => {
    if (!gestureRef.current) return;
    commitPending();
    gestureRef.current = null;
    if (resetCycle) cycleRef.current = null;
    onEndHistoryGesture();
  }, [commitPending, onEndHistoryGesture]);

  const applyMoveGesture = useCallback((gesture: GestureState, shiftKey: boolean) => {
    const delta = {
      x: gesture.lastUi.x - gesture.startUi.x,
      y: gesture.lastUi.y - gesture.startUi.y,
    };
    const locked = constrainMoveDeltaToAxis(delta, shiftKey);
    const moved = movePreviewTransform(gesture.transform, locked, gesture.previewSize);
    queueValues({ item: gesture.item, localFrame: gesture.localFrame, values: moved });
  }, [queueValues]);

  useEffect(() => () => {
    if (commitRafRef.current) cancelAnimationFrame(commitRafRef.current);
    if (gestureRef.current) endHistoryRef.current();
    gestureRef.current = null;
    pendingRef.current = null;
  }, []);

  useEffect(() => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const track = state.tracks?.[gesture.item.track];
    const stillExists = state.items.some((item) => item.id === gesture.item.id);
    if (!stillExists || track?.hidden || track?.locked || state.selectedId !== gesture.item.id) {
      finishGesture(true);
    }
  }, [finishGesture, state.items, state.selectedId, state.tracks]);

  // Shift may change while the pointer is still — re-apply move from lastUi immediately.
  useEffect(() => {
    const onShift = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') return;
      const gesture = gestureRef.current;
      if (!gesture || gesture.mode !== 'move' || !gesture.moved) return;
      // Prefer shiftKey over event.type so Left/Right Shift don't unlock early.
      applyMoveGesture(gesture, event.shiftKey);
    };
    window.addEventListener('keydown', onShift);
    window.addEventListener('keyup', onShift);
    return () => {
      window.removeEventListener('keydown', onShift);
      window.removeEventListener('keyup', onShift);
    };
  }, [applyMoveGesture]);

  const updateGesture = useCallback((event: ReactPointerEvent) => {
    const gesture = gestureRef.current;
    const root = rootRef.current;
    if (!gesture || !root || gesture.pointerId !== event.pointerId) return;
    const rect = root.getBoundingClientRect();
    const currentUi = uiPoint(event, rect);
    const currentComposition = compositionPoint(currentUi, rect, state);
    gesture.lastUi = currentUi;
    const delta = { x: currentUi.x - gesture.startUi.x, y: currentUi.y - gesture.startUi.y };
    if (!gesture.moved && Math.hypot(delta.x, delta.y) >= DRAG_THRESHOLD) gesture.moved = true;
    if (!gesture.moved) return;

    if (gesture.mode === 'move') {
      applyMoveGesture(gesture, event.shiftKey);
    } else if (gesture.mode === 'scale') {
      queueValues({
        item: gesture.item,
        localFrame: gesture.localFrame,
        values: mgLayoutEnabled(gesture.item) && gesture.corner !== undefined && gesture.baseRect
          ? cornerScale({x:gesture.transform.x,y:gesture.transform.y,scale:gesture.transform.scale},
              {x:gesture.baseRect.x/state.width,y:gesture.baseRect.y/state.height,w:gesture.baseRect.width/state.width,h:gesture.baseRect.height/state.height},
              gesture.corner, {x:currentComposition.x/state.width,y:currentComposition.y/state.height})
          : uniformScaleAxesPreviewTransform(gesture.transform,gesture.center,gesture.startComposition,currentComposition),
      });
    } else if (gesture.mode === 'crop-edge' && gesture.edge) {
      const { crop } = edgeCropPreviewTransform(
        state,
        gesture.transform,
        gesture.startCrop,
        currentComposition,
        gesture.edge,
      );
      queueValues({
        item: gesture.item,
        localFrame: gesture.localFrame,
        values: {},
        crop,
        cropTouched: true,
      });
    } else {
      queueValues({
        item: gesture.item,
        localFrame: gesture.localFrame,
        values: {
          rotation: rotatePreviewTransform(
            gesture.transform.rotation,
            gesture.center,
            gesture.startComposition,
            currentComposition,
          ),
        },
      });
    }
  }, [applyMoveGesture, queueValues, state]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gestureRef.current) return;
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    event.currentTarget.focus({ preventScroll: true });
    const pointUi = uiPoint(event, rect);
    const pointComposition = compositionPoint(pointUi, rect, state);
    const modeFromHandle = handleMode(event.target);
    let candidate = selectedCandidate;
    let mode: GestureMode = modeFromHandle?.mode ?? 'move';
    let edge = modeFromHandle?.edge;

    if (!modeFromHandle) {
      const hits = hitPreviewCandidates(state, frame, pointComposition);
      const cycled = cyclePreviewCandidate(cycleRef.current, pointUi, hits, CLICK_TOLERANCE);
      if (!cycled) {
        cycleRef.current = null;
        onSelectItem(null);
        return;
      }
      cycleRef.current = cycled.next;
      candidate = hits.find(({ item }) => item.id === cycled.id) ?? null;
      if (!candidate) return;
      onSelectItem(candidate.item.id);
      mode = 'move';
      edge = undefined;
    }

    if (!candidate) return;
    event.preventDefault();
    event.stopPropagation();
    playerRef.current?.pause();
    setFrame(Math.round(playerRef.current?.getCurrentFrame() ?? frame));
    event.currentTarget.setPointerCapture(event.pointerId);
    const geometry = previewCandidateGeometry(state, candidate);
    gestureRef.current = {
      pointerId: event.pointerId,
      item: candidate.item,
      mode,
      corner: modeFromHandle?.mode === 'scale' ? Number((event.target as HTMLElement).closest<HTMLElement>('[data-preview-handle]')?.dataset.previewHandle?.split('-')[1]) : undefined,
      baseRect: geometry.baseRect,
      edge,
      startCrop: candidate.item.transform?.crop,
      startUi: pointUi,
      lastUi: pointUi,
      startComposition: pointComposition,
      center: geometry.center,
      previewSize: { width: rect.width, height: rect.height },
      transform: candidate.transform,
      localFrame: candidate.localFrame,
      moved: false,
    };
    onBeginHistoryGesture();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    updateGesture(event);
    const moved = gesture.moved;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!moved && canPreviewTextEdit(gesture.item) && previewTextEditFields(gesture.item)?.textKey) {
      const now = Date.now();
      const prev = lastClickRef.current;
      if (prev && prev.id === gesture.item.id && now - prev.at <= DOUBLE_CLICK_MS) {
        lastClickRef.current = null;
        setTextAutoEdit(true);
      } else {
        lastClickRef.current = { id: gesture.item.id, at: now };
      }
    } else {
      lastClickRef.current = null;
    }
    finishGesture(moved);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    finishGesture(true);
  };

  const rotateHandle = useMemo(() => {
    if (!selection) return null;
    const top = {
      x: (selection.corners[0].x + selection.corners[1].x) / 2,
      y: (selection.corners[0].y + selection.corners[1].y) / 2,
    };
    const dx = top.x - selection.center.x;
    const dy = top.y - selection.center.y;
    const length = Math.hypot(dx, dy) || 1;
    const compositionOffset = previewSize.height > 0 ? 28 * state.height / previewSize.height : 28;
    return {
      stem: top,
      handle: { x: top.x + dx / length * compositionOffset, y: top.y + dy / length * compositionOffset },
    };
  }, [previewSize.height, selection, state.height]);

  const percentPosition = (point: PreviewPoint) => ({
    left: `${point.x / state.width * 100}%`,
    top: `${point.y / state.height * 100}%`,
  });

  const edgeMidpoints = selection ? previewEdgeMidpoints(selection.corners) : null;
  const edgeHandles: Array<{ edge: PreviewScaleEdge; label: string; className: string }> = [
    { edge: 'n', label: t('裁切上边（拖入则遮住上方）'), className: 'cc-preview-transform-crop-n' },
    { edge: 's', label: t('裁切下边（拖入则遮住下方）'), className: 'cc-preview-transform-crop-s' },
    { edge: 'e', label: t('裁切右边（拖入则遮住右侧）'), className: 'cc-preview-transform-crop-e' },
    { edge: 'w', label: t('裁切左边（拖入则遮住左侧）'), className: 'cc-preview-transform-crop-w' },
  ];

  return (
    <div
      ref={rootRef}
      className="cc-preview-transform-overlay"
      role="group"
      aria-label={t('预览画布片段变换')}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={updateGesture}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={() => finishGesture(true)}
    >
      {selection && rotateHandle && (
        <>
          <svg
            className="cc-preview-transform-outline"
            viewBox={`0 0 ${state.width} ${state.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {mgLayoutEnabled(selectedCandidate!.item) && <g stroke="#22d3ee66" strokeDasharray="6 6" fill="none" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <rect x="0" y="0" width={state.width} height={state.height} />
              <line x1={state.width/2} y1="0" x2={state.width/2} y2={state.height} />
              <line x1="0" y1={state.height/2} x2={state.width} y2={state.height/2} />
              <rect x="0" y={state.height-(state.height>state.width?166:141)} width={state.width} height={state.height>state.width?166:141} fill="#fb718511" stroke="#fb7185aa" />
            </g>}
            <polygon
              data-preview-selection={selectedCandidate!.item.id}
              points={selection.corners.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke="var(--cc-accent)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={rotateHandle.stem.x}
              y1={rotateHandle.stem.y}
              x2={rotateHandle.handle.x}
              y2={rotateHandle.handle.y}
              stroke="var(--cc-accent)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {selection.corners.map((point, index) => (
            <button
              key={index}
              type="button"
              className={`cc-preview-transform-handle cc-preview-transform-scale cc-preview-transform-scale-${index}`}
              data-preview-handle={`scale-${index}`}
              aria-label={t('从角点 {n} 等比缩放片段', { n: index + 1 })}
              style={percentPosition(point)}
            />
          ))}
          {!mgLayoutEnabled(selectedCandidate!.item) && edgeMidpoints && edgeHandles.map(({ edge, label, className }) => (
            <button
              key={edge}
              type="button"
              className={`cc-preview-transform-handle cc-preview-transform-crop ${className}`}
              data-preview-handle={`crop-${edge}`}
              aria-label={label}
              style={percentPosition(edgeMidpoints[edge])}
            />
          ))}
          {!mgLayoutEnabled(selectedCandidate!.item) && <button
            type="button"
            className="cc-preview-transform-handle cc-preview-transform-rotate"
            data-preview-handle="rotate"
            aria-label={t('旋转片段')}
            style={percentPosition(rotateHandle.handle)}
          />}
          {onItemPropChange
            && selectedCandidate
            && previewTextEditFields(selectedCandidate.item)
            && (
              <PreviewTextEditBar
                item={selectedCandidate.item}
                selection={selection}
                composition={{ width: state.width, height: state.height }}
                onPropChange={onItemPropChange}
                onSeedChat={onSeedChat}
                autoEdit={textAutoEdit}
                onAutoEditHandled={() => setTextAutoEdit(false)}
              />
            )}
        </>
      )}
    </div>
  );
}
