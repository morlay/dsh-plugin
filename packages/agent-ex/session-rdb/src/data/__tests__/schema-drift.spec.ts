// 打开库时如何消费结构漂移：库里有、catalog 没有的表（以及改列这类要人决定的差异）只报告不自动修——
// 记一条汇总 warn，不阻塞打开，也不改写库；可自动修的漂移当场修好，不进 warn。
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openRdbBackend } from "@morlay/session-rdb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRoot, removeRoot } from "../../__tests__/support/host.ts";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await removeRoot(root);
});

// 一份已初始化的库（建表 / 迁移 / 身份都已落库），返回库文件路径。
async function freshDatabase(): Promise<string> {
  const root = await makeRoot();
  roots.push(root);
  const path = join(root, "sessions.sqlite");
  const backend = await openRdbBackend({
    type: "sqlite",
    path,
    journalMode: "wal",
    busyTimeout: 5000,
  });
  await backend.close();
  return path;
}

// warn 是打开库这一层的对外信号（这一层没有注入 logger）：收 `console.warn` 的实参。
function captureWarnings(): string[] {
  const messages: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(" "));
  });
  return messages;
}

function tableNames(sqlite: DatabaseSync): string[] {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name).sort();
}

function indexColumns(sqlite: DatabaseSync, index: string): string[] {
  const rows = sqlite.prepare('PRAGMA index_info("' + index + '")').all() as Array<{
    name: string;
  }>;
  return rows.map((row) => row.name);
}

describe("打开库时的结构漂移", () => {
  it("库里有、catalog 没有的表：打开后一条汇总 warn（列出表名、只报告不自动修），表与结构原样还在", async () => {
    const path = await freshDatabase();
    // 库里有、catalog 没有的表：删掉表定义（或绕过迁移直接删账本）之后就会这样。
    const writer = new DatabaseSync(path);
    writer.exec('CREATE TABLE "t_legacy_orphan" ("f_id" TEXT NOT NULL)');
    writer.exec('CREATE TABLE "t_zzz_orphan" ("f_id" TEXT NOT NULL)');
    writer.prepare('INSERT INTO "t_legacy_orphan" ("f_id") VALUES (?)').run("kept");
    const before = tableNames(writer);
    writer.close();

    const warnings = captureWarnings();
    const backend = await openRdbBackend({
      type: "sqlite",
      path,
      journalMode: "wal",
      busyTimeout: 5000,
    });
    await backend.close();

    // 一条汇总，不是每条一条：表名与「只报告不自动修」都在里面。
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("t_legacy_orphan");
    expect(warnings[0]).toContain("t_zzz_orphan");
    expect(warnings[0]).toContain("只报告不自动修");

    // 只报告：库没被改写（表清单不变、孤儿表里的行还在）。
    const reader = new DatabaseSync(path);
    try {
      expect(tableNames(reader)).toEqual(before);
      expect(reader.prepare('SELECT "f_id" FROM "t_legacy_orphan"').all()).toEqual([
        { f_id: "kept" },
      ]);
    } finally {
      reader.close();
    }
  });

  it("可自动修的漂移不进 warn：同名索引被改过，打开时重建回定义的样子", async () => {
    const path = await freshDatabase();
    const writer = new DatabaseSync(path);
    writer.exec('DROP INDEX "idx_sessions_title"');
    writer.exec('CREATE INDEX "idx_sessions_title" ON "t_sessions" ("f_cwd")');
    writer.close();

    const warnings = captureWarnings();
    const backend = await openRdbBackend({
      type: "sqlite",
      path,
      journalMode: "wal",
      busyTimeout: 5000,
    });
    await backend.close();

    // 自动修好了（不需要人决定）：不告警。
    expect(warnings).toEqual([]);
    const reader = new DatabaseSync(path);
    try {
      expect(indexColumns(reader, "idx_sessions_title")).toEqual(["f_title"]);
    } finally {
      reader.close();
    }
  });
});
