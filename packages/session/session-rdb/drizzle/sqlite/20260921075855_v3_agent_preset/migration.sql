-- 只加一列：`agentPreset` 是会话 header 的创建事实，会话投影 `agentPreset` 的 `init` 只读 header
-- （缺了就被算成 null 并缓存下来），所以列式 header 必须存它。
--
-- 生成器另外还想重建 `t_event_usage`（实体的 tokens 列没有 default，而既有迁移建的表带 DEFAULT 0）。
-- 那次重建与本次改动无关，且会在几十万行的库上重写整表，所以不在这里应用；实体的 default 差异
-- 留待单独处理。
ALTER TABLE `t_sessions` ADD `f_agent_preset` text;
