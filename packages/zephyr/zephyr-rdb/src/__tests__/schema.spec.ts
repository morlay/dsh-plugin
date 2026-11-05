import { describe, expect, it } from "vitest";
import {
  aliasedTable,
  createDialect,
  createTableSql,
  defineCatalog,
  defineTable,
  dropIndexSql,
  E,
  ensureSchema,
  fragment,
  openDatabase,
  planSchema,
  render,
  runMigrations,
  wrapDatabase,
  type Database,
} from "@morlay/zephyr-rdb";

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
    const { openDatabase } = await import("@morlay/zephyr-rdb");
    const { fragment } = await import("@morlay/zephyr-rdb");
    const path = `/tmp/zephyr-rdb-pragma-${Date.now()}.sqlite`;
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

// 记录 SQL 的假 PostgreSQL 执行面：不需要真服务就能看表句柄 / 迁移渲染出来的语句。
function recordingPostgres(schema?: string): {
  database: Database;
  statements: { text: string; params: readonly unknown[] }[];
  reply: (rows: unknown[]) => void;
} {
  const statements: { text: string; params: readonly unknown[] }[] = [];
  let rows: unknown[] = [];
  let database: Database;
  database = wrapDatabase("postgres", {
    ...(schema === undefined ? {} : { schema }),
    async *iterate(text, params) {
      statements.push({ text, params });
      yield* rows;
    },
    async run(text, params) {
      statements.push({ text, params });
    },
    transaction: (fn) => fn(database),
  });
  return {
    database,
    statements,
    reply(next) {
      rows = next;
    },
  };
}

describe("PostgreSQL 自定义 schema", () => {
  const postgres = createDialect("postgres");
  const items = catalog[0]!;
  const links = catalog[1]!;

  it("DDL 的建表 / 外键引用 / 补列 / 索引都带 schema", () => {
    const createLinks = createTableSql(postgres, links, "dsh_test");
    expect(createLinks).toContain('CREATE TABLE IF NOT EXISTS "dsh_test"."t_links"');
    expect(createLinks).toContain('REFERENCES "dsh_test"."t_items"("f_owner")');

    const existing = new Map([
      [
        "t_items",
        { columns: new Set(["f_id", "f_owner", "f_active"]), indexes: new Set<string>() },
      ],
    ]);
    const statements = planSchema(postgres, catalog, existing, { schema: "dsh_test" }).map(
      (change) => change.statement,
    );
    expect(statements).toContain(
      'ALTER TABLE "dsh_test"."t_items" ADD COLUMN "f_count" INTEGER NOT NULL DEFAULT 0',
    );
    expect(statements).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_items_owner" ON "dsh_test"."t_items" ("f_owner")',
    );
    expect(statements.every((statement) => statement.includes('"dsh_test".'))).toBe(true);
  });

  it("表句柄的读写与 join 都指向配置的 schema", async () => {
    const { database, statements } = recordingPostgres("dsh_test");
    const table = database.table(items);
    await table.insert({ f_owner: "a", f_count: 1, f_active: true });
    await table.update({ f_count: 2 }, E.eq(table.f_owner, "a"));
    await table.delete(E.eq(table.f_owner, "a"));

    const sql = statements.map((statement) => statement.text);
    expect(sql[0]).toContain('INSERT INTO "dsh_test"."t_items"');
    expect(sql[1]).toContain('UPDATE "dsh_test"."t_items"');
    expect(sql[2]).toContain('DELETE FROM "dsh_test"."t_items"');
    expect(render(table.select().toFragment(), "postgres").text).toContain(
      'FROM "dsh_test"."t_items"',
    );
    const linksTable = database.table(links);
    expect(
      render(
        table
          .select({ owner: table.f_owner })
          .join(links, E.eq(table.f_owner, linksTable.f_owner))
          .toFragment(),
        "postgres",
      ).text,
    ).toContain('JOIN "dsh_test"."t_links"');
  });

  it("ensureSchema 与结构探测缺省用连接上的 schema", async () => {
    const { database, statements } = recordingPostgres("dsh_test");
    const applied = await ensureSchema(database, [items]);
    expect(
      applied.some((statement) =>
        statement.includes('CREATE TABLE IF NOT EXISTS "dsh_test"."t_items"'),
      ),
    ).toBe(true);
    expect(applied.every((statement) => statement.includes('"dsh_test".'))).toBe(true);
    // 结构探测查的是配置的 schema，不是硬编码的 public。
    expect(statements[0]!.text).toContain("information_schema.columns");
    expect(statements[0]!.params).toEqual(["dsh_test", "t_items"]);
  });

  it("迁移账本的建表 / 读 / 记账都在配置的 schema", async () => {
    const { database, statements } = recordingPostgres("dsh_test");
    const migrations = [{ id: "20261109-probe", up: async () => {} }];
    expect(await runMigrations(database, { catalog: [items], migrations })).toEqual([
      "20261109-probe",
    ]);
    const sql = statements.map((statement) => statement.text);
    expect(
      sql.some((text) =>
        text.includes('CREATE TABLE IF NOT EXISTS "dsh_test"."t_schema_migrations"'),
      ),
    ).toBe(true);
    expect(sql.some((text) => text.includes('FROM "dsh_test"."t_schema_migrations"'))).toBe(true);
    expect(sql.some((text) => text.includes('INSERT INTO "dsh_test"."t_schema_migrations"'))).toBe(
      true,
    );
  });

  it("objectNames 查配置的 schema", async () => {
    const { database, statements } = recordingPostgres("dsh_test");
    await database.objectNames();
    expect(statements).toHaveLength(1);
    expect(statements[0]!.text).toContain("information_schema.tables");
    expect(statements[0]!.params).toEqual(["dsh_test"]);
  });
});

