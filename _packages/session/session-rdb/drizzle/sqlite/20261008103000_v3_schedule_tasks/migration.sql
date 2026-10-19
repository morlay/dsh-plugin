-- 官方 `schedule` 域（`dsh-schedule` 的 `tasks` 表）落进本库：web-app 在每份 profile 里挂那一行，
-- 而 `storage-domain` 的 backend 路由指向 rdb——一个提醒一行，归属会话与状态是列，记录与投递回执存 JSON。
-- 手写迁移（生成器产不出可用 diff，见 `.agents/debts/20260921-drizzle生成器与实体定义对不上.md`）：
-- 本文件只含这次的真实改动，没有需要说明的略过段。
CREATE TABLE `t_schedule_tasks` (
	`f_id` text PRIMARY KEY,
	`f_session_id` text NOT NULL,
	`f_status` text NOT NULL,
	`f_record` text NOT NULL,
	`f_last_delivery` text,
	`f_delivery_history` text
);
--> statement-breakpoint
CREATE INDEX `idx_schedule_tasks_session_id` ON `t_schedule_tasks` (`f_session_id`);
