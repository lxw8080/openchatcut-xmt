/**
 * V3 迁移对 XMT 衬底轨的契约：轨道**名字**留住（衬底轨叫「衬底」）、
 * trackOrder 的上下顺序留住（叠层 → 衬底 → 主视频）、条目跟随重映射后的
 * 稳定轨道 id；主轨自下而上数仍是 V1。
 *
 * 已知副作用（接受并记录，不修）：迁移后视频轨别名自下而上重数，
 * 衬底轨拿到别名 V2、原叠放轨变 V3——别名只是显示层，稳定 id 才是身份。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runProjectMigrations } from '../persist/migrations/index.ts';
import { trackAlias, trackKind } from '../editor/timelineTypes.ts';
import type { Timeline } from '../editor/types.ts';

const fixtureUrl = new URL('./fixtures/xmt-backdrop-project.json', import.meta.url);
const doc = JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8'));

const result = runProjectMigrations(doc);
assert.ok(result, 'runProjectMigrations 必须受理真实 bridge 产出的 v3 工程');
const migrated = result!.doc;
const tl = migrated.timelines[0] as Timeline;

const order = tl.trackOrder ?? Object.keys(tl.tracks ?? {});
const nameOf = (id: string) => (tl.tracks?.[id] as { name?: string } | undefined)?.name;
const kindOf = (id: string) => trackKind(tl, id);

const backdropId = order.find((id) => nameOf(id) === '衬底');
assert.ok(backdropId, `迁移后衬底轨名丢了（顺序：${order.map((id) => `${id}:${nameOf(id) ?? ''}`).join(' → ')}）`);
assert.equal(kindOf(backdropId!), 'video');

const videoIds = order.filter((id) => kindOf(id) === 'video');
const aliasOf = videoIds.map((id) => `${id}=${trackAlias(tl, id)}(${nameOf(id) ?? ''})`);
// trackOrder 自上而下：叠层 → 衬底 → 主视频。
assert.equal(videoIds.length, 3, `视频轨应恰为叠层/衬底/主轨三条：${aliasOf.join(', ')}`);
assert.equal(nameOf(videoIds[0]!), '叠层', `自上而下第一条视频轨应是叠层：${aliasOf.join(', ')}`);
assert.equal(nameOf(videoIds[1]!), '衬底', `中间一条应是衬底（它的新别名是 ${trackAlias(tl, videoIds[1]!)}）：${aliasOf.join(', ')}`);
assert.equal(nameOf(videoIds[2]!), '主视频');
assert.equal(
  trackAlias(tl, videoIds[2]!), 'V1',
  `主轨别名必须仍是 V1（实际 ${trackAlias(tl, videoIds[2]!)}；衬底轨新别名 ${trackAlias(tl, videoIds[1]!)}）`,
);

// 条目跟随重映射后的稳定 id：scrim / bed 落在衬底轨，overlay 落在叠层轨，
// shot 落在主轨；没有任何条目还指着旧别名 id。
const trackOf = (id: string) => tl.items.find((item) => item.id === id)?.track;
assert.equal(trackOf('scrim-001'), videoIds[1]);
assert.equal(trackOf('backdrop-001'), videoIds[1]);
assert.equal(trackOf('overlay-001'), videoIds[0]);
assert.equal(trackOf('shot-000'), videoIds[2]);
assert.equal(trackOf('shot-001'), videoIds[2]);
assert.ok(
  tl.items.every((item) => order.includes(item.track)),
  '迁移后仍有条目指向不存在的轨道 id',
);

console.log('backdropMigration.verify.ts OK');
