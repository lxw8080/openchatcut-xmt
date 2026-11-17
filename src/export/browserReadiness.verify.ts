import assert from 'node:assert/strict';
import { renderTimelineInBrowser, type BrowserExportOptions } from './browserExport';
import { immutableExportSnapshot } from './exportMediaPlan';
import type { ProjectDoc, TimelineState } from '../editor/types';

const globals = globalThis as unknown as Record<string, unknown>;
const prior = new Map(['window', 'navigator', '__XMT_EDITOR__', '__XMT_EXPORT_ACCELERATION__']
  .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const clip = (id: number) => ({ id: `clip-${id}`, kind: 'video', src: `/library/api/assets/${id}/stream`,
  track: 'V1', startFrame: 0, durationInFrames: 30, srcInFrame: 0 });
const timeline = (id: string, items: unknown[]) => ({ id, name: id, fps: 30,
  width: 1920, height: 1080, items, tracks: { V1: {} }, trackOrder: ['V1'], transitions: [] });
const main = timeline('main', [clip(1), { id: 'seq', kind: 'sequence', timelineId: 'nested',
  track: 'V1', startFrame: 30, durationInFrames: 30, srcInFrame: 0 }]);
const project = immutableExportSnapshot({ version: 3, activeTimelineId: 'inactive', mediaFolders: [],
  assets: [1, 2, 3, 4].map((id) => ({ id: `asset-${id}`, kind: 'video', src: clip(id).src })),
  timelines: [main, timeline('nested', [clip(2)]), timeline('inactive', [clip(3)])],
} as unknown as ProjectDoc);
const state = immutableExportSnapshot({ ...main, assets: project.assets } as unknown as TimelineState);

try {
  globals.window = globalThis;
  globals.__XMT_EDITOR__ = { jobId: 1 };
  for (const userAgent of ['Windows NT 10.0', 'Linux; Android 15', 'iPhone; CPU iPhone OS 18', 'Macintosh']) {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent } });
    const calls: string[] = [];
    globals.__XMT_EXPORT_ACCELERATION__ = {
      selectEncoder: async () => ({ hardwareAcceleration: 'prefer-hardware' }),
      prepareProject: async ({ project: inputs, sources }: {
        project: { state: TimelineState; project: ProjectDoc }; sources: string[];
      }) => {
        calls.push('prepare');
        assert.deepEqual(sources.sort(), [clip(1).src, clip(2).src]);
        assert.notEqual(inputs.project, project);
        assert.notEqual(inputs.state, state);
        inputs.state.items[0]!.src = '/prepared.mp4';
        inputs.project.timelines[0]!.items[0]!.src = '/prepared.mp4';
      },
    };
    const options: BrowserExportOptions = { state, project, timelineId: 'main', codec: 'h264',
      resolution: '1080p', fps: 30, loadComposition: async () => ({ TimelineComposition: () => null }),
      loadRenderer: (async () => ({
        canRenderMediaOnWeb: async () => ({ canRender: true, issues: [] }),
        renderMediaOnWeb: async (input: { inputProps: { state: TimelineState; project: ProjectDoc }; hardwareAcceleration: string }) => {
          calls.push('render');
          assert.equal(input.hardwareAcceleration, 'prefer-hardware');
          assert.equal(input.inputProps.state.items[0]!.src, '/prepared.mp4');
          assert.equal(input.inputProps.project.timelines[0]!.items[0]!.src, '/prepared.mp4');
          return { getBlob: async () => new Blob(['mp4']) };
        },
      })) as BrowserExportOptions['loadRenderer'],
    };
    assert.equal((await renderTimelineInBrowser(options)).status, 'rendered');
    assert.deepEqual(calls, ['prepare', 'render'], userAgent);
    assert.equal(state.items[0]!.src, clip(1).src);
    assert.equal(project.timelines[0]!.items[0]!.src, clip(1).src);
    calls.length = 0;
    globals.__XMT_EXPORT_ACCELERATION__ = { prepareProject: async () => { throw new Error('not ready'); } };
    await assert.rejects(renderTimelineInBrowser(options), /not ready/);
    assert.deepEqual(calls, [], 'no render after failed preparation');
  }
} finally {
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globals[key];
  }
}
console.log('browserReadiness.verify: OK (Windows, Android, iOS, macOS; nested scope; isolated snapshots; fail closed)');
