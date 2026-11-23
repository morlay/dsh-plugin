// 域错误分层：失败只有一条通道（域码），库层原因折进 cause；端点与用例都按码分派，不解析文案。
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SessionId } from "@morlay/dsh-session/contract";
import { meta, oneTurnLogStepFirst, turnLog } from "@morlay/dsh-session/testing";
import { openRdbBackend } from "@morlay/session-rdb";
import { DbError } from "@morlay/zephyr-rdb";
import { afterEach, describe, expect, it } from "vitest";
import { dbErrorOf, failureCodeOf, sessionStoreError, SessionStoreError } from "../errors.ts";
import { makeRoot, removeRoot, startAt, type Instance } from "../../__tests__/support/host.ts";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await removeRoot(root);
});

async function twoInstances(): Promise<{ first: Instance; second: Instance }> {
  const root = await makeRoot();
  roots.push(root);
  const first = await startAt(root);
  const second = await startAt(root);
  return { first, second };
}

describe("域错误", () => {
  it("位点冲突给 SESSION_CONCURRENT_WRITER，且不自动重试（库保持原样）", async () => {
    const { first, second } = await twoInstances();
    try {
      const writer = await first.persistence.create(meta("conflict", "/work"));
      await writer.append(oneTurnLogStepFirst());
      await writer.close();

      // 两个实例都 open 了写句柄（各自记下当时的 head = 5），第一个提交之后第二个的基准就过期了。
      const a = await first.persistence.open(SessionId("conflict"), "write");
      const b = await second.persistence.open(SessionId("conflict"), "write");
      await a.append(turnLog(6, 2));

      const failure = await b.append(turnLog(6, 2)).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(SessionStoreError);
      expect(failure).toMatchObject({ code: "SESSION_CONCURRENT_WRITER" });
      expect(failureCodeOf(failure)).toBe("SESSION_CONCURRENT_WRITER");
      await a.close();
      await b.close().catch(() => undefined);

      // 被拒的一方没有副作用：日志还是 12 条。
      const reader = await first.persistence.open(SessionId("conflict"), "read");
      const events = (await reader.read()).events;
      await reader.close();
      expect(events).toHaveLength(12);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it("库的版本对不上时给 SESSION_STORAGE_INCOMPATIBLE，且不动那份库", async () => {
    const root = await makeRoot();
    roots.push(root);
    const path = join(root, "sessions.sqlite");
    const seed = new DatabaseSync(path);
    seed.exec("PRAGMA user_version = 999");
    seed.close();

    const failure = await openRdbBackend({
      type: "sqlite",
      path,
      journalMode: "wal",
      busyTimeout: 5000,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SessionStoreError);
    expect(failure).toMatchObject({ code: "SESSION_STORAGE_INCOMPATIBLE" });
    const after = new DatabaseSync(path);
    expect(after.prepare("PRAGMA user_version").get()).toEqual({ user_version: 999 });
    after.close();
  });

  it("cause 折成库层判定，域码可以从错误里读出来", () => {
    const sqliteBusy = Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "5" });
    const cause = dbErrorOf(sqliteBusy, "sqlite");
    expect(cause).toBeInstanceOf(DbError);
    expect(cause.kind).toBe("timeout");

    const error = sessionStoreError("SESSION_FLUSH_FAILED", "flush 没做成", sqliteBusy, "sqlite");
    expect(error).toBeInstanceOf(SessionStoreError);
    expect(error.cause).toBeInstanceOf(DbError);
    expect((error.cause as DbError).kind).toBe("timeout");
    expect(failureCodeOf(error)).toBe("SESSION_FLUSH_FAILED");
    expect(failureCodeOf(new Error("不是域错误"))).toBeUndefined();
  });
});
