import { describe, expect, test } from "@morlay/zephyr/testing";
import {
  DbError,
  classifyError,
  defineTable,
  ensureSchema,
  fragment,
  openDatabase,
} from "@morlay/zephyr-rdb";

const readings = defineTable({
  name: "t_readings",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_at: { type: "bigint", notNull: true },
    f_active: { type: "boolean", notNull: true, default: 1 },
    f_note: { type: "text" },
  },
});

describe("健壮性", () => {
  test("占位符与参数个数不一致时立刻失败（多给一个参数不会被静默丢掉）", () => {
    expect(() => fragment("SELECT 1 WHERE 1 = ?", []).call(undefined)).toThrow();
    expect(() => fragment("SELECT 1", ["extra"]).call(undefined)).toThrow();
    expect(() => fragment("SELECT ? + ?", [1]).call(undefined)).toThrow();
  });

  test("分页参数非法时 fail loud；单独 OFFSET 在 SQLite 上不是语法错误", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [readings]);
      const table = database.table(readings);
      for (const note of ["a", "b", "c"]) {
        await table.insert({ f_at: 1, f_active: true, f_note: note });
      }
      expect(() => table.select({ id: table.f_id }).limit(-1)).toThrow();
      expect(() => table.select({ id: table.f_id }).offset(Number.NaN)).toThrow();
      const rows = [];
      for await (const row of table.select({ note: table.f_note }).orderBy("f_id").offset(1)) {
        rows.push(row.note);
      }
      expect(rows).toEqual(["b", "c"]);
    } finally {
      await database.close();
    }
  });

  test("RETURNING 与投影给同一套值类型：bigint 是 BigInt、boolean 是 true/false", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [readings]);
      const table = database.table(readings);
      const [created] = await table.insert({ f_at: 2, f_active: true }, ["f_at", "f_active"]);
      expect(created?.f_at).toBe(BigInt(2));
      expect(created?.f_active).toBe(true);
      const [updated] = await table.update({ f_active: false }, undefined, ["f_active"]);
      expect(updated?.f_active).toBe(false);
      for await (const row of table.select({ at: table.f_at, active: table.f_active })) {
        expect(row.at).toBe(BigInt(2));
        expect(row.active).toBe(false);
      }
    } finally {
      await database.close();
    }
  });

  test("写不认识的列 fail loud，不静默丢数据", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [readings]);
      const table = database.table(readings);
      await expect(table.insert({ f_at: 1, f_typo: "x" } as never)).rejects.toThrow(
        /unknown column/u,
      );
      await expect(table.update({ f_typo: "x" } as never)).rejects.toThrow(/unknown column/u);
    } finally {
      await database.close();
    }
  });

  test("错误分类能分派重试：事务冲突、语句取消、连接断开各归一类", () => {
    expect(classifyError({ code: "40001", message: "could not serialize" }, "postgres").kind).toBe(
      "retryable",
    );
    expect(classifyError({ code: "40P01", message: "deadlock detected" }, "postgres").kind).toBe(
      "retryable",
    );
    expect(classifyError({ code: "57014", message: "canceling statement" }, "postgres").kind).toBe(
      "canceled",
    );
    expect(
      classifyError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" }, "postgres").kind,
    ).toBe("connection");
    const timeout = classifyError({ code: "55P03", message: "lock not available" }, "postgres");
    expect(timeout.kind).toBe("timeout");
    expect(timeout.sqlState).toBe("55P03");
    const busy = classifyError({ errcode: 5, message: "database is locked" }, "sqlite");
    expect(busy.kind).toBe("timeout");
    expect(busy).toBeInstanceOf(DbError);
  });
});
