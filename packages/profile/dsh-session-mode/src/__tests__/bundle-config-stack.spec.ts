// bundle 配置页接的是**真的 settings 服务栈**（`ConfigForms` + `SettingsDescribeMirror` + `SettingsSchemaService`）：
// 这里验的是"视图晚到"那一段——控制器建起来时 describe 还没作答，作答之后读数必须自己跟上。
//
// 注：共享表单（`ConfigForms.get`）自己的 `status` 在测试进程里会受客户端快照冻结的影响（immer 的非 production
// 行为），与本题无关，所以这里只断言控制器那侧的读数。
//
// 接缝是 host 的 `settings.describe` 问答（只把 wire 那一层换成替身），其余全是真的。

import { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { ConfigForms } from "../../../../../vendor/deepseek-harness/packages/client/ui-settings/src/client/config-form.ts";
import { SettingsDescribeMirror } from "../../../../../vendor/deepseek-harness/packages/client/ui-settings/src/client/settings-mirror.ts";
import { SettingsSchemaService } from "../../../../../vendor/deepseek-harness/packages/client/ui-settings/src/client/schema.ts";
import {
  plainConfig,
  projectForm,
  volatileForm,
} from "../../../../../vendor/deepseek-harness/packages/settings/settings/src/schema.ts";
import { SchemaFormHints } from "@morlay/dsh-client-ui-primitives/client";
import {
  createBundleConfigFace,
  unwrapService,
  type BundleTranslate,
  type HintsLike,
} from "../client/bundle-config.ts";
import { Config } from "../modes.ts";

const t = ((key: string) => key) as BundleTranslate;

// 一段真实的 config 值（一个模式就够：这里验的是视图到达的时序）。
const section = {
  default: "coding",
  modes: {
    coding: {
      name: "编码模式",
      description: "编码",
      role: ["main"],
      persona: { prefix: "", suffix: "" },
      allowTools: [],
      denyTools: [],
      allowSkills: [],
      denySkills: [],
      allowPolicies: [],
      denyPolicies: [],
      instructions: true,
      runtimeContext: true,
    },
  },
  models: {},
};

// host 送给 client 的值与 host 的 describe 同形：`projectForm(form, plainConfig(config))`
// —— 只留表单声明的字段（带默认），client 侧的解码会拿它跟 schema 对一遍。
const json = (input: unknown): unknown => JSON.parse(JSON.stringify(input));

const value = JSON.parse(
  JSON.stringify(
    projectForm(
      volatileForm(Config as never) as z,
      plainConfig((Config as never as (input: unknown) => unknown)(section)),
    ),
  ),
) as Record<string, unknown>;

// 真 settings 栈 + 只延迟作答的 wire 替身。
function bench() {
  const ctx = new Context();
  const schema = new SettingsSchemaService(ctx);
  const form = volatileForm(Config as never) as z;
  let ready = false;
  ctx.provide("remote", {
    settings: {
      describe: async () => {
        // 第一次调用推迟到下一个微任务之后：控制器建起来时视图还没到。
        await new Promise((resolve) => {
          setTimeout(resolve, 1);
        });
        ready = true;
        return {
          ok: true as const,
          value: {
            namespaces: [
              {
                ns: "session-mode",
                schema: json(form.toJSON()),
                value,
                autoGenerate: true,
                applies: "live" as const,
                secrets: [],
                revision: 1,
              },
            ],
            writable: true,
            hasDocument: false,
          },
        };
      },
      mutate: async () => ({
        ok: true as const,
        value: {
          ns: "session-mode",
          schema: form.toJSON(),
          value,
          autoGenerate: true,
          applies: "live" as const,
          secrets: [],
          revision: 2,
        },
      }),
    },
  });
  ctx.provide("locale", { bind: () => t });
  const mirror = new SettingsDescribeMirror(ctx, "host");
  let notified = 0;
  mirror.subscribe(() => {
    notified += 1;
  });
  // `SettingsSchemaService` 与 `ConfigForms` 都在自己的构造里把服务挂上（超类 Service 注册），不必再 provide。
  const forms = new ConfigForms(ctx, { mirror, schema, persistence: "host" });
  return {
    ctx,
    notified: () => notified,
    mirror,
    forms,
    schema,
    describeReady: () => ready,
    faceOf: () => createBundleConfigFace(ctx as never, t),
  };
}

describe("bundle 配置页：提示面经 cordis 服务拿到", () => {
  it("代理上直接调方法会抛（私有字段），解包成原实例之后读得到候选", () => {
    const stack = bench();
    // 真的提示面服务（与 dsh-session-mode 的 client 半同一份实现）：自己挂到 ctx 上。
    const hints = new SchemaFormHints(stack.ctx);
    hints.source("llm-providers", {
      options: () => [{ value: "provider-a", label: "A" }],
    });

    // cordis 会给服务值包一层追踪代理：代理上的调用以代理为 `this`，而服务实现用 JS 私有字段。
    const proxied = stack.ctx.get("schemaFormHints") as unknown as HintsLike;
    expect(() => proxied.sourceFor("llm-providers")).toThrow();

    // 页面走的是解包之后那条路。
    const original = unwrapService(proxied);
    expect(original?.sourceFor("llm-providers")).toBeDefined();
  });
});

describe("bundle 配置页：真 settings 栈下的视图到达", () => {  it("控制器建起来时视图还没到：作答之后读数自己跟上（不用人工重建）", async () => {
    const stack = bench();
    const { face } = stack.faceOf();

    // 控制器刚建：还没有视图。
    expect(face.hooks.bundleStatus.getSnapshot()).toBe("loading");
    expect(face.hooks.bundleConfig.getSnapshot().configured).toBe(false);

    // 等 host 的解答落到镜像上。
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(stack.describeReady()).toBe(true);
    // 先看镜像与共享表单各自的读数：是 wire 的那份没落上，还是共享表单没跟上。
    expect(stack.mirror.getSnapshot().status).toBe("ready");
    expect(stack.mirror.getSnapshot().view?.namespaces.map((row) => row.ns)).toEqual([
      "session-mode",
    ]);
    // 控制器读的是同一份镜像：视图落地后它必须自己跟上（不靠外部重建）。
    expect(stack.notified()).toBeGreaterThan(0);
    expect(face.hooks.bundleConfig.getSnapshot().configured).toBe(true);
    expect(face.hooks.bundleConfig.getSnapshot().walked.length).toBeGreaterThan(0);
  });
});
