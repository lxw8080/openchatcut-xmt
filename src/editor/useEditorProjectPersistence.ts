import { useCallback, useEffect, useRef } from 'react';
import type { PlayerRef } from '@remotion/player';
import { enqueueVisualAnalysis } from '../agent/progress/visual-analysis-jobs';
import { useT } from '../i18n/locale';
import { pendingAutosaveAfterObservation, recoverFailedAutosave } from '../persist/autosaveRecovery';
import { acknowledgeIngestedGenerationResults, resumeOpenGenerationJobs } from '../persist/jobRegistryStore';
import { saveXmtProject } from '../xmt/projectBridge';
import { showAppToast } from '../ui/appToast';
import type { EditorCommands } from './store';
import type { ProjectDoc, TimelineState } from './types';

type MutableRef<T> = { current: T };

interface EditorProjectPersistenceOptions {
  projectId: string;
  doc: ProjectDoc;
  commands: Pick<EditorCommands, 'addAsset'>;
  stateRef: MutableRef<TimelineState>;
  docRef: MutableRef<ProjectDoc>;
  playerRef: MutableRef<PlayerRef | null>;
  flushBeforeLeaveRef: MutableRef<() => Promise<boolean>>;
  onHome: () => void;
}

interface PendingSave {
  projectId: string;
  doc: ProjectDoc;
}

interface XmtSaveResult {
  status: 'saved' | 'failed';
}

function usePendingSaveQueue(): {
  unsavedRef: MutableRef<PendingSave | null>;
  inFlightRef: MutableRef<Promise<XmtSaveResult> | null>;
  enqueuePendingSave: () => Promise<XmtSaveResult> | null;
} {
  const t = useT();
  const unsavedRef = useRef<PendingSave | null>(null);
  const inFlightRef = useRef<Promise<XmtSaveResult> | null>(null);
  const latestSaveAttemptRef = useRef(0);
  const saveFailureShownRef = useRef(false);
  const observeSave = useCallback((result: XmtSaveResult): void => {
    if (result.status === 'failed') {
      if (!saveFailureShownRef.current) {
        showAppToast(t('工程保存失败。请重试；在保存成功前不会关闭或切换工程。'), { error: true });
        saveFailureShownRef.current = true;
      }
      return;
    }
    saveFailureShownRef.current = false;
  }, [t]);
  const enqueuePendingSave = useCallback((): Promise<XmtSaveResult> | null => {
    const pending = unsavedRef.current;
    if (!pending) return null;
    unsavedRef.current = null;
    const attempt = ++latestSaveAttemptRef.current;
    // xmt fork：保存直达宿主 API（PUT projectUrl，非 2xx 即失败重排），不再走
    // 上游的 project-store 队列 —— 这里没有自有 server，localStorage 落盘等于丢稿。
    const saving: Promise<XmtSaveResult> = saveXmtProject(pending.doc)
      .then((): XmtSaveResult => ({ status: 'saved' }))
      .catch((): XmtSaveResult => {
        unsavedRef.current = recoverFailedAutosave({
          currentUnsaved: unsavedRef.current,
          failedSnapshot: pending,
          failedAttempt: attempt,
          latestEnqueuedAttempt: latestSaveAttemptRef.current,
        });
        return { status: 'failed' };
      });
    inFlightRef.current = saving;
    void saving.then((result) => {
      if (inFlightRef.current === saving) inFlightRef.current = null;
      if (result.status === 'saved') {
        void acknowledgeIngestedGenerationResults(pending.projectId, pending.doc.assets ?? []);
      }
      observeSave(result);
    });
    return saving;
  }, [observeSave]);
  return { unsavedRef, inFlightRef, enqueuePendingSave };
}

