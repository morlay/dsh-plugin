import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { CommandCatalog, CommandRunner } from "@morlay/dsh-command/endpoint";
import type { CommandEntry } from "@morlay/dsh-command/endpoint";
import { CommandPaletteStore } from "@morlay/dsh-command/ui";

const ENTRIES: readonly CommandEntry[] = [
  { name: "model", description: "切换模型" },
  { name: "compact", description: "压缩上下文" },
  { name: "help", description: "帮助" },
];

/** 假目录：固定三条命令。 */
@Injectable()
class FakeCatalog extends CommandCatalog {
  async list(): Promise<readonly CommandEntry[]> {
    return ENTRIES;
  }
}

/** 假执行器：记录被执行的命令。 */
@Injectable()
class FakeRunner extends CommandRunner {
  readonly ran: string[] = [];

  async run(_sessionId: SessionId, name: string): Promise<void> {
    this.ran.push(name);
  }
}

/**
 * 局部闭环：只装配这个模块 + 两个假端口，不碰任何别的域、不需要起全局服务。
 * @returns store 实例与假执行器。
 */
async function storeOf(): Promise<{
  store: CommandPaletteStore;
  runner: FakeRunner;
  dispose: () => Promise<void>;
}> {
  const app = await bootstrapApplication({
    providers: [FakeCatalog, FakeRunner, CommandPaletteStore],
  });
  return { store: app.get(CommandPaletteStore), runner: app.get(FakeRunner), dispose: () => app.dispose() };
}

describe("命令弹层 store", () => {
  it("打开后拿到目录，默认全可见、选中第一个", async () => {
    const { store, dispose } = await storeOf();
    try {
      await store.open("s1");
      const state = store.stateOf("s1");
      expect(state.open).toBe(true);
      expect(state.entries).toHaveLength(3);
      expect(store.visibleOf(state).map((entry) => entry.name)).toEqual(["model", "compact", "help"]);
      expect(state.selected).toBe(0);
    } finally {
      await dispose();
    }
  });

  it("按名字或说明过滤，过滤后选中项归零", async () => {
    const { store, dispose } = await storeOf();
    try {
      await store.open("s1");
      store.move("s1", 2);
      expect(store.stateOf("s1").selected).toBe(2);
      store.setQuery("s1", "模型");
      const state = store.stateOf("s1");
      expect(store.visibleOf(state).map((entry) => entry.name)).toEqual(["model"]);
      expect(state.selected).toBe(0);
    } finally {
      await dispose();
    }
  });

  it("选中项在可见列表里循环移动", async () => {
    const { store, dispose } = await storeOf();
    try {
      await store.open("s1");
      store.move("s1", -1);
      expect(store.stateOf("s1").selected).toBe(2);
      store.move("s1", 1);
      expect(store.stateOf("s1").selected).toBe(0);
    } finally {
      await dispose();
    }
  });

  it("执行选中项：交给 runner，并关闭弹层", async () => {
    const { store, runner, dispose } = await storeOf();
    try {
      await store.open("s1");
      store.setQuery("s1", "compact");
      await store.run("s1");
      expect(runner.ran).toEqual(["compact"]);
      expect(store.stateOf("s1").open).toBe(false);
    } finally {
      await dispose();
    }
  });

  it("没有可见项时执行只是关闭，不调 runner", async () => {
    const { store, runner, dispose } = await storeOf();
    try {
      await store.open("s1");
      store.setQuery("s1", "不存在的命令");
      await store.run("s1");
      expect(runner.ran).toEqual([]);
      expect(store.stateOf("s1").open).toBe(false);
    } finally {
      await dispose();
    }
  });

  it("订阅者在每次状态变化时被通知", async () => {
    const { store, dispose } = await storeOf();
    try {
      let notified = 0;
      const stop = store.subscribe(() => {
        notified += 1;
      });
      await store.open("s1");
      store.setQuery("s1", "m");
      store.close("s1");
      stop();
      store.close("s1");
      expect(notified).toBe(3);
    } finally {
      await dispose();
    }
  });
});
