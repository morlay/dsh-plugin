// @vitest-environment happy-dom
/**
 * `Slots` 契约面覆盖：九个成员都要能用（不是"存在"，是"可调用"）。
 *
 * 这条用例的存在理由：`installLocale is not a function` 曾经一路漏到运行时——契约面成员从没被断言过。
 */
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { SlotsDefault } from "../slots.service.ts";
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
    expect(slots.entries).toBeDefined();
    for (const key of ["inject", "install", "installLocale", "installScope", "provideRoot", "register", "registerFactory", "subscribe"] as const) {
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
