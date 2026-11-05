import { provide } from "@morlay/zephyr";
import { SessionQuerySqlite } from "../session-query.service.ts";

/** 会话查询（sqlite）：默认配置在实现类里（内存库、不自动打开），装配面可 `configure` 覆盖。 */
export const provideSessionQuerySqlite = provide([SessionQuerySqlite]);
