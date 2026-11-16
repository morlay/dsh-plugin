import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createPostgresTestDatabase } from "@morlay/zephyr-rdb/testing";
import {
  defineCatalog,
  defineTable,
  fragment,
  openDatabase,
  runMigrations,
} from "@morlay/zephyr-rdb";

const items = defineTable({
  name: "t_lock_items",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_owner: { type: "text", notNull: true },
  },
});
const catalog = defineCatalog([items]);

async function ledgerIds(database: Awaited<ReturnType<typeof openDatabase>>): Promise<string[]> {
  const rows = await database.read<{ f_id: string }>(
    fragment('SELECT "f_id" FROM "t_schema_migrations" ORDER BY "f_id"'),
  );
  return rows.map((row) => row.f_id);
}

describe("迁移并发锁（SQLite）", () => {
  it("同进程两个 Database 指向同一文件：迁移只执行一次", async () => {
    const path = `/tmp/zephyr-rdb-migration-lock-${String(Date.now())}.sqlite`;
    let runs = 0;
    const migrations = [
      {
        id: "20261121-slow",
        up: async () => {
          runs += 1;
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
      },
    ];
    const first = await openDatabase({ dialect: "sqlite", path, busyTimeout: 5000 });
    const second = await openDatabase({ dialect: "sqlite", path, busyTimeout: 5000 });
    try {
      const [left, right] = await Promise.all([
        runMigrations(first, { catalog, migrations }),
        runMigrations(second, { catalog, migrations }),
      ]);
      expect([...left.executed, ...right.executed]).toEqual(["20261121-slow"]);
      expect(runs).toBe(1);
      expect(await ledgerIds(first)).toEqual(["20261121-slow"]);
    } finally {
      await first.close();
      await second.close();
      await rm(path, { force: true });
    }
  });
});

describe.skipIf(!process.env.TEST_PG_URL)("迁移并发锁（PostgreSQL）", () => {
  it("两个 Database 同时跑：advisory lock 让迁移只执行一次", async () => {
    const testDatabase = await createPostgresTestDatabase();
    let runs = 0;
    const migrations = [
      {
        id: "20261121-pg-slow",
        up: async () => {
          runs += 1;
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
      },
    ];
    const config = {
      dialect: "postgres" as const,
      connectionString: testDatabase.connectionString,
      catalog,
    };
    const first = await openDatabase(config);
    const second = await openDatabase(config);
    try {
      const [left, right] = await Promise.all([
        runMigrations(first, { catalog, migrations }),
        runMigrations(second, { catalog, migrations }),
      ]);
      expect([...left.executed, ...right.executed]).toEqual(["20261121-pg-slow"]);
      expect(runs).toBe(1);
      expect(await ledgerIds(first)).toEqual(["20261121-pg-slow"]);
    } finally {
      await first.close();
      await second.close();
      await testDatabase.drop();
    }
  });
});
