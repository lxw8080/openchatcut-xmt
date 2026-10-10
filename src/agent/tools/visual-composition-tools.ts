import { layoutDefault, loadLayoutDefaults } from '../../xmt/mgLayoutDefaults';
import { xmtHost } from '../../xmt/host';
/** Execute reviewed XMT component nodes as native, editable child timelines.
 * The XMT shared builder owns component macros; this entry owns ms -> frames.
 * No JSX is accepted in the call. MG code comes exclusively from ctx.templates.
 */
import type { AgentContext } from '../context';
import type { ItemKeyframes, Timeline, TimelineItem } from '../../editor/types';
import { resolveTimelineRenderPlan, sequenceReferencesTo } from '../../editor/sequenceGraph';
import { runProjectMigrations } from '../../persist/migrations';

type Data = Record<string, any>;
const jsonCopy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const identifier = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const fail = (message: string): never => { throw new Error(message); };
const finite = (value: unknown, lo: number, hi: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi ? value : fail('Invalid finite composition number');
const rect = (raw: Data) => {
  if (!raw || typeof raw !== 'object') fail('Missing normalized rectangle');
  const out = Object.fromEntries(['x', 'y', 'w', 'h'].map((key) => [key, finite(raw[key], 0, 1)]));
  if (!out.w || !out.h || out.x + out.w > 1.000001 || out.y + out.h > 1.000001) fail('Rectangle outside composition');
  return out;
};

export async function execVisualCompositionTool(name: string, args: Data, ctx: AgentContext) {
  if (name !== 'edit_visual_composition') return { error: `unknown tool ${name}` };
  try {
    if (args.action === 'create' && typeof window !== 'undefined' && xmtHost()) await loadLayoutDefaults();
    const before = ctx.getDoc();
    const doc = jsonCopy(before);
    const owner = doc.timelines.find((t) => t.id === doc.activeTimelineId)!;
    const id = args.composition_id;
    if (!owner || !identifier(id)) fail('Invalid composition_id or owner timeline');
    const prefix = `vc_${id}_`;
    const existing = owner.items.find((it) => it.props?._xmt && (it.props._xmt as Data).composition?.id === id);
    if (!['create', 'update', 'delete'].includes(args.action)) fail('Unsupported composition action');
    if (args.action === 'create' && existing) fail('Composition already exists; use update');
    if (args.action !== 'create' && !existing) fail('Composition not found');
    if (existing) {
      // Only owned child timelines may be replaced. An external instance of an
      // owned child makes this update unsafe and must be removed explicitly.
      const children = doc.timelines.filter((t) => t.id.startsWith(prefix));
      for (const child of children) {
        const refs = sequenceReferencesTo(doc, child.id);
        if (refs.some((ref) => ref.itemId !== existing.id && !children.some((t) => t.id === ref.timelineId))) {
          fail('Composition child is referenced outside its group');
        }
      }
      owner.items = owner.items.filter((it) => it.id !== existing.id);
      if (existing.track) {
        if (owner.items.some((it) => it.track === existing.track)) fail('Composition track contains unrelated clips');
        delete owner.tracks?.[existing.track];
        owner.trackOrder = owner.trackOrder?.filter((track) => track !== existing.track);
      }
      doc.timelines = doc.timelines.filter((t) => !t.id.startsWith(prefix));
    }
    if (args.action === 'delete') {
      const validated = runProjectMigrations(doc);
      if (!validated) fail('Invalid native document after composition deletion');
      resolveTimelineRenderPlan(validated!.doc, owner.id);
      ctx.commands.applyDoc(validated!.doc);
      return { ok: true, composition_id: id, deleted_native_id: existing!.id };
    }
    const spec = args.composition as Data;
    if (!spec || spec.version !== 1 || spec.id !== id || !Array.isArray(args.nodes) || !args.nodes.length || args.nodes.length > 24) {
      fail('Expected normalized VisualCompositionV1 from shared builder');
    }
    const tpl = ctx.templates.find((t) => t.id === args.template_id && t.id === 'xmt-composition-node-v1');
    if (!tpl) fail('Reviewed visual component template is unavailable');
    const fps = owner.fps;
    const toFrame = (ms: number) => Math.round(finite(ms, 0, 3600000) * fps / 1000);
    const durationMs = finite(spec.end_ms, 0, 3600000) - finite(spec.start_ms, 0, 3600000);
    if (durationMs <= 0) fail('Invalid composition time range');
    const offset = finite(args.intro_ms ?? 0, 0, 3600000);
    const start = toFrame(spec.start_ms + offset);
    const duration = Math.max(1, toFrame(spec.end_ms + offset) - start);
    const compositionWindow = rect(spec.rect);
    const width = Math.max(1, Math.round(owner.width * compositionWindow.w));
    const height = Math.max(1, Math.round(owner.height * compositionWindow.h));
    const nativeElements: Data[] = [];
    const knownIds = new Set([...doc.timelines.map((t) => t.id), ...doc.timelines.flatMap((t) => t.items.map((i) => i.id))]);
    const checkedId = (suffix: string) => {
      const result = prefix + suffix;
      if (knownIds.has(result)) fail(`Native id collision: ${result}`);
      knownIds.add(result);
      return result;
    };
    const timeline = (suffix: string, w: number, h: number, fit: 'contain' | 'cover' = 'contain'): Timeline => {
      const child: Timeline = { id: checkedId(suffix), name: `图文组合 ${id} ${suffix}`, order: doc.timelines.length,
        fps, width: w, height: h, fit, items: [], tracks: {}, trackOrder: [], selectedId: null, captionsHidden: false };
      doc.timelines.push(child);
      return child;
    };
    const put = (child: Timeline, item: TimelineItem) => {
      const track = `${item.id}_track`;
      item.track = track;
      child.tracks![track] = { kind: 'video', name: item.name || item.id, muted: true, hidden: false, role: 'follower' };
      child.trackOrder!.unshift(track);
      child.items.push(item);
    };
    const events = (raw: Data[] = []): Data[] => raw.map((e) => {
      if (!['enter', 'reveal', 'emphasize', 'value_change', 'exit'].includes(e.type)) fail('Unknown visual event');
      if (e.at_ms + e.duration_ms > durationMs) fail('Visual event outside composition');
      return { ...e, at_frame: toFrame(e.at_ms), duration_frames: Math.max(1, toFrame(e.duration_ms)) };
    });
    const motion = (raw: Data = {}, base: Data = {}): ItemKeyframes => Object.fromEntries(Object.entries(raw).map(([prop, frames]) => {
      if (!['x', 'y', 'scale', 'rotation', 'opacity'].includes(prop) || !Array.isArray(frames)) fail('Unsupported group motion');
      return [prop, frames.map((key: Data) => ({ frame: Math.min(duration - 1, toFrame(key.at_ms)),
        value: (prop === 'x' || prop === 'y' ? finite(key.value, -4, 4) * 100 : finite(key.value, -3600, 3600)) + (base[prop] ?? 0),
        easing: key.easing ?? 'easeInOut' }))];
    }));
    const groupCues = (raw: Data[] = [], base: Data = {}): ItemKeyframes => {
      const points: Record<string, Data[]> = {};
      const add = (prop: string, frame: number, value: number) => {
        (points[prop] ??= []).push({ frame: Math.min(duration - 1, Math.max(0, frame)), value, easing: 'easeInOut' });
      };
      for (const cue of events(raw)) {
        if (['enter', 'reveal', 'exit'].includes(cue.type)) {
          const exit = cue.type === 'exit';
          if (!exit) add('opacity', 0, 0);
          const end = cue.at_frame + (cue.motion === 'none' ? 0 : cue.duration_frames);
          add('opacity', cue.at_frame, exit ? 1 : 0);
          add('opacity', end, exit ? 0 : 1);
          const prop = cue.motion === 'fade_up' ? 'y' : cue.motion === 'slide_left' ? 'x' : cue.motion === 'scale' ? 'scale' : null;
          if (prop) {
            const value = base[prop] ?? (prop === 'scale' ? 1 : 0);
            const hidden = prop === 'scale' ? value * .92 : value + (prop === 'y' ? 1.8 : -2.5);
            add(prop, cue.at_frame, exit ? value : hidden);
            add(prop, end, exit ? hidden : value);
          }
        } else if (cue.type === 'emphasize') {
          const value = base.scale ?? 1;
          add('scale', cue.at_frame, value);
          add('scale', cue.at_frame + Math.round(cue.duration_frames / 2), value * 1.04);
          add('scale', cue.at_frame + cue.duration_frames, value);
        }
      }
      return Object.fromEntries(Object.entries(points).map(([prop, keys]) => [prop,
        [...new Map(keys.map((key) => [key.frame, key])).values()].sort((a, b) => a.frame - b.frame)])) as ItemKeyframes;
    };
    const meta = (elementId: string, part: Data) => ({ visualCompositionVersion: 1, compositionId: id,
      elementId, partId: part.id, events: part.events ?? [], narrationRefs: part.narration_refs ?? [],
      placement: 'overlay', matchStatus: 'graphic' });
    const seq = (suffix: string, target: Timeline, box: Data): TimelineItem => ({
      id: checkedId(suffix), kind: 'sequence', name: suffix, track: '', timelineId: target.id,
      sequenceFit: 'native', width: target.width, height: target.height, startFrame: 0, durationInFrames: duration,
      srcInFrame: 0, playbackRate: 1,
      transform: { x: (box.x + box.w / 2 - .5) * 100, y: (box.y + box.h / 2 - .5) * 100 },
    });
    const group = timeline('group', width, height);
    for (const node of [...args.nodes].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
      if (!identifier(node.id) || !Array.isArray(node.parts) || node.parts.length > 100) fail('Invalid visual element');
      const box = rect(node.rect);
      const element = timeline(`${node.id}_group`, Math.max(1, Math.round(width * box.w)), Math.max(1, Math.round(height * box.h)));
      const groupItem = seq(`${node.id}_instance`, element, box);
      groupItem.keyframes = { ...groupCues(node.events, groupItem.transform), ...motion(node.motion, groupItem.transform) };
      groupItem.props = { _xmt: { ...meta(node.id, node), layoutTemplateKey: 'xmt-composition-node-v1#' + node.component, layoutSystemTransform: { ...groupItem.transform } } };
      const savedLayout = layoutDefault('xmt-composition-node-v1#' + node.component, width, height);
      if (savedLayout) {
        for (const prop of ['x','y','scale'] as const) {
          const base = groupItem.transform?.[prop] ?? (prop === 'scale' ? 1 : 0);
          groupItem.transform = { ...groupItem.transform, [prop]: prop === 'scale' ? base * savedLayout[prop] : base * savedLayout.scale + savedLayout[prop] };
          for (const key of groupItem.keyframes?.[prop] ?? []) key.value = prop === 'scale' ? key.value * savedLayout[prop] : key.value * savedLayout.scale + savedLayout[prop];
        }
        (groupItem.props._xmt as Data).layoutDefaultApplied = true;
      }
      put(group, groupItem);
      for (const part of node.parts) {
        if (!identifier(part.id)) fail('Invalid visual part id');
        const partBox = rect(part.rect);
        let graphicPart = part;
        if (node.component === 'evidence_marks' && part.shape === 'mark') {
          const asset = doc.assets.find((a) => a.id === node.media?.asset_ref);
          if (!asset?.width || !asset?.height) fail('Evidence marks require the original image dimensions');
          const fitting = node.media?.fit === 'cover' ? Math.max : Math.min;
          const factor = fitting(element.width / asset!.width!, element.height / asset!.height!);
          const imageW = asset!.width! * factor / element.width, imageH = asset!.height! * factor / element.height;
          graphicPart = { ...part, rect: { x: (1-imageW)/2 + partBox.x*imageW,
            y: (1-imageH)/2 + partBox.y*imageH, w: partBox.w*imageW, h: partBox.h*imageH } };
        }
        const suffix = `${node.id}_${part.id}`;
        let item: TimelineItem;
        if (part.shape === 'media') {
          const asset = doc.assets.find((a) => a.id === part.asset_ref);
          if (!asset || !['image', 'video'].includes(asset.kind)) fail('Missing native image/video asset');
          const media = timeline(suffix + '_media', Math.max(1, Math.round(element.width * partBox.w)),
            Math.max(1, Math.round(element.height * partBox.h)), part.fit ?? 'contain');
          const sourceStart = toFrame(part.source_start_ms ?? 0);
          if (asset!.kind === 'video' && asset!.durationInFrames && sourceStart + duration > asset!.durationInFrames) {
            fail('Composition video source window exceeds imported source duration');
          }
          const clip: TimelineItem = { id: checkedId(suffix + '_clip'), name: asset!.name, kind: asset!.kind as 'video' | 'image',
            sourceAssetId: asset!.id, src: asset!.src, width: asset!.width, height: asset!.height, track: '',
            startFrame: 0, durationInFrames: duration, srcInFrame: sourceStart, volume: 0,
            keyframes: { ...groupCues(part.events), ...motion(part.motion) }, props: { _xmt: meta(node.id, part) } };
          put(media, clip);
          item = seq(suffix + '_slot', media, partBox);
          item.props = { _xmt: meta(node.id, part) };
          nativeElements.push({ element_id: node.id, part_id: part.id, native_id: clip.id, timeline_id: media.id,
            slot_id: item.id, events: events(part.events), narration_refs: part.narration_refs ?? [] });
        } else {
          if (!['panel', 'text', 'cell', 'number', 'bar', 'mark'].includes(part.shape)) fail('Unknown reviewed primitive');
          item = { id: checkedId(suffix + '_graphic'), name: suffix, kind: 'motion-graphic', track: '',
            startFrame: 0, durationInFrames: duration, width: element.width, height: element.height,
            templateId: tpl!.id, code: tpl!.code, props: { ...jsonCopy(tpl!.props), shape: part.shape, node: graphicPart,
              text: part.text ?? '', label: part.label ?? '', value: part.value ?? 0, unit: part.unit ?? '',
              scaleMax: part.scale_max ?? 1, decimals: part.decimals ?? 0,
              textColor: node.style.text, accentColor: node.style.accent, mutedColor: node.style.muted,
              backgroundColor: node.style.background,
              style: node.style, fontFamily: node.style.font, fontPx: Math.min(owner.width, owner.height) * node.style.font_size,
              events: events(part.events), _xmt: meta(node.id, part) } };
          // Evidence marks inherit the same image movement within the viewport.
          if (node.component === 'evidence_marks' && part.shape === 'mark') item.keyframes = motion(node.media?.motion);
          nativeElements.push({ element_id: node.id, part_id: part.id, native_id: item.id, timeline_id: element.id,
            events: events(part.events), narration_refs: part.narration_refs ?? [] });
        }
        put(element, item);
      }
    }
    const outer = seq('instance', group, compositionWindow);
    outer.startFrame = start;
    outer.keyframes = motion(spec.motion, outer.transform);
    outer.props = { _xmt: { visualCompositionVersion: 1, placement: 'overlay', matchStatus: 'graphic',
      composition: spec, nativeElements, z: spec.z ?? 0, introOffsetMs: args.intro_ms ?? 0 } };
    put(owner, outer);
    const compositionTracks = owner.items.filter((it) => (it.props?._xmt as Data)?.visualCompositionVersion === 1 &&
      (it.props?._xmt as Data)?.composition).sort((a, b) => ((b.props?._xmt as Data).z ?? 0) - ((a.props?._xmt as Data).z ?? 0)).map((it) => it.track);
    owner.trackOrder = [...compositionTracks, ...owner.trackOrder!.filter((track) => !compositionTracks.includes(track))];
    const validated = runProjectMigrations(doc);
    if (!validated) fail('Visual composition produced invalid native ProjectDoc');
    resolveTimelineRenderPlan(validated!.doc, owner.id);
    ctx.commands.applyDoc(validated!.doc);
    return { ok: true, composition_id: id, native_id: outer.id, child_timeline_id: group.id,
      native_elements: nativeElements, start_frame: start, duration_frames: duration };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
