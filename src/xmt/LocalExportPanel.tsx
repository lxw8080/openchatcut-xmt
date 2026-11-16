import { useSyncExternalStore } from 'react';
import { Icon, type IconName } from '../components/icons';
import { InfoCard } from '../export/ExportDialogParts';
import { useT } from '../i18n/locale';
import type { XmtLocalExport, XmtLocalExportTarget } from './host';

export const LOCAL_EXPORT_TABS = [
  { key: 'local-jianying', target: 'jianying', label: '导出剪映工程', summary: '剪映草稿', icon: 'clipboard' },
  { key: 'local-mp4', target: 'mp4', label: '使用本机导出', summary: 'XMT · MP4', icon: 'download' },
] as const satisfies ReadonlyArray<{
  key: string; target: XmtLocalExportTarget; label: string; summary: string; icon: IconName;
}>;

export type LocalExportTab = typeof LOCAL_EXPORT_TABS[number];

export function LocalExportPanel({ tab, exporter }: { tab: LocalExportTab; exporter: XmtLocalExport }) {
  const t = useT();
  const state = useSyncExternalStore(exporter.subscribe, exporter.getSnapshot);
  const isJianying = tab.target === 'jianying';
  return (
    <main className="cc-export-main">
      <div className="cc-export-main-header">
        <div><h3>{t(tab.label)}</h3><p>{t(tab.summary)}</p></div>
      </div>
      <div className="cc-export-content" role="tabpanel" id={`cc-export-content-${tab.key}`}
        aria-labelledby={`cc-export-tab-${tab.key}`}>
        <InfoCard icon={tab.icon} title={t(isJianying ? '可继续编辑的剪映工程' : '在本机生成 MP4 成片')}
          text={t(isJianying
            ? '自动保存当前工程，并交给 XMT 本地渲染器生成剪映草稿，方便在剪映中继续编辑。'
            : '自动保存当前工程，并交给 XMT 本地渲染器在电脑上完成视频导出。')} />
        <p className="cc-export-footnote">{t('请先安装并配置 XMT 本地渲染器。')}</p>
        <div role="status" aria-live="polite" className="cc-export-host-status">{state.message}</div>
        {state.launchUrl && (
          <a className="cc-export-cta cc-export-host-launch" href={state.launchUrl}>
            <Icon name="download" size={14} />{t('打开 XMT 本地渲染器')}
          </a>
        )}
      </div>
      <footer className="cc-export-footer">
        <div className="cc-export-output">
          <span>{t('输出类型')}</span><strong>{t(tab.summary)}</strong>
        </div>
        <button type="button" className="cc-export-cta" disabled={state.busy}
          onClick={() => void exporter.start()}>
          <Icon name="download" size={14} />
          {t(state.busy ? '正在准备导出…' : isJianying ? '导出剪映工程' : '开始本机导出')}
        </button>
      </footer>
    </main>
  );
}
