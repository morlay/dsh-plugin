import type { Catalog, TableDef } from "./defs.ts";
import { defineTable } from "./defs.ts";
import type { Database } from "./database/types.ts";
import { ensureSchema } from "./migrate.ts";

// 内置迁移账本：一条已执行的数据迁移一行（`f_id` 唯一）。
export const schemaMigrations = defineTable({
  name: "t_schema_migrations",
  columns: {
    f_id: { type: "text", primaryKey: true, notNull: true },
    f_applied_at: { type: "bigint", notNull: true },
  },
});

// 一条数据迁移：`id` 唯一且按字典序执行；`up` 在事务里跑，抛错则整条不记。
export interface Migration {
  readonly id: string;
  // 返回 `false` 表示这次无需执行（例如旧表还不存在），**不记账**——下次打开还会再试。
  // 返回其它值（含 `undefined`）表示已执行，记账。
  readonly up: (database: Database) => Promise<boolean | void>;
}

// 迁移注册表：业务把自己的迁移登记进来，打开库时一起执行。
export class MigrationRegistry {
  readonly #migrations = new Map<string, Migration>();

  register(migration: Migration): this {
    if (this.#migrations.has(migration.id)) {
      throw new Error(`zephyr-rdb: migration '${migration.id}' is registered twice`);
    }
    this.#migrations.set(migration.id, migration);
    return this;
  }

  list(): readonly Migration[] {
    return [...this.#migrations.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}

// 打开库时做的事：结构（catalog diff）+ 数据迁移（注册表）。
export interface RunMigrationsOptions {
  // 业务表定义（`ensureSchema` 用）。
  catalog?: Catalog;
  migrations: readonly Migration[] | MigrationRegistry;
}

// 先按 catalog 对齐结构（建表 / 补列 / 补索引），再执行未应用的数据迁移。
//
// 账本是本包内置的 `t_schema_migrations`：每条迁移在**同一个事务**里执行并记账，
// 失败即回滚，重跑时只跑没记过的。返回本次实际执行了哪些 `id`。
export async function runMigrations(
  database: Database,
  options: RunMigrationsOptions,
): Promise<readonly string[]> {
  const migrations =
    options.migrations instanceof MigrationRegistry
      ? options.migrations.list()
      : [...options.migrations];
  const catalog: Catalog = [...(options.catalog ?? []), schemaMigrations as TableDef];
  await ensureSchema(database, catalog);

  const ledger = database.table(schemaMigrations);
  const applied = new Set<string>();
  for await (const row of ledger.select({ id: ledger.f_id })) applied.add(row.id);

  const executed: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const appliedNow = await database.transaction(async (tx) => {
      const result = await migration.up(tx);
      if (result === false) return false;
      await tx.table(schemaMigrations).insert({ f_id: migration.id, f_applied_at: Date.now() });
      return true;
    });
    if (appliedNow) executed.push(migration.id);
  }
  return executed;
}
