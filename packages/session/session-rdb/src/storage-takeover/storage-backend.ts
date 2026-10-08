import { StorageError } from "@deepseek-ai/dsh-storage";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { ScheduleTask } from "@deepseek-ai/dsh-schedule";
import type { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from "@deepseek-ai/dsh-storage";
import type { StorageRepository, WorkspaceRecord, WorkspaceDomainState } from "./types.ts";

export const RDB_STORAGE_BACKEND = "rdb";

// 本后端服务哪些域：一个域一个显式映射（表结构显式维护，未知域名 fail loud——见
// `.agents/adrs/20260917-接管storages到rdb语义表.md`）。官方那几行谁读哪个域是上游的事，
// 这里只回答"这个域的数据落在哪张表"。
const WORKSPACE_UNIT = "workspace";
const WORKSPACE_TABLE = "workspaces";
const SCHEDULE_UNIT = "schedule";
const SCHEDULE_TABLE = "tasks";

// 本后端对 unit 的内部约定：关闭时把域名让回后端（上游 `KvUnit` 没有这个入口，它归"谁能再开一次"这件事）。
interface ReleasableKvUnit extends KvUnit {
  onClose(release: () => void): void;
}

export class RdbStorageBackend implements StorageBackend {
  readonly kv: KvFacet = { open: (descriptor) => this.openUnit(descriptor) };

  private readonly open = new Map<string, ReleasableKvUnit>();
  private closed = false;

  constructor(private readonly repository: StorageRepository) {}

  private async openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closed) throw new StorageError("closed", "rdb storage backend is closed");
    if (descriptor.layout !== undefined && descriptor.layout !== "single") {
      throw new Error(
        `rdb storage backend serves only the 'single' layout (domain '${descriptor.name}' ` +
          `declares '${descriptor.layout}')`,
      );
    }
    if (this.open.has(descriptor.name)) {
      throw new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`);
    }

    const unit = this.unitFor(descriptor);
    this.open.set(descriptor.name, unit);
    try {
      const stored = await this.repository.readUnitVersion(descriptor.name);
      if (stored === undefined) {
        await this.repository.insertUnitVersion(descriptor.name, descriptor.version);
      } else if (stored !== descriptor.version) {
        throw new StorageError(
          "version-mismatch",
          `kv unit '${descriptor.name}' is stamped version ${stored} on the medium, ` +
            `incompatible with descriptor version ${descriptor.version}`,
        );
      }
    } catch (error) {
      this.open.delete(descriptor.name);
      throw error;
    }
    unit.onClose(() => {
      this.open.delete(descriptor.name);
    });
    return unit;
  }

  private unitFor(descriptor: KvUnitDescriptor): ReleasableKvUnit {
    if (descriptor.name === WORKSPACE_UNIT) {
      if (!descriptor.tables.includes(WORKSPACE_TABLE) || descriptor.hasGlobal !== true) {
        throw new Error(
          `rdb storage backend expects the '${WORKSPACE_UNIT}' domain shape ` +
            `(table '${WORKSPACE_TABLE}' plus a global slot)`,
        );
      }
      return new WorkspaceKvUnit(this.repository, descriptor);
    }
    if (descriptor.name === SCHEDULE_UNIT) {
      if (!descriptor.tables.includes(SCHEDULE_TABLE) || descriptor.hasGlobal !== false) {
        throw new Error(
          `rdb storage backend expects the '${SCHEDULE_UNIT}' domain shape ` +
            `(table '${SCHEDULE_TABLE}' without a global slot)`,
        );
      }
      return new ScheduleKvUnit(this.repository, descriptor);
    }
    throw new Error(
      `rdb storage backend serves only the '${WORKSPACE_UNIT}' and '${SCHEDULE_UNIT}' domains ` +
        `(requested '${descriptor.name}')`,
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    const units = [...this.open.values()];
    this.open.clear();
    await Promise.all(units.map((unit) => unit.close()));
  }
}

// 一个 KV unit 的公共形态：关闭后拒写、关闭前把已接受的写排干、关闭回调把名字让回给后端。
// 域自己的读写在子类里（`unitFor` 的返回类型就地校验它们合得上 `KvUnit`）。
abstract class TrackedKvUnit {
  private closed = false;

  private readonly inflight = new Set<Promise<void>>();

  private onClosed: (() => void) | undefined;

  constructor(
    protected readonly repository: StorageRepository,
    protected readonly descriptor: KvUnitDescriptor,
  ) {}

  // 这个 unit 认的表名（由各自的域决定）。
  protected abstract readonly tables: readonly string[];

  onClose(release: () => void): void {
    this.onClosed = release;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    while (this.inflight.size > 0) {
      await Promise.allSettled(this.inflight);
    }
    this.onClosed?.();
  }

  protected async track(operation: Promise<unknown>): Promise<void> {
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    this.inflight.add(settled);
    try {
      await operation;
    } finally {
      this.inflight.delete(settled);
    }
  }

  protected assertOpen(): void {
    if (this.closed) {
      throw new StorageError("closed", `kv unit '${this.descriptor.name}' is closed`);
    }
  }

  protected assertTable(table: string): void {
    if (!this.tables.includes(table)) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`);
    }
  }
}

