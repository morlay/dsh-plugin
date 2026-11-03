import { StorageError } from "@deepseek-ai/dsh-storage";
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from "@deepseek-ai/dsh-storage";
import type { StorageRepository } from "./types.ts";

export const RDB_STORAGE_BACKEND = "rdb";

// 本后端服务**所有** storage 域：`(域, 表, 键)` 一行落 `t_storage_records`，global 单例用空表名与空键。
// 上游 `KvUnit` 的契约只有「按表名读写记录 + 一个 global」这几种操作，行存储直接承载它，所以再加一个域
// （不论它自带几张表、还是只有 global）都不需要新表或新映射——域名就是行的一部分。

// 本后端对 unit 的内部约定：关闭时把域名让回后端（上游 `KvUnit` 没有这个入口，它归"谁能再开一次"这件事）。
interface ReleasableKvUnit extends KvUnit {
  onClose(release: () => void): void;
}

export class RdbStorageBackend implements StorageBackend {
  readonly kv: KvFacet = { open: (descriptor) => this.openUnit(descriptor) };

  private readonly open = new Map<string, ReleasableKvUnit>();
  // 正在打开的名字：`open()` 要先等介质，占位必须在 await 之前，否则并发 open 会双双通过检查。
  private readonly opening = new Set<string>();
  private closed = false;

  constructor(private readonly repository: () => Promise<StorageRepository>) {}

  private async openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closed) throw new StorageError("closed", "rdb storage backend is closed");
    if (this.open.has(descriptor.name) || this.opening.has(descriptor.name)) {
      throw new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`);
    }
    this.opening.add(descriptor.name);

    const repository = await this.repository();
    const unit = new RdbKvUnit(repository, descriptor);
    this.open.set(descriptor.name, unit);
    this.opening.delete(descriptor.name);
    try {
      const stored = await repository.readUnitVersion(descriptor.name);
      const accepted =
        stored === descriptor.version ||
        (descriptor.compatibleVersions ?? []).includes(stored ?? -1);
      if (stored === undefined) {
        await repository.insertUnitVersion(descriptor.name, descriptor.version);
      } else if (!accepted) {
        throw new StorageError(
          "version-mismatch",
          `kv unit '${descriptor.name}' is stamped version ${stored} on the medium, ` +
            `incompatible with descriptor version ${descriptor.version}`,
        );
      }
    } catch (error) {
      this.open.delete(descriptor.name);
      this.opening.delete(descriptor.name);
      throw error;
    }
    unit.onClose(() => {
      this.open.delete(descriptor.name);
    });
    return unit;
  }

  async close(): Promise<void> {
    this.closed = true;
    const units = [...this.open.values()];
    this.open.clear();
    await Promise.all(units.map((unit) => unit.close()));
  }
}

// 一个 unit 的公共形态：关闭后拒写、关闭前把已接受的写排干、关闭回调把名字让回给后端。
abstract class TrackedKvUnit {
  private closed = false;

  private readonly inflight = new Set<Promise<void>>();

  private onClosed: (() => void) | undefined;

  constructor(
    protected readonly repository: StorageRepository,
    protected readonly descriptor: KvUnitDescriptor,
  ) {}

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
    if (!this.descriptor.tables.includes(table)) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`);
    }
  }
}

// 行存储：记录按 `(域, 表, 键)` 一行，global 单例是空表名的那一行。`single` 与 `per-record` 两种布局
// 在这里同构（一行一条记录），所以布局不再拒绝——版本仍按域戳。
class RdbKvUnit extends TrackedKvUnit {
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen();
    const tables: Record<string, Record<string, unknown>> = Object.create(null) as Record<
      string,
      Record<string, unknown>
    >;
    for (const record of await this.repository.listDomainRecords(this.descriptor.name)) {
      (tables[record.table] ??= {})[record.key] = record.value;
    }
    // 声明了但从未写过的表也要出现在快照里（域层按 spec.tables 逐表读）。
    for (const table of this.descriptor.tables) tables[table] ??= {};
    return {
      tables,
      global: this.descriptor.hasGlobal
        ? await this.repository.readDomainGlobal(this.descriptor.name)
        : null,
    };
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen();
    this.assertTable(table);
    await this.track(this.repository.putDomainRecord(this.descriptor.name, table, key, value));
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen();
    this.assertTable(table);
    await this.track(this.repository.deleteDomainRecord(this.descriptor.name, table, key));
  }

  async deleteRecords(table: string, keys: readonly string[]): Promise<void> {
    this.assertOpen();
    this.assertTable(table);
    await this.track(this.repository.deleteDomainRecords(this.descriptor.name, table, keys));
  }

  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen();
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' declares no global slot`);
    }
    await this.track(this.repository.writeDomainGlobal(this.descriptor.name, value));
  }
}
