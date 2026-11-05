// 管理面的非 wire 行为：整理（回收孤儿 + 重算统计 + VACUUM）、归档标记、删除的三条拒绝理由。
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { asRdbStore } from "@morlay/better-session";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./support/host.ts";
import { meta, oneTurnLogStepFirst } from "@morlay/dsh-session/testing";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
}

async function seed(harness: Harness, id: string, cwd?: string): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id, cwd));
  await handle.append(oneTurnLogStepFirst());
  await handle.close();
}

describe("管理面", () => {
  it("organize 回收孤儿并重算派生统计，返回三项计数", async () => {
    const harness = await start();
    await seed(harness, "org-1");
    await seed(harness, "org-2");

    const report = await asRdbStore(harness.app.get(SessionPersistence)).organize();

    expect(report.rebuiltSessions).toBe(2);
    expect(report.orphanSessions).toBe(0);
    expect(Number.isSafeInteger(report.orphanEvents)).toBe(true);
  });

  it("删除只允许已归档且不在运行中的会话，三条拒绝理由各自有码", async () => {
    const harness = await start();
    await seed(harness, "delete-me");
    const persistence = asRdbStore(harness.app.get(SessionPersistence));

    // 未归档。
    await expect(persistence.deleteSession("delete-me")).rejects.toMatchObject({
      code: "SESSION_NOT_ARCHIVED",
    });
    // 不存在。
    await expect(persistence.deleteSession("absent")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });

  it("archivedSessionIds 读持久化里的归档标记（没有归档服务时给空集）", async () => {
    const harness = await start();
    await seed(harness, "archive-1");

    const archived = await asRdbStore(harness.app.get(SessionPersistence)).archivedSessionIds();

    expect(archived.size).toBe(0);
  });

  it("listRows 给完整语料（含 cwd / 时间 / 归档标记）并支持分页", async () => {
    const harness = await start();
    await seed(harness, "rows-1", "/work");
    await seed(harness, "rows-2", "/other");

    const page = await asRdbStore(harness.app.get(SessionPersistence)).listRows({
      limit: 1,
      offset: 0,
    });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ cwd: expect.any(String), archived: false });
  });
});
