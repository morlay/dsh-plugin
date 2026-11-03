import { describe, expect, it } from "vitest";
import {
  column,
  count,
  defineTable,
  ensureSchema,
  eq,
  exists,
  gt,
  expr,
  inSubquery,
  openDatabase,
  value,
} from "../index.ts";

const items = defineTable({
  name: "t_items",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_key: { type: "text", notNull: true, unique: true },
    f_count: { type: "integer", notNull: true, default: 0 },
  },
});

const audit = defineTable({
  name: "t_audit",
  columns: {
    f_item: { type: "integer", notNull: true },
    f_note: { type: "text" },
  },
});

describe("写入通道（RETURNING / 冲突表达式 / 子查询 / 错误分类）", () => {
  it("insert / update 拿回行，冲突时按表达式自增", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items, audit]);
      const table = database.table(items);

      const [created] = await table.insert({ f_key: "a" }, ["f_id", "f_count"]);
      expect(created).toMatchObject({ f_id: 1, f_count: 0 });

      const [updated] = await table.update({ f_count: 10 }, eq(column("f_key"), value("a")), [
        "f_count",
      ]);
      expect(updated).toMatchObject({ f_count: 10 });

      // 冲突时用表达式更新：计数自增，而不是覆盖。
      await table.upsertExpr({ f_key: "a", f_count: 1 }, ["f_key"], {
        f_count: expr('"f_count" + 1'),
      });
      let afterUpsert: { count: number } | undefined;
      for await (const row of table.select({ count: table.column("f_count") })) {
        afterUpsert = row;
        break;
      }
      expect(afterUpsert).toEqual({ count: 11 });
    } finally {
      await database.close();
    }
  });

  it("子查询：IN (SELECT) 与 EXISTS", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items, audit]);
      const table = database.table(items);
      const auditTable = database.table(audit);
      await table.insert({ f_key: "a" }, ["f_id"]);
      await table.insert({ f_key: "b" }, ["f_id"]);
      await auditTable.insertMany([{ f_item: 2, f_note: "seen" }]);

      const withAudit: string[] = [];
      for await (const row of table
        .select({ key: table.column("f_key") })
        .where(
          inSubquery(
            column("f_id"),
            auditTable.select({ item: auditTable.column("f_item") }).toFragment(),
          ),
        )) {
        withAudit.push(row.key);
      }
      expect(withAudit).toEqual(["b"]);

      const existsRows: number[] = [];
      for await (const row of table.select({ id: table.column("f_id") }).where(
        exists(
          auditTable
            .select({ one: auditTable.column("f_item") })
            .where(eq(column("f_item", "t_audit"), column("f_id", "t_items")))
            .toFragment(),
        ),
      )) {
        existsRows.push(row.id);
      }
      expect(existsRows).toEqual([2]);
    } finally {
      await database.close();
    }
  });

  it("错误分类：唯一冲突与非空约束", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items]);
      const table = database.table(items);
      await table.insert({ f_key: "a" });
      await expect(table.insert({ f_key: "a" })).rejects.toMatchObject({ kind: "unique" });
      await expect(table.insert({ f_key: null as never })).rejects.toMatchObject({
        kind: "not-null",
      });
    } finally {
      await database.close();
    }
  });
});

describe("批量写入", () => {
  it("insertMany + ON CONFLICT 覆盖：一行不多、值被更新", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items]);
      const table = database.table(items);
      await table.insertMany(
        [
          { f_key: "a", f_count: 1 },
          { f_key: "b", f_count: 2 },
        ],
        { conflict: ["f_key"], update: ["f_count"] },
      );
      await table.insertMany([{ f_key: "a", f_count: 9 }], {
        conflict: ["f_key"],
        update: ["f_count"],
      });
      const rows: { key: string; count: number }[] = [];
      for await (const row of table
        .select({ key: table.column("f_key"), count: table.column("f_count") })
        .orderBy("f_key")) {
        rows.push(row);
      }
      expect(rows).toEqual([
        { key: "a", count: 9 },
        { key: "b", count: 2 },
      ]);
    } finally {
      await database.close();
    }
  });
});

