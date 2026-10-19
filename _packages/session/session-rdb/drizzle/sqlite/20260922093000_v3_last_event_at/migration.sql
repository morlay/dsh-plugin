-- 「最后活动时间」物化到会话行：管理面的会话列表要按它排序 + 分页，原先每行一次「该会话最后事件时间」的
-- 相关子查询（真实库 243 行 = 4.2s）在分页下也救不了——排序要求全表先把值算出来。加列后排序与分页都只
-- 碰 t_sessions（毫秒级），写路径负责维护；这里一次性回填，没有事件的会话留 NULL（读时回落 createdAt）。
-- 类型写 `integer`（不是 `bigint`）：STRICT 表只认固定类型名，`bigint` 会被拒。
ALTER TABLE `t_sessions` ADD `f_last_event_at` integer;
--> statement-breakpoint
UPDATE `t_sessions`
   SET `f_last_event_at` = (
         SELECT MAX(e.f_created_at)
           FROM t_session_events se
           JOIN t_events e ON e.f_event_id = se.f_event_id
          WHERE se.f_session_id = t_sessions.f_session_id
       );
