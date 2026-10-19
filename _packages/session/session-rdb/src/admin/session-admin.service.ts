// 管理面能力（端点背后的事）：会话列表、用量、删除、导出、导入、GC。
// HTTP 层在消费它的前端包里；这里只暴露能力，供 `@morlay/session-rdb/admin` 出口使用。
import { inject, Injectable } from "@morlay/zephyr";
import { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import { Agents } from "@morlay/dsh-base/agent";
import { SessionStore } from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { RdbController } from "../persistence/rdb-controller.ts";
import { SessionPersistenceRdb } from "../persistence/session-persistence-rdb.service.ts";
import { SessionBranchProvider } from "../branch/contract.ts";
import { persistImport } from "../import/session-import.ts";
import type { SessionRowsItem, SessionRowsRequest } from "../query/session-rows.types.ts";
import type { UsageAggregate } from "../usage/usage.ts";

interface GcAgentLike {
  cancel?(cause: { kind: "user" }, options?: { keepInbox?: boolean }): void;
  whenIdle(): Promise<void>;
}

export interface SessionAdminRows {
  items: SessionRowsItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SessionAdminGcResult {
  orphanSessions: number;
  orphanEvents: number;
  stoppedAgents: number;
}

// 一页的条数上限：超过就按上限截断（这个接口给页面用，不是导出通道）。
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class SessionAdmin {
  persistence = inject(SessionPersistence);

  controller = inject(RdbController);

  branch = inject.optional(SessionBranchProvider);

  sessions = inject(SessionStore);

  agents = inject.optional(Agents);

  // 令牌是上游抽象类；rdb 的扩展方法（internals / usageReport / readRaw）在这里收口。
  private get rdb(): SessionPersistenceRdb {
    return this.persistence as SessionPersistenceRdb;
  }

  async listRows(
    request: SessionRowsRequest = {},
  ): Promise<SessionAdminRows> {
    const page = Number.isSafeInteger(request.page) && (request.page ?? 0) > 0 ? request.page! : 1;
    const requested = request.pageSize;
    const pageSize =
      Number.isSafeInteger(requested) && (requested ?? 0) > 0
        ? Math.min(requested!, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;
    const { items, total } = await this.controller.backend.listSessionRows({
      ...(request.query === undefined ? {} : { query: request.query }),
      ...(request.includeSubagents === undefined
        ? {}
        : { includeSubagents: request.includeSubagents }),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { items, total, page, pageSize };
  }

  usage(sinceMs?: number): Promise<UsageAggregate> {
    return this.rdb.usageReport(sinceMs);
  }

  deleteSession(sessionId: SessionId): Promise<void> {
    return this.rdb.deleteSession(sessionId);
  }

  exportSession(sessionId: SessionId) {
    return this.rdb.readRaw(sessionId);
  }

  importSession(
    imported: Parameters<typeof persistImport>[2],
    targetId?: SessionId,
  ): Promise<SessionId> {
    return persistImport(
      this.rdb,
      this.branch,
      imported,
      targetId,
      this.sessions,
      (id) => this.stopAgentLoop(id),
    );
  }

  async gc(): Promise<SessionAdminGcResult> {
    const stoppedAgents = await this.stopRunningAgents();
    // 先回收孤儿会话，再回收事件行：被删会话独占的事件行才刚成为孤儿。
    const orphanSessions = await this.rdb.collectOrphanSessions();
    const orphanEvents = await this.rdb.collectOrphans();
    await this.rdb.vacuum();
    return { orphanSessions, orphanEvents, stoppedAgents };
  }

  // 让所有运行中的 agent 先退场：GC 要重写事件表，运行中的写路径必须停下来。
  private async stopRunningAgents(): Promise<number> {
    const agents = this.agents as unknown as { list(): GcAgentLike[] } | undefined;
    const running = agents?.list() ?? [];
    for (const agent of running) agent.cancel?.({ kind: "user" }, { keepInbox: true });
    await Promise.all(running.map((agent) => agent.whenIdle()));
    return running.length;
  }

  private async stopAgentLoop(sessionId: SessionId): Promise<void> {
    const agents = this.agents as unknown as
      | { get(id: SessionId): GcAgentLike | undefined }
      | undefined;
    const agent = agents?.get(sessionId);
    if (agent === undefined) return;
    agent.cancel?.({ kind: "user" }, { keepInbox: true });
    await agent.whenIdle();
  }
}
