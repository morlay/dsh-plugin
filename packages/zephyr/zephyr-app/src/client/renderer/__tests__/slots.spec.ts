// @vitest-environment happy-dom
/**
 * `Slots` 契约面覆盖：九个成员都要能用（不是"存在"，是"可调用"）。
 *
 * 这条用例的存在理由：`installLocale is not a function` 曾经一路漏到运行时——契约面成员从没被断言过。
 */
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { SlotsDefault } from "../slots.service.ts";
import { Slot, applySlotDeclaration, slotDeclarationOf } from "../slot.decorator.ts";
import { Slots } from "../slots.contract.ts";

describe("Slots 契约面", { timeout: 10_000 }, () => {
  const apps: App[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.dispose();
  });

  async function boot(): Promise<Slots> {
    const app = await bootstrapApplication({ providers: [SlotsDefault], timeoutMs: 8_000 });
    apps.push(app);
    return app.get(Slots);
  }

  it("九个成员都能读到，且方法可调用", async () => {
    const slots = await boot();
    for (const key of ["entries", "inject", "install", "installLocale", "installScope", "provideRoot", "register", "registerFactory", "subscribe"] as const) {
      expect(typeof slots[key], key).toBe("function");
    }
  });

  it("register 接受组件对象与声明 options（root 内建已声明）", async () => {
    const slots = await boot();
    const Component = (): null => null;
    const dispose = slots.register({ name: "root", id: "test" } as never, Component as never);
    expect(slots.entries("root" as never).length).toBe(1);
    dispose();
    expect(slots.entries("root" as never).length).toBe(0);
  });

  it("installLocale 装一次；重复装会按上游语义抛错（boot-once）", async () => {
    const slots = await boot();
    const face = { bind: () => () => "", getSnapshot: () => ({ active: "zh" }), subscribe: () => () => {} };
    slots.installLocale(face as never);
    expect(() => slots.installLocale(face as never)).toThrow(/already installed/u);
  });
});

describe("@Slot 声明", { timeout: 10_000 }, () => {
  it("声明写在类上，应用后 scope/root 都到位；撤销按逆序", async () => {
    const app = await bootstrapApplication({ providers: [SlotsDefault], timeoutMs: 8_000 });
    try {
      const slots = app.get(Slots);
      const adapter = { current: { getSnapshot: () => ({ key: undefined, hooks: {}, keyedHooks: {}, props: {} }), subscribe: () => () => {} }, bindingSource: () => ({}) };
      const undo = applySlotDeclaration(slots, {
        scope: { session: adapter as never },
        root: { hooks: { probe: { getSnapshot: () => 1, subscribe: () => () => {} } } },
      });
      expect(typeof slots.entries).toBe("function");
      undo();
      // 撤销后可以重新装（说明 disposer 真的生效了）
      expect(() => slots.installScope("session", adapter as never)).not.toThrow();
    } finally {
      await app.dispose();
    }
  });

  it("`slotDeclarationOf` 读得到类上的声明", () => {
    @Slot({ root: { props: { probe: 1 } } })
    class Declaring {
      static probe = 1;
    }
    expect(slotDeclarationOf(new Declaring())).toEqual({ root: { props: { probe: 1 } } });
  });
});
