// 包根（装配行写的那一行）：装到的必须是**通道本体**，config 是 `keep` / `suppress` / `replace` 的缺省。
// 工作区指令与技能目录走官方行，本包只做装配结果上的文本转换（丢 section / 换文案 / 降级送达）。
import { Context } from "@deepseek-ai/cordis";
import { assembleContextFor } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { SessionId } from "@deepseek-ai/dsh-session";
import { renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import { afterEach, describe, expect, it } from "vitest";
import { RULES_TEXT } from "../rules.ts";
import * as plugin from "../index.ts";

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

async function mount(config: Record<string, unknown> = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个编码专家。" },
  });
  const harness = await mountAgentLoopTestHarness(ctx);
  // 装配行那一行的形状：插件 name 是包名，config 是这一行的 config。
  await ctx.plugin(plugin, config);
  const agent = await harness.create(
    SessionId(`context-assembler-root-${Date.now()}-${Math.random()}`),
    {},
    { cwd: "/tmp" },
  );
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        inner.systemPrompt.section({ name: "tool:bash", order: 1000, text: "BASH_GUIDE" });
      },
      { inject: ["systemPrompt"] },
    ),
  );
  return { ctx, agent };
}

describe("包根（装配行那一行）", () => {
  it("config 为空也装出通道本体：服务在、规则声明进系统提示词", async () => {
    const { ctx, agent } = await mount();

    expect(ctx.get("contextAssembler")).toBeDefined();
    const rendered = renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(agent)));
    expect(rendered).toContain(RULES_TEXT);
    // 缺省清单就是本部署要的那一份转换：`tool:bash` 不进提示词（降级为按步送达）。
    expect(rendered).not.toContain("BASH_GUIDE");
  });

  it("config 的 `suppress` 丢掉那条 section", async () => {
    const { ctx, agent } = await mount({ suppress: ["tool:bash"] });

    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent));
    expect(assembly.sections.map((section) => section.name)).not.toContain("tool:bash");
  });
});
