import type { CaptionsData } from './types';

/**
 * XMT 成片进编辑器的字幕：独立轨（无 ASR sourceItemId）+ 已定稿的显示行
 * （`pacing: "word"`，一条 words 条目 = 一行）。切到 phrase 会按字符预算重分页，
 * 毁掉定稿行界，并把 hold 退回 until-next（盖住句间空隙 / 「删除这句」）。
 */
export function isFinalizedDisplayCaptions(captions: CaptionsData | null | undefined): boolean {
  if (!captions) return false;
  if (captions.sourceItemId != null) return false;
  if (Array.isArray(captions.sourceEntries) && captions.sourceEntries.length > 0) return false;
  return Array.isArray(captions.words) && captions.words.length > 0;
}
