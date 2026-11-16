// 归档的写穿（L2：真装配 + 真库 + 真接口）：workspace 域的归档集合是**唯一**的真相，
// 它落 storage 域的 global，会话行的 `f_archived_at` 由 `syncSessionFlags` 跟着写。
//
// 判据落在会话行上：列表的归档过滤（`archived: only | unarchived`）与删除守卫读的都是会话行，
// 所以「归档集合里有它」必须等价于「行上有标记」——这是页面归档按钮与批量归档靠的那条链路。
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { meta, turnLog } from "@morlay/dsh-session/testing";
import type { WorkspaceDomainState } from "@morlay/dsh-workspace/contract";
import { asRdbStore } from "@morlay/better-session";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../../__tests__/support/host.ts";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
}

async function seed(harness: Harness, id: string): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id, "/work"));
  await handle.append(turnLog(0, 1));
  await handle.close();
}

describe("L2 归档写穿", () => {
  it("归档集合一写：行的归档标记、列表过滤与删除守卫同时生效", async () => {
    const harness = await start();
    await seed(harness, "arch-a");
    await seed(harness, "arch-b");
    const store = asRdbStore(harness.app.get(SessionPersistence));
    const repository = await store.storageRepository();

    // 只写 workspace 域的 global（没碰会话表）：写穿要把标记落到会话行上。
    const state = {
      initialized: true,
      workspaceIds: [],
      archivedSessionIds: ["arch-a"],
      pinnedSessionIds: [],
    } as unknown as WorkspaceDomainState;
    await repository.writeDomainGlobal("workspace", state);

    expect((await store.listRows({ archived: "only" })).items.map((row) => row.sessionId)).toEqual([
      "arch-a",
    ]);
    expect(
      (await store.listRows({ archived: "unarchived" })).items.map((row) => row.sessionId),
    ).toEqual(["arch-b"]);
    expect([...(await store.archivedSessionIds())]).toEqual(["arch-a"]);

    // 删除守卫读的是同一份标记：未归档的拒绝（带码），已归档的放行。
    await expect(store.deleteSession("arch-b")).rejects.toMatchObject({
      code: "SESSION_NOT_ARCHIVED",
    });
    await store.deleteSession("arch-a");
    expect(await store.headerOf("arch-a")).toBeUndefined();
  });
});
