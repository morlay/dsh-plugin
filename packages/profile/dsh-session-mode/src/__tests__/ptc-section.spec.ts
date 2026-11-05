// PTC 装配下 system 里的 `tools:sdk` 必须被换成稳定骨架（不是上游那份全量 ToolArgsMap）。
// 这条用例在真实装配里走：tool-executor-ptc + 一个最小 ptcRuntime + 本插件（ptc: true）。
import { Context } from "@deepseek-ai/cordis";
import { assembleContextFor } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { apply as applyPtcExecutor } from "@deepseek-ai/dsh-tool-executor-ptc";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../index.ts";
import { pinDshHome } from "./dsh-home.ts";

// 用例里的模式定义就是被测输入：把 `{dshHome}/modes/*.toml` 指到空目录，别让开发机上真用户的覆盖参与装配。
pinDshHome();

const contexts: Context[] = [];
afterEach(() => {
  contexts.splice(0);
});

describe("PTC 装配：tools:sdk 换成稳定骨架", () => {
  it("section 里是 describe_tool 骨架，没有全量 ToolArgsMap", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
    });
    await mountAgentLoopTestHarness(ctx);
    await ctx.plugin(
      Object.assign(
        (inner: Context) => {
          for (const name of ["read", "send_message"]) inner.tools.register(tool(name));
        },
        { inject: ["tools"] },
      ),
    );
    // 最小 ptcRuntime：执行器求值 `tools:sdk` 时只读 language / programFormat。
    ctx.provide("ptcRuntime", { language: "typescript", programFormat: "function-body" });
    await ctx.plugin(plugin, {
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
    });

    const { agent } = await ctx.agents.create({ sessionId: SessionId("ptc-section") });
    // testkit 已有一个 native executor；PTC 执行器注册在 **agent scope** 上，两者不冲突。
    await agent.ctx.plugin(
      Object.assign(applyPtcExecutor, { inject: ["tools", "systemPrompt"] }) as unknown as never,
      {} as never,
    );
    ctx.sessionModes.applyTo(agent, "coding", { record: false });

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
