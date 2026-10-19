# 跟随上游 session-format

状态：已采纳

背景：上游的 `SESSION_FORMAT_VERSION` 现在是 4，改动落在我们读写的每条缝上。本仓库按上游语义适配，**不自建
迁移**——非当前格式统一走上游迁移链，读路径负责把旧字段形状归一为当前形状。

**决定**

读写的坐标与 shape 全部对齐上游当前格式：

- **非当前格式都走迁移链**：`isLegacyVersion` 为 `version < SESSION_FORMAT_VERSION`（`src/legacy.ts:73`），
  从 v0 逐段相邻迁移上来；相邻边要求**显式子会话证据**，所以读旧数据用
  `createSessionFormatCatalogWithChildren([])`（声明「无子会话」，`restoreCatalog`，`src/legacy.ts:52`）。
- **物理 header 按版本选形状**：v0 / v1 用 `seedLength`，v2 起用 `isSeeded`（前缀长度由 log 内
  `session/end-seed` 推导）——`physicalHeader` 按 `f_version` 选择（`src/legacy.ts:11`）。
- **`tool/result` 按当前形状读写**：tool 角色、`toolCallId` 在消息顶层、`content` 就是结果块（维度提取
  `f_role` = tool、`f_action_id` = `data.message.toolCallId`；「只改结果」的重写判定也读新形状，
  `src/schema.ts:166`、`src/log.ts:214`）。
- **message source 的 kind 由生产者自报**：泛型 `{ kind: 'plugin', plugin }` 没有了；compaction 的检查点消息
  自报 `compact-checkpoint`（带 `compactionId`）。
- **钉住集合落会话行的 `f_pinned_seq`**（最近钉住在前、与归档互斥），读回即按它排序；旧 `storages` 文档没有
  这个集合，导入按空处理。
- **桥接行 surfaceOp 读取归一**：v2 时代的 `{op:'replace', start, end}` 在 `rowToEvent` 归一为
  `{op:'replace', startSeq, endSeq}`（`src/log.ts:9`）——上游对旧字段名 fail loud，归一不改数值坐标。
- **`system/message` 纳入本地 surface 集合**：`SURFACE_EVENT_TYPES` 与上游 `SurfaceEventType` 同步
  （`src/log.ts:127`），否则 system head 的 surfaceOp 会被当「非 surface 事件携带 surfaceOp」清掉。
- **`assistant/message` 的 replace 降级 append**：上游禁止它携带 `sourceEventSeqs`（来源内嵌在 stream），
  其 replace 的 provenance 永远无法满足 fold 校验，降级 append 是唯一可加载形态（`src/log.ts:234`）。
- **回退视图扛住我们写过、后来被上游退役的形状**（`adoptLegacyRows` → `normalizeToCurrentShape`，
  `src/log.ts:478`）：pre-step 的 `request/header`（剥掉 `header.system` / 空 `tools` / 空 `adapterDefaults`）、
  旧形状的 `tool/result`（user 角色 + 结果块包在 `content[0]`）抬成当前形状、`system/message` 的 source 归一为
  `system-prompt`、PTC 词汇（`tool/code-dispatch-*` → `tool/ptc-dispatch-*`、`tools-code-mode` → `tools-ptc`、
  preset 值 `code` → `ptc`，`src/log.ts:423`）；白名单里的事件类型标 `ignorable: true`
  （`OWN_EVENT_TYPES`，`src/log.ts:552`）——**其它未知类型保持 fail loud**（那是「数据来自更新版本的
  harness」的信号，不能用 ignorable 吞掉）。
- **版本号不可信时按内容再判一次**：库里存在「当前版本号 + 旧代形状」的行（写路径曾把回退视图的结果以当前
  版本号落库），所以当前格式分支里 `scanRows` 之后按内容再判（`needsShapeAdoption`，`src/index.ts:1050`），
  命中走同一条归一。检测必须在扫干净的边界之内做——撕裂尾部与坏行由 `scanRows` 先丢掉，否则检测本身会撞上
  坏 JSON。
- **读取视图修复先于校验**：夹取 / 降级必须在 `validateStoredEvents` 看到 replace range 之前完成，否则历史
  会话的加载入口失败（流程与顺序见 [设计 读路径](../designs/20260917-读路径.md)）。

**考虑过的选项**

- **跟随上游 fail loud（不归一）**：pre-step 的旧会话升级后无法加载，`readRaw` 导出也走同一读取路径，
  用户历史数据不可访问——不做。
- **自行重排 pre-step surface 的旧日志**：需要事件重编号 + 全量引用重映射，改变历史坐标且偏离上游语义——不做。
- **不跟随、只靠回退视图**：旧的 `tool/result` 过不了上游对 role / toolCallId 的校验，历史会话直接加载失败。
- **只做字段重命名、不接迁移链**：旧数据的 system prompt 无法恢复，`request/header.header.system` 会被校验
  拒绝，等于放弃历史会话。
- **为父会话收集子会话证据**：目录事实由父会话自己在成功路径上写成 `subagent/catalog` 事件，child evidence
  只是补缺入口；为它加一次子会话扫描 + 事件解析，复杂度与收益不成比例（缺口写进「后果」）。
- **钉住集合单独建表**：归档已经用会话行的 `f_archived_at` 表达，钉住用同类的一列更省一层 join；单独的关联表
  会多一张只有几十行的表与一套级联清理。

**后果**

- 旧会话首次写打开时整体重写落库（`rewriteMigratedLog`），读坐标包含迁移注入的 system head
  （见 [设计 旧数据修复](../designs/20260917-旧数据修复.md)）。
- pre-step surface 的旧会话走回退视图：可读，但 surface 上没有 system head（历史 system prompt 被剥离）。
- 纯 v0 / v1 的 pre-step 会话（消息无 id、旧 payload 形状）仍不可读：payload 转换属于迁移链的职责，
  回退视图只做字段级归一。
- **已知限制**：父会话迁移时声明无子会话证据，因此不补「父会话里本就没有的」`subagent/catalog` 事实；
  正常数据不受影响（那时代的目录事实由父会话自己承载）。
- 迁移 `drizzle/{sqlite,postgres}/20260922*_v3_pinned_seq` 只加一列（沿用手写迁移的惯例，见
  [债务 drizzle生成器与实体定义对不上](../debts/20260921-drizzle生成器与实体定义对不上.md)）。
- 本地读路径与上游字段名绑定（`startSeq` / `endSeq`、tool/result 的 `toolCallId`、source kind 词汇），
  上游再改名时需同步更新。
