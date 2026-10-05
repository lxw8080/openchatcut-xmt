/** Review uses the native graph gate and native source-time mapping. */
import type { ProjectDoc, Timeline } from '../editor/types';
import { resolveTimelineRenderPlan } from '../editor/sequenceGraph';
import { sourceFrameAt } from '../editor/sourceLimit';

export function inspectProject(doc: ProjectDoc) {
  const root = doc.timelines.find((t) => t.id === doc.activeTimelineId)!;
  const plan = resolveTimelineRenderPlan(doc, root.id);
  const rows: unknown[] = [];
  const transitions: unknown[] = [];
  const visit = (timeline: Timeline, path: string[], toRoot: (local: number) => number,
    fromRoot: (frame: number) => number, range: [number, number], inheritedMuted: boolean) => {
    const idAt = (id: string) => path.length ? [...path, id].join('/') : id;
    for (const tr of timeline.transitions ?? []) {
      const incoming = timeline.items.find((i) => i.id === tr.incomingItemId);
      const outgoing = timeline.items.find((i) => i.id === tr.outgoingItemId);
      if (!incoming || !outgoing || tr.enabled === false || timeline.tracks?.[tr.trackId]?.hidden) continue;
      const localStart = incoming.startFrame - Math.floor(tr.durationInFrames / 2);
      const start = Math.max(range[0], Math.ceil(toRoot(localStart)));
      const end = Math.min(range[1], Math.ceil(toRoot(localStart + tr.durationInFrames)));
      if (end <= start) continue;
      transitions.push({ ...tr, id: idAt(tr.id), native_id: tr.id,
        incomingItemId: idAt(incoming.id), outgoingItemId: idAt(outgoing.id),
        timeline_id: timeline.id, instance_path: [...path, tr.id],
        review_start_frame: start, durationInFrames: end-start });
    }
    for (const item of timeline.items) {
      if (timeline.tracks?.[item.track]?.hidden) continue;
      const start = Math.max(range[0], Math.ceil(toRoot(item.startFrame)));
      const end = Math.min(range[1], Math.ceil(toRoot(item.startFrame + item.durationInFrames)));
      if (end <= start) continue;
      const rate = item.playbackRate ?? 1;
      const itemPath = [...path, item.id];
      const instanceId = path.length ? itemPath.join('/') : item.id;
      const muted = inheritedMuted || !!timeline.tracks?.[item.track]?.muted;
      rows.push({ item: { ...item, id: instanceId, startFrame: start, durationInFrames: end - start,
        srcInFrame: sourceFrameAt(item, fromRoot(start) - item.startFrame),
        playbackRate: rate * (fromRoot(start + 1) - fromRoot(start)) },
        native_id: item.id, instance_path: itemPath, timeline_id: timeline.id, muted,
        local_start_frame: item.startFrame, local_duration_frames: item.durationInFrames,
        root_origin: toRoot(item.startFrame), root_frames_per_local: toRoot(item.startFrame + 1) - toRoot(item.startFrame),
        events: Array.isArray(item.props?.events)
          ? (item.props.events as any[]).map((event) => ({ ...event,
              at_ms: event.at_frame * 1000 / timeline.fps, duration_ms: event.duration_frames * 1000 / timeline.fps }))
          : (item.props?._xmt as any)?.events ?? [] });
      if (item.kind === 'sequence') {
        const child = doc.timelines.find((t) => t.id === item.timelineId)!;
        const sourceStart = sourceFrameAt(item, 0);
        const childToRoot = (frame: number) => toRoot(item.startFrame + (frame - sourceStart) / rate);
        const childFromRoot = (frame: number) => sourceStart + (fromRoot(frame) - item.startFrame) * rate;
        visit(child, itemPath, childToRoot, childFromRoot, [start, end], muted);
      }
    }
  };
  visit(root, [], (f) => f, (f) => f, [0, plan.durationInFrames], false);
  return { fps: root.fps, timeline_id: root.id, duration_frames: plan.durationInFrames, items: rows, transitions };
}
