// xmt：字幕检查器「字体」下拉的选项分组（纯函数）。
//
// fork 自带的字体清单（FONT_CATALOG）不含宿主上传的字体，而画布视频节点可以选
// 上传字体一键成片：工程里的 fontFamily 不在清单里时，受控 <select> 找不到匹配项，
// 浏览器把第一项（Anton）显示成当前字体——画面上是上传字体，下拉里却是另一个名字，
// 改选别的之后也选不回来。所以：上传字体单独一组；当前值两边都不在时（字体已被
// 删掉、或名字拼写与清单不一致），也给它留一项，下拉永远显示真实的当前值。
export interface CaptionFontOptions {
  catalog: string[];
  uploaded: string[];
  /** 当前值既不在清单也不在上传字体里时的那一项；否则为 null。 */
  current: string | null;
}

export function captionFontOptions(
  catalog: readonly string[],
  uploaded: readonly string[],
  currentFamily: string | undefined,
): CaptionFontOptions {
  const known = new Set(catalog);
  const uploadedUnique: string[] = [];
  for (const family of uploaded) {
    const name = typeof family === 'string' ? family.trim() : '';
    if (!name || known.has(name)) continue;
    known.add(name);
    uploadedUnique.push(name);
  }
  // 返回原值而不是 trim 后的：<select value> 按原值匹配 option。
  const current = typeof currentFamily === 'string' ? currentFamily : '';
  return {
    catalog: [...catalog],
    uploaded: uploadedUnique,
    current: current.trim() && !known.has(current) ? current : null,
  };
}
