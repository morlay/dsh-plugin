/**
 * 「选模型」的候选：本行的 schema 里没有 provider / 模型清单，它们来自部署里的 LLM 目录。
 *
 * 盯的接缝是**目录 → 候选**：provider 候选是目录（活着的路由 + 可配置声明）合并后的清单；模型清单读那份声明指向的
 * 配置（`settingsNs` / `settingsPath`），并跟着 provider 字段的当前值变。
 */

import { describe, expect, it } from "vitest";
import type { SelectOption, SelectSpec } from "@morlay/dsh-client-ui-schema-form/client";
import { apply } from "../client/index.ts";

interface Registered {
  path: readonly string[];
  spec: SelectSpec;
}

/** 一套最小的 client 面：提示面记账、LLM 目录与配置读数是替身。 */
function bench() {
  const selects: Registered[] = [];
  let refreshes = 0;
  const services: Record<string, unknown> = {
    schemaFormHints: {
      describe: () => () => {},
      select: (_ns: string, path: readonly string[], spec: SelectSpec) => {
        selects.push({ path, spec });
        return () => {};
      },
      suggestKeys: () => () => {},
      refresh: () => {
        refreshes += 1;
      },
    },
    remote: {
      llm: {
        listProviders: () =>
          Promise.resolve({ ok: true, value: [{ id: "openai", name: "OpenAI" }] }),
        listConfigurableProviders: () =>
          Promise.resolve({
            ok: true,
            value: [
              {
                provider: "mine",
                displayName: "自建",
                settingsNs: "llm-openai-compatible",
                settingsPath: ["providers", "mine"],
              },
            ],
          }),
      },
      $on: () => () => {},
    },
    configForms: {
      get: () => ({
        getSnapshot: () => ({
          value: { providers: { mine: { models: [{ id: "m1" }, { id: "m2" }] } } },
        }),
        subscribe: () => () => {},
      }),
    },
  };
  const ctx = {
    get: (name: string) => services[name],
    effect: (effect: () => unknown) => effect(),
    inject: (_services: string[], factory: (scope: unknown) => unknown) => factory(ctx),
    slots: { register: () => () => {} },
    locale: { bind: () => (key: string) => key, register: () => {} },
  };
  return { ctx, selects, refreshes: () => refreshes };
}

/** 等到目录取回并注册（`load` 是异步的）。 */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("选模型的候选", () => {
  it("provider 候选来自 LLM 目录：活着的路由与可配置声明合并、去重", async () => {
    const b = bench();
    apply(b.ctx as never);
    await settled();

    const provider = b.selects.find((entry) => entry.path.join(".") === "models.*.provider");
    expect(provider).toBeDefined();
    expect(provider?.spec.options(() => undefined)).toEqual([
      { value: "mine", label: "自建" },
      { value: "openai", label: "OpenAI" },
    ]);
    expect(b.refreshes()).toBeGreaterThan(0);
  });

  it("模型候选读 provider 声明指向的那份配置，并声明依赖 provider", async () => {
    const b = bench();
    apply(b.ctx as never);
    await settled();

    const model = b.selects.find((entry) => entry.path.join(".") === "models.*.model");
    expect(model?.spec.dependsOn).toEqual([["provider"]]);
    const options = (provider: unknown): readonly SelectOption[] =>
      model?.spec.options((path) => (path.join(".") === "provider" ? provider : undefined)) ?? [];

    expect(options("mine")).toEqual([{ value: "m1" }, { value: "m2" }]);
    // 目录里没有配置地址的 provider（内置路由）：列不出模型，字段退回文本输入。
    expect(options("openai")).toEqual([]);
    expect(options(undefined)).toEqual([]);
  });
});
