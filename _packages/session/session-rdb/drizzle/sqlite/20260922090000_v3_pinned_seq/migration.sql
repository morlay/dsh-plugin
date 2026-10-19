-- 只加一列：上游 0.1.7 的 workspace registry 状态多了 `pinnedSessionIds`（钉住的会话 id 集合，
-- 最近钉住的在前；归档与钉住互斥）。归档在本库里用会话行的 `f_archived_at` 表达，钉住同理用
-- 一个序号列：值是它在集合里的位置，读回即按它排序。
ALTER TABLE `t_sessions` ADD `f_pinned_seq` integer;
