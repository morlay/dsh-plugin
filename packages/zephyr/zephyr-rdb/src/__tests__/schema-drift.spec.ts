import { describe, expect, it } from "vitest";
import { createPostgresTestDatabase } from "@morlay/zephyr-rdb/testing";
import {
  createDialect,
  defineCatalog,
  defineTable,
  ensureSchema,
  fragment,
  openDatabase,
  planSchema,
  type Database,
  type TableShape,
} from "@morlay/zephyr-rdb";

const items = defineTable({
  name: "t_items",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_owner: { type: "text", notNull: true },
    f_count: { type: "integer", notNull: true, default: 0 },
  },
  indexes: { idx_items_owner: { columns: ["f_owner"] } },
});

const links = defineTable({
  name: "t_links",
  columns: {
    f_owner: { type: "text", notNull: true },
    f_key: { type: "text", notNull: true },
  },
  primaryKey: ["f_owner", "f_key"],
});

const linksUnique = defineTable({
  ...links,
  // 与复合主键不同的列：主键已经保证 (f_owner, f_key) 唯一，再声明它不算「约束缺失」。
  uniques: { uq_links_owner: { columns: ["f_owner"] } },
});

async function indexColumns(database: Database, index: string): Promise<string[]> {
  const rows = await database.read<{ name: string }>(fragment(`PRAGMA index_info("${index}")`));
  return rows.map((row) => row.name);
}

