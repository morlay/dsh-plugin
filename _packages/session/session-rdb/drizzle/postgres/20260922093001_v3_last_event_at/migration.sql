-- 见 SQLite 侧同名迁移的说明：最后活动时间物化到会话行，写路径维护，这里一次性回填。
ALTER TABLE "t_sessions" ADD COLUMN "f_last_event_at" bigint;
--> statement-breakpoint
UPDATE "t_sessions" s
   SET "f_last_event_at" = (
         SELECT MAX(e.f_created_at)
           FROM "t_session_events" se
           JOIN "t_events" e ON e.f_event_id = se.f_event_id
          WHERE se.f_session_id = s.f_session_id
       );
