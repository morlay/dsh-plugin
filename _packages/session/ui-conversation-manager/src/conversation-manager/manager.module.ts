import { Module } from "@morlay/zephyr";
import { SessionDeletionEndpoint } from "../admin/session-deletion.endpoint.ts";
import { SessionExportEndpoint } from "../admin/session-export.endpoint.ts";
import { SessionGcEndpoint } from "../admin/session-gc.endpoint.ts";
import { SessionImportEndpoint } from "../admin/session-import.endpoint.ts";
import { SessionRowsEndpoint } from "../admin/session-rows.endpoint.ts";
import { SessionUsageEndpoint } from "../admin/session-usage.endpoint.ts";
import { ConversationManagerHost } from "./conversation-manager.service.ts";

// 「对话管理」行的装配面：host 锚点 + 页面直接消费的 6 个管理面端点。
@Module({
  providers: [
    ConversationManagerHost,
    SessionRowsEndpoint,
    SessionUsageEndpoint,
    SessionDeletionEndpoint,
    SessionExportEndpoint,
    SessionGcEndpoint,
    SessionImportEndpoint,
  ],
})
export class ConversationManagerModule {}
