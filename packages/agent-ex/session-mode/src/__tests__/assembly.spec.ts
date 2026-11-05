// 包根（装配行写的那一行）：装到的必须是**通道本体**，config 是 `keep` / `suppress` / `replace` 的缺省。
// 工作区指令与技能目录走官方行，本包只做装配结果上的文本转换（丢 section / 换文案 / 降级送达）。
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { SessionId } from "@morlay/dsh-session/contract";
import { assembleContextFor, renderPrompt } from "@morlay/dsh-agent/contract";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { loopTestProviders } from "@morlay/dsh-agent-loop/testing";
import { SystemPromptDefault } from "@morlay/dsh-agent";
import { afterEach, describe, expect, it } from "vitest";
import { RULES_TEXT } from "@morlay/session-mode";
import { provideSessionMode } from "@morlay/session-mode";
import { ContextChannel } from "../context-assembler.provide.ts";

const opened: Awaited<ReturnType<typeof bootstrapApplication>>[] = [];
afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose();
});

async function mount(config: { readonly suppress?: readonly string[] } = {}) {
  const app = await bootstrapApplication({
    providers: [
      // 骨架 + 会话 + 投影 + 执行器 + 循环本体（本仓的测试装配清单）。
      ...loopTestProviders({
        systemPrompt: { includeHarnessIdentity: false, personaPrefix: "你是一个编码专家。" },
      }),
      // 装配行那一行：通道的 config 就是 `keep` / `suppress` / `replace`。
      ...provideSessionMode(configure(ContextChannel, config)),
    ],
    timeoutMs: 30_000,
  } as never);
  opened.push(app);
  const agent = await app
    .get(AgentLoop)
    .create(SessionId(`context-assembler-root-${String(Date.now())}`), {}, { cwd: "/tmp" });
  // 上游 `tool:bash` 那一行在我们的装配里没装：直接挂一条同样的 section 当被降级的对象。
  app.get(SystemPromptDefault).section({ name: "tool:bash", order: 1000, text: "BASH_GUIDE" });
  return { app, agent };
}

describe("包根（装配行那一行）", () => {
  it("config 为空也装出通道本体：服务在、规则声明进系统提示词", async () => {
    const { app, agent } = await mount();

    expect(app.get(ContextChannel)).toBeDefined();
    const rendered = renderPrompt(
      await app.get(SystemPromptDefault).assemble(assembleContextFor(agent)),
    );
    expect(rendered).toContain(RULES_TEXT);
    // 缺省清单就是本部署要的那一份转换：`tool:bash` 不进提示词（降级为按步送达）。
    expect(rendered).not.toContain("BASH_GUIDE");
  });

  it("config 的 `suppress` 丢掉那条 section", async () => {
    const { app, agent } = await mount({ suppress: ["tool:bash"] });

    const assembly = await app.get(SystemPromptDefault).assemble(assembleContextFor(agent));
    expect(assembly.sections.map((section) => section.name)).not.toContain("tool:bash");
  });
});
