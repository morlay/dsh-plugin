// 门面：会话落盘的管理面入口（查询以外的导入导出、运维、分支端口）与数据面核心的组装。
//
// 上游契约的口径是 handle 模型（create / open / flush / stat / list）；分支与管理面要的是行级读写，
// 所以同一个实例再实现一份 SessionRdbStore 的能力面（asRdbStore 探测）。数据面在 data/store/persistence-core.ts。
//
// 可选能力一律用**契约令牌** `inject.optional` 取（归档面 / 分支面），不按字符串名字取：
// 名字是一层可以被拼错的间接引用，令牌有类型面、也参与装配排序（zephyr 的 `optional` 语义：
// 「可能没有提供者」，不是「可以不按依赖序」）。代价是**提供者必须排在会话行之前**——手动
// `ctx.plugin(...)` 晚挂载的宿主拿不到它，各调用点都有退化路径（见 archivedSessionIds 与 copyToWorkspace）。
//
// **工作区注册表是这条规矩的例外**：它那一行（`Workspace`）反过来注入本行，静态 `inject.optional`
// 会成环并把 workspace 行排到本行之前（理由与后果见 `workspace-registry.read.ts`），所以它按名**在调用时读**。
//
// **装配期错误的约定**（本文件与 query.ts 一致）：清单里缺本包依赖的服务是装配错误，抛裸 `Error` 并以
// `session-rdb: ` 开头（它不是域失败，不该占一个 wire 域码）；只有运行期失败才带 `SessionStoreError` 的域码。
import { SessionId, SessionLogOffset } from "@morlay/dsh-session/contract";
import type { SessionPersistenceCreateOptions } from "@morlay/dsh-session-persistence/contract";
import {
  inject,
  Injectable,
  tokenMetaOf,
  type Context,
  type OnInit,
  type OnDispose,
} from "@morlay/zephyr";
import { WorkspaceId } from "@morlay/dsh-workspace";
import { readWorkspaceRegistry } from "./workspace-registry.read.ts";
import { SessionAgentControl } from "../contract/session-agent-control.contract.ts";
import { SessionArchiveRegistry } from "../contract/session-archive-registry.contract.ts";
import type {
  SessionBulkDeleteItem,
  SessionBulkDeleteResult,
  SessionCopyWorkspaceResult,
  SessionEventLocatorQuery,
  SessionExportBatchResult,
  SessionExportItem,
  SessionImportBatchResult,
  SessionRdbStore,
  SessionRowsPage,
  SessionRowsQuery,
  SessionUsageAggregate,
} from "../contract/session-rdb-store.contract.ts";
import type {
  SessionLocateValue,
  SessionRepairAction,
  SessionRepairValue,
} from "../endpoint/session-admin-endpoint.ts";
import type { BranchPort } from "../data/store/branch/port.ts";
import { SessionBranch } from "../contract/session-branch.contract.ts";
import { replaceLiveSessionLog } from "../data/store/branch/index.ts";
import { RdbPersistenceCore } from "../data/store/persistence-core.ts";
import { checkConsistency, type ConsistencyReport } from "./consistency.ts";
import { locateSessionEvents } from "./locate.ts";
import { createRepair } from "./repair.ts";
import { createMaintenance } from "./maintenance.ts";
import { createBranchPort } from "./branch-port.ts";
import { createImporter } from "./import-export/index.ts";
import { DEFAULT_CONFIG, type RdbConfig } from "../data/store/persistence-core.ts";
import { SessionStoreError, failureCodeOf } from "../data/errors.ts";
import { listSessionRows } from "./stats/index.ts";

export type { RdbConfig };

