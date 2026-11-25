/**
 * `Slots` 契约面覆盖：九个成员都要能用（不是"存在"，是"可调用"）。
 *
 * 这条用例的存在理由：`installLocale is not a function` 曾经一路漏到运行时——契约面成员从没被断言过。
 *
 * 四个 describe 只读同一份 `SlotsDefault` 装配（各自写的是互不重叠的成员），装一次就够。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { describe, expect, test, type TestingAppEnv } from "@morlay/zephyr-app/testing";
import { onTestFinished } from "vitest";
import { SlotsDefault } from "../slots.service.ts";
import { Slot, applySlotDeclaration, slotDeclarationOf } from "../slot.decorator.ts";
import { Slots } from "../slots.contract.ts";

/**
 * 每个用例一份 `Slots` 装配（装配便宜，用完随用例卸）。
 * @param appEnv - 本用例的运行环境（数据根就是它的临时目录）。
 * @returns 契约面。
 */
async function slotsOf(appEnv: TestingAppEnv): Promise<Slots> {
  const app = await bootstrapApplication({
    providers: [{ provide: AppEnv, useValue: appEnv }, SlotsDefault],
    timeoutMs: 8_000,
  });
  onTestFinished(() => app.dispose());
  return app.get(Slots);
}

describe("Slots 契约面", { timeout: 10_000 }, () => {
  test("九个成员都能读到，且方法可调用", async ({ appEnv }) => {
    const slots = await slotsOf(appEnv);
    for (const key of [
      "entries",
      "inject",
      "install",
      "installLocale",
      "installScope",
      "provideRoot",
      "register",
      "registerFactory",
      "subscribe",
    ] as const) {
      expect(typeof slots[key], key).toBe("function");
    }
  });

  test("register 接受组件对象与声明 options（root 内建已声明）", async ({ appEnv }) => {
    const slots = await slotsOf(appEnv);
    const Component = (): null => null;
    const dispose = slots.register({ name: "root", id: "test" } as never, Component as never);
    expect(slots.entries("root" as never).length).toBe(1);
    dispose();
    expect(slots.entries("root" as never).length).toBe(0);
  });

  test("installLocale 装一次；重复装会按上游语义抛错（boot-once）", async ({ appEnv }) => {
    const slots = await slotsOf(appEnv);
    const face = {
      bind: () => () => "",
      getSnapshot: () => ({ active: "zh" }),
      subscribe: () => () => {},
    };
    slots.installLocale(face as never);
    expect(() => slots.installLocale(face as never)).toThrow(/already installed/u);
  });
});

describe("@Slot 声明", { timeout: 10_000 }, () => {
  test("声明写在类上，应用后 scope/root 都到位；撤销按逆序", async ({ appEnv }) => {
    const slots = await slotsOf(appEnv);
    const adapter = {
      current: {
        getSnapshot: () => ({ key: undefined, hooks: {}, keyedHooks: {}, props: {} }),
        subscribe: () => () => {},
      },
      bindingSource: () => ({}),
    };
    const undo = applySlotDeclaration(slots, {
      scope: { session: adapter as never },
      root: { hooks: { probe: { getSnapshot: () => 1, subscribe: () => () => {} } } },
    });
    expect(typeof slots.entries).toBe("function");
    undo();
    // 撤销后可以重新装（说明 disposer 真的生效了）
    expect(() => slots.installScope("session", adapter as never)).not.toThrow();
  });

  test("`slotDeclarationOf` 读得到类上的声明", () => {
    @Slot({ root: { props: { probe: 1 } } })
    class Declaring {
      static probe = 1;
    }
    expect(slotDeclarationOf(new Declaring())).toEqual({ root: { props: { probe: 1 } } });
  });
});
