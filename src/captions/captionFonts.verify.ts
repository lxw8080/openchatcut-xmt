/**
 * xmt 上传字幕字体：① font-family 必须加引号（带数字词的族名不加引号整条被丢弃）；
 * ② 检查器字体下拉要列出上传字体，并始终显示真实的当前值。
 * 运行：npx tsx src/captions/captionFonts.verify.ts
 */
import assert from 'node:assert/strict';
import { captionFontOptions } from './captionFontOptions.ts';
import { captionTypographyStyle, cssFontFamilyList } from './renderStyles.ts';
import { CAPTION_STYLE_BY_ID } from './styles.ts';

assert.equal(cssFontFamilyList('Alibaba PuHuiTi 2.0'), '"Alibaba PuHuiTi 2.0"');
assert.equal(cssFontFamilyList('WDCH'), '"WDCH"');
assert.equal(cssFontFamilyList('Noto Sans SC'), '"Noto Sans SC"');
// 通用族关键字加引号就不再是关键字
assert.equal(cssFontFamilyList('Inter, sans-serif'), '"Inter", sans-serif');
assert.equal(cssFontFamilyList('system-ui'), 'system-ui');
// 已带引号的片段原样保留，引号里的逗号不拆
assert.equal(cssFontFamilyList(`Inter, "A, B", 'C'`), `"Inter", "A, B", 'C'`);
assert.equal(cssFontFamilyList('Say "Hi"'), '"Say \\"Hi\\""');
assert.equal(cssFontFamilyList('  '), '');
assert.equal(cssFontFamilyList(undefined), '');

const preset = { ...CAPTION_STYLE_BY_ID.plain, fontFamily: 'Alibaba PuHuiTi 2.0' };
assert.equal(
  captionTypographyStyle(preset, 1080).fontFamily,
  '"Alibaba PuHuiTi 2.0", system-ui, sans-serif',
);
assert.equal(
  captionTypographyStyle({ ...preset, fontFamily: '  ' }, 1080).fontFamily,
  'system-ui, system-ui, sans-serif',
);

const catalog = ['Anton', 'Noto Sans SC', 'Smiley Sans'];
// 上传字体单独成组；与清单同名的（上传了一份得意黑）不重复列
assert.deepEqual(captionFontOptions(catalog, ['WDCH', 'Smiley Sans', 'WDCH', ' '], 'WDCH'), {
  catalog, uploaded: ['WDCH'], current: null,
});
// 当前值在清单里：不额外加项
assert.equal(captionFontOptions(catalog, [], 'Noto Sans SC').current, null);
// 当前值哪边都不在（字体被删 / 上传列表还没取回来）：留一项，下拉不显示成 Anton
assert.equal(captionFontOptions(catalog, [], 'Douyin Meihaoti').current, 'Douyin Meihaoti');
assert.equal(captionFontOptions(catalog, [], '').current, null);

console.log('captionFonts.verify: quoting + uploaded font options passed');
