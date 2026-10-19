import { configure, provide } from "@morlay/zephyr";
import { SessionProjectionCacheDefault } from "../session-projection-cache.service.ts";

/** 投影落盘节流：每 200 个事件或 5s 写一次（默认值写在这里，装配面可按需 `configure` 覆盖）。 */
export const provideSessionProjectionCache = provide(
  configure(SessionProjectionCacheDefault, { writeEveryEvents: 200, writeIntervalMs: 5000 })([
    SessionProjectionCacheDefault,
  ]),
);
