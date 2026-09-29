# 跟随上游 session-format-v3

状态：已采纳

背景：上游把 `SESSION_FORMAT_VERSION` 升到 3，并改了会话日志的 surface 表达：`seq` 与 `SurfaceOp` 的 range
端点是 branded `SessionSeq`；replace 的 `start` / `end` 改名 `startSeq` / `endSeq`；system prompt 从
`request/header.header.system` 提升为受保护的 surface 节点（`system/message` 占 node 0）；`adoptSessionEvent`
新增事件级 surface 元数据校验（含 `header.system` 必须省略、空 `tools` / `adapterDefaults` 必须省略）。
本仓库按上游语义适配，不自建迁移。

**决定**

读写的坐标与 shape 全部对齐 v3：非当前格式统一走上游迁移链，读取视图负责把 v3 之前的字段形状归一为当前
形状，并保证修复发生在 `validateStoredEvents` 之前。

- **非当前格式都走迁移链**：`isLegacyVersion` 为 `version < SESSION_FORMAT_VERSION`（`src/legacy.ts:73`），
  v2 数据经 `sessionFormatCatalog` 的 v2→v3 相邻迁移升级（首个 step 注入空 system head、`request/header` 的
  system 以 replace 更新该 head、剥离 `header.system`）。
- **物理 header 按版本选形状**：v0 / v1 用 `seedLength`，v2 起用 `isSeeded`（前缀长度由 log 内
  `session/end-seed` 推导）——`physicalHeader` 按 `f_version` 选择（`src/legacy.ts:11`）。
- **桥接行 surfaceOp 读取归一**：`f_surface_op` 里 v2 时代的 `{op:'replace', start, end}` 在 `rowToEvent` 归一为
  `{op:'replace', startSeq, endSeq}`（`src/log.ts:9`）——上游以「invalid replace surfaceOp」fail-loud 拒绝旧
  字段名，归一不改变数值坐标。
- **`system/message` 纳入本地 surface 集合**：`SURFACE_EVENT_TYPES` 与上游 `SurfaceEventType` 同步
  （`src/log.ts:127`），否则 system head 的 surfaceOp 会被当「非 surface 事件携带 surfaceOp」清掉。
- **`assistant/message` 的 replace 降级 append**：上游禁止 `assistant/message` 携带 `sourceEventSeqs`
  （来源内嵌在 stream），其 replace 的 provenance 永远无法满足 fold 校验，降级 append 是唯一可加载形态
  （`src/log.ts:234`）。
- **回退视图归一 `request/header`**：上游 v2→v3 迁移对「首个 step 之前出现 surface」显式拒绝（拒绝重排历史），
  而本仓库编辑 / 重试种子（`appendManualTurn`）写入的正是 pre-step 形状。`adoptLegacyRows` 在
  `validateStoredEvents` 之前剥掉 `header.system` / 空 `tools` / 空 `adapterDefaults`，让这类 v2 会话保持可读；
  system prompt 因此不再进入模型请求，会话下次运行由 v3 的 `system/message` 机制重建。
- **读取视图修复先于校验**：夹取 / 降级必须在 `validateStoredEvents` 看到 replace range 之前完成，否则历史会话
  的加载入口失败（流程与顺序见 [设计 读路径](../designs/20260917-读路径.md)）。
- **回退视图归一 PTC 词汇**：`renameLegacyPtcEvents` 把 `tool/code-dispatch-*` 改名为 `tool/ptc-dispatch-*`、
  `tools-code-mode` 插件来源改为 `tools-ptc`、agent preset 值 `code` 改为 `ptc`（`src/log.ts:423`）——
  上游对旧类型名 fail loud，改写与迁移链的 `renamePtcEvent` 对齐。

**考虑过的选项**

- **跟随上游 fail loud（不归一 request/header）**：pre-step 的 v2 会话升级后无法加载，`readRaw` 导出也走同一
  读取路径，用户历史数据不可访问——因此不做。
- **自行重排 pre-step surface 的旧日志**：重排事件或补合成 step 都需要事件重编号 + 全量引用重映射，改变历史
  坐标且偏离上游语义；不做。
- **只做字段重命名、不接迁移链**：v2 数据的 system prompt 无法恢复，且 `request/header.header.system` 会被
  校验拒绝，等于放弃 v2 历史会话。

**后果**

- v2 会话在首次写打开时整体重写落库（`rewriteMigratedLog`），读坐标包含迁移注入的 system head
  （见 [设计 旧数据修复](../designs/20260917-旧数据修复.md)）。
- pre-step surface 的 v2 会话走回退视图：可读，但 surface 上没有 system head（历史 system prompt 被剥离）。
- 纯 v0 / v1 的 pre-step 会话（消息无 id、旧 payload 形状）仍不可读：payload 转换属于 v0→v1 迁移链的职责，
  回退视图只做字段级归一。
- 本地 surface 修复逻辑与上游 `SurfaceOp` 字段名绑定（`findSurfaceRepairs`、`recomputeReplaceProvenance`、
  `syncMeteringRanges` 读 `startSeq` / `endSeq`），上游再次改名时需同步更新；v4 的字段变化见
  [ADR-跟随上游session-format-v4](20260922-跟随上游session-format-v4.md)——本 ADR 的 v0–v3 迁移链与读路径
  修复仍然有效。
