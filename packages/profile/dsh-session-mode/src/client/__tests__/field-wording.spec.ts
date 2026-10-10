// 字段文案面的行为：client 半把这一行的字段文案注册到**提示面**（`ctx.schemaFormHints.describe`），
// 行式配置页据此画注释行；两份 policy 名单的候选值也走提示面（`select`，登记在数组项的路径上）。提示面缺席时
// （老组合）安静跳过，不影响会话面。

import { describe, expect, it } from "vitest";
import { apply, inject } from "../index.ts";
import { zh } from "../locales.ts";
import { POLICY_NAMES } from "@morlay/dsh-session-mode";

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

// 最小替身：记录提示面的注册事实。
function bench(options: { withHints?: boolean } = {}) {
  const described: Described[] = [];
  const selected: Selected[] = [];
  const dictionaries: string[] = [];
  const services: Record<string, unknown> = {};
  if (options.withHints !== false) {
    services["schemaFormHints"] = {
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
    };
  }
  const ctx = {
    get: (name: string) => services[name],
    effect: (effect: () => unknown) => effect(),
    // 会话里的模式 chip 挂在这些服务上：这里只需它们存在。
    // 与 cordis 一致：inject 的服务缺席时不执行工厂；在时把服务挂在 scope 上。
    inject: (names: string[], factory: (scope: unknown) => unknown) => {
      if (names.some((name) => services[name] === undefined)) return;
      factory({ ...ctx, ...services });
    },
    slots: { register: () => () => {} },
    locale: {
      bind: () => (key: keyof typeof zh) => zh[key],
      register: (ns: string) => {
        dictionaries.push(ns);
      },
    },
  };
  return { ctx, described, selected, dictionaries };
}

describe("会话模式 的字段文案", () => {
  it("只声明用到的服务", () => {
    expect(inject).toEqual(["slots", "locale"]);
  });

  it("注册字典与字段文案", () => {
    const b = bench();
    apply(b.ctx as never);

    expect(b.dictionaries).toEqual(["session-mode"]);
    expect(b.described.map((entry) => ({ ns: entry.ns, path: entry.path }))).toEqual([
      { ns: "session-mode", path: ["modes", "*", "defaultModel", "provider"] },
      { ns: "session-mode", path: ["modes", "*", "defaultModel", "model"] },
      { ns: "session-mode", path: ["modes", "*", "defaultModel", "reasoningEffort"] },
    ]);
  });

  it("每个字段的文案来自本包字典", () => {
    const b = bench();
    apply(b.ctx as never);

    expect(b.described.map((entry) => entry.read())).toEqual([
      { label: zh.provider, hint: zh.providerHint },
      { label: zh.model, hint: zh.modelHint },
      { label: zh.reasoningEffort, hint: zh.reasoningEffortHint },
    ]);
  });

  it("两份 policy 名单的候选就是封闭名单：登记在数组项那一路径上", () => {
    const b = bench();
    apply(b.ctx as never);

    // 名单是**字符串数组**，所以候选登记在数组项的路径（`…Policies.*`）上，页面把每一项画成选择器。
    expect(b.selected.map((entry) => ({ ns: entry.ns, path: entry.path }))).toEqual([
      { ns: "session-mode", path: ["modes", "*", "allowPolicies", "*"] },
      { ns: "session-mode", path: ["modes", "*", "denyPolicies", "*"] },
    ]);
    for (const entry of b.selected) {
      expect(entry.options().map((option) => option.value)).toEqual([...POLICY_NAMES]);
    }
  });

  it("没有提示面时安静跳过（老组合）", () => {
    const b = bench({ withHints: false });

    expect(() => {
      apply(b.ctx as never);
    }).not.toThrow();
    expect(b.described).toEqual([]);
    expect(b.selected).toEqual([]);
  });
});
