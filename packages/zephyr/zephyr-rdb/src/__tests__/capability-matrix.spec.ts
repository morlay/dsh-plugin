import { describe, expect, it } from "vitest";
import {
  createDialect,
  defineTable,
  DbError,
  openDatabase,
  UNSUPPORTED_CODE,
  wrapDatabase,
  type DialectCapability,
  type DialectName,
} from "@morlay/zephyr-rdb";

const items = defineTable({
  name: "t_items",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_owner: { type: "text", notNull: true },
  },
});

// 能力矩阵的代码事实：改这两个集合就改这张表。
const CAPABILITIES: readonly DialectCapability[] = [
  "schema",
  "row-lock",
  "advisory-lock",
  "json",
  "explain",
  "partial-index",
  "savepoint",
  "vacuum-analyze",
];

const MATRIX: Record<DialectName, ReadonlySet<DialectCapability>> = {
  sqlite: new Set<DialectCapability>(["json", "explain", "partial-index", "savepoint"]),
  postgres: new Set<DialectCapability>([
    "schema",
    "row-lock",
    "advisory-lock",
    "json",
    "explain",
    "partial-index",
    "savepoint",
    "vacuum-analyze",
  ]),
};

// 记录语句的假 PostgreSQL 执行面：不需要真库就能看表句柄渲染出的语句。
function recordingPostgres() {
  const statements: string[] = [];
  let database!: ReturnType<typeof wrapDatabase>;
  database = wrapDatabase("postgres", {
    async *iterate(text) {
      statements.push(text);
      yield* [] as unknown[];
    },
    async run(text) {
      statements.push(text);
    },
    transaction: (fn) => fn(database),
  });
  return { database, statements };
}

describe("方言能力矩阵", () => {
  it("每个能力在两种方言上的判定与矩阵一致", () => {
    for (const name of ["sqlite", "postgres"] as const) {
      const dialect = createDialect(name);
      for (const capability of CAPABILITIES) {
        expect([name, capability, dialect.supports(capability)]).toEqual([
          name,
          capability,
          MATRIX[name].has(capability),
        ]);
      }
    }
  });

  it("SQLite 上用 FOR UPDATE 立刻抛 unsupported（不静默丢弃）", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      const table = database.table(items);
      let thrown: unknown;
      try {
        table.select({ id: table.f_id }).forUpdate();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(DbError);
      expect(thrown).toMatchObject({ kind: "unsupported", code: UNSUPPORTED_CODE });
      expect((thrown as DbError).message).toContain("sqlite does not support 'row-lock");
    } finally {
      await database.close();
    }
  });

  it("PostgreSQL 上 FOR UPDATE 照常渲染", () => {
    const { database } = recordingPostgres();
    const table = database.table(items);
    const query = table.select({ id: table.f_id }).forUpdate({ skipLocked: true });
    expect(query.toFragment()).toBeDefined();
    expect(() => query.forUpdate()).not.toThrow();
  });
});
