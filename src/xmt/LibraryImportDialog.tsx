// xmt「项目素材库」对话框：分页列出本项目的库素材，选中即把同源 stream URL
// 登记为媒体池资产 —— 不拷贝文件、不自动插入时间线；已在池中的素材回传
// already_imported 防重复添加。
//
// 两种检索：「关键词」按标题 / 项目 / 文件名子串（原行为）；「语义」按画面内容，
// 走宿主与替换面板同一个向量检索，分段命中按素材聚合，每行带命中的那几秒。
// 语义只覆盖已解读的素材——没解读的片子没有分段，只能用关键词找。
//
// 「图片」页签列素材库的图片（`/library/api/images/<id>/file`），只有关键词检索，
// 导入成默认 5 秒的静图（同本地上传的图片）。视频与图片的 id 各自编号会撞号，
// 所以本端「刚导入」的记账按 `媒体:id` 区分。
import { useEffect, useMemo, useState } from 'react';
import { theme, themeAlpha } from '../theme';
import type { MediaAsset } from '../editor/types';
import { useT } from '../i18n/locale';
import {
  fetchXmtLibraryAssets,
  type XmtLibraryAsset,
  type XmtLibraryMedia,
  type XmtLibrarySearchMode,
} from './projectBridge';

interface LibraryImportDialogProps {
  fps: number;
  /** 当前媒体池：AI 方案落进来的素材 id 是 `asset-<id>`，与本对话框的
   *  `xmt-asset-<id>` 不同，池子按 id 去重拦不住——按同源地址认「已在媒体池」。 */
  poolAssets?: readonly MediaAsset[];
  onAddAsset: (asset: MediaAsset) => void;
  onClose: () => void;
}

const PER_PAGE = 24;
/** 与 media/mediaProbe 的本地图片默认时长一致。 */
const IMAGE_SECONDS = 5;