describe("事务端口（宿主管事务，执行面按调用传入）", () => {
  it("scoped Database 用同一事务执行，回滚后什么都不留", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { wrapDatabase } = await import("../index.ts");
    const client = new DatabaseSync(":memory:");
    const scoped = (): ReturnType<typeof wrapDatabase> =>
      wrapDatabase("sqlite", {
        iterate: async function* (text: string, params: readonly unknown[]) {
          for (const row of client.prepare(text).iterate(...(params as never[]))) yield row;
        },
        run: async (text: string, params: readonly unknown[]) => {
          client.prepare(text).run(...(params as never[]));
        },
      });
    const database = wrapDatabase("sqlite", {
      iterate: async function* (text: string, params: readonly unknown[]) {
        for (const row of client.prepare(text).iterate(...(params as never[]))) yield row;
      },
      run: async (text: string, params: readonly unknown[]) => {
        client.prepare(text).run(...(params as never[]));
      },
      transaction: async (fn) => {
        client.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn(scoped());
          client.exec("COMMIT");
          return result;
        } catch (error) {
          client.exec("ROLLBACK");
          throw error;
        }
      },
    });
    try {
      await ensureSchema(database, [items]);
      const table = database.table(items);
      await database.transaction(async (tx) => {
        await tx.table(items).insert({ f_key: "a" });
      });
      let total = 0;
      for await (const row of table.select({ n: count() })) total = Number(row.n);
      expect(total).toBe(1);
      await expect(
        database.transaction(async (tx) => {
          await tx.table(items).insert({ f_key: "b" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      let after = 0;
      for await (const row of table.select({ n: count() })) after = Number(row.n);
      expect(after).toBe(1);
    } finally {
      client.close();
    }
  });
});

describe("更新表达式", () => {
  it("update 里可以写表达式（列自增 / 取大），普通值仍然绑定", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items]);
      const table = database.table(items);
      await table.insert({ f_key: "a", f_count: 1 }, ["f_id"]);
      await table.update({ f_count: expr('"f_count" + 10') }, eq(table.f_key, "a"));
      let seen = -1;
      for await (const row of table.select({ count: table.f_count })) seen = row.count;
      expect(seen).toBe(11);
    } finally {
      await database.close();
    }
  });
});

describe("删除", () => {
  it("delete 可以拿回被删的行（RETURNING）", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items]);
      const table = database.table(items);
      await table.insertMany([{ f_key: "a" }, { f_key: "b" }]);
      const removed = await table.delete(eq(table.f_key, "a"), ["f_key"]);
      expect(removed).toEqual([{ f_key: "a" }]);
      expect(await table.delete(eq(table.f_key, "missing"), ["f_key"])).toEqual([]);
    } finally {
      await database.close();
    }
  });
});

describe("INSERT … SELECT", () => {
  it("按投影顺序把查询结果插进来（可带冲突子句）", async () => {
    const archive = defineTable({
      name: "t_archive",
      columns: {
        f_id: { type: "serial", primaryKey: true },
        f_key: { type: "text", notNull: true, unique: true },
        f_count: { type: "integer", notNull: true, default: 0 },
      },
    });
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items, archive]);
      const table = database.table(items);
      const target = database.table(archive);
      await table.insertMany([
        { f_key: "a", f_count: 1 },
        { f_key: "b", f_count: 2 },
      ]);
      await target.insertFromSelect(
        ["f_key", "f_count"],
        table
          .select({ key: table.f_key, count: table.f_count })
          .where(gt(table.f_count, 1))
          .toFragment(),
      );
      const copied: { key: string; count: number }[] = [];
      for await (const row of target.select({ key: target.f_key, count: target.f_count })) {
        copied.push(row);
      }
      expect(copied).toEqual([{ key: "b", count: 2 }]);
    } finally {
      await database.close();
    }
  });
});

describe("defineTable 即操作钩子", () => {
  it("表定义直接拿句柄（与 database.table(def) 等价）", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items]);
      const table = items.table(database);
      await table.insert({ f_key: "hook" });
      const seen: string[] = [];
      for await (const row of table.select({ key: table.f_key })) seen.push(row.key);
      expect(seen).toEqual(["hook"]);
    } finally {
      await database.close();
    }
  });
});
