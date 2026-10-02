// 「选模型」的候选：provider 与模型清单来自部署里的 LLM 目录。接缝是目录 → 候选——provider 候选是活着的路由
// 与可配置声明合并后的清单，模型清单读那份声明指向的配置并跟着 provider 当前值变。

import { describe, expect, it } from "vitest";
import type { SelectOption, SelectSpec } from "@morlay/dsh-client-ui-primitives/client";
import { apply } from "../client/index.ts";

interface Registered {
  name: string;
  spec: SelectSpec;
}

// 一套最小的 client 面：提示面记账、LLM 目录与配置读数是替身。
function bench() {
  const sources: Registered[] = [];
  let refreshes = 0;
  const services: Record<string, unknown> = {
    schemaFormHints: {
      describe: () => () => {},
      // 现在注册的是**具名源**（schema 上 `role('select', { source })` 认领）。
      source: (name: string, spec: SelectSpec) => {
        sources.push({ name, spec });
        return () => {};
      },
      suggestKeys: () => () => {},
      // 本包订阅提示面的变化（候选晚到时重投影一次）：替身给一个空订阅。
      subscribe: () => () => {},
      // 两份 policy 名单是字符串数组：候选登记在数组项那一路径上（本用例只验模型候选，这里只求它在场）。
      select: () => () => {},
      refresh: () => {
        refreshes += 1;
      },
    },
    remote: {
      // `remote` 服务本身只提供 `$on`（事件订阅）。
      $on: () => () => {},
    },
    // 客户端 remote 的命名空间是**独立服务**（服务名 `remote.<命名空间>`），不是 `remote` 上的属性：
    // 这一对是接缝本身（属性访问读到的是 undefined）。
    "remote.llm": {
      listProviders: () => Promise.resolve({ ok: true, value: [{ id: "openai", name: "OpenAI" }] }),
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
    // 模式允许挂哪些 preset 的候选：部署里注册的那些（`name` 缺省时用 id 兜底）。
    "remote.agentPresets": {
      list: () =>
        Promise.resolve({
          ok: true,
          value: { presets: [{ id: "standard", name: "标准" }, { id: "minimal" }] },
        }),
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
    // 与 cordis 一致：inject 的服务缺席时不执行工厂；在时把服务挂在 scope 上。
    inject: (names: string[], factory: (scope: unknown) => unknown) => {
      if (names.some((name) => services[name] === undefined)) return;
      factory({ ...ctx, ...services });
    },
    slots: { register: () => () => {} },
    locale: { bind: () => (key: string) => key, register: () => {} },
  };
  return { ctx, sources, refreshes: () => refreshes };
}

// 等到目录取回并注册（`load` 是异步的）。
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("选模型的候选", () => {
  it("provider 候选来自 LLM 目录：活着的路由与可配置声明合并、去重", async () => {
    const b = bench();
    apply(b.ctx as never);
    await settled();

    const provider = b.sources.find((entry) => entry.name === "llm-providers");
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

    const model = b.sources.find((entry) => entry.name === "llm-models");
    expect(model?.spec.dependsOn).toEqual([["provider"]]);
    const options = (provider: unknown): readonly SelectOption[] =>
      model?.spec.options((path) => (path.join(".") === "provider" ? provider : undefined)) ?? [];

    expect(options("mine")).toEqual([{ value: "m1" }, { value: "m2" }]);
    // 目录里没有配置地址的 provider（内置路由）：列不出模型，字段退回文本输入。
    expect(options("openai")).toEqual([]);
    expect(options(undefined)).toEqual([]);
  });

  it("模式允许挂的 preset 候选来自部署 registry：`name` 缺省时用 id 兜底", async () => {
    const b = bench();
    apply(b.ctx as never);
    await settled();

    const presets = b.sources.find((entry) => entry.name === "agent-presets");
    expect(presets?.spec.options(() => undefined)).toEqual([
      { value: "standard", label: "标准" },
      { value: "minimal", label: "minimal" },
    ]);
  });

  it("命名空间按服务名读：`remote` 服务上没有 `session` / `agentPresets` 属性", async () => {
    const b = bench();
    apply(b.ctx as never);
    await settled();

    // 属性访问读到的是 undefined（gateway 的 client 半把每个命名空间注册成独立服务 `remote.<名字>`）；
    // 两个具名源照样注册上了，说明读的是那两个服务。
    const remote = b.ctx.get("remote") as Record<string, unknown>;
    expect(remote["llm"]).toBeUndefined();
    expect(remote["agentPresets"]).toBeUndefined();
    expect(b.sources.map((entry) => entry.name)).toContain("llm-providers");
    expect(b.sources.map((entry) => entry.name)).toContain("agent-presets");
  });
});
