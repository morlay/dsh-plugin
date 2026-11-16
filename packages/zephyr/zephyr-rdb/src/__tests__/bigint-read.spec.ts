import { describe, expect, it } from "vitest";
import {
  defineTable,
  ensureSchema,
  fragment,
  openDatabase,
  readBigInts,
  render,
} from "@morlay/zephyr-rdb";

const counters = defineTable({
  name: "t_counters",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_at: { type: "bigint", notNull: true },
    f_hits: { type: "integer", notNull: true },
    f_active: { type: "boolean", notNull: true, default: 1 },
  },
});

const BIG = 9_007_199_254_740_993n; // 2^53 + 1

describe("大整数读", () => {
  it("写入 2^53+1 后 select / RETURNING / read 三条路径都读回 BigInt", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [counters]);
      const table = database.table(counters);

      // 1) RETURNING
      const [created] = await table.insert({ f_at: BIG, f_hits: 7 }, [
        "f_at",
        "f_hits",
        "f_active",
      ]);
      expect(created?.f_at).toBe(BIG);
      // 同一语句里 INTEGER / BOOLEAN 列不走 BigInt：只有声明为 bigint 的列是 BigInt。
      expect(created?.f_hits).toBe(7);
      expect(created?.f_active).toBe(true);

      // 2) 投影查询
      for await (const row of table.select({
        at: table.f_at,
        hits: table.f_hits,
        active: table.f_active,
      })) {
        expect(row.at).toBe(BIG);
        expect(row.hits).toBe(7);
        expect(row.active).toBe(true);
      }

      // 3) 手写片段：读取开关跟着片段走（片段没有列定义，标记作用于整条语句）。
      const rows = await database.read<{ f_at: bigint }>(
        readBigInts(fragment('SELECT "f_at" FROM "t_counters"')),
      );
      expect(rows[0]?.f_at).toBe(BIG);
    } finally {
      await database.close();
    }
  });

  it("语句级开关只由 bigint 列触发：没有 bigint 列的查询不开它", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [counters]);
      const table = database.table(counters);
      expect(render(table.select({ hits: table.f_hits }).toFragment(), "sqlite").readBigInts).toBe(
        false,
      );
      expect(render(table.select({ at: table.f_at }).toFragment(), "sqlite").readBigInts).toBe(
        true,
      );
    } finally {
      await database.close();
    }
  });
});
