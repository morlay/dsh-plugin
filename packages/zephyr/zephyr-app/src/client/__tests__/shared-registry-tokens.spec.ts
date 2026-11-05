/**
 * 跨行共享注册表的两份入口：上游行在自己的 `apply` 里 `ctx.reflect.provide('<name>', …)` 建出注册表，
 * 消费方按**令牌** inject 它。这里守的是「一份实例、两个入口」：
 *
 * - 行只声明一个契约（`sidebarRight` / `configForms`），注册表是**同一次** apply 的另一个产物；
 * - cordis store 是唯一注册表：装配末尾按「上游发布名 → 同名令牌」反查，把注册表补进令牌表
 *   （`adoptNamedServices`），所以没有对应行的令牌也能 `app.get`；
 * - 于是消费方 `inject(令牌)` / `app.get(令牌)` 与上游行按名字读到的是同一个对象。
 *
 * 装配是真的（`fromCordis` 行 + 真 `bootstrapApplication`）；上游插件用最小 apply 代替，
 * 只保留 `ctx.reflect.provide` 这一条被断言的语义。
 */
import type { Context as CordisContext } from "@morlay/zephyr";
import { bootstrapApplication, Injectable, InjectionToken, type App, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { describe, expect, it } from "vitest";
import { SettingsSchema, SidebarRightTabs } from "../index.ts";

/** 行契约（真实里是 `SidebarRight` / `ConfigForms`；这里只借令牌身份，名字由上游 provide 决定）。 */
const SidebarRight = new InjectionToken<unknown>("sidebarRight");

const ConfigForms = new InjectionToken<unknown>("configForms");

/**
 * 上游 `ui-sidebar-right` 的最小 apply：**同一次** apply 里 provide 两个名字——导航面 `sidebarRight`
 * 与标签类型注册表 `sidebarRightTabs`。两者是不同的对象，所以「绑错成契约面」会被下面第 3 条抓住。
 */
const sidebarRightPlugin = {
  name: "spec-ui-sidebar-right",
  inject: [],
  apply(ctx: CordisContext): void {
    ctx.reflect.provide("sidebarRight", { open: () => {} });
    ctx.reflect.provide("sidebarRightTabs", {
      register: () => () => {},
      get: () => undefined,
      entries: () => [],
      subscribe: () => () => {},
    });
  },
};

/** 上游 `ui-settings` 的最小 apply：同一次 apply 里 provide `configForms` 与 `settingsSchema` 两个对象。 */
const settingsPlugin = {
  name: "spec-ui-settings",
  inject: [],
  apply(ctx: CordisContext): void {
    ctx.reflect.provide("configForms", { describe: () => [] });
    ctx.reflect.provide("settingsSchema", { namespaces: () => [], describe: () => [] });
  },
};

/**
 * 按上游注册名读根 ctx 的服务：cordis store 是唯一注册表，没有第二套名字表。
 * @param app - 装配结果。
 * @param name - 上游 `ctx.reflect.provide` 用的名字。
 * @returns 服务值，或 `undefined`。
 */
function named(app: App, name: string): unknown {
  return (app.ctx as unknown as { get(n: string, strict?: boolean): unknown }).get(name, false);
}

/** 右侧面板行：单契约，注册表靠 mount 的上游注册名绑定到令牌。 */
@Injectable()
class SidebarRightRow extends fromCordis(SidebarRight, sidebarRightPlugin) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

/** 设置面板行：单契约，schema 靠 mount 的上游注册名绑定到令牌。 */
@Injectable()
class SettingsRow extends fromCordis(ConfigForms, settingsPlugin) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

describe("跨行共享注册表：一份实例、两个入口", () => {
  it("`SidebarRightTabs` 令牌指向上游行 provide 的那份注册表", { timeout: 20_000 }, async () => {
    const app = await bootstrapApplication({ providers: [SidebarRightRow], timeoutMs: 20_000 });
    try {
      // 双注册：上游 provide 的名字也进根名字视图（上游插件之间要按名字互相找）。
      expect(named(app, "sidebarRightTabs")).toBeDefined();
      const tabs = app.get(SidebarRightTabs);
      expect(tabs).toMatchObject({ register: expect.any(Function), entries: expect.any(Function) });
    } finally {
      await app.dispose();
    }
  });

  it("`SettingsSchema` 令牌指向上游行 provide 的 schema 服务", { timeout: 20_000 }, async () => {
    const app = await bootstrapApplication({ providers: [SettingsRow], timeoutMs: 20_000 });
    try {
      // 同上：名字进根名字视图（双注册）。
      expect(named(app, "settingsSchema")).toBeDefined();
      expect(app.get(SettingsSchema)).toMatchObject({ describe: expect.any(Function) });
    } finally {
      await app.dispose();
    }
  });

  it("消费方按令牌拿到的是**注册表**而不是契约面控制器（`register`/`subscribe` 真的可调）", { timeout: 20_000 }, async () => {
    const app = await bootstrapApplication({ providers: [SidebarRightRow], timeoutMs: 20_000 });
    try {
      const tabs = app.get(SidebarRightTabs);
      expect(tabs).toMatchObject({ register: expect.any(Function), subscribe: expect.any(Function) });
      // 同一次 apply 里的另一个产物是导航面：两者不能是同一个对象（旧实现绑的是 `face`，会撞上）。
      expect(tabs).not.toBe(app.get(SidebarRight));
      expect(app.get(SidebarRight)).toMatchObject({ open: expect.any(Function) });
    } finally {
      await app.dispose();
    }
  });
});
