import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { loadTimelineView, saveTimelineView } from '../../persist/sessionPrefs';
import {
  anchoredTimelineScrollLeft,
  anchoredTimelineScrollLeftForFrame,
  defaultTimelineZoom,
  fitTimelineZoom,
  scaleTimelineZoom,
} from '../../editor/timelineZoom';
import {
  scrollLeftToCenterFrame,
  wheelHorizontalDelta,
  wheelShouldHorizontalScroll,
} from '../../editor/timelineViewport';
import {
  HEADER_W,
  MIN_TIME_ZOOM,
  PX_PER_FRAME,
  RULER_LABEL_MIN_PX,
} from './timelineUtil';

const TIME_LIMITS = { min: MIN_TIME_ZOOM, max: 6 };
const TRACK_MIN = 0.6;
const TRACK_MAX = 3;
const TIMELINE_FIT_PADDING = 48;
type NumberSetter = Dispatch<SetStateAction<number>>;

export type TimelineZoomAnchor =
  | 'playhead'
  | { pointerViewportX: number };

interface TimelineZoomControllerOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Playhead frame; used when zoom anchor is 'playhead'. */
  playheadRef: MutableRefObject<number>;
  /** Called when the user pans the timeline horizontally (wheel / later pan). */
  onUserScroll?: () => void;
  totalFrames: number;
  fps: number;
  projectId?: string;
  timelineId?: string;
}

interface ZoomViewState {
  key: string;
  zoom: number;
  trackScale: number;
}

function fittedZoom(element: HTMLDivElement, totalFrames: number, fps: number): number {
  return fitTimelineZoom(
    element.clientWidth, HEADER_W, TIMELINE_FIT_PADDING, totalFrames, PX_PER_FRAME, TIME_LIMITS,
  ) ?? defaultTimelineZoom(fps, PX_PER_FRAME, RULER_LABEL_MIN_PX, TIME_LIMITS);
}

function useTimelineWheelGestures(
  scrollRef: RefObject<HTMLDivElement | null>,
  zoom: number,
  commitZoom: (next: number, anchor: TimelineZoomAnchor) => void,
  setTrackScale: NumberSetter,
  onUserScroll?: () => void,
) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onUserScrollRef = useRef(onUserScroll);
  onUserScrollRef.current = onUserScroll;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const oldZoom = zoomRef.current;
        const next = scaleTimelineZoom(oldZoom, event.deltaY < 0 ? 1.12 : 1 / 1.12, TIME_LIMITS);
        if (next === oldZoom) return;
        const pointerViewportX = event.clientX - element.getBoundingClientRect().left;
        commitZoom(next, { pointerViewportX });
        return;
      }
      if (event.altKey) {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        setTrackScale((current) => Math.min(TRACK_MAX, Math.max(TRACK_MIN, current * factor)));
        return;
      }
      if (!wheelShouldHorizontalScroll(event)) return;
      event.preventDefault();
      element.scrollLeft += wheelHorizontalDelta(event);
      onUserScrollRef.current?.();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [commitZoom, scrollRef, setTrackScale]);
}

