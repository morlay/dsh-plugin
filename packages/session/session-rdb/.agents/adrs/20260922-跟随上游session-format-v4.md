# 跟随上游 session-format-v4

状态：已采纳（承接 [ADR-跟随上游session-format-v3](20260917-跟随上游session-format-v3.md)，v0–v3 的迁移链与读路径修复都不动）

背景：上游 0.1.7 把 `SESSION_FORMAT_VERSION` 从 3 升到 4，同一批改动落在我们读写的每条缝上：

- **tool/result 消息换了角色与形状**：v3 是 user 角色的消息，身份与结果都包在 `content[0]` 那个
  `tool-result` 块里；v4 是 tool 角色、`toolCallId` 在消息顶层、`content` 就是结果块本身。
- **message source 的 kind 变成各生产者自报**：泛型 `{ kind: 'plugin', plugin }` 没了，
  compaction 的检查点消息自报 `compact-checkpoint`（带 `compactionId`）。
- **v3→v4 迁移要求显式子会话证据**：静态 catalog 的那条边 `createStage()` 直接抛
  `SessionFormatUnsupportedMigrationError`，必须用 `createSessionFormatCatalogWithChildren(children)`
  组装（空数组即声明「无子会话」）。
- **workspace registry 状态多了 `pinnedSessionIds`**：钉住集合（最近钉住在前，与归档互斥），
  存储接管的读写两侧都要带上它。

**决定**

跟随 v4：读旧数据改用带 v4 边的 catalog（子会话证据声明为空），tool/result 的维度提取与
「只改结果」重写判定改读新形状，钉住集合落会话行的 `f_pinned_seq` 序号列（读回即按它排序）。

**考虑过的选项**

- **不跟随、走回退视图**：`adoptLegacyRows` 会把 v3 行当 v4 读，而上游 `adoptSessionEvent`
  对 tool/result 校验 role/toolCallId，历史会话直接加载失败；不做。
- **为父会话收集子会话证据**：v3 的目录事实由父会话自己在成功路径上写成 `subagent/catalog`
  事件（上游 0.1.6 的 subagent 语义），child evidence 只是补缺入口；为它加一次子会话扫描 + 事件
  解析，复杂度与收益不成比例。真实缺口的代价写进「后果」。
- **钉住集合单独建表**：归档已经用会话行的 `f_archived_at` 表达，钉住用同类的一列更省一层 join；
  单独的关联表会多一张只有几十行的表与一套级联清理。

**后果**

- v3 会话在读取时走完整迁移链（v0→v1→v2→v3→v4）；首次写打开仍按既有机制整体重写落库。
- **已知限制**：v3 父会话迁移时声明无子会话证据，因此不补「父会话里本就没有的」`subagent/catalog`
  事实；正常数据不受影响（v3 时代的目录事实由父会话自己承载）。若将来出现真实缺口，再实现子会话证据收集。
- 钉住集合按会话行序号列存：找不到会话行的 id 会被跳过（pin 只作用于已存在的会话）；
  旧 `storages` 文档没有这个集合，导入路径按空处理。
- 新增迁移 `drizzle/{sqlite,postgres}/20260922*_v3_pinned_seq`（只加一列，沿用手写迁移的惯例，
  见 [债务 drizzle生成器与实体定义对不上](../debts/20260921-drizzle生成器与实体定义对不上.md)）。
- 本地读路径的字段名绑定又扩了一处（`startSeq`/`endSeq` 之外，加了 tool/result 的
  `toolCallId` 与 source kind 词汇），上游再改时需同步。
