// client 半只有一个职责：把上游 `modules` 服务补上。判据是"上游真正用到的那两个成员形状对"——
// 上游 `ui-settings-general` 把 `entries.releaseChange` 当 `useSyncExternalStore` 的快照读、
// 用 `entries.dismissRelease()` 关掉提示，动态插件运行器用 `invalidate()` 做模块失效。
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { apply } from "../index.ts";

interface ModulesService {
  readonly entries: {
    readonly releaseChange: {
      getSnapshot: () => unknown;
      subscribe: (listener: () => void) => () => void;
    };
    readonly dismissRelease: () => void;
  };
  readonly invalidate: (id: string) => void;
}

async function modulesOf(): Promise<ModulesService> {
  const ctx = new Context();
  await ctx.plugin({ apply });
  return ctx.get("modules") as unknown as ModulesService;
}

describe("client 半的 modules 服务面", () => {
  it("releaseChange 是恒 undefined 的可订阅快照（我们这条链没有跨 Host 版本的插件更新）", async () => {
    const modules = await modulesOf();
    expect(modules.entries.releaseChange.getSnapshot()).toBeUndefined();
    const unsubscribe = modules.entries.releaseChange.subscribe(() => {});
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("dismissRelease 与 invalidate 可调用（提示已读与模块失效在本链上都是空操作）", async () => {
    const modules = await modulesOf();
    expect(() => {
      modules.entries.dismissRelease();
    }).not.toThrow();
    expect(() => {
      modules.invalidate("plugin-x");
    }).not.toThrow();
  });
});
