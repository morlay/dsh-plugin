import type { Catalog, TableDef } from "./defs.ts";
import { defineTable } from "./defs.ts";
import { eq } from "./expr.ts";
import { fragment } from "./fragment.ts";
import type { Database } from "./database/types.ts";
import { ensureSchema, SCHEMA_MIGRATIONS_TABLE } from "./migrate.ts";

// 内置迁移账本：一条已执行的数据迁移一行（`f_id` 唯一）。
export const schemaMigrations = defineTable({
  name: SCHEMA_MIGRATIONS_TABLE,
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

// PostgreSQL 的迁移互斥键（字符串常量走 `hashtext`，跨实例认同一个键）。
const MIGRATION_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('zephyr_rdb_migrations'))";

// 在迁移锁内跑一段：PostgreSQL 拿事务级 advisory lock（同一时刻只有一方在跑），
// SQLite 的 `BEGIN IMMEDIATE` 自己就是写锁。锁与事务同生共死，不会漏放。
async function withMigrationLock<T>(
  database: Database,
  body: (scoped: Database) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    if (tx.dialect.supports("advisory-lock")) await tx.run(fragment(MIGRATION_LOCK_SQL));
    return body(tx);
  });
}

// 先按 catalog 对齐结构（建表 / 补列 / 补索引），再执行未应用的数据迁移。
//
// 每条迁移在自己的事务里执行并记账（失败即回滚、不记账、重跑只跑没记过的）；账本在锁内**重新读**，
// 所以两个实例同时启动时只有一方执行。返回本次实际执行了哪些 `id`。
export async function runMigrations(
  database: Database,
  options: RunMigrationsOptions,
): Promise<readonly string[]> {
  const migrations =
    options.migrations instanceof MigrationRegistry
      ? options.migrations.list()
      : [...options.migrations];
  const catalog: Catalog = [...(options.catalog ?? []), schemaMigrations as TableDef];

  // 结构对齐也在锁内：两个实例同时补列 / 建索引会撞「duplicate column」。
  await withMigrationLock(database, (tx) => ensureSchema(tx, catalog));

  const executed: string[] = [];
  for (const migration of migrations) {
    const appliedNow = await withMigrationLock(database, async (tx) => {
      const ledger = tx.table(schemaMigrations);
      // 锁内重新读账本：另一个实例可能刚跑过这条。
      for await (const row of ledger
        .select({ id: ledger.f_id })
        .where(eq(ledger.f_id, migration.id))) {
        void row;
        return false;
      }
      const result = await migration.up(tx);
      if (result === false) return false;
      await ledger.insert({ f_id: migration.id, f_applied_at: Date.now() });
      return true;
    });
    if (appliedNow) executed.push(migration.id);
  }
  return executed;
}
