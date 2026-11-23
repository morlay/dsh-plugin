# 标题前缀搜索用不上 idx_sessions_title（SQLite 上整表扫）

状态：未销账——前缀段比 `lower(f_title)`，索引建在原列 `f_title` 上，SQLite 的 `EXPLAIN QUERY PLAN` 给 `SCAN t_sessions`；`idx_sessions_title` 当前没有查询读者，留着等量级上来再接。
位置：`packages/agent-ex/better-session/src/data/store/rows-query.ts`（`sessionRowsSearchCondition` 的两段写法）、`packages/agent-ex/better-session/src/data/entities/v3/sessions.ts`（`idx_sessions_title` 的定义）、`packages/agent-ex/better-session/src/admin/__tests__/search-filter.spec.ts`「前缀段的索引代价：lower(f_title) 用不上原列索引，计划是整表扫（已接受的债）」；PG 同判据见 `packages/agent-ex/better-session/src/admin/__tests__/search-filter.pg.spec.ts`（含 `Index Cond` 对照）。

**现象**

- 前缀段两方言两种写法，判据都是「折过大小写的前缀」：SQLite 是 `lower(f_title) >= ? AND lower(f_title) < ?`，PG 是 `like(lower(f_title), 'x%')`；全文段是 `like(lower(f_title), '%x%')`——两段同一口径。
- `idx_sessions_title` 是原列上的普通索引（SQLite 的 BINARY 排序 / PG 的默认 collation），条件里的 `lower(...)` 对不上它：SQLite 计划是 `SCAN t_sessions`，PG 要有 `lower(f_title)` 上的表达式索引才可能走。
- 列表没有按标题排序的读法（默认 `f_last_event_at` 降序、第二键 `f_session_id`），这条索引因此没有任何查询读者，只有定义。

**影响**

会话数上千后，搜索的第一段就全表扫一遍并对每行算一次 `lower()`，`COUNT` 与翻页各扫一次。当前量级（本地库、数十到数百会话）单次耗时可忽略，用户只感到搜索慢一点。

**触发条件**

标题搜索成为热点时必须先还：会话数上千，且搜索是常用动作（前端防抖后每次输入都打一枪 `rows`）。

**销账条件**

Done when：SQLite 的 `EXPLAIN QUERY PLAN` 在前缀段显示走索引（`SEARCH t_sessions USING INDEX ...`）而不是 `SCAN t_sessions`，PG 上同一条也走索引；并有一条断言查询计划的用例（`search-filter.spec.ts` 现在这条「整表扫」的判断换成正向断言）。

**不修的理由**

两条改法都要 rdbkit 先支持：给列加 collation（SQLite 的 `COLLATE NOCASE` 索引），或给 `t_sessions` 加 `title_lower` 归一列（写路径同步维护 + 既有库回填）。本包现在只能声明列名与普通索引，collation 与表达式索引都表达不出来；`COLLATE NOCASE` 只折 ASCII，非 ASCII 的折大小写还得靠归一列。语义优先（两段同一大小写口径是产品判据），量级不大，先把索引留着，等其中一条能力到位再恢复它的读者。
