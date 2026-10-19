// @vitest-environment happy-dom
/**
 * 视图的闭环：注册到 `conversation.input.overlay`，并按 store 状态渲染。
 *
 * 只装配这一个模块 + 假端口 + 一个最小的 `Slots`/渲染宿主；不碰别的域。
 */
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { provideRenderer, Slots } from "@morlay/zephyr-app/client";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { CommandCatalog, CommandRunner } from "@morlay/dsh-command/endpoint";
import type { CommandEntry } from "@morlay/dsh-command/endpoint";
import { CommandPaletteStore } from "@morlay/dsh-command/ui";
import { CommandPaletteView } from "@morlay/dsh-command/ui";

const ENTRIES: readonly CommandEntry[] = [
  { name: "model", description: "切换模型" },
  { name: "compact", description: "压缩上下文" },
];

@Injectable()
class FakeCatalog extends CommandCatalog {
  async list(): Promise<readonly CommandEntry[]> {
    return ENTRIES;
  }
}

@Injectable()
class FakeRunner extends CommandRunner {
  async run(): Promise<void> {}
}

describe("命令弹层视图", () => {
  it("注册到 conversation.input.overlay，并按打开状态渲染条目", async () => {
    const app = await bootstrapApplication({
      // `Slots` 是视图注册的宿主面：装框架的渲染器模块（它是模块，不是 provider）。
      providers: [...provideRenderer(),
      FakeCatalog, FakeRunner, CommandPaletteStore, CommandPaletteView],
    });
    const slots = app.get(Slots);
    try {
      // 位置由父条目的 `children` 声明（生产里是 `ui-conversation`）；这里用一个最小的 root 条目声明它。
      // `registerDynamic` 是「key 只有运行时才知道」的正式入口（装配器场景），正好避开 SlotMap 的 key 收窄。
      slots.registerDynamic(
        {
          name: "root",
          children: { "conversation.input.overlay": { kind: "list", scope: "root" } },
        },
        () => null,
      );
      // `@SlotView` 的注册走 `slots.inject(name, …)`（等位置声明），给它一个微任务。
      await Promise.resolve();
      expect(
        slots.entries("conversation.input.overlay").length,
        "视图应注册到 conversation.input.overlay",
      ).toBe(1);

      const store = app.get(CommandPaletteStore);
      await act(async () => {
        await store.open("s1");
      });
      expect(store.stateOf("s1").open).toBe(true);
      expect(store.visibleOf(store.stateOf("s1")).map((entry) => entry.name)).toEqual([
        "model",
        "compact",
      ]);
    } finally {
      await app.dispose();
    }
  });
});
