# rewind 绕过 handle 模型直接截断

状态：已采纳

背景：上游 `SessionHandle` 模型只有 append-only，没有显式回退原语，而 rewind 必须真的把日志截断到某个闭合
边界（客户端增量同步按 seq 前进，留墓碑会让旧节点残留）。

**决定**

rewind **直接操作后端事务**、不经上游 handle 面：边界校验（闭合 `turn/end`，或 `-1` 空前缀）→ 事务内截断
（删桥接行 + head 游标回退 + revision bump，Abort 整体回滚）→ 更新 `WriteGuard` 确认 head → live 会话同步
（截断内存 log、失效投影单元缓存与 token meter 折叠、重置 agent 轮次游标、对齐 handle cursor、取消排队输入）
→ 刷新持久化投影检查点。**只删桥接行，事件行保留**（全局实体，可能被其他会话引用）。

读面同样绕过 handle 抽象：rewind 是「先停止、再操作」的排他面，所以不拉全量日志（`readLog` 会做 legacy 转换

- 读视图修复 + 全量扫描），而是直连 DB 按 `(session_id, f_sequence)` 只读边界那一行的类型与尾部窗口的类型；
  保留前缀的 step 配平也只在该窗口内做（`rewindKeepLength`）。只有 legacy（非当前格式）会话因为持久化坐标与
  视图 seq 不一致，才回退到 `readLog`。细节见 [设计 分支能力](../designs/20260917-分支能力.md)。

**考虑过的选项**

- **扩展 handle 模型支持回退原语**：违反「上游不可修改」红线。
- **用 append 表达删除（tombstone 事件）**：append-only 事件流无法表达截断，客户端增量同步会残留旧节点。
- **rewind 先 `readLog` 全量读再截断**：排他面上全量读 + 修复是白付；有界读只取边界与尾部窗口的类型。

**后果**

- rewind 是 rdb 特有的直接截断，未与 handle 模型的 per-id 串行链互斥（无法从外部访问）；调用方必须先停止
  该会话的运行中 loop，对 cold 会话调用时需保证没有 in-flight append；多实例共享数据库时由事务 + head 校验
  兜底（[设计 并发写入](../designs/20260917-并发写入.md)）。
- 截断进入继承前缀时须收缩 `f_seed_length`（只收缩、不扩张），否则存储出现「继承前缀超过存储事件数」的矛盾，
  上游 load 拒绝。
- 保留区 replace range 完整性由数学保证：replace 的 range 引用更早事件，截断尾部不可能破坏保留区 range。
- 截断后必须同步的派生状态（投影单元缓存失效、token meter 折叠丢弃、agent 排队输入 durable 取消、持久化投影
  检查点刷新）与 fail-soft 语义见 [设计 分支能力](../designs/20260917-分支能力.md) 的 rewind 步骤；漏掉任一项会让
  被截断的历史在读取侧重现或重放错乱。
