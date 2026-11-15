// XMT 衬底（压暗 / 缺素材兜底床）的配对同步。
//
// 衬底是布景：它跟随被配对的那一条（scrim→overlay-NNN，bed→shot-NNN）。
// 宿主被删掉或换掉时，衬底一起收掉；宿主被裁、被挪而衬底没跟上时，
// 直接把衬底对齐到宿主的新位置（布景跟着走，不留孤儿层）。
// 手动改衬底本身、或衬底与宿主同 delta 一起动，都判为仍在跟随，不动它。
// 切分宿主时左半保留原 id，衬底跟左半，右半没有衬底——这是接受的语义。
import type { TimelineState } from '../editor/types';
import { removeItemsWithGroups } from '../editor/linkGroups';
import { isXmtBackdrop, xmtBackdropPairId } from './clipMeta';

export function syncXmtBackdrops(prev: TimelineState, next: TimelineState): TimelineState {
  // 快速通道：状态没变、或工程里根本没有衬底 → 原样返回（非 XMT 工程零开销零行为）。
  if (next === prev || !next.items.some(isXmtBackdrop)) return next;

  const beforeById = new Map(prev.items.map((item) => [item.id, item]));
  const nextById = new Map(next.items.map((item) => [item.id, item]));
  const staleIds: string[] = [];
  const followFrames = new Map<string, { startFrame: number; durationInFrames: number }>();

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

    // 宿主没了 / 宿主被换掉（仅 bed）→ 孤儿，收掉；
    // 宿主改了时长或位置而衬底没跟上 → 对齐跟随。
    if (!pairId || !pair || swapped) {
      staleIds.push(backdrop.id);
    } else if (retimed && !followed) {
      followFrames.set(backdrop.id, {
        startFrame: pair.startFrame,
        durationInFrames: pair.durationInFrames,
      });
    }
  }

  if (!staleIds.length && !followFrames.size) return next;

  const trackLocked = (itemId: string): boolean => {
    const item = nextById.get(itemId);
    return !!item && !!next.tracks?.[item.track]?.locked;
  };

  // 走 removeItemsWithGroups：选中集、转场、linkGroup 与字幕引用一并收敛；
  // 轨道锁着时它就是 no-op，这里照单接受。
  let result = staleIds.length ? removeItemsWithGroups(next, staleIds, false) : next;

  // 对齐跟随：轨道锁着就不动这条衬底。
  const realign = new Map(
    [...followFrames.entries()].filter(([id]) => !trackLocked(id)),
  );
  if (realign.size) {
    result = {
      ...result,
      items: result.items.map((item) => {
        const frames = realign.get(item.id);
        return frames ? { ...item, ...frames } : item;
      }),
    };
  }
  return result;
}
