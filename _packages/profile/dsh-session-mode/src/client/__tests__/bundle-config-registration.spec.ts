// bundle 配置页的注册面：client 半把这一页注册到 `plugins.bundle.config`，key 是 **bundle 包名**（页面按它取注册项），
// 字典走自己的命名空间 `session-mode-bundle`；读写的命名空间仍是本行的 `session-mode`。
//
// 装配走 client 同一条 `toCordis` 路径：真实 Context 上提供替身服务，`ctx.plugin(defaultExport)` 挂载 Provider；
// `slots.inject` 的替身按声明在场与否决定是否执行回调（真实服务也是等声明）。

import { Context, type Fiber } from "@deepseek-ai/cordis";
import { readFile } from "node:fs/promises";
import z from "@deepseek-ai/schemastery";
import { afterEach, describe, expect, it } from "vitest";
import { BUNDLE_CONFIG_KEY, PROTECTED_MODE_IDS } from "../bundle-config.ts";
import { BUNDLE_NS } from "../bundle-locales.ts";
import entry from "../index.ts";

interface Registered {
  name: string;
  key?: string;
  locale?: string;
  inject?: () => { hooks: { bundleConfig: { getSnapshot: () => unknown } } };
}

const fibers: Fiber[] = [];

afterEach(async () => {
  for (const fiber of fibers.splice(0).reverse()) await fiber.dispose();
});

// 最小替身：记录槽位注册与字典注册，并给出配置表单 / schema 服务（控制器构造要用）。
async function bench() {
  const registrations: Registered[] = [];
  const injected: string[] = [];
  const dictionaries: string[] = [];
  const form = {
    getSnapshot: () => ({
      status: "ready",
      value: { default: "coding", modes: {} },
      base: {},
      user: undefined,
      writable: true,
      revision: 1,
      mode: "host",
    }),
    subscribe: () => () => {},
    mutate: () => Promise.resolve(true),
    set: () => Promise.resolve(true),
    unset: () => Promise.resolve(true),
  };
  const ctx = new Context();
  ctx.reflect.provide("configForms", {
    get: () => form,
    describe: () => ({
      getSnapshot: () => ({
        status: "ready",
        view: { namespaces: [], writable: true, hasDocument: false },
        error: null,
      }),
      subscribe: () => () => {},
      ensure: () => Promise.resolve(),
      acceptView: () => {},
    }),
  });
  ctx.reflect.provide("settingsSchema", {
    rehydrate: (serialized: unknown) => new z(serialized as never),
  });
  // `plugins.bundle.config` 由上游工厂声明；`conversation.input.left` 在别的装配里才有声明——这里只验本页，
  // 所以只把前者算作已声明（`slots.inject` 的替身与真实服务一样等声明）。
  const declared = new Set(["plugins.bundle.config"]);
  ctx.reflect.provide("slots", {
    register: (options: Registered) => {
      registrations.push(options);
      return () => {};
    },
    inject: (name: string, factory: () => unknown) => {
      if (!declared.has(name)) return () => {};
      injected.push(name);
      factory();
      return () => {};
    },
  });
  ctx.reflect.provide("locale", {
    bind: () => (key: string) => key,
    register: (ns: string) => {
      dictionaries.push(ns);
      return () => {};
    },
  });
  const fiber = ctx.plugin(entry);
  fibers.push(fiber);
  await fiber;
  return { registrations, injected, dictionaries };
}

describe("bundle 配置页的注册", () => {
  it("注册进 `plugins.bundle.config`：key 就是 bundle 的包名，字典用自己的命名空间", async () => {
    const b = await bench();

    expect(b.injected).toEqual(["plugins.bundle.config"]);
    expect(b.registrations).toHaveLength(1);
    const registration = b.registrations[0];
    expect(registration?.name).toBe("plugins.bundle.config");
    expect(registration?.key).toBe(BUNDLE_CONFIG_KEY);
    expect(registration?.locale).toBe(BUNDLE_NS);
    // 注入面给出读数（框架据此绑 `useBundleConfig`）与动作：页面靠它读草稿、写草稿、保存。
    expect(typeof registration?.inject?.().hooks.bundleConfig.getSnapshot).toBe("function");
  });

  it("两个字典都在：会话那半的 `session-mode` 与本页的 `session-mode-bundle`", async () => {
    const b = await bench();

    expect(b.dictionaries).toEqual(["session-mode", BUNDLE_NS]);
  });

  it("注册 key 与 bundle 清单里的包名同源：改名时这里会先红", async () => {
    const manifest = JSON.parse(
      await readFile(
        new URL("../../../../../bundles/session-mode-profile/package.json", import.meta.url),
        "utf8",
      ),
    ) as { name: string };

    expect(BUNDLE_CONFIG_KEY).toBe(manifest.name);
  });

  it("`noop` 在保护名单里：页面不提供删除（它是「与上游一致」那一档）", () => {
    expect(PROTECTED_MODE_IDS).toEqual(["noop"]);
  });
});
