// 分支原语的端口（`SessionBranching`，L2：真装配 + 真库）：跨域编排只要两件事——派生一条子会话、
// 失败时撤掉这次派生。判据：子会话的 header（父引用 + 换过的 cwd）、父会话不动、discard 之后库里只剩源会话。
import { SessionId } from "@morlay/dsh-session/contract";
import { SessionBranching } from "@morlay/dsh-session";
import { meta, turnLog } from "@morlay/dsh-session/testing";
import { asRdbStore } from "@morlay/session-rdb";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished } from "vitest";
import { mount, type MountedRow } from "../../__tests__/support/base.ts";

async function start(): Promise<MountedRow> {
  const row = await mount();
  onTestFinished(() => row.dispose());
  return row;
}

async function seedSession(row: MountedRow, id: string): Promise<number> {
  const handle = await row.persistence.create(meta(id, "/work"));
  const log = turnLog(0, 1, { users: [{ id: id + "-u", text: "要复制的会话" }] });
  await handle.append(log);
  await handle.close();
  return log.length;
}

async function idsInStore(row: MountedRow): Promise<string[]> {
  const rows = await asRdbStore(row.persistence).listRows({ limit: 10 });
  return rows.items.map((item) => item.sessionId).sort();
}

describe("SessionBranching 端口", () => {
  test("fork 换来子会话的 cwd、父会话不动；discard 把这次派生收干净", async () => {
    const row = await start();
    const branching = row.get(SessionBranching);
    const length = await seedSession(row, "copy-source");

    const fork = await branching.fork(SessionId("copy-source"), { cwd: "/target" });

    // 子会话：父引用指向源会话，cwd 换成目标目录（workspace 的 attach 校验的就是这一条）。
    const reader = await row.persistence.open(fork.sessionId, "read");
    expect(reader.header).toMatchObject({ cwd: "/target", parentSession: "copy-source" });
    const child = await reader.read();
    await reader.close();
    expect(child.events.map((event) => event.seq)).toEqual(
      Array.from({ length }, (_value, index) => index),
    );
    expect(await idsInStore(row)).toEqual(["copy-source", String(fork.sessionId)].sort());
    // 派生不是移动：源会话原样还在。
    expect((await asRdbStore(row.persistence).load("copy-source")).events).toHaveLength(length);

    // 补偿删除：库里只剩源会话（派生账目一起清，不走用户删除那条守卫）。
    await fork.discard();
    expect(await idsInStore(row)).toEqual(["copy-source"]);
  });

  test("源会话不存在：fork 抛域码 SESSION_NOT_FOUND（不静默造一条空会话）", async () => {
    const row = await start();
    const branching = row.get(SessionBranching);

    await expect(branching.fork(SessionId("absent"))).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
    expect(await idsInStore(row)).toEqual([]);
  });
});
