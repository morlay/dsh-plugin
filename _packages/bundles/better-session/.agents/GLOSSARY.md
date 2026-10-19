# 会话编辑装配面（better-session）

本包自己的词：本包作为聚合层把三层装进 profile 时**自己做的那个替换**；跨包的装配词汇（装配本身、
会话编辑的操作词）在根 [`.agents/GLOSSARY.md`](../../../../.agents/GLOSSARY.md)，边界表见
[`.agents/GLOSSARY-MAP.md`](../../../../.agents/GLOSSARY-MAP.md)。

## 术语

**rdb 替换（rdb replacement）**：
用 `@morlay/session-rdb` 实现 `ctx.sessionPersistence`、禁用官方
`session-persistence-jsonl`（理由见
[ADR-20260917-rdb替换官方jsonl持久化](./adrs/20260917-rdb替换官方jsonl持久化.md)）。
_避免使用_：持久化迁移、storage swap
