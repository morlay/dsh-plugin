// 落盘契约：上游 `SessionPersistence` 的那 20 条语义（handle 模型、所有权、flush 屏障、revision、撕裂尾部）。
//
// 源包用这份契约测试守它自己的后端；本包把它接到 RDB 实现上，判据因此与上游同口径。
import { SessionId } from "@morlay/dsh-session/contract";
import { asRdbStore } from "@morlay/better-session";
import {
  runPersistenceContract,
  type ContractBackend,
  type ContractBackendInstance,
} from "@morlay/dsh-session-persistence/testing";
import { afterEach } from "vitest";
import { makeRoot, removeRoot, startAt, type Instance } from "./support/host.ts";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await removeRoot(root);
});

// 一份后端：`reopen` 在同一数据根上起新实例（新连接 + 新进程内状态）。
async function makeBackend(): Promise<ContractBackend> {
  const root = await makeRoot();
  roots.push(root);
  const instance: Instance = await startAt(root);
  const opened: Instance[] = [instance];
  return {
    persistence: instance.persistence,
    async dispose(): Promise<void> {
      for (const item of opened.splice(0)) await item.dispose();
    },
    async reopen(): Promise<ContractBackendInstance> {
      const next = await startAt(root);
      opened.push(next);
      return {
        persistence: next.persistence,
        dispose: () => next.dispose(),
      };
    },
  };
}

runPersistenceContract("RDB（SQLite）", makeBackend);

// 契约测试没覆盖的那一条：`load` 之外的读取入口在同一份存储上给同一份日志。
import { describe, expect, it } from "vitest";
import { oneTurnLogStepFirst } from "@morlay/dsh-session/testing";

describe("RDB 落盘的补充判据", () => {
  it("readFrom 从指定 seq 起读，读视图与整段读一致", async () => {
    const root = await makeRoot();
    roots.push(root);
    const instance = await startAt(root);
    try {
      const header = {
        version: 4 as const,
        id: SessionId("read-from"),
        createdAt: 1000,
        isSeeded: false,
      };
      const handle = await instance.persistence.create(header);
      await handle.append(oneTurnLogStepFirst());
      await handle.close();

      const partial = await asRdbStore(instance.persistence).readFrom("read-from", 3);

      expect(partial.events.map((event) => event.seq)).toEqual([3, 4, 5]);
    } finally {
      await instance.dispose();
    }
  });
});
