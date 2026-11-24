import { describe, expect, test } from "@morlay/zephyr/testing";
import { defineTable } from "../defs.ts";
import { fragment } from "../fragment.ts";
import { createDialect } from "../dialect.ts";
import { createDatabase } from "../database/create.ts";
import { indexCatalog } from "../catalog.ts";
import type { Database, Executor } from "../database/types.ts";

// 事务作用域的判据：事务内的读写必须走事务给的执行面——PG 上从池里另取一条连接读不到本事务
// 未提交的写入（写路径拿它做 head 位点校验时，误报「另一个写者」）。用假 Executor 就能把这条
// 接缝钉住：不需要真库，也不看 SQL 长什么样。
const users = defineTable({
  name: "t_users",
  columns: {
    f_id: { type: "text", primaryKey: true },
    f_name: { type: "text", notNull: true },
  },
});

function scopedExecutor(label: string, seen: string[]): Executor {
  return {
    iterate: () => {
      seen.push(`${label}:iterate`);
      return (async function* () {
        yield { f_id: "u1", f_name: label };
      })();
    },
    write: async () => {
      seen.push(`${label}:write`);
      return [{ f_id: "u2", f_name: label }];
    },
    run: async () => {
      seen.push(`${label}:run`);
    },
    transaction: (fn) => fn(scopedExecutor("tx", seen)),
    close: async () => undefined,
  };
}

describe("事务作用域", () => {
  test("事务内的读与写都走事务给的执行面，事务外走基础执行面", async () => {
    const seen: string[] = [];
    const base = scopedExecutor("base", seen);
    const database: Database = createDatabase(createDialect("sqlite"), base, indexCatalog([users]));

    await database.read(fragment("SELECT 1"));
    // 带 RETURNING 的写走写原语（不是读原语）：事务外与 `run` 同队，事务内跟着事务。
    await database.table(users).insert({ f_id: "u2", f_name: "outside" }, ["f_id"]);

    await database.transaction(async (tx) => {
      await tx.read(fragment("SELECT 1"));
      await tx.run(fragment("UPDATE t_users SET f_name = ?", ["x"]));
      // 表句柄同样跟着事务走：投影查询与 insert ... RETURNING 都经执行面。
      const handle = tx.table(users);
      for await (const row of handle.select({ f_id: handle.f_id })) {
        expect(row.f_id).toBe("u1");
      }
      await handle.insert({ f_id: "u2", f_name: "n" }, ["f_id"]);
    });
    expect(seen).toEqual([
      "base:iterate",
      "base:write",
      "tx:iterate",
      "tx:run",
      "tx:iterate",
      "tx:write",
    ]);
  });
});
