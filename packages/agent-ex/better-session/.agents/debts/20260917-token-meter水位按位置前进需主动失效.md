# token meter 的水位按位置前进：截断内存 log 后要主动失效上游的派生缓存

状态：未销账——我们在自己的截断与导入路径上 duck-type 失效上游的折叠水位与投影单元缓存
位置：`packages/agent-ex/better-session/src/rdb/branch/reset.ts`（`resetDerivedState`）、`packages/agent-ex/better-session/src/rdb/branch/index.ts`（`resetLiveDerivedState` / `refreshProjectionCache` / `rewindKeepLength`）、`packages/agent-ex/better-session/src/rdb/log-import.ts`、`packages/agent-ex/better-session/src/endpoint/balance.ts`

**现象**

上游的派生缓存都按**位置**记、以 `Session` 对象为键：`ctx.tokenMeter` 的折叠水位是 `consumedEvents`（`session.eventAt(seq)` 的下标，`logRevision` 直接取它），`ctx.sessionProjections` 的每份注册各有 `cells: WeakMap<Session, UnitCell>`。原地截断或整段替换会话的内存 log（rewind、覆盖导入）之后，键还指着同一个对象，缓存不会自己失效。

我们只在自己的接缝上失效，不改上游：`packages/agent-ex/better-session/src/rdb/branch/reset.ts` 的 `resetDerivedState` 按 duck-type 读 `sessionProjections.registrations` 与 `tokenMeter.states`，删掉该会话的条目；读不到（服务未挂载，或字段形状变了）就走 `warnOnce`——每个插件实例、每种键只告警一次。覆盖导入复用同一个入口（`resetLiveDerivedState`）。

step 配对在截断处配平，两条规则分居（`packages/agent-ex/better-session/src/endpoint/balance.ts`）：导出与导入是整段日志，走 `balanceRewindPrefix(…, { keepOpenTail: true })`——只丢「已不平衡」之后的尾部，合法的未闭合 `step/start` 原样保留（中断运行的正常形状，由上游 resume 补 closers）；rewind 与 fork seed 要一并丢掉悬空的 `step/start`（后面紧跟新 step，悬空会报错），丢事件时 warn。

rewind 的保留长度只依赖尾部窗口（`rewindKeepLength`：从边界往回读类型，窗口没覆盖到最近一个 `turn/end` 就翻倍重读），所以**前缀内部既有的破损不自愈**；只有旧格式的持久化坐标才整段读回前缀、走 `balanceRewindPrefix` 前向修剪。

同一族还有第三处位置水位：磁盘上的投影检查点按 head 水位存行，撤回后要按新 head 重写或截断（`refreshProjectionCache`，语义见 [设计 投影检查点与storage接管的两个名字](../designs/20261109-投影检查点与storage接管的两个名字.md)）。那一处走上游 `sessionProjectionCache` 的公开面，不是 duck-type。

**影响**

上游一改这两个私有字段的形状，失效就静默失灵：用户会在「奇怪的时机」看到手动 `/compact` 报 `step/end at seq N has no matching step/start event`，而不是在 rewind 当下。`warnOnce` 是哨兵——先出告警，再出症状。

**触发条件**

动 `packages/agent-ex/better-session/src/rdb/branch/` 的截断路径、`packages/agent-ex/better-session/src/rdb/log-import.ts` 的导入路径、或 `packages/agent-ex/better-session/src/endpoint/balance.ts` 的配平规则之前必须先看这条；上游同步（`DEEPSEEK_HARNESS_VERSION`，根 `mise.toml`）之后要重跑守护用例。

守护面（`just test packages/agent-ex/better-session`）：

- `packages/agent-ex/better-session/src/__tests__/branch.spec.ts`：「invalidates the token meter fold so a rewound live session stays measurable」（同一 meter 实例 + 预热水位）、「warns once per plugin instance when the token meter service is missing」、「warns once when the token meter and projection registry shapes change」、「loads a rewind-to-user-message session without an orphan step/start (token-meter replay safe)」；
- `packages/agent-ex/better-session/src/__tests__/projection-cache.spec.ts`：「live rewind drops the pre-truncation rows from the cache」、「cold rewind invalidates the cache instead of folding the log again」；
- `packages/agent-ex/better-session/src/__tests__/balance.spec.ts`：`balanceRewindPrefix` 与 `rewindKeepLength` 的配对规则。

覆盖空洞：导入路径的失效没有专门用例（`packages/agent-ex/better-session/src/__tests__/recovery.spec.ts` 的「导出件能原样导入回一个（新的）会话」只判可读），改导入路径时按 `packages/agent-ex/better-session/src/__tests__/branch.spec.ts` 那条 meter 用例类推，别当成已覆盖。

**销账条件**

Done when：上游满足任一项，我们侧的 duck-type 与探测告警即删除——① 折叠状态按事件身份（或日志世代、修订号）校验，水位回退或日志被重写时自行失效；② 提供公开的失效面（如 `ctx.tokenMeter.invalidate(session)`、注册表按会话丢弃 cell）。

眼下两条都没达成：`vendor/deepseek-harness/packages/llm/token-meter/src/index.ts` 的水位仍是 `consumedEvents`（`logRevision` 取它），`vendor/deepseek-harness/packages/llm/token-meter/src` 与 `vendor/deepseek-harness/packages/session/session-projection/src` 里 grep `invalidate` 0 命中；注册表只有 release 引用计数，没有按会话丢 cell 的出口。

回退动作：删掉 duck-type 失效调用与探测告警，改用上游公开面；`balanceRewindPrefix` 的配平保留（它守的是日志不变量本身），同步删掉「为 meter 保险」那部分说明。

**不修的理由**

上游不可改（`AGENTS.md` 红线），只能在我们侧规避；规避本身已经带了能力探测与配平自愈，代价是上游改结构时跟一次告警。
