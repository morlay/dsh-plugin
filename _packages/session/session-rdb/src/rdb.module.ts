import { Module, type ProviderList } from "@morlay/zephyr";
import { SessionAdmin } from "./admin/session-admin.service.ts";
import { SessionBranchRdbProvider } from "./branch.ts";
import { SessionStorageTakeover } from "./storage-takeover/session-storage-takeover.service.ts";
import { RdbController } from "./persistence/rdb-controller.ts";
import { SessionPersistenceRdb } from "./persistence/session-persistence-rdb.service.ts";
import { SessionQueryRdb } from "./query/session-query-rdb.service.ts";

const providers = (): ProviderList => [
  RdbController,
  SessionAdmin,
  SessionPersistenceRdb,
  SessionBranchRdbProvider,
  SessionQueryRdb,
  SessionStorageTakeover,
];

// rdb 的装配面：控制面 + 持久化 + 分支 / 查询 / 用量 / 管理动作各一个 Provider；行入口见 ./cordis-register。
@Module({
  providers: providers(),
})
export class SessionRdbModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
