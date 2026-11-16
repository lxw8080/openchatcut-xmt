import { useState } from 'react';
import type { ProjectDoc, TimelineState } from '../editor/types';
import type { ExportJobStore } from './backgroundExportStore';
import { ExportDialogMain } from './ExportDialogMain';
import { ExportDialogShell, ExportSidebar, type ExportDialogTab } from './ExportDialogShell';
import { useExportDialogModel } from './useExportDialogModel';
import { xmtHost } from '../xmt/host';
import { LOCAL_EXPORT_TABS, LocalExportPanel, type LocalExportTab } from '../xmt/LocalExportPanel';

interface ExportDialogProps {
  state: TimelineState;
  project: ProjectDoc;
  projectId: string;
  projectName: string;
  exportJobs: ExportJobStore;
  onClose: () => void;
}

export function ExportDialog({ state, project, projectId, projectName, exportJobs, onClose }: ExportDialogProps) {
  const model = useExportDialogModel({ state, project, projectId, projectName, exportJobs, onClose });
  const localExports = xmtHost()?.localExports;
  const localTabs = LOCAL_EXPORT_TABS.filter((tab) => localExports?.[tab.target]);
  const [localTab, setLocalTab] = useState<LocalExportTab | null>(null);
  const exporter = localTab && localExports?.[localTab.target];
  const selectTab = (tab: ExportDialogTab) => {
    if (tab === 'local-mp4' || tab === 'local-jianying') {
      setLocalTab(localTabs.find((entry) => entry.key === tab) ?? null);
    } else {
      setLocalTab(null);
      model.setTab(tab);
    }
    model.workflow.resetFeedback();
  };
  return (
    <ExportDialogShell base={model.base} state={state} onClose={onClose}>
      <ExportSidebar tab={localTab?.key ?? model.tab} localTabs={localTabs}
        busy={!!model.workflow.busy} onTabChange={selectTab} />
      {localTab && exporter
        ? <LocalExportPanel tab={localTab} exporter={exporter} />
        : <ExportDialogMain state={state} model={model} />}
    </ExportDialogShell>
  );
}
