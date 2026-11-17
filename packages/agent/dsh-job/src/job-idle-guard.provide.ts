// 「job 域忙不忙」的装配条目（开发态换树用：`IdleGuard` 多值令牌）。
//
// 为什么不并进 `provideJob()`：那个清单住在 `src/server/` 子入口面里，面纪律不许它跨面相对导入
// （`../job-idle-guard.service.ts` 会让「面」退化成目录结构）。这条实现只服务开发态换树，
// 装不装都不影响任务本身，所以单开一个 `provideXxx()`，装配面按需要叠上去。
import { provide } from "@morlay/zephyr";
import { JobIdleGuard } from "./job-idle-guard.service.ts";

export const provideJobIdleGuard = provide([JobIdleGuard]);
