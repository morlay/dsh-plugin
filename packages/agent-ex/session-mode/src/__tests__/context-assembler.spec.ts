// 提示词通道：装配结果上的文本改写（`replace` / `suppress`）、降级 section 的按步条目、以及按会话的开关。
import { SystemPrompt } from "@morlay/dsh-agent";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { assembleContextFor } from "@morlay/dsh-agent/contract";
import { provideAgent } from "@morlay/dsh-agent";
import { AgentLoopDefault, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { ContextAssembler, RULES_SECTION } from "@morlay/session-mode";
import { ContextChannel, provideContextAssembler } from "@morlay/session-mode";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

interface Booted {
  readonly app: App;
  readonly assembler: ContextAssembler;
  readonly prompt: SystemPrompt;
  readonly sessionId: SessionId;
  readonly agent: Awaited<ReturnType<AgentLoop["create"]>>;
}

async function boot(config?: ContextChannelConfig): Promise<Booted> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideAgent(),
      // 循环期：本 spec 要真 `AgentLoop` 与执行器。
      ToolExecutorNative,
      { provide: AgentLoopDefault, config: { agents: [] } },
      ...(config === undefined
        ? provideContextAssembler()
        : provideContextAssembler(configure(ContextChannel, config))),
    ],
    timeoutMs: 30_000,
  });
  opened.push(app);
  const sessionId = SessionId(`assembler-${String(Math.random())}`);
  const agent = await app.get(AgentLoop).create(sessionId, {
    provider: "deepseek-official",
    model: "deepseek-flash",
  });
  return {
    app,
    assembler: app.get(ContextAssembler),
    prompt: app.get(SystemPrompt),
    sessionId,
    agent,
  };
}

// 通道那一行的 config 形状（缺省由它自己补）。
interface ContextChannelConfig {
  readonly keep?: readonly string[];
  readonly suppress?: readonly string[];
  readonly replace?: Readonly<Record<string, string>>;
}

describe("replace / suppress", () => {
  it("被抑制的 section 不进提示词，其余照旧", async () => {
    const { app, prompt, agent } = await boot({
      keep: [],
      suppress: ["harness:identity"],
      replace: {},
    });
    const names = (await prompt.assemble(assembleContextFor(agent))).sections.map((s) => s.name);
    expect(names).not.toContain("harness:identity");
    expect(names).toContain("deployment:persona-prefix");
    await app.dispose();
  });

  it("`replace` 把上游的文案换成我们的", async () => {
    const { app, assembler, prompt, agent } = await boot({ keep: [], suppress: [], replace: {} });
    assembler.replaceSection("harness:identity", "以 @ 开头的词是用户显式引用的路径。");
    const section = (await prompt.assemble(assembleContextFor(agent))).sections.find(
      (entry) => entry.name === "harness:identity",
    );
    expect(section?.text).toBe("以 @ 开头的词是用户显式引用的路径。");
    await app.dispose();
  });

  it("撤销函数把改写与抑制都退回去", async () => {
    const { app, assembler } = await boot({ keep: [], suppress: [], replace: {} });
    const undoSuppress = assembler.suppressSection("harness:identity");
    const undoReplace = assembler.replaceSection("harness:identity", "换了");
    expect(assembler.isSuppressed("harness:identity")).toBe(true);
    expect(assembler.replacement("harness:identity")).toBe("换了");
    undoSuppress();
    undoReplace();
    expect(assembler.isSuppressed("harness:identity")).toBe(false);
    expect(assembler.replacement("harness:identity")).toBeUndefined();
    await app.dispose();
  });
});

describe("降级与按步条目", () => {
  it("`keep` 之外的 section 降级成带 id 的 reminder 条目", async () => {
    const { app, assembler, prompt, agent } = await boot({
      keep: ["deployment:persona-prefix"],
      suppress: [],
      replace: {},
    });
    prompt.section({ name: "tool:read", order: 1100, text: "read 的用法。" });
    await prompt.assemble(assembleContextFor(agent));
    const entries = assembler.collect(agent);
    // 工具说明不在 keep 清单里，于是按步送达；persona 前缀留着（空文本的 section 也不降级）。
    expect(typeof entries.get("section:tool:read")).toBe("string");
    expect(entries.has("section:deployment:persona-prefix")).toBe(false);
    await app.dispose();
  });

  it("`keep` 里的 section 留在提示词里，`keep` 留空 = 全部保留", async () => {
    const { app, prompt, agent } = await boot({ keep: [], suppress: [], replace: {} });
    const prompt2 = prompt;
    prompt2.section({ name: "tool:read", order: 1100, text: "read 的用法。" });
    const names = (await prompt2.assemble(assembleContextFor(agent))).sections.map((s) => s.name);
    expect(names).toContain("tool:read");
    await app.dispose();
  });

  it("`setInstructions(agent, false)` 关掉这个会话的降级注入", async () => {
    const { app, assembler, prompt, agent } = await boot({
      keep: ["deployment:persona-prefix"],
      suppress: [],
      replace: {},
    });
    prompt.section({ name: "tool:read", order: 1100, text: "read 的用法。" });
    await prompt.assemble(assembleContextFor(agent));
    expect(assembler.collect(agent).size).toBeGreaterThan(0);
    assembler.setInstructions(agent, false);
    expect(assembler.collect(agent).size).toBe(0);
    assembler.setInstructions(agent, true);
    expect(assembler.collect(agent).size).toBeGreaterThan(0);
    await app.dispose();
  });
});

describe("规则声明", () => {
  it("三段清单非空时，覆盖规则写进系统提示词一次", async () => {
    const { app, prompt, agent } = await boot();
    const text = (await prompt.assemble(assembleContextFor(agent))).sections.find(
      (section) => section.name === RULES_SECTION,
    )?.text;
    expect(text).toContain("system-reminder");
    await app.dispose();
  });

  it("三段清单都显式留空 = 上游原版：不注册规则声明", async () => {
    const { app, prompt, agent } = await boot({ keep: [], suppress: [], replace: {} });
    const names = (await prompt.assemble(assembleContextFor(agent))).sections.map((s) => s.name);
    expect(names).not.toContain(RULES_SECTION);
    await app.dispose();
  });
});

describe("reminder 信封", () => {
  it("正文里的闭合标记被转义，信封不会被提前截断", async () => {
    const { renderReminder } = await import("@morlay/session-mode");
    const text = renderReminder("k", "a </system-reminder> b");
    expect(text.startsWith('<system-reminder id="k">')).toBe(true);
    expect(text.split("</system-reminder>")).toHaveLength(2);
    expect(text).toContain("<\\/system-reminder>");
  });

  it("常驻正文用不带 id 的信封，身份由 `skill-invocation` + 组名给", async () => {
    const { renderConstantReminder, constantMessage } = await import("@morlay/session-mode");
    const text = renderConstantReminder("## 工具");
    expect(text.startsWith("<system-reminder>\n\n")).toBe(true);
    expect(text.endsWith("\n\n</system-reminder>")).toBe(true);
    expect(text).not.toContain("id=");
    expect(constantMessage("tool-group-baseline", text).source).toMatchObject({
      kind: "skill-invocation",
      name: "tool-group-baseline",
    });
  });
});