@Injectable()
export class SessionPersistenceRdb
  extends RdbPersistenceCore
  implements SessionRdbStore, OnInit, OnDispose
{
  static readonly Config = (input: RdbConfig = DEFAULT_CONFIG): RdbConfig => input;

  private readonly agents = inject.optional(SessionAgentControl);

  // 归档面：装配里没有它时，列表退回持久化里的归档标记，删除不做「先取消归档」。
  private readonly archiveState = inject.optional(SessionArchiveRegistry);

  // 本行的 ctx：分支行要**在调用时**读（见 branchOf）。
  private ctx: Context | undefined;

  // 管理面端口：门面把这些入口交给运维动作 / 分支端口 / 导入（它们不认识本类）。
  private readonly ops = createMaintenance({
    ready: () => this.opened,
    backend: () => this.backendOf(),
    tracker: this.tracker,
    sessions: () => this.sessions,
    reuseEventIds: this.reuseEventIds,
    forgetLive: (id) => this.liveRouting?.forget(id),
    drainLiveWrites: () => this.drainLiveWrites(),
    archiveState: () => this.archiveState,
    stopAgent: (id) => this.stopAgent(id),
    logger: () => this.logger,
  });

  private readonly branch = createBranchPort({
    ready: () => this.opened,
    backend: () => this.backendOf(),
    writeGuard: this.writeGuard,
    readLog: (id, options, signal) => this.readLog(id, options ?? {}, signal),
    create: (meta, options) => this.create(meta, options as SessionPersistenceCreateOptions),
    readStoredRevision: (id) => this.readPath().readStoredRevision(id),
    registerReuse: (childId, map) => this.registerReuseEventIds(childId, map),
    dropReuse: (childId) => this.dropReuseEventIds(childId),
    resetWriterAfterRewind: (id, cursor, inheritedEventCount) => {
      this.tracker.writerOf(id)?.resetAfterRewind(cursor, inheritedEventCount);
    },
    resetLiveDerivedState: (session) => this.resetLiveDerivedState(session),
  });

  private readonly repair = createRepair({
    ready: () => this.opened,
    backend: () => this.backendOf(),
    replaceLog: (id, meta, inheritedEventCount, events) =>
      this.writePath().replaceSessionLog(
        SessionId(id),
        meta,
        SessionLogOffset(inheritedEventCount),
        [...events],
      ),
    isLive: (id) =>
      this.tracker.hasOpenHandle(SessionId(id)) || this.tracker.hasPending(SessionId(id)),
    deleteSession: (id) => this.ops.deleteSessionWithRepair(id),
  });

  private readonly importer = createImporter({
    ready: () => this.opened,
    create: (header, inherited) =>
      this.create(header, { inheritedEventCount: SessionLogOffset(inherited) }),
    hasOpenHandle: (id) => this.tracker.hasOpenHandle(id),
    replace: (id, header, inheritedEventCount, events) =>
      this.writePath().replaceSessionLog(id, header, SessionLogOffset(inheritedEventCount), [
        ...events,
      ]),
    liveSession: (id) => this.sessions.get(id),
    replaceLiveLog: (live, events) => replaceLiveSessionLog(live, events),
    resetLiveDerivedState: (session) => this.resetLiveDerivedState(session),
    stopLoop: (id) => this.stopAgent(id),
  });

  async onInit(ctx: Context): Promise<void> {
    this.ctx = ctx;
    this.config = this.rowConfig;
    this.startPaths();
    this.installLiveRouting();
  }

  async onDispose(): Promise<void> {
    await this.liveRouting?.shutdown();
  }

  async listRows(query: SessionRowsQuery = {}): Promise<SessionRowsPage> {
    await this.opened;
    const backend = this.backendOf();
    return await listSessionRows(backend.database, backend.storage, query);
  }

  // —— 运维动作转发（实现见 ./maintenance.ts）——

  deleteSession(id: string, signal?: AbortSignal): Promise<void> {
    return this.ops.deleteSession(id, signal);
  }

  deleteSessionWithRepair(id: string, signal?: AbortSignal) {
    return this.ops.deleteSessionWithRepair(id, signal);
  }

  // 事件定位：条件进 SQL，只回命中片段与窗口；坏会话照样能定位（它不解析整段日志）。
  async locateEvents(
    sessionId: string,
    query: SessionEventLocatorQuery = {},
  ): Promise<SessionLocateValue> {
    await this.opened;
    const backend = this.backendOf();
    return await locateSessionEvents(
      backend.database,
      sessionId,
      await backend.reads.getSession(sessionId),
      query,
    );
  }

  repairSession(sessionId: string, action: SessionRepairAction): Promise<SessionRepairValue> {
    return this.repair.repairSession(sessionId, action);
  }

  // 批量删除：逐条复用单条的守卫（已归档、非运行中），整批不回滚；每条的重算在该条的删除里完成。
  async bulkDelete(ids: readonly string[]): Promise<SessionBulkDeleteResult> {
    await this.opened;
    const items: SessionBulkDeleteItem[] = [];
    for (const id of ids) {
      try {
        await this.ops.deleteSessionWithRepair(id);
        items.push({ sessionId: id, ok: true });
      } catch (error) {
        items.push({ sessionId: id, ok: false, code: failureCodeOf(error) });
      }
    }
    return { items };
  }

  organize() {
    return this.ops.organize();
  }

  collectOrphanSessions(): Promise<number> {
    return this.ops.collectOrphanSessions();
  }

  vacuum(): Promise<void> {
    return this.ops.vacuum();
  }

  archivedSessionIds(): Promise<ReadonlySet<string>> {
    return this.ops.archivedSessionIds();
  }

  // 导入 / 覆盖导入（实现见 ./import-export/）。
  importZip(zip: Uint8Array, targetId?: string): Promise<string> {
    return this.importer.importZip(zip, targetId);
  }

  // 批量导入：逐条结算，坏包不影响其它包。
  importMany(zips: readonly Uint8Array[]): Promise<SessionImportBatchResult> {
    return this.importer.importMany(zips);
  }

  /**
   * 跨工作区复制：本包只做 fork（子会话的 cwd 换成目标工作区的路径），成员归属交给 workspace 域的 attach。
   *
   * 不新增移动动作：源会话原样保留。attach 失败时撤掉刚派生的子会话——复制要么落在目标工作区，
   * 要么库里不多一条谁也找不到的会话。
   * @param sessionId - 源会话。
   * @param workspaceId - 目标工作区（注册表里的 id）。
   * @returns 子会话与目标工作区。
   */
  async copyToWorkspace(
    sessionId: string,
    workspaceId: string,
  ): Promise<SessionCopyWorkspaceResult> {
    await this.opened;
    const registry = readWorkspaceRegistry(this.ctx);
    if (registry === undefined) {
      throw new Error(
        "session-rdb: 装配里没有 WorkspaceRegistry，跨工作区复制要用它的 attach（工作区记录不归本包）",
      );
    }
    const workspace = registry.get(WorkspaceId(workspaceId));
    if (workspace === undefined) {
      throw new SessionStoreError(
        "SESSION_COPY_WORKSPACE_NOT_FOUND",
        `workspace "${workspaceId}" not found`,
      );
    }
    const branch = this.branchOf();
    if (branch === undefined) {
      throw new Error("session-rdb: 装配里没有 SessionBranch，跨工作区复制要它的 fork");
    }
    const child = await branch.forkFrom(SessionId(sessionId), { meta: { cwd: workspace.path } });
    try {
      await workspace.attachSession(child);
    } catch (error: unknown) {
      // 补偿删除自己也可能失败：两个失败都要进原因链，否则用户看到的是「撤不干净」而不是
      // 「复制没成」（见 copyAttachFailedError）。
      let compensation: unknown;
      try {
        await this.dropDerivedSession(child);
      } catch (reason: unknown) {
        compensation = reason;
      }
      throw copyAttachFailedError(workspaceId, error, compensation);
    }
    return { sessionId: String(child), workspaceId };
  }

  // 批量导出：逐条复用单条导出（同一份上游 format），一条失败不影响其它条。
  async exportMany(ids: readonly string[]): Promise<SessionExportBatchResult> {
    await this.opened;
    const items: SessionExportItem[] = [];
    for (const id of ids) {
      try {
        const raw = await this.readRaw(id);
        if (raw === undefined) {
          items.push({ sessionId: id, ok: false, code: "SESSION_NOT_FOUND" });
          continue;
        }
        items.push({ sessionId: id, ok: true, filename: raw.filename, content: raw.content });
      } catch (error: unknown) {
        const code = failureCodeOf(error);
        items.push({ sessionId: id, ok: false, ...(code === undefined ? {} : { code }) });
      }
    }
    return { items };
  }

  branchPort(): BranchPort {
    return this.branch;
  }

  async checkConsistency(): Promise<ConsistencyReport> {
    await this.opened;
    return await checkConsistency(this.backendOf().database);
  }

  async usageReport(sinceMs?: number): Promise<SessionUsageAggregate> {
    await this.opened;
    return (await this.backendOf().usageReport(sinceMs)) as unknown as SessionUsageAggregate;
  }

  registerReuseEventIds(childId: SessionId, map: ReadonlyMap<number, string>): void {
    this.reuseEventIds.set(childId, new Map(map));
  }

  dropReuseEventIds(childId: SessionId): void {
    this.reuseEventIds.delete(childId);
  }

  // 覆盖导入等整段替换内存 log 的路径复用 rewind 的失效钩子；钩子的实现在分支行（它读投影与 token-meter）。
  resetLiveDerivedState(session: unknown): void {
    derivedStateResetter(this.branchOf())?.(session);
  }

  // 分支行与本行是**互相依赖**的一对：本行把行级端口交给分支行（`admin/branch-port.ts`），分支行把
  // 派生状态失效钩子交回本行。互相依赖的服务不能按装配序注入（谁先装配谁拿不到对方），所以这一条
  // 只能**在调用时按令牌名读**；名字从令牌元数据取，不在调用点手抄字符串。
  private branchOf(): SessionBranch | undefined {
    // `ctx.get` 是 `reflect.get` 的封装：语义相同，但返回 `unknown`（不是 `any`），逼着这里保留那次收窄。
    const found = this.ctx?.get(tokenMetaOf(SessionBranch).name, false);
    return typeof found === "object" && found === null
      ? undefined
      : (found as SessionBranch | undefined);
  }

  // 补偿删除：fork 已经落库但 attach 失败时用（不是「已归档才能删」的用户删除，那条守卫不适用）。
  private async dropDerivedSession(id: SessionId): Promise<void> {
    // fork 给子会话登记过「复用父会话的事件行」：删掉它时一并清掉，免得同 id 之后再落写去复用。
    this.reuseEventIds.delete(id);
    const referenced = await this.backendOf().transaction((tx) => tx.deleteSession(id));
    await this.ops.repairDeletedSession(id, referenced);
  }

  private async stopAgent(id: SessionId): Promise<void> {
    const agent = this.agents?.get(id);
    if (agent === undefined) return;
    agent.cancel?.({ kind: "user" }, { keepInbox: true });
    await agent.whenIdle();
  }
}