/** 去掉查询串与片段标识，只比路径（池里的 src 可能带缓存参数）。 */
function srcPath(src: string): string {
  return src.split(/[?#]/, 1)[0];
}

/** 素材内时间点：m:ss。 */
function fmtClock(ms: number | null | undefined): string {
  const total = Math.max(0, Math.floor((ms ?? 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

interface AppliedSearch {
  query: string;
  mode: XmtLibrarySearchMode;
  media: XmtLibraryMedia;
}

const importKey = (media: XmtLibraryMedia, id: number): string => `${media}:${id}`;

export function LibraryImportDialog({ fps, poolAssets, onAddAsset, onClose }: LibraryImportDialogProps) {
  const t = useT();
  const poolSrcs = useMemo(
    () => new Set((poolAssets ?? []).map((asset) => srcPath(asset.src))),
    [poolAssets],
  );
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<XmtLibrarySearchMode>('keyword');
  const [media, setMedia] = useState<XmtLibraryMedia>('video');
  // 真正发出去的那次检索：输入框里敲字不触发请求，回车 / 点搜索 / 切模式才换它。
  const [applied, setApplied] = useState<AppliedSearch>({ query: '', mode: 'keyword', media: 'video' });
  // 服务端实际走的模式（语义模式下查询为空时服务端回落全量列表）。
  const [resultMode, setResultMode] = useState<XmtLibrarySearchMode>('keyword');
  const [items, setItems] = useState<XmtLibraryAsset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importedKeys, setImportedKeys] = useState<Set<string>>(new Set());
  const isImage = media === 'image';

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchXmtLibraryAssets({
      page,
      perPage: PER_PAGE,
      query: applied.query || undefined,
      mode: applied.media === 'image' ? 'keyword' : applied.mode,
      media: applied.media,
    })
      .then((data) => {
        if (!alive) return;
        setItems(data.items);
        setPages(Math.max(1, data.pages));
        setTotal(data.total);
        setResultMode(data.mode);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page, applied]);

  const runSearch = (
    nextMode: XmtLibrarySearchMode = mode,
    nextMedia: XmtLibraryMedia = media,
  ): void => {
    setPage(1);
    setApplied({ query: query.trim(), mode: nextMode, media: nextMedia });
  };

  const switchMedia = (nextMedia: XmtLibraryMedia): void => {
    if (nextMedia === media) return;
    setMedia(nextMedia);
    // 换类目就是换一张表：清掉旧列表免得闪一下另一类的行，并按当前查询词重拉。
    setItems(null);
    runSearch(mode, nextMedia);
  };

  const switchMode = (nextMode: XmtLibrarySearchMode): void => {
    if (nextMode === mode) return;
    setMode(nextMode);
    // 已经敲了查询词就按新模式立刻重搜；没敲词时两种模式都是全量列表，不必重拉。
    if (query.trim()) runSearch(nextMode);
  };

  const rowMedia = (row: XmtLibraryAsset): XmtLibraryMedia => (row.media === 'image' ? 'image' : 'video');

  const importAsset = (row: XmtLibraryAsset): void => {
    const kind = rowMedia(row);
    onAddAsset(kind === 'image'
      ? {
        id: `xmt-image-${row.id}`,
        name: row.title || `图片 ${row.id}`,
        kind: 'image',
        src: row.stream_url,
        durationInFrames: Math.max(1, Math.round(IMAGE_SECONDS * fps)),
        width: row.width ?? undefined,
        height: row.height ?? undefined,
      }
      : {
        id: `xmt-asset-${row.id}`,
        name: row.title || `素材 ${row.id}`,
        kind: 'video',
        src: row.stream_url,
        durationInFrames: Math.max(1, Math.round((row.duration_ms ?? 0) / 1000 * fps)),
        width: row.width ?? undefined,
        height: row.height ?? undefined,
      });
    setImportedKeys((previous) => new Set(previous).add(importKey(kind, row.id)));
  };

  const isImported = (item: XmtLibraryAsset): boolean =>
    item.already_imported
    || importedKeys.has(importKey(rowMedia(item), item.id))
    || poolSrcs.has(srcPath(item.stream_url));
  const pending = (items ?? []).filter((item) => !isImported(item));
  const importAllOnPage = (): void => {
    pending.forEach(importAsset);
  };

  const row = (item: XmtLibraryAsset) => {
    const imported = isImported(item);
    const matches = resultMode === 'semantic' ? (item.matches ?? []) : [];
    const thumb = item.thumb_url ?? (rowMedia(item) === 'image' ? item.stream_url : null);
    return (
      <div key={importKey(rowMedia(item), item.id)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
        borderBottom: `0.5px solid ${theme.border}`,
      }}>
        {thumb && (
          <img src={thumb} alt="" loading="lazy" style={{
            width: 52, height: 30, objectFit: 'cover', borderRadius: 3,
            border: `0.5px solid ${theme.border}`, flexShrink: 0, background: theme.bg,
          }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>
            {item.title}
          </div>
          <div style={{ fontSize: 11, color: theme.textDim, marginTop: 1 }}>
            {typeof item.duration_ms === 'number' && item.duration_ms > 0
              ? `${(item.duration_ms / 1000).toFixed(1)}${t('秒')}`
              : ''}
            {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
            {resultMode === 'semantic' && typeof item.score === 'number'
              ? ` · ${t('相似度')} ${(item.score * 100).toFixed(0)}%`
              : ''}
          </div>
          {matches.map((match, index) => (
            <div
              key={match.video_segment_id ?? `m-${index}`}
              title={match.event_summary ?? undefined}
              style={{
                fontSize: 11, color: theme.textMuted, marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: theme.textDim, fontVariantNumeric: 'tabular-nums' }}>
                {fmtClock(match.start_ms)}–{fmtClock(match.end_ms)}
              </span>
              {' '}{match.event_summary || t('（无事件摘要）')}
            </div>
          ))}
        </div>
        {imported ? (
          <span style={{ flexShrink: 0, fontSize: 11.5, color: theme.textDim }}>{t('已在媒体池')}</span>
        ) : (
          <button type="button" onClick={() => importAsset(item)} style={{
            flexShrink: 0, border: `0.5px solid ${theme.accent}`, background: theme.accent,
            color: theme.onAccent, borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
          }}>{t('导入媒体池')}</button>
        )}
      </div>
    );
  };

  return (
    <div
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.45)',
        display: 'grid', placeItems: 'center',
      }}
    >
      <div style={{
        width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        background: theme.panel, border: `0.5px solid ${theme.borderLight}`, borderRadius: 6,
        boxShadow: `0 12px 36px ${themeAlpha.shadow(0.55)}`, overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 12px', borderBottom: `0.5px solid ${theme.border}`, fontWeight: 600, fontSize: 13 }}>
          {t('项目素材库')}
        </div>
        <div style={{ padding: '8px 12px 0', display: 'flex', gap: 8 }}>
          <div role="group" aria-label={t('素材类型')} style={{
            display: 'flex', flexShrink: 0, border: `0.5px solid ${theme.border}`,
            borderRadius: 4, overflow: 'hidden',
          }}>
            {(['video', 'image'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={media === value}
                onClick={() => switchMedia(value)}
                style={{
                  border: 'none', padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                  background: media === value ? theme.accent : 'none',
                  color: media === value ? theme.onAccent : theme.text,
                }}
              >{value === 'video' ? t('视频') : t('图片')}</button>
            ))}
          </div>
          {!isImage && <div role="group" aria-label={t('检索方式')} style={{
            display: 'flex', flexShrink: 0, border: `0.5px solid ${theme.border}`,
            borderRadius: 4, overflow: 'hidden',
          }}>
            {(['keyword', 'semantic'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => switchMode(value)}
                style={{
                  border: 'none', padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                  background: mode === value ? theme.accent : 'none',
                  color: mode === value ? theme.onAccent : theme.text,
                }}
              >{value === 'keyword' ? t('关键词') : t('语义')}</button>
            ))}
          </div>}
          <input
            value={query}
            placeholder={isImage
              ? t('搜索标题、图中文字或项目')
              : mode === 'semantic'
                ? t('描述画面内容，如「颁奖仪式」「观众欢呼」')
                : t('搜索标题、项目或文件名')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
            style={{
              flex: 1, minWidth: 0, background: theme.bg, border: `0.5px solid ${theme.border}`,
              borderRadius: 4, padding: '6px 8px', color: theme.text, fontSize: 12,
            }}
          />
          <button type="button" onClick={() => runSearch()} style={{
            border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
            borderRadius: 4, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
          }}>{t('搜索')}</button>
        </div>
        <div style={{ padding: '5px 12px 8px', fontSize: 11, color: theme.textDim, minHeight: 14 }}>
          {isImage
            ? t('按标题、摘要、图中文字或项目匹配；导入后默认 5 秒')
            : mode === 'semantic'
              ? t('按画面内容检索，只覆盖已解读的素材；结果按相似度排序')
              : t('按标题、项目或文件名匹配')}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 140 }}>
          {loading && <div style={{ padding: 16, fontSize: 12, color: theme.textDim, textAlign: 'center' }}>{t('搜索中…')}</div>}
          {!loading && error && <div style={{ padding: 16, fontSize: 12, color: theme.accent, textAlign: 'center' }}>{error}</div>}
          {!loading && !error && items && items.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: theme.textDim, textAlign: 'center' }}>
              {applied.media === 'image'
                ? t('没有符合条件的图片素材')
                : resultMode === 'semantic'
                  ? t('没有语义匹配的素材；未解读的素材请用关键词搜索')
                  : t('没有符合条件的视频素材')}
            </div>
          )}
          {!loading && !error && items?.map(row)}
        </div>
        <div style={{ padding: '8px 12px', borderTop: `0.5px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} style={{
            border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
            borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: page <= 1 ? 'default' : 'pointer',
          }}>{t('上一页')}</button>
          <span style={{ fontSize: 11.5, color: theme.textDim, flex: 1, textAlign: 'center' }}>
            {page} / {pages} · {t('共 {n} 条', { n: total })}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} style={{
            border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
            borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: page >= pages ? 'default' : 'pointer',
          }}>{t('下一页')}</button>
          <button
            type="button"
            disabled={loading || pending.length === 0}
            onClick={importAllOnPage}
            style={{
              border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
              borderRadius: 4, padding: '4px 10px', fontSize: 12,
              cursor: loading || pending.length === 0 ? 'default' : 'pointer',
              opacity: loading || pending.length === 0 ? 0.5 : 1,
            }}
          >{t('本页全部导入（{n}）', { n: pending.length })}</button>
          <button type="button" onClick={onClose} style={{
            border: `0.5px solid ${theme.border}`, background: 'none', color: theme.text,
            borderRadius: 4, padding: '4px 14px', fontSize: 12, cursor: 'pointer',
          }}>{t('取消')}</button>
        </div>
      </div>
    </div>
  );
}
