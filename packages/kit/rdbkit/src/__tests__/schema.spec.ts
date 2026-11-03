import { describe, expect, it } from "vitest";
import {
  createDialect,
  createTableSql,
  defineCatalog,
  defineTable,
  ensureSchema,
  fragment,
  openDatabase,
} from "../index.ts";

const catalog = defineCatalog([
  defineTable({
    name: "t_items",
    columns: {
      f_id: { type: "serial", primaryKey: true },
      f_owner: { type: "text", notNull: true },
      f_count: { type: "integer", notNull: true, default: 0 },
      f_active: { type: "boolean", notNull: true, default: 1 },
    },
    indexes: { idx_items_owner: { columns: ["f_owner"] } },
  }),
  defineTable({
    name: "t_links",
    columns: {
      f_owner: {
        type: "text",
        notNull: true,
        references: { table: "t_items", column: "f_owner", onDelete: "cascade" },
      },
      f_key: { type: "text", notNull: true },
    },
    primaryKey: ["f_owner", "f_key"],
    uniques: { uq_links_key: { columns: ["f_owner", "f_key"] } },
  }),
]);

describe("DDL 由表定义生成", () => {
  it("SQLite 与 PostgreSQL 各自的类型 / 主键 / 引用", () => {
    const sqlite = createDialect("sqlite");
    const item = catalog[0]!;
    const sqliteSql = createTableSql(sqlite, item);
    expect(sqliteSql).toContain('"f_id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sqliteSql).toContain('"f_active" INTEGER NOT NULL DEFAULT 1');
    expect(sqliteSql).toContain('CREATE TABLE IF NOT EXISTS "t_items"');

    const postgres = createDialect("postgres");
    const postgresSql = createTableSql(postgres, item);
    expect(postgresSql).toContain('"f_id" SERIAL PRIMARY KEY');
    expect(postgresSql).toContain('"f_active" BOOLEAN NOT NULL DEFAULT TRUE');
    expect(postgresSql).toContain('CREATE TABLE IF NOT EXISTS "public"."t_items"');

    const link = catalog[1]!;
    expect(createTableSql(sqlite, link)).toContain(
      'REFERENCES "t_items"("f_owner") ON DELETE CASCADE',
    );
    expect(createTableSql(sqlite, link)).toContain('PRIMARY KEY ("f_owner", "f_key")');
  });
});

describe("ensureSchema 只做增", () => {
  it("建表、补列、补索引，并且重复执行是幂等的", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      const first = await ensureSchema(database, catalog);
      expect(first.some((sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS "t_items"'))).toBe(
        true,
      );

      // 第二次：结构已对齐，不再执行任何语句。
      expect(await ensureSchema(database, catalog)).toEqual([]);

      // 定义里多一列：只在旧表上补这一列。
      const extended = defineCatalog([
        defineTable({
          ...catalog[0]!,
          columns: { ...catalog[0]!.columns, f_note: { type: "text" } },
        }),
        catalog[1]!,
      ]);
      const applied = await ensureSchema(database, extended);
      expect(applied).toEqual(['ALTER TABLE "t_items" ADD COLUMN "f_note" TEXT']);

      const columns = await database.read<{ name: string }>(
        fragment('PRAGMA table_info("t_items")'),
      );
      expect(columns.map((row) => row.name)).toContain("f_note");
    } finally {
      await database.close();
    }
  });

  it("已有数据的表加 NOT NULL 列（无默认值）时 fail loud", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, catalog);
      const strict = defineCatalog([
        defineTable({
          ...catalog[0]!,
          columns: { ...catalog[0]!.columns, f_note: { type: "text", notNull: true } },
        }),
      ]);
      await expect(ensureSchema(database, strict)).rejects.toThrow(/without a default/u);
    } finally {
      await database.close();
    }
  });

  it("catalog 注入后按表名取表；允许破坏性变更时才删多余列", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, catalog);
      // 定义里没有 f_legacy：默认保留（升级不丢数据）。
      await database.run(fragment('ALTER TABLE "t_items" ADD COLUMN "f_legacy" TEXT'));
      expect(await ensureSchema(database, catalog)).toEqual([]);
      const dropped = await ensureSchema(database, catalog, { allowDestructive: true });
      expect(dropped).toEqual(['ALTER TABLE "t_items" DROP COLUMN "f_legacy"']);
    } finally {
      await database.close();
    }
  });
});

describe("SQLite 连接调优选项", () => {
  it("cacheSizeKb / mmapSize 落到 PRAGMA（连接级，从同一连接读回）", async () => {
    const { openDatabase } = await import("../index.ts");
    const { fragment } = await import("../index.ts");
    const path = `/tmp/rdbkit-pragma-${Date.now()}.sqlite`;
    const database = await openDatabase({
      dialect: "sqlite",
      path,
      cacheSizeKb: 65536,
      mmapSize: 268435456,
    });
    try {
      const [cache] = await database.read<{ cache_size: number }>(fragment("PRAGMA cache_size"));
      const [mmap] = await database.read<{ mmap_size: number }>(fragment("PRAGMA mmap_size"));
      expect(cache?.cache_size).toBe(-65536);
      expect(mmap?.mmap_size).toBe(268435456);
    } finally {
      await database.close();
    }
  });
});
