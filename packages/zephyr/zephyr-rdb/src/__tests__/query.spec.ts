import { describe, expect, it } from "vitest";
import {
  and,
  column,
  count,
  defineTable,
  eq,
  fragment,
  inList,
  isNull,
  openDatabase,
  render,
  value,
} from "@morlay/zephyr-rdb";

const users = defineTable({
  name: "t_users",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_name: { type: "text", notNull: true },
    f_note: { type: "text" },
  },
});

describe("投影查询（业务不写 SQL）", () => {
  it("select 的投影决定结果类型，读是迭代器", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await database.run(
        fragment(
          'CREATE TABLE "t_users" ("f_id" INTEGER PRIMARY KEY AUTOINCREMENT, "f_name" TEXT NOT NULL, "f_note" TEXT)',
        ),
      );
      const table = database.table(users);
      await table.insert({ f_name: "ada" });
      await table.insert({ f_name: "bob", f_note: "ops" });

      const names: string[] = [];
      for await (const row of table
        .select({ name: table.column("f_name") })
        .where(eq(column("f_name"), value("ada")))) {
        names.push(row.name);
      }
      expect(names).toEqual(["ada"]);

      await table.update({ f_note: "ops-updated" }, eq(column("f_name"), value("bob")));
      const bob = await first(
        table.select({ note: table.column("f_note") }).where(eq(column("f_name"), value("bob"))),
      );
      expect(bob).toEqual({ note: "ops-updated" });

      const [total] = await collect(table.select({ n: count() }));
      expect(total?.n).toBe(2);

      await table.delete(and(eq(column("f_name"), value("ada")), isNull(column("f_note"))));
      const [after] = await collect(table.select({ n: count() }));
      expect(after?.n).toBe(1);
    } finally {
      await database.close();
    }
  });

  it("片段是惰性迭代器：可重复消费，占位符只由参数节点生成", () => {
    const condition = eq(column("f_name"), value("ada"));
    expect(render(condition, "sqlite")).toEqual({ text: '"f_name" = ?', params: ["ada"] });
    expect(render(condition, "postgres")).toEqual({ text: '"f_name" = $1', params: ["ada"] });
    // 可重复消费：每次调用重新生成，不是一次性迭代器。
    expect(render(condition, "sqlite")).toEqual({ text: '"f_name" = ?', params: ["ada"] });

    // 多条件组合一律加括号（AND/OR 混用时优先级不靠读 SQL 的人来判断）。
    const combined = and(condition, inList(column("f_id"), [1, 2]));
    expect(render(combined, "postgres")).toEqual({
      text: '("f_name" = $1 AND "f_id" IN ($2, $3))',
      params: ["ada", 1, 2],
    });
  });
});

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

async function first<T>(rows: AsyncIterable<T>): Promise<T | undefined> {
  for await (const row of rows) return row;
  return undefined;
}
