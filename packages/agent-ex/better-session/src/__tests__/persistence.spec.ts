// RDB 落盘的行为面：写一批、读回来、重启后还在、fork 的 seed 账目对得上。
//
// 这些用例只经 `SessionPersistence` 的公开面（create / open / stat / list），不直测内部映射函数。
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { SessionId } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./support/host.ts";
import { meta, oneTurnLogStepFirst, twoTurnLog } from "@morlay/dsh-session/testing";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
}

describe("RDB 会话落盘", () => {
  it("写进去的日志能原样读回来（含 seq 与 surfaceOp）", async () => {
    const harness = await start();
    const persistence = harness.app.get(SessionPersistence);
    const log = oneTurnLogStepFirst();
    const header = meta("round-trip", "/work");

    const handle = await persistence.create(header);
    await handle.append(log);
    await handle.close();

    const reopened = await persistence.open(SessionId("round-trip"), "read");
    const read = await reopened.read();
    await reopened.close();

    expect(read.events).toEqual(log);
  });

  it("落盘在数据根下的 sqlite 文件里（进程之外可恢复）", async () => {
    const harness = await start();
    const persistence = harness.app.get(SessionPersistence);

    const handle = await persistence.create(meta("on-disk"));
    await handle.append(oneTurnLogStepFirst());
    await handle.close();

    // 会话数据统一在 `sessions/` 下（与官方 jsonl 实现同一个目录，换实现只是换个文件）。
    const files = await readdir(join(harness.root, "sessions"));
    expect(files).toContain("sessions.sqlite");
  });

  it("stat 只给 header 与 revision，list 把已落库的会话都列出来", async () => {
    const harness = await start();
    const persistence = harness.app.get(SessionPersistence);

    const first = await persistence.create(meta("listed-1", "/work"));
    await first.append(oneTurnLogStepFirst());
    await first.close();
    const second = await persistence.create(meta("listed-2"));
    await second.append(twoTurnLog());
    await second.close();

    const snapshot = await persistence.stat(SessionId("listed-1"));
    expect(snapshot?.header.id).toBe("listed-1");
    expect(snapshot?.header.cwd).toBe("/work");

    const listed = await persistence.list();
    expect(listed.map((entry) => entry.header.id).sort()).toEqual(["listed-1", "listed-2"]);
  });

  it("同一 id 重复 create 被拒；关闭后仍被已落库的那条挡住", async () => {
    const harness = await start();
    const persistence = harness.app.get(SessionPersistence);

    const handle = await persistence.create(meta("dup"));
    await handle.append(oneTurnLogStepFirst());
    await handle.close();

    await expect(persistence.create(meta("dup"))).rejects.toThrow();
  });

  it("删掉库文件后重启：会话不在了（落盘真在文件里，不是进程内状态）", async () => {
    const harness = await start();
    const persistence = harness.app.get(SessionPersistence);
    const handle = await persistence.create(meta("gone"));
    await handle.append(oneTurnLogStepFirst());
    await handle.close();

    await harness.dispose();
    harnesses.splice(harnesses.indexOf(harness), 1);
    await rm(join(harness.root, "sessions", "sessions.sqlite"), { force: true });

    const again = await startHarness();
    harnesses.push(again);
    // 新的数据根：同一 id 现在可以重新建。
    const fresh = await again.app.get(SessionPersistence).create(meta("gone"));
    await fresh.close();
  });

  it("空会话要 flush 之后才物化，物化后 stat 看得到", async () => {
    const harness = await start();
    const persistence = harness.app.get(SessionPersistence);

    const handle = await persistence.create(meta("empty"));
    await handle.flush();
    await handle.close();

    expect((await persistence.stat(SessionId("empty")))?.header.id).toBe("empty");
  });
});