function useEditorAutosave(projectId: string, doc: ProjectDoc): () => Promise<boolean> {
  const t = useT();
  const { unsavedRef, inFlightRef, enqueuePendingSave } = usePendingSaveQueue();
  const previousDocumentRef = useRef<PendingSave | null>(null);
  useEffect(() => {
    const next = { projectId, doc };
    const pending = pendingAutosaveAfterObservation(previousDocumentRef.current, next);
    previousDocumentRef.current = next;
    unsavedRef.current = pending;
    if (pending === null) return undefined;
    const timer = setTimeout(() => { enqueuePendingSave(); }, 500);
    return () => clearTimeout(timer);
  }, [doc, enqueuePendingSave, projectId, unsavedRef]);
  const flushBeforeLeave = useCallback(async (): Promise<boolean> => {
    const saving = enqueuePendingSave() ?? inFlightRef.current;
    if (saving) {
      const result = await saving;
      if (result.status === 'failed') {
        showAppToast(t('工程仍未保存，已阻止离开。请继续编辑以重试保存。'), { error: true });
        return false;
      }
    }
    return true;
  }, [enqueuePendingSave, inFlightRef, t]);
  useBrowserSaveGuards(enqueuePendingSave, unsavedRef, inFlightRef);
  return flushBeforeLeave;
}

function useBrowserSaveGuards(
  enqueuePendingSave: () => Promise<XmtSaveResult> | null,
  unsavedRef: MutableRef<PendingSave | null>,
  inFlightRef: MutableRef<Promise<XmtSaveResult> | null>,
): void {
  useEffect(() => {
    const hasUnfinishedSave = (): boolean => unsavedRef.current !== null || inFlightRef.current !== null;
    const flushWithoutWaiting = (): void => {
      enqueuePendingSave();
    };
    const blockUnfinishedSave = (event: BeforeUnloadEvent): void => {
      enqueuePendingSave();
      if (!hasUnfinishedSave()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', blockUnfinishedSave);
    window.addEventListener('pagehide', flushWithoutWaiting);
    return () => {
      window.removeEventListener('beforeunload', blockUnfinishedSave);
      window.removeEventListener('pagehide', flushWithoutWaiting);
      flushWithoutWaiting();
    };
  }, [enqueuePendingSave, inFlightRef, unsavedRef]);
}

function useGenerationJobResume(
  projectId: string,
  commands: Pick<EditorCommands, 'addAsset'>,
  stateRef: MutableRef<TimelineState>,
  docRef: MutableRef<ProjectDoc>,
): void {
  useEffect(() => {
    let alive = true;
    void (async () => {
      await acknowledgeIngestedGenerationResults(projectId, docRef.current.assets ?? []).catch(() => undefined);
      if (!alive) return;
      await resumeOpenGenerationJobs(projectId, {
        getState: () => stateRef.current,
        onAsset: (asset) => {
          if (!alive) return;
          if ((docRef.current.assets ?? []).some((candidate) => candidate.id === asset.id || candidate.src === asset.src)) return;
          commands.addAsset(asset);
          if (asset.kind !== 'audio') enqueueVisualAnalysis(asset);
        },
        timeoutSeconds: 180,
      });
    })();
    return () => { alive = false; };
  }, [projectId, commands, stateRef, docRef]);
}

function useActiveTimelineSeek(activeTimelineId: string, playerRef: MutableRef<PlayerRef | null>): void {
  const firstTimelineRef = useRef(true);
  useEffect(() => {
    if (firstTimelineRef.current) {
      firstTimelineRef.current = false;
      return;
    }
    playerRef.current?.seekTo(0);
  }, [activeTimelineId, playerRef]);
}

export function useEditorProjectPersistence({
  projectId,
  doc,
  commands,
  stateRef,
  docRef,
  playerRef,
  flushBeforeLeaveRef,
  onHome,
}: EditorProjectPersistenceOptions): { handleHome: () => Promise<void> } {
  const flushBeforeLeave = useEditorAutosave(projectId, doc);
  flushBeforeLeaveRef.current = flushBeforeLeave;
  useGenerationJobResume(projectId, commands, stateRef, docRef);
  useActiveTimelineSeek(doc.activeTimelineId, playerRef);

  const handleHome = useCallback(async (): Promise<void> => {
    if (await flushBeforeLeave()) onHome();
  }, [flushBeforeLeave, onHome]);

  return { handleHome };
}
