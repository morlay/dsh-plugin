import { toCordis } from "@morlay/zephyr/compat";
import { RdbController } from "./persistence/rdb-controller.ts";
import { SessionRdbModule } from "./rdb.module.ts";

// dsh 行入口：整个 rdb 一个 Module 批量装进同一行；行 config 按持久化后端的 schema 解析后分发给各 Provider。
export const sessionRdbRow = toCordis(SessionRdbModule, { Config: RdbController.Config });

export default sessionRdbRow;
