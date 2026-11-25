import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished } from "vitest";
import { openInitializedSqlite } from "../../__tests__/support/sqlite.ts";

async function freshDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dsh-rdb-busy-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "sessions.db");
}

function tryWriteLock(
  path: string,
  busyTimeout: number,
): Promise<{ ok: boolean; waitedMs?: number; error?: string }> {
  const script = `
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(${JSON.stringify(path)})
    db.exec('PRAGMA busy_timeout = ' + ${busyTimeout})
    const t0 = Date.now()
    try {
      db.exec('BEGIN IMMEDIATE')
      db.exec('COMMIT')
      console.log('RESULT ' + JSON.stringify({ ok: true, waitedMs: Date.now() - t0 }))
    } catch (e) {
      console.log('RESULT ' + JSON.stringify({ ok: false, error: String(e) }))
    }
    process.exit(0)
  `;
  return writeFile(join(dirname(path), "waiter.cjs"), script).then(
    () =>
      new Promise((resolvePromise) => {
        const child = spawn(process.execPath, [join(dirname(path), "waiter.cjs")], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => {
          out += d;
        });
        child.stderr.on("data", (d) => {
          err += d;
        });
        child.on("close", (code) => {
          const line = out.split("\n").find((l) => l.startsWith("RESULT "));
          if (line) {
            resolvePromise(JSON.parse(line.slice("RESULT ".length)));
          } else {
            resolvePromise({ ok: false, error: `child exited ${code}: ${err}` });
          }
        });
      }),
  );
}

describe("busyTimeout: cross-process write-lock contention", () => {
  test("a zero timeout fails immediately while the lock is held (SQLite default would lose the append)", async () => {
    const path = await freshDbPath();
    const holder = await openInitializedSqlite(path, "wal", 0);
    holder.exec("BEGIN IMMEDIATE");
    try {
      const result = await tryWriteLock(path, 0);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/database is locked|busy/i);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
  });

  test("a nonzero timeout waits for the lock and commits (contention becomes a queue, not a loss)", async () => {
    const path = await freshDbPath();
    const holder = await openInitializedSqlite(path, "wal", 0);
    holder.exec("BEGIN IMMEDIATE");

    const release = setTimeout(() => {
      holder.exec("COMMIT");
    }, 800);
    try {
      const result = await tryWriteLock(path, 5000);
      // 判据是「**等到锁并写成功**，而不是丢写」——`ok: true` 就是它。
      expect(result.ok).toBe(true);
      // `waitedMs` 只证明「确实遇到锁并等了」，不是「立即成功」。具体时长是**实现细节**（holder 的 800ms
      // 减抖动），把它写进断言等于把环境时序当契约：负载一抖就红（实测 391 vs 400）。
      // 这条用例也不能用 fake timers：等的是内核的 `SQLITE_BUSY` 重试（真 sqlite 跨进程锁），
      // `vi.advanceTimersByTime()` 与 sqlite 的 `busy_timeout` 毫无关系。
      expect(result.waitedMs).toBeGreaterThan(0);
    } finally {
      clearTimeout(release);
      holder.close();
    }
  });
});
