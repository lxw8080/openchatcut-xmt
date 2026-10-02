import type { TimelineState } from '../editor/types';
import { requireXmtHost } from '../xmt/host';

export interface CompositionFinding {
  code: string;
  message: string;
  state: string;
  frame: number;
  item_id?: string;
  evidence?: { claimed?: string; observed?: string[]; mentioned?: string[] };
}

export interface CompositionReport {
  doc_sha256: string;
  evidence_sha256: string;
  findings: CompositionFinding[];
  coverage: { speech: boolean; visual_sources: boolean; audio_samples: boolean; rendered_frames: boolean };
}

/** Review the visible editor state, including unsaved edits; never flush to save. */
export function compositionSnapshot(timelineId: string, state: TimelineState): string {
  const { assets, selectedId: _selectedId, selectedIds: _selectedIds, ...content } = state;
  return JSON.stringify({ version: 3, activeTimelineId: timelineId, assets: assets ?? [],
    timelines: [{ ...content, id: timelineId }] });
}

export async function reviewComposition(snapshot: string, signal: AbortSignal): Promise<CompositionReport> {
  const host = requireXmtHost();
  if (!host.compositionReviewUrl) throw new Error('当前服务尚未提供成片检查。');
  const response = await fetch(host.compositionReviewUrl, {
    method: 'POST', signal, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': host.csrfToken },
    body: JSON.stringify({ project: JSON.parse(snapshot) as unknown }),
  });
  const result = await response.json() as { error?: string; data?: CompositionReport };
  if (!response.ok || !result.data || !Array.isArray(result.data.findings)) {
    throw new Error(result.error ?? `成片检查失败（HTTP ${response.status}）。`);
  }
  return result.data;
}