export function useTimelineZoomController(options: TimelineZoomControllerOptions) {
  const { scrollRef, playheadRef, onUserScroll, totalFrames, fps, projectId, timelineId } = options;
  const key = `${projectId ?? 'default'}\u0000${timelineId ?? 'default'}`;
  const [view, setView] = useState<ZoomViewState>({ key: '', zoom: 1, trackScale: 1 });
  const totalFramesRef = useRef(totalFrames);
  totalFramesRef.current = totalFrames;
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const zoom = view.key === key ? view.zoom : 1;
  const trackScale = view.key === key ? view.trackScale : 1;
  const viewByKeyRef = useRef<Record<string, Pick<ZoomViewState, 'zoom' | 'trackScale'>>>({});
  if (view.key) viewByKeyRef.current[view.key] = { zoom: view.zoom, trackScale: view.trackScale };
  const pendingAutoFitRef = useRef<string | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const setZoomValue = useCallback((value: number) => {
    setView((current) => {
      const base = current.key === key ? current : { key, zoom: 1, trackScale: 1 };
      return value === base.zoom ? base : { ...base, zoom: value };
    });
  }, [key]);

  const applyCenteredScroll = useCallback((element: HTMLDivElement, nextZoom: number, frame: number) => {
    const nextScroll = scrollLeftToCenterFrame(
      Math.max(0, frame),
      HEADER_W,
      PX_PER_FRAME * nextZoom,
      element.clientWidth,
    );
    requestAnimationFrame(() => { element.scrollLeft = nextScroll; });
  }, []);

  /** Change zoom while keeping the chosen anchor fixed on screen. */
  const commitZoom = useCallback((nextZoom: number, anchor: TimelineZoomAnchor = 'playhead') => {
    const element = scrollRef.current;
    const oldZoom = zoomRef.current;
    if (nextZoom === oldZoom) return;
    if (!element) {
      setZoomValue(nextZoom);
      return;
    }
    const oldPx = PX_PER_FRAME * oldZoom;
    const newPx = PX_PER_FRAME * nextZoom;
    const nextScroll = anchor === 'playhead'
      ? anchoredTimelineScrollLeftForFrame(
        element.scrollLeft,
        Math.max(0, playheadRef.current),
        HEADER_W,
        oldPx,
        newPx,
      )
      : anchoredTimelineScrollLeft(
        element.scrollLeft,
        anchor.pointerViewportX,
        HEADER_W,
        oldPx,
        newPx,
      );
    setZoomValue(nextZoom);
    requestAnimationFrame(() => { element.scrollLeft = nextScroll; });
  }, [playheadRef, scrollRef, setZoomValue]);

  const setZoom = useCallback<NumberSetter>((next) => {
    const oldZoom = zoomRef.current;
    const value = typeof next === 'function' ? next(oldZoom) : next;
    commitZoom(Math.min(TIME_LIMITS.max, Math.max(TIME_LIMITS.min, value)), 'playhead');
  }, [commitZoom]);

  const setTrackScale = useCallback<NumberSetter>((next) => {
    setView((current) => {
      const base = current.key === key ? current : { key, zoom: 1, trackScale: 1 };
      const value = typeof next === 'function' ? next(base.trackScale) : next;
      return value === base.trackScale ? base : { ...base, trackScale: value };
    });
  }, [key]);

  useEffect(() => {
    const element = scrollRef.current;
    const views = viewByKeyRef.current;
    if (!element) return;
    const saved = projectId && timelineId ? loadTimelineView(projectId, timelineId) : null;
    const nextZoom = saved?.zoom ?? (totalFramesRef.current > 0
      ? fittedZoom(element, totalFramesRef.current, fpsRef.current)
      : defaultTimelineZoom(fpsRef.current, PX_PER_FRAME, RULER_LABEL_MIN_PX, TIME_LIMITS));
    pendingAutoFitRef.current = !saved && totalFramesRef.current <= 0 ? key : null;
    setView({ key, zoom: nextZoom, trackScale: saved?.trackScale ?? 1 });
    element.scrollLeft = saved?.scrollLeft ?? 0;
    return () => {
      if (projectId && timelineId) {
        const previous = views[key] ?? { zoom: nextZoom, trackScale: saved?.trackScale ?? 1 };
        saveTimelineView(projectId, timelineId, {
          zoom: previous.zoom,
          trackScale: previous.trackScale,
          scrollLeft: element.scrollLeft,
        });
      }
    };
  }, [key, projectId, scrollRef, timelineId]);

  useEffect(() => {
    if (view.key !== key || !projectId || !timelineId) return;
    saveTimelineView(projectId, timelineId, { zoom: view.zoom, trackScale: view.trackScale });
  }, [key, projectId, timelineId, view]);

  useEffect(() => {
    if (pendingAutoFitRef.current !== key || totalFrames <= 0) return;
    const element = scrollRef.current;
    if (!element) return;
    pendingAutoFitRef.current = null;
    const nextZoom = fittedZoom(element, totalFrames, fps);
    setZoomValue(nextZoom);
    applyCenteredScroll(element, nextZoom, playheadRef.current);
  }, [applyCenteredScroll, fps, key, playheadRef, scrollRef, setZoomValue, totalFrames]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !projectId || !timelineId) return;
    let raf = 0;
    const saveScroll = () => {
      raf = 0;
      saveTimelineView(projectId, timelineId, { scrollLeft: element.scrollLeft });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(saveScroll);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      saveScroll();
      element.removeEventListener('scroll', onScroll);
    };
  }, [projectId, scrollRef, timelineId]);

  useTimelineWheelGestures(scrollRef, zoom, commitZoom, setTrackScale, onUserScroll);

  const zoomBy = useCallback(
    (factor: number) => commitZoom(scaleTimelineZoom(zoomRef.current, factor, TIME_LIMITS), 'playhead'),
    [commitZoom],
  );
  const fitToView = useCallback(() => {
    const element = scrollRef.current;
    if (!element || totalFrames <= 0) return;
    pendingAutoFitRef.current = null;
    const nextZoom = fittedZoom(element, totalFrames, fps);
    setZoomValue(nextZoom);
    applyCenteredScroll(element, nextZoom, playheadRef.current);
  }, [applyCenteredScroll, fps, playheadRef, scrollRef, setZoomValue, totalFrames]);

  return {
    zoom,
    setZoom,
    zoomBy,
    fitToView,
    pixelsPerFrame: PX_PER_FRAME * zoom,
    trackScale,
  };
}