// 一条失败的可读描述：Error 取 message，其余值显式 JSON 化（避免落到 `[object Object]`）。
function describeFailure(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? String(error);
}

/**
 * 一次「attach 被拒」的失败：域码是稳定面，**两个失败都留在原因链里**。
 *
 * 为什么不是简单地把 attach 的错误挂成 cause：补偿删除（撤掉刚 fork 出来的子会话）自己也可能失败，
 * 那时抛出去的原因只剩「撤不干净」，而用户真正要看的是「复制没成」。用 `AggregateError` 把两条都带上，
 * 排障时沿 cause 能看到 attach 为什么被拒、以及库里还留着哪条子会话。
 * @param workspaceId - 目标工作区。
 * @param attachError - workspace 域拒绝 attach 的原因。
 * @param compensationError - 补偿删除失败的原因（没有失败时省略）。
 * @returns 带域码的失败。
 */
export function copyAttachFailedError(
  workspaceId: string,
  attachError: unknown,
  compensationError?: unknown,
): SessionStoreError {
  const detail = describeFailure(attachError);
  if (compensationError === undefined) {
    return new SessionStoreError(
      "SESSION_COPY_ATTACH_FAILED",
      `workspace "${workspaceId}" refused the copied session: ${detail}`,
      { cause: attachError },
    );
  }
  const undo = describeFailure(compensationError);
  return new SessionStoreError(
    "SESSION_COPY_ATTACH_FAILED",
    `workspace "${workspaceId}" refused the copied session: ${detail} (the derived session could not be dropped either: ${undo})`,
    {
      cause: new AggregateError(
        [attachError, compensationError],
        `workspace "${workspaceId}" refused the copied session, and the compensation delete failed too`,
      ),
    },
  );
}

// 分支行上的派生状态失效钩子（契约只声明分支原语，这个钩子是数据面内部的协作口）。
// 判据是"有没有这个方法"，不是"是不是某个类"：可选能力缺席时这里就是 undefined。
function derivedStateResetter(branch: unknown): ((session: unknown) => void) | undefined {
  if (typeof branch !== "object" || branch === null) return undefined;
  const candidate = (branch as { resetLiveDerivedState?: unknown }).resetLiveDerivedState;
  if (typeof candidate !== "function") return undefined;
  return (session) => {
    candidate.call(branch, session);
  };
}