// 连接上的 schema 是唯一事实来源：DROP INDEX 与表别名引用同样要落在它上面。
// 源 commit 漏了这两处，漏掉时配置了 schema 的部署仍会按 search_path 解析。
describe("schema 机制漏掉的两处也走方言", () => {
  const postgres = createDialect("postgres");
  const sqlite = createDialect("sqlite");
  const items = catalog[0]!;

  it("dropIndexSql：SQLite 不带前缀，PostgreSQL 带 schema", () => {
    expect(dropIndexSql(sqlite, "idx_items_owner")).toBe('DROP INDEX IF EXISTS "idx_items_owner"');
    expect(dropIndexSql(postgres, "idx_items_owner")).toBe(
      'DROP INDEX IF EXISTS "public"."idx_items_owner"',
    );
    expect(dropIndexSql(postgres, "idx_items_owner", "dsh_test")).toBe(
      'DROP INDEX IF EXISTS "dsh_test"."idx_items_owner"',
    );
  });

  it("aliasedTable：带 schema 与不带 schema", () => {
    expect(aliasedTable(sqlite, items, "i")).toBe('"t_items" AS "i"');
    expect(aliasedTable(postgres, items, "i")).toBe('"public"."t_items" AS "i"');
    expect(aliasedTable(postgres, items, "i", "dsh_test")).toBe('"dsh_test"."t_items" AS "i"');
  });

  it("这两处的标识符校验没有因为加参数而放宽", () => {
    expect(() => dropIndexSql(postgres, 'idx"; DROP TABLE x; --', "dsh_test")).toThrow(
      /invalid index/u,
    );
    expect(() => dropIndexSql(postgres, "idx_ok", 'dsh_test"; DROP TABLE x; --')).toThrow(
      /invalid schema/u,
    );
    expect(() => aliasedTable(postgres, items, "i", 'dsh_test"; DROP TABLE x; --')).toThrow(
      /invalid schema/u,
    );
    expect(() => aliasedTable(postgres, items, 'i" AS "j')).toThrow(/invalid identifier/u);
  });

  // 索引名不能走表名那条路：报错要说是索引，规则也不跟着表名的校验漂。
  it("索引名自己的标识符校验（报错说 index，不冒充 table）", () => {
    expect(() => dropIndexSql(postgres, "bad-index", "dsh_test")).toThrow(
      /zephyr-rdb: invalid index 'bad-index'/u,
    );
    expect(() => sqlite.indexName("bad-index")).toThrow(/invalid index/u);
    expect(() => postgres.indexName("bad-index", "dsh_test")).toThrow(/invalid index/u);
    expect(postgres.indexName("idx_ok", "dsh_test")).toBe('"dsh_test"."idx_ok"');
    expect(sqlite.indexName("idx_ok", "dsh_test")).toBe('"idx_ok"');
  });
});
