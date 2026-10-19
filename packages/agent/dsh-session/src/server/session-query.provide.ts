import { configure, provide } from "@morlay/zephyr";
import { SessionQuerySqlite } from "../session-query.service.ts";

/** 会话查询（sqlite，内存库、不自动打开）：默认配置写在这里，装配面可 `configure` 覆盖。 */
export const provideSessionQuerySqlite = provide(
  configure(SessionQuerySqlite, { path: ":memory:", openAt: "never" })([SessionQuerySqlite]),
);