describe("结构漂移", () => {
  it("同名索引的列变了：报告可自动修的漂移并重建索引", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items]);
      // 库里的索引被改成别的列（同名不同形）。
      await database.run(fragment('DROP INDEX "idx_items_owner"'));
      await database.run(fragment('CREATE INDEX "idx_items_owner" ON "t_items" ("f_count")'));

      const result = await ensureSchema(database, [items]);
      expect(result.drift).toHaveLength(1);
      expect(result.drift[0]).toMatchObject({
        table: "t_items",
        kind: "index-columns",
        fix: "auto",
      });
      expect(result.drift[0]?.detail).toContain("database has (f_count)");
      expect(result.statements).toEqual([
        'DROP INDEX IF EXISTS "idx_items_owner"',
        'CREATE INDEX IF NOT EXISTS "idx_items_owner" ON "t_items" ("f_owner")',
      ]);
      expect(await indexColumns(database, "idx_items_owner")).toEqual(["f_owner"]);

      // 修完之后漂移消失（再跑一次是空的）。
      expect(await ensureSchema(database, [items])).toEqual({ statements: [], drift: [] });
    } finally {
      await database.close();
    }
  });

  it("同名索引的唯一性变了：报告并重建为定义的样子", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items]);
      await database.run(fragment('DROP INDEX "idx_items_owner"'));
      await database.run(
        fragment('CREATE UNIQUE INDEX "idx_items_owner" ON "t_items" ("f_owner")'),
      );

      const result = await ensureSchema(database, [items]);
      expect(result.drift.map((entry) => [entry.kind, entry.fix])).toEqual([
        ["index-uniqueness", "auto"],
      ]);
      expect(result.statements).toHaveLength(2);
      const [index] = await database.read<{ unique: number }>(
        fragment('PRAGMA index_list("t_items")'),
      );
      expect(index?.unique).toBe(0);
    } finally {
      await database.close();
    }
  });

  it("列类型 / 可空 / 默认值不同形时只报告，不改表", () => {
    const dialect = createDialect("sqlite");
    const shape: TableShape = {
      columns: new Set(["f_id", "f_owner", "f_count"]),
      indexes: new Set(["idx_items_owner"]),
      columnShapes: new Map([
        ["f_id", { type: "INTEGER", notNull: false, defaultValue: undefined }],
        ["f_owner", { type: "TEXT", notNull: false, defaultValue: undefined }],
        ["f_count", { type: "TEXT", notNull: true, defaultValue: "1" }],
      ]),
      indexShapes: new Map([["idx_items_owner", { columns: ["f_owner"], unique: false }]]),
    };
    const plan = planSchema(dialect, [items], new Map([["t_items", shape]]));

    expect(plan.drift.map((entry) => [entry.kind, entry.fix])).toEqual([
      ["column-nullability", "manual"],
      ["column-type", "manual"],
      ["column-default", "manual"],
    ]);
    // 只报告：改列类型 / 可空 / 默认值要人决定，不发任何语句。
    expect(plan.changes).toEqual([]);
    expect(plan.drift[0]?.detail).toContain("defined NOT NULL, database has NULL");
    expect(plan.drift[1]?.detail).toContain("defined integer, database has text");
    expect(plan.drift[2]?.detail).toContain("defined default 0, database has 1");
  });

  // P1-9：删掉一张表的定义（或不走迁移直接删账本）时，库里多出来的表必须被看见；
  // 只报告、不删——这是「表定义被删」的唯一安全网。
  it("库里有、catalog 没有的表列为 orphan：只报告不删，视图与迁移账本不算", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items]);
      // 库里多出来的表 / 视图 / 别人的迁移账本（账本由 `runMigrations` 自管）。
      await database.run(fragment('CREATE TABLE "t_legacy" ("f_id" TEXT NOT NULL)'));
      await database.run(fragment('CREATE VIEW "v_legacy" AS SELECT "f_id" FROM "t_legacy"'));
      await database.run(fragment('CREATE TABLE "t_schema_migrations" ("f_id" TEXT PRIMARY KEY)'));

      const result = await ensureSchema(database, [items]);
      expect(result.drift.map((entry) => [entry.table, entry.kind, entry.fix])).toEqual([
        ["t_legacy", "orphan", "manual"],
      ]);
      expect(result.drift[0]?.detail).toContain("t_legacy");

      // 只报告：不生成任何 DDL，表还在（SQLite 的自增表 sqlite_sequence 也不能被报）。
      expect(result.statements).toEqual([]);
      expect(await database.objectNames()).toContain("t_legacy");

      // 幂等：再跑一次是同一份报告（孤儿不因为「报过一次」而消失，也不会被删）。
      expect(await ensureSchema(database, [items])).toEqual(result);

      // 破坏性开关也不删孤儿表：删表要人决定，不在结构对齐里做。
      expect(await ensureSchema(database, [items], { allowDestructive: true })).toEqual(result);
      expect(await database.objectNames()).toContain("t_legacy");
    } finally {
      await database.close();
    }
  });

  it("orphan 的差集只认 catalog 之外的表，迁移账本自管不算", () => {
    const dialect = createDialect("sqlite");
    const shape: TableShape = {
      columns: new Set(["f_id", "f_owner", "f_count"]),
      indexes: new Set(["idx_items_owner"]),
    };
    const plan = planSchema(dialect, [items], new Map([["t_items", shape]]), {
      // 库里的表名是无序读出来的（PostgreSQL 的 information_schema 不保证顺序）：报告按表名稳定排序。
      tables: ["t_zzz_legacy", "t_items", "t_schema_migrations", "t_legacy"],
    });
    expect(plan.drift.map((entry) => [entry.table, entry.kind, entry.fix])).toEqual([
      ["t_legacy", "orphan", "manual"],
      ["t_zzz_legacy", "orphan", "manual"],
    ]);
    expect(plan.drift[0]?.detail).toContain("not in catalog");
    // 只报告：不生成任何 DDL（包括删表）。
    expect(plan.changes).toEqual([]);
  });

  it("唯一约束缺失被报告并补唯一索引，补齐后不再报", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [links]);
      const result = await ensureSchema(database, [linksUnique]);
      expect(result.drift.map((entry) => [entry.kind, entry.fix])).toEqual([
        ["missing-unique", "auto"],
      ]);
      expect(result.statements).toEqual([
        'CREATE UNIQUE INDEX IF NOT EXISTS "uq_links_owner" ON "t_links" ("f_owner")',
      ]);
      expect(await indexColumns(database, "uq_links_owner")).toEqual(["f_owner"]);

      // 等价的唯一索引已经存在：不再报缺失，也不再建第二个。
      expect(await ensureSchema(database, [linksUnique])).toEqual({ statements: [], drift: [] });
    } finally {
      await database.close();
    }
  });
});
describe.skipIf(!process.env.TEST_PG_URL)("结构漂移（PostgreSQL）", () => {
  it("索引列与默认值的变化从 information_schema / pg_index 读出来", async () => {
    const testDatabase = await createPostgresTestDatabase();
    const database = await openDatabase({
      dialect: "postgres",
      connectionString: testDatabase.connectionString,
      catalog: defineCatalog([items]),
    });
    try {
      await ensureSchema(database, [items]);
      await database.run(fragment('DROP INDEX "public"."idx_items_owner"'));
      await database.run(
        fragment('CREATE INDEX "idx_items_owner" ON "public"."t_items" ("f_count")'),
      );
      await database.run(
        fragment('ALTER TABLE "public"."t_items" ALTER COLUMN "f_count" SET DEFAULT 5'),
      );

      const result = await ensureSchema(database, [items]);
      expect(result.drift.map((entry) => [entry.kind, entry.fix])).toEqual([
        ["column-default", "manual"],
        ["index-columns", "auto"],
      ]);
      expect(result.statements).toContain('DROP INDEX IF EXISTS "public"."idx_items_owner"');
      expect(result.statements).toContain(
        'CREATE INDEX IF NOT EXISTS "idx_items_owner" ON "public"."t_items" ("f_owner")',
      );

      // 索引修好；默认值只报告（不自动改列）。
      const after = await ensureSchema(database, [items]);
      expect(after.drift.map((entry) => entry.kind)).toEqual(["column-default"]);
      expect(after.statements).toEqual([]);
    } finally {
      await database.close();
      await testDatabase.drop();
    }
  });

  it("库里有、catalog 没有的表列为 orphan：只报告不删，视图不算", async () => {
    const testDatabase = await createPostgresTestDatabase();
    const database = await openDatabase({
      dialect: "postgres",
      connectionString: testDatabase.connectionString,
    });
    try {
      await ensureSchema(database, [items]);
      await database.run(fragment('CREATE TABLE "public"."t_pg_legacy" ("f_id" TEXT NOT NULL)'));
      await database.run(
        fragment('CREATE VIEW "public"."v_pg_legacy" AS SELECT "f_id" FROM "public"."t_pg_legacy"'),
      );

      const result = await ensureSchema(database, [items]);
      expect(result.drift.map((entry) => [entry.table, entry.kind, entry.fix])).toEqual([
        ["t_pg_legacy", "orphan", "manual"],
      ]);
      expect(result.statements).toEqual([]);
      expect(await database.objectNames()).toContain("t_pg_legacy");

      // 幂等：再跑一次是同一份报告，孤儿表还在。
      expect(await ensureSchema(database, [items])).toEqual(result);
    } finally {
      await database.close();
      await testDatabase.drop();
    }
  });
});