class WorkspaceKvUnit extends TrackedKvUnit {
  protected readonly tables = [WORKSPACE_TABLE];

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen();
    const records: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const { id, record } of await this.repository.listWorkspaces()) {
      records[id] = record;
    }
    const state = await this.repository.readWorkspaceState();
    return { tables: { [WORKSPACE_TABLE]: records }, global: state };
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen();
    this.assertTable(table);
    await this.track(this.repository.putWorkspace(key, workspaceRecordOf(value)));
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen();
    this.assertTable(table);
    await this.track(this.repository.deleteWorkspace(key));
  }

  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen();
    await this.track(this.repository.writeWorkspaceState(workspaceStateOf(value)));
  }
}

class ScheduleKvUnit extends TrackedKvUnit {
  protected readonly tables = [SCHEDULE_TABLE];

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen();
    const records: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const { id, task } of await this.repository.listScheduleTasks()) {
      records[id] = task;
    }
    // 这个域没有 global 槽（`scheduleDomain` 不声明）：`null` = "从未写过"，域层不会读它。
    return { tables: { [SCHEDULE_TABLE]: records }, global: null };
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen();
    this.assertTable(table);
    await this.track(this.repository.putScheduleTask(key, scheduleTaskOf(value)));
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen();
    this.assertTable(table);
    await this.track(this.repository.deleteScheduleTask(key));
  }

  setGlobal(_value: unknown): Promise<void> {
    throw new Error(`unit '${this.descriptor.name}' declares no global slot`);
  }
}

function workspaceRecordOf(value: unknown): WorkspaceRecord {
  const record = value as Partial<WorkspaceRecord> | null;
  if (
    typeof record !== "object" ||
    record === null ||
    typeof record.path !== "string" ||
    typeof record.title !== "string" ||
    !Array.isArray(record.sessionIds) ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    throw new TypeError("workspace record does not match the stored shape");
  }
  return {
    path: record.path,
    title: record.title,
    sessionIds: record.sessionIds.map((id) => id as SessionId),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function workspaceStateOf(value: unknown): WorkspaceDomainState {
  const state = value as Partial<WorkspaceDomainState> | null;
  if (
    typeof state !== "object" ||
    state === null ||
    typeof state.initialized !== "boolean" ||
    !Array.isArray(state.workspaceIds) ||
    !Array.isArray(state.archivedSessionIds) ||
    !Array.isArray(state.pinnedSessionIds)
  ) {
    throw new TypeError("workspace registry state does not match the stored shape");
  }
  return {
    initialized: state.initialized,
    workspaceIds: state.workspaceIds.map((id) => id as WorkspaceId),
    archivedSessionIds: state.archivedSessionIds.map((id) => id as SessionId),
    pinnedSessionIds: state.pinnedSessionIds.map((id) => id as SessionId),
    ...(state.pendingMutation === undefined ? {} : { pendingMutation: state.pendingMutation }),
  };
}

function scheduleTaskOf(value: unknown): ScheduleTask {
  const task = value as Partial<ScheduleTask> | null;
  if (
    typeof task !== "object" ||
    task === null ||
    typeof task.sessionId !== "string" ||
    typeof task.record !== "object" ||
    task.record === null
  ) {
    throw new TypeError("schedule task does not match the stored shape");
  }
  return task as ScheduleTask;
}
