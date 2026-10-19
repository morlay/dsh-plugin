// 会话面的装配差异：在 dsh-base 之上换掉持久化（停官方 jsonl 持久化 / 投影缓存 / 查询 / storage json
// 四行，`storage-domain` 路由到 rdb），并装上会话编辑与引用展开。base 的行由入口应用 imports DshBaseModule，
// 这里只表达差异；入口 Module 一次性展开时会应用这里的 without。
import { Module, without } from "@morlay/zephyr";
import { SessionPersistenceJsonl } from "@morlay/dsh-base/session-persistence";
import { SessionProjectionCacheDefault } from "@morlay/dsh-base/session-projection";
import { SessionQuerySqlite } from "@morlay/dsh-base/session-query";
import { StorageBackendJson, StorageDomainDefault } from "@morlay/dsh-base/storage";
import { ReferenceModule } from "@morlay/dsh-reference";
import { SessionRdbModule } from "@morlay/session-rdb";
import { SessionEditorModule } from "@morlay/ui-conversation-message-actions";
import { ConversationManagerModule } from "@morlay/ui-conversation-manager";

@Module({
  imports: [SessionRdbModule, SessionEditorModule, ConversationManagerModule, ReferenceModule],
  providers: [
    without(SessionProjectionCacheDefault),
    without(SessionPersistenceJsonl),
    without(SessionQuerySqlite),
    without(StorageBackendJson),
    StorageDomainDefault.withConfig({ backend: "rdb" }),
  ],
})
export class BetterSessionModule {}
