// PTC 装配下 system 里的 `tools:sdk` 必须被换成稳定骨架（不是上游那份全量 ToolArgsMap）。
// 这条用例在真实装配里走：tool-executor-ptc + 一个最小 ptcRuntime + 本插件（ptc: true）。
// 真 cordis ctx 的宽形状由 support/mount 提供（vendor 的类型增强不在本仓 TS program 里）。
import { SessionId } from "@morlay/dsh-session/contract";
import { assembleContextFor, defineTool } from "@morlay/dsh-agent/contract";
import { apply as applyPtcExecutor } from "@morlay/dsh-ptc";
import type { TestContext } from "./support/context.ts";
import { afterEach, describe, expect, it } from "vitest";
import { pinDshHome } from "./support/dsh-home.ts";
import { mountSessionModeApp } from "./support/mount-app.ts";

// 用例里的模式定义就是被测输入：把 `{dshHome}/modes/*.toml` 指到空目录，别让开发机上真用户的覆盖参与装配。
pinDshHome();

const apps: Awaited<ReturnType<typeof mountSessionModeApp>>["app"][] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose();
});

describe("PTC 装配：tools:sdk 换成稳定骨架", () => {
  it("section 里是 describe_tool 骨架，没有全量 ToolArgsMap", async () => {
    // 真 cordis 根 ctx（`App.ctx`）：上游的 `ctx.plugin(scope)` / `fiber.ctx.extend` 才能跑。
    const { app, ctx } = await mountSessionModeApp({
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
      guidance: false,
      modes: {
        default: "coding",
        modes: {
          coding: {
            name: "编码模式",
            description: "",
            role: ["main"],
            persona: { prefix: "", suffix: "" },
            allowTools: [],
            denyTools: [],
            allowSkills: [],
            denySkills: [],
            allowPolicies: [],
            denyPolicies: [],
            instructions: true,
            skills: true,
            runtimeContext: true,
          },
        },
      },
    });
    apps.push(app);
    await ctx.plugin(
      Object.assign(
        (inner: TestContext) => {
          for (const name of ["read", "send_message"]) inner.tools.register(tool(name));
        },
        { inject: ["tools"] },
      ),
    );
    // 最小 ptcRuntime：执行器求值 `tools:sdk` 时只读 language / programFormat。
    ctx.provide("ptcRuntime", { language: "typescript", programFormat: "function-body" });

    const { agent } = await ctx.agents.create({ sessionId: SessionId("ptc-section") });
    // testkit 已有一个 native executor；PTC 执行器注册在 **agent scope** 上，两者不冲突。
    await (agent.ctx as unknown as TestContext).plugin(
      Object.assign(applyPtcExecutor, { inject: ["tools", "systemPrompt"] }) as unknown as never,
      {} as never,
    );
    // 收口（`applyTo`）要在 PTC 执行器装好之后再来一次：`describe_tool` 的注册与工具的可见面都按那一刻定。
    (
      (ctx as unknown as Record<string, unknown>)["session-mode"] as {
        applyTo(a: unknown, m: string, o?: unknown): void;
      }
    ).applyTo(agent, "coding", { record: false });

    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent));
    const text = String(assembly.sections.find((row) => row.name === "tools:sdk")?.text ?? "");
    expect(text).toContain("describe_tool(args: { group?:");
    expect(text).not.toContain("interface ToolArgsMap");
  });
});

function tool(name: string) {
  return defineTool({
    name,
    description: `${name} 的说明。`,
    parameters: {},
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    execute: async () => "ok",
  });
}
