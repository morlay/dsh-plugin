// 终端恢复兜底：宿主已经不认的终端 id（`closedIds` / 重启后消失）不能再拿来 `retain` —— 而侧栏布局与
// 客户端 `bindings` 会一直把它带回来，`TerminalView` 的 `createWhenMissing` 因此恒为 false，面板永远停在
// "此终端已不存在，请新建终端"。这里守的是"对账"这一步：清单里没有这个 id 就当新 tab（删 binding、丢掉
// 旧视图），让上游按其本意分配一个新终端；清单里有则原样透传（恢复能力不变）。
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { apply } from "../index.ts";

interface Fake {
  readonly service: unknown;
  readonly bindings: Map<string, string>;
  readonly views: Map<string, Map<string, unknown>>;
}

/** 上游 `ClientTerminals` 的最小替身：`view` 在**原型**上（我们的兜底改的就是原型）。 */
function fakeTerminals(alive: boolean): Fake {
  const bindings = new Map<string, string>([["s|content", "terminal-1"]]);
  const inventories = new Map([["s", { items: new Map(alive ? [["terminal-1", {}]] : []) }]]);
  const views = new Map([["s", new Map<string, unknown>([["key", {}]])]]);
  class Terminals {
    readonly bindings = {
      get: (sessionId: string, contentId: string): string | undefined =>
        bindings.get(`${sessionId}|${contentId}`),
      delete: (sessionId: string, contentId: string): void => {
        bindings.delete(`${sessionId}|${contentId}`);
      },
    };
    readonly inventories = inventories;
    readonly views = views;
    view(...args: unknown[]): unknown {
      return args;
    }
  }
  return { service: new Terminals(), bindings, views };
}

async function loaded(fake: Fake): Promise<{ view: (...args: unknown[]) => unknown }> {
  const ctx = new Context();
  ctx.provide("webTerminals", fake.service as never);
  await ctx.plugin({ apply });
  return {
    view: (...args: unknown[]) =>
      (fake.service as { view: (...a: unknown[]) => unknown }).view(...args),
  };
}

describe("终端恢复兜底", () => {
  it("宿主已经不认这个 id 时：当新 tab——删 binding、丢掉旧视图、不把 id 传下去", async () => {
    const fake = fakeTerminals(false);
    const { view } = await loaded(fake);
    const args = view("s", "key", "content", undefined, undefined);
    expect(fake.bindings.has("s|content")).toBe(false);
    expect(fake.views.get("s")?.has("key")).toBe(false);
    expect(args).toEqual(["s", "key", "content", undefined, undefined]);
  });

  it("清单里还在时：原样透传（恢复能力不变）", async () => {
    const fake = fakeTerminals(true);
    const { view } = await loaded(fake);
    const args = view("s", "key", "content", undefined, undefined);
    expect(fake.bindings.has("s|content")).toBe(true);
    expect(fake.views.get("s")?.has("key")).toBe(true);
    expect(args).toEqual(["s", "key", "content", undefined, undefined]);
  });
});
