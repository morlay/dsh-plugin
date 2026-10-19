-- 统计衍生表：纯派生数据（打开库时按事件表全量回填），迁移直接先删后建，
-- 不做 ALTER / 数据搬迁。结构与取舍见 ADR-统计衍生表物化归属与汇总。
DROP TABLE IF EXISTS `t_event_usage`;--> statement-breakpoint
DROP TABLE IF EXISTS `t_event_counts`;--> statement-breakpoint
DROP TABLE IF EXISTS `t_session_usage`;--> statement-breakpoint
DROP TABLE IF EXISTS `t_session_counts`;--> statement-breakpoint
CREATE TABLE `t_event_usage` (
	`f_event_id` text PRIMARY KEY NOT NULL,
	`f_created_at` bigint NOT NULL,
	`f_day` text NOT NULL,
	`f_provider` text,
	`f_model` text,
	`f_referenced` integer DEFAULT 0 NOT NULL,
	`f_subagent` integer DEFAULT 0 NOT NULL,
	`f_input_tokens` integer DEFAULT 0 NOT NULL,
	`f_output_tokens` integer DEFAULT 0 NOT NULL,
	`f_cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`f_reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`f_total_tokens` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_t_event_usage_f_event_id_t_events_f_event_id_fk` FOREIGN KEY (`f_event_id`) REFERENCES `t_events`(`f_event_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_event_usage_created_at` ON `t_event_usage` (`f_created_at`);--> statement-breakpoint
CREATE TABLE `t_session_usage` (
	`f_session_id` text NOT NULL,
	`f_day` text NOT NULL,
	`f_provider` text DEFAULT '' NOT NULL,
	`f_model` text DEFAULT '' NOT NULL,
	`f_input_tokens` integer DEFAULT 0 NOT NULL,
	`f_output_tokens` integer DEFAULT 0 NOT NULL,
	`f_cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`f_reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`f_total_tokens` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_t_session_usage_f_session_id_t_sessions_f_session_id_fk` FOREIGN KEY (`f_session_id`) REFERENCES `t_sessions`(`f_session_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_session_usage_key` ON `t_session_usage` (`f_session_id`,`f_day`,`f_provider`,`f_model`);--> statement-breakpoint
CREATE TABLE `t_session_counts` (
	`f_session_id` text NOT NULL,
	`f_day` text NOT NULL,
	`f_turns` integer DEFAULT 0 NOT NULL,
	`f_steps` integer DEFAULT 0 NOT NULL,
	`f_user_inputs` integer DEFAULT 0 NOT NULL,
	`f_tool_calls` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_t_session_counts_f_session_id_t_sessions_f_session_id_fk` FOREIGN KEY (`f_session_id`) REFERENCES `t_sessions`(`f_session_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_session_counts_key` ON `t_session_counts` (`f_session_id`,`f_day`);
