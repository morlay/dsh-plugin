// 字段文案面的行为：client 半把这一行的字段文案注册到**提示面**（`ctx.schemaFormHints.describe`），
// 行式配置页据此画注释行；两份 policy 名单的候选值也走提示面（`select`，登记在数组项的路径上）。提示面缺席时
// （老组合）安静跳过，不影响会话面。
//
// 装配走 client 同一条 `toCordis` 路径：真实 Context 上提供替身服务，`ctx.plugin(defaultExport)` 挂载 Provider。

import { Context, type Fiber } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it } from "vitest";
import { POLICY_NAMES } from "../../index.ts";
import entry from "../index.ts";
import { zh } from "../locales.ts";

interface Described {
  ns: string;
  path: readonly string[];
  read: () => { label?: string | undefined; hint?: string | undefined };
}

interface Selected {
  ns: string;
  path: readonly string[];
  options: () => readonly { value: unknown }[];
}

const fibers: Fiber[] = [];

afterEach(async () => {
  for (const fiber of fibers.splice(0).reverse()) await fiber.dispose();
});

// 最小替身：记录提示面的注册事实；`slots` 是必填依赖，chip 注册在这里只需有个落点。
async function bench(options: { withHints?: boolean } = {}) {
  const described: Described[] = [];
  const selected: Selected[] = [];
  const dictionaries: string[] = [];
  const ctx = new Context();
  ctx.reflect.provide("locale", {
    bind: () => (key: keyof typeof zh) => zh[key],
    register: (ns: string) => {
      dictionaries.push(ns);
      return () => {};
    },
  });
  ctx.reflect.provide("slots", {
    inject: (_name: string, factory: () => unknown) => {
      factory();
      return () => {};
    },
    register: () => () => {},
  });
  if (options.withHints !== false) {
    ctx.reflect.provide("schemaFormHints", {
      describe: (
        ns: string,
        path: readonly string[],
        read: () => { label?: string; hint?: string },
      ) => {
        described.push({ ns, path, read });
        return () => {};
      },
      select: (ns: string, path: readonly string[], spec: Selected) => {
        selected.push({ ns, path, options: spec.options });
        return () => {};
      },
      // 本包订阅提示面的变化（候选晚到时重投影一次）：替身给一个空订阅。
      subscribe: () => () => {},
    });
  }
  const fiber = ctx.plugin(entry);
  fibers.push(fiber);
  await fiber;
  return { ctx, described, selected, dictionaries };
}

describe("会话模式 的字段文案", () => {
  it("注册字典与字段文案", async () => {
    const b = await bench();

    expect(b.dictionaries).toEqual(["session-mode"]);
    expect(b.described.map((entry) => ({ ns: entry.ns, path: entry.path }))).toEqual([
      { ns: "session-mode", path: ["modes", "*", "defaultModel", "provider"] },
      { ns: "session-mode", path: ["modes", "*", "defaultModel", "model"] },
      { ns: "session-mode", path: ["modes", "*", "defaultModel", "reasoningEffort"] },
    ]);
  });

  it("每个字段的文案来自本包字典", async () => {
    const b = await bench();

    expect(b.described.map((entry) => entry.read())).toEqual([
      { label: zh.provider, hint: zh.providerHint },
      { label: zh.model, hint: zh.modelHint },
      { label: zh.reasoningEffort, hint: zh.reasoningEffortHint },
    ]);
  });

  it("两份 policy 名单的候选就是封闭名单：登记在数组项那一路径上", async () => {
    const b = await bench();

    // 名单是**字符串数组**，所以候选登记在数组项的路径（`…Policies.*`）上，页面把每一项画成选择器。
    expect(b.selected.map((entry) => ({ ns: entry.ns, path: entry.path }))).toEqual([
      { ns: "session-mode", path: ["modes", "*", "allowPolicies", "*"] },
      { ns: "session-mode", path: ["modes", "*", "denyPolicies", "*"] },
    ]);
    for (const entry of b.selected) {
      expect(entry.options().map((option) => option.value)).toEqual([...POLICY_NAMES]);
    }
  });

  it("没有提示面时安静跳过（老组合）", async () => {
    const b = await bench({ withHints: false });

    expect(b.described).toEqual([]);
    expect(b.selected).toEqual([]);
  });
});
