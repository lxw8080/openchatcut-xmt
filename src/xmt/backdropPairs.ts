// XMT 衬底（压暗 / 缺素材兜底床）的配对清理。
//
// 衬底是布景：它跟随被配对的那一条（scrim→overlay-NNN，bed→shot-NNN）。
// 宿主被删掉、换掉、裁开、挪走而衬底没跟上时，衬底就成了挂在那里的孤儿层，
// 得一起收掉；反过来只要衬底还跟宿主同起同长，就视为「一起动的」保留。
// 手动改衬底本身、或衬底与宿主同 delta 一起动，都判为仍在跟随，不清理。
import type { TimelineState } from '../editor/types';
import { removeItemsWithGroups } from '../editor/linkGroups';
import { isXmtBackdrop, xmtBackdropPairId } from './clipMeta';

export function pruneStaleXmtBackdrops(prev: TimelineState, next: TimelineState): TimelineState {
  // 快速通道：状态没变、或工程里根本没有衬底 → 原样返回（非 XMT 工程零开销零行为）。
  if (next === prev || !next.items.some(isXmtBackdrop)) return next;

  const beforeById = new Map(prev.items.map((item) => [item.id, item]));
  const nextById = new Map(next.items.map((item) => [item.id, item]));
  const staleIds: string[] = [];

  for (const backdrop of next.items) {
    if (!isXmtBackdrop(backdrop)) continue;
    const pairId = xmtBackdropPairId(backdrop);
    const pair = pairId ? nextById.get(pairId) : undefined;
    const before = pairId ? beforeById.get(pairId) : undefined;

    const followed = !!pair
      && backdrop.startFrame === pair.startFrame
      && backdrop.durationInFrames === pair.durationInFrames;
    const retimed = !!before && !!pair
      && (before.startFrame !== pair.startFrame
        || before.durationInFrames !== pair.durationInFrames);
    const bed = (backdrop.props as { _xmt?: { backdrop?: string } } | undefined)
      ?._xmt?.backdrop === 'bed';
    const swapped = bed && !!before && !!pair
      && (before.kind !== pair.kind
        || before.src !== pair.src
        || (before.props as { _xmt?: { matchStatus?: string } } | undefined)?._xmt?.matchStatus
          !== (pair.props as { _xmt?: { matchStatus?: string } } | undefined)?._xmt?.matchStatus);

    // 宿主没了 / 宿主被换掉（仅 bed）/ 宿主改了时长或位置而衬底没跟上 → 孤儿。
    if (!pairId || !pair || swapped || (retimed && !followed)) {
      staleIds.push(backdrop.id);
    }
  }

  if (!staleIds.length) return next;
  // 走 removeItemsWithGroups：选中集、转场、linkGroup 与字幕引用一并收敛；
  // 轨道锁着时它就是 no-op，这里照单接受。
  return removeItemsWithGroups(next, staleIds, false);
}
