import { describe, expect, it } from "vitest";
import {
  createDialect,
  createTableSql,
  defineTable,
  E,
  ensureSchema,
  fragment,
  openDatabase,
} from "@morlay/zephyr-rdb";

const events = defineTable({
  name: "t_events",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    // 受检 text：DB 上是 CHECK，写入时构造期就拦。
    f_state: { type: "text", notNull: true, values: ["pending", "done"] },
    // JSON：SQLite 存 TEXT，PostgreSQL 用 JSONB；读写都是结构化值。
    f_data: { type: "json", notNull: true },
  },
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const row of source) result.push(row);
  return result;
}

describe("枚举与 JSON 列", () => {
  it("枚举列在 DDL 上是 CHECK，写入非枚举值构造期抛错", async () => {
    const sqlite = createTableSql(createDialect("sqlite"), events);
    expect(sqlite).toContain("CHECK (\"f_state\" IN ('pending', 'done'))");
    const postgres = createTableSql(createDialect("postgres"), events);
    expect(postgres).toContain("CHECK (\"f_state\" IN ('pending', 'done'))");

    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [events]);
      const table = database.table(events);

      const [created] = await table.insert({ f_state: "pending", f_data: { kind: "created" } }, [
        "f_state",
      ]);
      expect(created?.f_state).toBe("pending");

      await expect(table.insert({ f_state: "bogus", f_data: { kind: "x" } })).rejects.toThrow(
        /must be one of pending, done/u,
      );
      await expect(table.update({ f_state: "bogus" } as never)).rejects.toThrow(
        /must be one of pending, done/u,
      );

      // 数据库层也拦：绕过表句柄的写入拿到的是 CHECK 分类错误（不是 unknown）。
      await expect(
        database.run(
          fragment('INSERT INTO "t_events" ("f_state", "f_data") VALUES (?, ?)', ["bogus", "{}"]),
        ),
      ).rejects.toMatchObject({ kind: "check" });
    } finally {
      await database.close();
    }
  });

  it("JSON 列读写是结构化值，DDL 按方言映射（SQLite TEXT / PostgreSQL JSONB）", async () => {
    expect(createTableSql(createDialect("sqlite"), events)).toContain('"f_data" TEXT NOT NULL');
    expect(createTableSql(createDialect("postgres"), events)).toContain('"f_data" JSONB NOT NULL');

    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [events]);
      const table = database.table(events);
      const payload = { kind: "created", tags: ["a", "b"], usage: { input: 3 } };

      // RETURNING 读回结构化值（不是 JSON 文本）。
      const [created] = await table.insert({ f_state: "done", f_data: payload }, ["f_data"]);
      expect(created?.f_data).toEqual(payload);

      // 投影查询同样给结构化值。
      const rows = await collect(table.select({ data: table.f_data }));
      expect(rows).toEqual([{ data: payload }]);

      // 与 JSON 表达式配合：jsonInt 从同一列取值。
      const [usage] = await collect(
        table.select({ input: E.jsonInt(table.f_data, "$.usage.input") }),
      );
      expect(usage?.input).toBe(3);
    } finally {
      await database.close();
    }
  });
});
