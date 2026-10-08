-- 见 SQLite 侧同名迁移的说明：官方 `schedule` 域的 `tasks` 表落进本库。
CREATE TABLE "t_schedule_tasks" (
	"f_id" text PRIMARY KEY,
	"f_session_id" text NOT NULL,
	"f_status" text NOT NULL,
	"f_record" text NOT NULL,
	"f_last_delivery" text,
	"f_delivery_history" text
);
--> statement-breakpoint
CREATE INDEX "idx_schedule_tasks_session_id" ON "t_schedule_tasks" USING btree ("f_session_id");
