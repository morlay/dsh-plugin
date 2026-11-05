# RDB 接管面的读路径

一条硬规则：**凡「按条件取一部分」的读，条件必须进 WHERE**；不许先把整份日志读进内存再过滤。
接管持久化就是为了把这一步交给数据库——做不到就等于白换。

## 三类读，三种口径

| 类别                   | 例子                                                                             | 口径                                                            | 为什么                                                       |
| ---------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| **条件读**（取一部分） | `filterSessions` / `filterEvents` / `listEvents` / `sessionAdmin/rows` / `usage` | 条件进 WHERE，只返回命中行；分页与 `total` 一次查完；聚合进 SQL | 命中行数远小于全量；内存里再筛就是白读                       |
| **单会话完整读**       | `load` / `readSession` / `observeSession` / `readSurface` / `readEvent`          | 允许读全量（会话重建要整段日志），但**必须**有界缓存或只取窄列  | 语义要求「一次完整快照」；宽表全读是浪费                     |
| **派生重算**           | 撤回后的检查点写回、`rewindKeepLength` / `balanceRewindPrefix`                   | 认**刚被截断的那个内存对象**，不回库                            | 库里的 head 可能还没跟上（flush 失败），派生状态要跟内存一致 |

## 现状（每个读口落在哪一类）

| 读口                | 落点                                                                                                                                | 守护 spec                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `filterSessions`    | `readModel.selectSessionRows`：id / cwd / parent / createdAt 进 WHERE；`availability` 按来源分流（live 遍历内存表、persisted 查库） | **无专门用例**（见文末「已知未覆盖」）                                                      |
| `filterEvents`      | `readModel.selectEventRows` + `selectEventMetas`（四列，**不取 `f_data`**）：surface 分类靠坐标，文本抽取只对命中行                 | `query.spec.ts`「1 万条事件的会话：按 seq 区间筛选只物化命中那几行，事件列表不读 f_data」   |
| `listEvents`        | `selectEventMetas`（seq / type / time / surfaceOp 四列），不物化事件体                                                              | `query.spec.ts`「listEvents / readSurface 都从同一个库读出来」                              |
| `sessionAdmin/rows` | `stats.listSessionRows`：`LIMIT` / `OFFSET` + `COUNT` 一次查完                                                                      | `admin.spec.ts`「listRows 给完整语料（含 cwd / 时间 / 归档标记）并支持分页」                |
| `usage`             | `stats.usageReport`：按天 × 模型在 SQL 里聚合                                                                                       | `endpoint.spec.ts`「usage 回报总量、子代理拆分、按天桶与按会话行（形状与契约一致）」        |
| `observeSession`    | 有界缓存，键 `(persistenceIdentity, revision)`，租约 pin 住不淘汰，容量取 `preparedSessionCacheSize`                                | `query.spec.ts` 的观测缓存三条；`session-query.spec.ts`「冷会话观察缓存容量是这一行的配置」 |
| `headerOf`          | `readModel.getSession` + `rowToMeta`，**不读日志**                                                                                  | 契约面（包内暂无调用方）                                                                    |
| `readEvent`         | `load` 后取窗口（语义要求整段快照），窗口大小显式校验                                                                               | `query.spec.ts`「readEvent 给目标事件与前后窗口，越界显式报错」                             |

## 怎么写

- **条件 → SQL 只有一个 home**：`src/rdb/query-filters.ts` 的 `sessionFilterCondition` / `eventFilterCondition`。
  加新的筛选条件只改这里，别在 service 里再写一遍 `Array.filter`。
- **列引用也只有一个 home**：`src/rdb/storage-takeover/read-model.ts` 的 `columns`（`sessions.table(db)` 那一处）。
  `SessionPersistenceRdb` 只转发 `sessionFilterColumns()` / `eventFilterColumns()`，不自己取表。
- **`null` 单独走 `IS NULL`**：`NULL` 与任何值都不相等，塞进 `IN (...)` 会静默丢行（`nullableInList` 处理这一点）。
- **窄列优先**：能只要坐标就别 `SELECT *`；`f_data` 是最大的一列，取它之前先问「这行判据真的需要事件体吗」。
- **live 会话先 flush 再读库**：`ctx.sessions.flush` 是公开同步点，flush 之后库读与内存读等价；
  不许为了「读快一点」再走一遍内存（那就是第二条读路径，见 [设计 20261109-会话查询直读RDB读面](../designs/20261109-会话查询直读RDB读面.md)）。

## 怎么证明没白读

三条接缝，任选其一（都要能复现）：

1. **计数**：给后端 `getEventRows` / `selectEventRows` / `getSessionRows` 套计数器，断言「筛 9000..9010 只读命中那几行」；
2. **探针值**：把不该读的那一列塞成 `'BROKEN'`，读路径若无其事就说明没读它；
3. **SQL 文本**：断言 `SELECT` 的列清单里没有 `f_data`。

断言「内存没涨」不算证明——GC 时机不可控；要断言「读的行数」。

## 已知未下推（都有理由，别硬塞）

| 处                                   | 为什么不下推                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `filterSessions` 的归档过滤          | 归档集合是 workspace 域的 global（与页面归档动作同源），不是会话行的列；先按行筛再按集合过，读量不变                            |
| `filterSessions` 的 ORDER BY / LIMIT | 上游 `SessionQuery.filterSessions` 没有 limit 语义（要返回全集），排序只能在内存做；加 limit 是改契约，不是改读法               |
| `readSurface`                        | `surface` 是折叠结果的**两态**，不是列；无 replace 的会话已退化成「`f_surface_op` 是否存在」的四列读，有 replace 才需要全量折叠 |
| `filterEvents` 的 surface / text     | surface 要折叠结果、text 要语义抽取（不是原文匹配），都不下推；命中行上再判                                                     |

## 已知未覆盖

- **会话侧的下推没有断言**：事件侧有「1 万条事件的会话：按 seq 区间筛选只物化命中那几行，事件列表不读 f_data」这条计数 + 探针用例，会话侧（`filterSessions` 的 id / cwd / parent / createdAt）没有等价用例。补它要一个上万会话行的库与一次 `selectSessionRows` 计数。

## 会再犯的反例

- 把整份日志 `load` 出来再 `Array.filter`（同库同事件读两遍、缓存两份）。
- 用 live 会话的同步历史读当第二读路径（查库前 flush 就够）。
- `headerOf` 用 `load`（读完整日志只为拿一行 header）。
- 在 service 里内联表名拼条件（列引用的 home 会分叉成两份）。
- 给 `observeSession` 加「读不到就回内存」的兜底（把「库里日志不完整」这个事实藏起来）。
