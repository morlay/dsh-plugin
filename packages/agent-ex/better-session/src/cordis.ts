// **行入口**：把本包的核心实现包成 cordis 插件对象，让"按 `ctx.plugin(...)` 装"的装配也能用。
//
// 生产装配面走 `provideXxx()`（令牌注入），**不需要**这一层；它存在的理由是：
// 1. 本仓以外按 cordis 行装配的部署（`cordis.yml` 的 `name:` 行）能直接列本包；
// 2. 从源包搬过来的 spec 全部按 `ctx.plugin(SessionPersistenceRdbRow, config)` 装配——那一层断言
//    （句柄语义、read view、rewind 位点）与装配形式无关，保留原形态才能证明行为没漂。
//
// **不传 `Config`**：`toCordis` 的 `Config` 要的是 cordis 的 schema（`~standard.validate`），而本包的
// `static Config` 是普通的规范化函数——交给 `toCordis` 会在 cordis 的 `resolveConfig` 里炸。
import { toCordis } from "@morlay/zephyr/compat";
import { SessionPersistenceRdb } from "./rdb-store.service.ts";

// 会话落盘的行入口：`ctx.plugin(SessionPersistenceRdbRow, { type: "sqlite", path })`。
export const SessionPersistenceRdbRow = toCordis(SessionPersistenceRdb);

export default SessionPersistenceRdbRow;
