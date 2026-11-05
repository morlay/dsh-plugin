// 会话级覆盖的存储：复用 harness 的 storageDomain（与 `session_projcache` 同一层），按 sessionId 存一份
// `ModeConfig`。不写会话日志、不自己落裸文件。

import { z } from "zod";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";

export const sessionModeRecord = z.object({
  config: z.record(z.string(), z.unknown()),
});

export const sessionModeDomainSpec = defineDomain({
  name: "session_mode",
  version: 1,
  invalidRecords: "backup-and-skip",
  layout: "per-record",
  tables: {
    sessions: domainTable<SessionId, { config: Record<string, unknown> }>(sessionModeRecord),
  },
});
