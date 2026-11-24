// 门面：会话落盘的管理面入口（查询以外的导入导出、运维、分支端口）与数据面核心的组装。
//
// 上游契约的口径是 handle 模型（create / open / flush / stat / list）；分支与管理面要的是行级读写，
// 所以同一个实例再实现一份 SessionRdbStore 的能力面（asRdbStore 探测）。数据面在 data/store/persistence-core.ts。
//
// 可选能力一律用**契约令牌** `inject.optional` 取（归档面 / 分支面），不按字符串名字取：
// 名字是一层可以被拼错的间接引用，令牌有类型面、也参与装配排序（zephyr 的 `optional` 语义：
// 「可能没有提供者」，不是「可以不按依赖序」）。代价是**提供者必须排在会话行之前**——手动
// `ctx.plugin(...)` 晚挂载的宿主拿不到它，各调用点都有退化路径（见 archivedSessionIds）。
//
// **本行不认识 workspace 域**：跨域动作（把一条会话复制到目标工作区）不在持久化行上——它要同时用
// `SessionBranching`（本域的分支原语）与 `SessionWorkspace`（workspace 域的 attach），那是编排职责，
// 住在 `@morlay/dsh-workspace`（见 `SessionWorkspaceCopy` 端口）。本行只留本域能力：读写日志、
// 建会话、派生原语与它的补偿删除。
//
// **装配期错误的约定**（本文件与 query.ts 一致）：清单里缺本包依赖的服务是装配错误，抛裸 `Error` 并以
// `session-rdb: ` 开头（它不是域失败，不该占一个 wire 域码）；只有运行期失败才带 `SessionStoreError` 的域码。
import { SessionId, SessionLogOffset } from "@morlay/dsh-session/contract";
import type { SessionPersistenceCreateOptions } from "@morlay/dsh-session-persistence/contract";
import { inject, Injectable, type Context, type OnInit, type OnDispose } from "@morlay/zephyr";
import { SessionAgentControl } from "../contract/session-agent-control.contract.ts";
import type {
  SessionBulkDeleteItem,
  SessionBulkDeleteResult,
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
import { failureCodeOf } from "../data/errors.ts";
import { listSessionRows } from "./stats/index.ts";

export type { RdbConfig };

@Injectable()
export class SessionPersistenceRdb
  extends RdbPersistenceCore
  implements SessionRdbStore, OnInit, OnDispose
{
  static readonly Config = (input: RdbConfig = DEFAULT_CONFIG): RdbConfig => input;

  private readonly agents = inject.optional(SessionAgentControl);

  // 分支行与本行**互相依赖**：本行把行级端口交给分支行（`admin/branch-port.ts`），分支行把派生状态
  // 失效钩子交回本行。两条注入边成环，内核跳过回边、两边都在**调用时**才用对方，所以可选注入即可。
  private readonly branchRow = inject.optional(SessionBranch);

  // 管理面端口：门面把这些入口交给运维动作 / 分支端口 / 导入（它们不认识本类）。
  private readonly ops = createMaintenance({
    ready: () => this.opened,
    backend: () => this.backendOf(),
    tracker: this.tracker,
    sessions: () => this.sessions,
    reuseEventIds: this.reuseEventIds,
    forgetLive: (id) => this.liveRouting?.forget(id),
    drainLiveWrites: () => this.drainLiveWrites(),
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

  async onInit(_ctx: Context): Promise<void> {
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
    derivedStateResetter(this.branchRow)?.(session);
  }

  // 补偿删除：fork 已经落库但 attach 失败时用（不是「已归档才能删」的用户删除，那条守卫不适用）。
  async discardDerivedSession(id: string): Promise<void> {
    return await this.dropDerivedSession(SessionId(id));
  }

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
