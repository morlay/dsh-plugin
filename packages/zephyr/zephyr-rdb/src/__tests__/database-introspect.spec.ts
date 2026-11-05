import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTable, ensureSchema, openDatabase } from "@morlay/zephyr-rdb";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zephyr-rdb-pragma-"));
  dirs.push(dir);
  return join(dir, "store.sqlite");
}

const notes = defineTable({
  name: "t_introspect_notes",
  columns: { f_id: { type: "text", primaryKey: true, notNull: true } },
});

describe("库级操作（业务侧不写 PRAGMA / VACUUM）", () => {
  it("objectNames：返回现有的表与视图名", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [notes]);
      expect(await database.objectNames()).toContain("t_introspect_notes");
    } finally {
      await database.close();
    }
  });

  it("sqlitePragma：读写库身份（user_version / application_id / journal_mode）", async () => {
    // journal_mode 在 `:memory:` 上只能是 `memory`，所以用文件库。
    const database = await openDatabase({ dialect: "sqlite", path: await tempFile() });
    try {
      expect(await database.sqlitePragma("user_version")).toBe(0);
      await database.setSqlitePragma("user_version", 7);
      expect(await database.sqlitePragma("user_version")).toBe(7);
      await database.setSqlitePragma("application_id", 12345);
      expect(await database.sqlitePragma("application_id")).toBe(12345);
      await database.setSqlitePragma("journal_mode", "wal");
      expect(await database.sqlitePragma("journal_mode")).toBe("wal");
    } finally {
      await database.close();
    }
  });

  it("setSqlitePragma 拒绝拼进 SQL 的值", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await expect(database.setSqlitePragma("user_version", "0; DROP TABLE x")).rejects.toThrow(
        /invalid pragma value/,
      );
    } finally {
      await database.close();
    }
  });

  it("vacuum：两种方言各有自己的写法，业务侧只调方法", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [notes]);
      await database.vacuum();
      expect(await database.objectNames()).toContain("t_introspect_notes");
    } finally {
      await database.close();
    }
  });
});
