// 并发写：同一份存储上两个实例写同一会话必须 fail-loud（写者位点守卫），不是静默丢事件。
//
// 位点守卫的口径是「open 之后有人动过这条会话」：open 时记下磁盘 head，append 时再比一次。
//
// 为什么留在根 `__tests__/`：判据是两个实例在同一份库上争写（多实例接缝）；单实例的守卫在 `data/__tests__/write-guard.spec.ts`。
import { SessionId } from "@morlay/dsh-session/contract";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished } from "vitest";
import { makeRoot, removeRoot, startAt, type Instance } from "./support/host.ts";
import { meta, oneTurnLogStepFirst, turnLog } from "@morlay/dsh-session/testing";

async function twoInstances(): Promise<{ first: Instance; second: Instance }> {
  const root = await makeRoot();
  onTestFinished(() => removeRoot(root));
  const first = await startAt(root);
  const second = await startAt(root);
  return { first, second };
}

// 第二个回合的事件（seq 从 6 起）。
function secondTurn(): ReturnType<typeof turnLog> {
  return turnLog(6, 2);
}

describe("并发写", () => {
  test("两个实例都 open 了写句柄，先写的那个提交之后，后写的被写者位点守卫拒绝", async () => {
    const { first, second } = await twoInstances();
    try {
      const seed = await first.persistence.create(meta("shared", "/work"));
      await seed.append(oneTurnLogStepFirst());
      await seed.close();

      // 两个实例都先 open（各自记下当时的 head = 5）。
      const a = await first.persistence.open(SessionId("shared"), "write");
      const b = await second.persistence.open(SessionId("shared"), "write");

      await a.append(secondTurn());

      // b 的基准位点已经过期（open 时记的是 5，库里现在是 11）：写入必须被拒，而不是覆盖。
      await expect(b.append(secondTurn())).rejects.toThrow(/modified by another writer/);
      await a.close();
      await b.close().catch(() => undefined);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  test("第二个实例在 open 之后写：位点对齐，写入成功", async () => {
    const { first, second } = await twoInstances();
    try {
      const writer = await first.persistence.create(meta("aligned", "/work"));
      await writer.append(oneTurnLogStepFirst());
      await writer.close();

      // open 读一遍日志、记下 head（= 5），之后没有别人动过 → 写入通过。
      const handle = await second.persistence.open(SessionId("aligned"), "write");
      await handle.append(secondTurn());
      await handle.close();

      const after = await second.persistence.open(SessionId("aligned"), "read");
      const events = (await after.read()).events;
      await after.close();
      expect(events).toHaveLength(12);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  test("另一个实例提交之后，rewind 被写者位点守卫拒绝（不是静默截掉那段）", async () => {
    const { first, second } = await twoInstances();
    try {
      const seed = await first.persistence.create(meta("rewound", "/work"));
      await seed.append(oneTurnLogStepFirst());
      await seed.close();

      // second 打开写句柄（认领 head = 5），之后 first 又提交了一轮（head 变 11）。
      const reader = await second.persistence.open(SessionId("rewound"), "write");
      await reader.close();
      const writer = await first.persistence.open(SessionId("rewound"), "write");
      await writer.append(secondTurn());
      await writer.close();

      // second 仍按 seq 5 撤回：它的位点已经过期，必须拒绝，而不是把 first 的事件当尾部删掉。
      await expect(second.branch.rewind(SessionId("rewound"), 5)).rejects.toThrow(
        /another writer/u,
      );

      const after = await first.persistence.open(SessionId("rewound"), "read");
      const events = (await after.read()).events;
      await after.close();
      expect(events).toHaveLength(12);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  test("同一实例内的写所有权是单持有者：重复 open write 被拒", async () => {
    const { first } = await twoInstances();
    try {
      const writer = await first.persistence.create(meta("owner"));
      await expect(first.persistence.open(SessionId("owner"), "write")).rejects.toThrow();
      await writer.close();
    } finally {
      await first.dispose();
    }
  });

  test("创建了两个句柄写不同会话：互不影响", async () => {
    const { first, second } = await twoInstances();
    try {
      const a = await first.persistence.create(meta("iso-a", "/a"));
      const b = await second.persistence.create(meta("iso-b", "/b"));
      await a.append(oneTurnLogStepFirst());
      await b.append(oneTurnLogStepFirst());
      await a.close();
      await b.close();

      expect((await first.persistence.stat(SessionId("iso-a")))?.header.id).toBe("iso-a");
      expect((await second.persistence.stat(SessionId("iso-b")))?.header.id).toBe("iso-b");
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});
