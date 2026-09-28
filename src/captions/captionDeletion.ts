import { captionsOnTrack, type TimelineState, type TrackId } from '../editor/types';
import { cueTextPatch, type CueRow } from './captionCues';
import { removeManualCue } from './manualCaptions';
import { resolveOrderedCaptionSelections, type CaptionSelectionRef } from './captionSelection';
import type { CaptionsData } from './types';

export interface CaptionSelectionDeletePatch {
  trackId: TrackId;
  patch: Partial<CaptionsData>;
}

/**
 * Delete selected caption cues as one captions patch per affected track, so the
 * caller can commit every track in a single history step. Manual cues are
 * removed from their lane's word list; generated (transcript-driven) cues are
 * hidden through wordOverrides — the same display-only semantic as clearing a
 * cue's text in the preview editor, leaving the source transcript untouched and
 * undoable. Selections on locked tracks are skipped.
 */
export function captionSelectionDeletePatches(
  state: TimelineState,
  selections: readonly CaptionSelectionRef[],
): CaptionSelectionDeletePatch[] {
  interface TrackPlan {
    manualIndexes: Map<string, Set<number>>;
    automaticCueIndexes: number[];
    rows: CueRow[] | null;
  }
  const plans = new Map<TrackId, TrackPlan>();
  for (const resolved of resolveOrderedCaptionSelections(state, selections)) {
    if (state.tracks?.[resolved.trackId]?.locked) continue;
    let plan = plans.get(resolved.trackId);
    if (!plan) {
      plan = { manualIndexes: new Map(), automaticCueIndexes: [], rows: null };
      plans.set(resolved.trackId, plan);
    }
    if (resolved.target.kind === 'manual') {
      const indexes = plan.manualIndexes.get(resolved.target.laneId) ?? new Set<number>();
      indexes.add(resolved.target.cueIndex);
      plan.manualIndexes.set(resolved.target.laneId, indexes);
    } else {
      plan.rows ??= resolved.target.rows;
      plan.automaticCueIndexes.push(resolved.target.cueIndex);
    }
  }

  const patches: CaptionSelectionDeletePatch[] = [];
  for (const [trackId, plan] of plans) {
    const base = captionsOnTrack(state, trackId);
    if (!base) continue;
    let patch: Partial<CaptionsData> = {};
    let merged: CaptionsData = base;
    let changed = false;
    for (const [laneId, indexes] of plan.manualIndexes) {
      // Descending so the remaining cue indexes stay valid after each removal.
      for (const index of [...indexes].sort((a, b) => b - a)) {
        const next = removeManualCue(merged, laneId, index);
        patch = { ...patch, ...next };
        merged = { ...merged, ...next };
        changed = true;
      }
    }
    if (plan.rows) {
      // Rows carry source-word indexes/refs, which hiding never moves — the
      // original row list stays valid while wordOverrides accumulate.
      for (const cueIndex of plan.automaticCueIndexes) {
        const next = cueTextPatch(merged, plan.rows, cueIndex, '');
        if (!next) continue;
        patch = { ...patch, ...next };
        merged = { ...merged, ...next };
        changed = true;
      }
    }
    if (changed) patches.push({ trackId, patch });
  }
  return patches;
}
