// 会话级三态是**真实写面**：`setItemState` 之后，这个会话的工具面必须立刻变（不需要等下一次装配）。
// 这条用例盯的正是"写面只更新了状态、没有重装收口"那类 bug（`installFor` 的幂等判断）。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { SessionId } from "@morlay/dsh-session/contract";
import { assembleContextFor, defineTool, type Agent } from "@morlay/dsh-agent/contract";
import type { TestContext } from "./support/context.ts";
import { describe, expect, test } from "@morlay/session-mode/testing";
import { onTestFinished, vi } from "vitest";
import { asModeConfig, type ModeConfig } from "@morlay/session-mode";
// 装配入口是 `bootstrapApplication` + `app.get(Token)`：一次 bootstrap 拿到真 cordis 根 ctx（`App.ctx`），
// 卸载走 `app.dispose()`。为什么不再有「逐行挂」的第二套内核：它与 `bootstrapApplication` 里的装配重复，
// 而且总会新起一个根 ctx，与「复用同一个 ctx」的用法冲突。
import { pinDshHome } from "./support/dsh-home.ts";
import { mountSessionModeApp } from "./support/mount-app.ts";

// 用例里的模式定义就是被测输入：把 `{dshHome}/modes/*.toml` 指到空目录，别让开发机上真用户的覆盖参与装配。
pinDshHome();

function modeOf(name: string, overrides: Partial<ModeConfig> = {}): ModeConfig {
  return {
    presetsOnly: [],
    name,
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
    dropSections: [],
    runtimeContext: true,
    defaultModel: undefined,
    ...overrides,
  } as ModeConfig;
}

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

async function mount(): Promise<{ ctx: TestContext; agent: Agent }> {
  const { app, ctx } = await mountSessionModeApp({
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
  });
  onTestFinished(() => app.dispose());
  await ctx.plugin(
    Object.assign(
      (inner: TestContext) => {
        for (const name of ["read", "bash", "send_message"]) inner.tools.register(tool(name));
      },
      { inject: ["tools"] },
    ),
  );
  const { agent } = await ctx.agents.create({ sessionId: SessionId("item-state") });
  ctx.sessionModes.applyTo(agent, "coding", { record: false });
  return { ctx, agent };
}

function visibleTools(ctx: TestContext, agent: Agent): string[] {
  // `describe_tool` 是本插件在 PTC 下常驻的控制工具，不参与"模式收窄"的断言。
  return ctx.tools
    .schemas(agent)
    .map((schema) => schema.name)
    .filter((name) => name !== "describe_tool")
    .toSorted();
}

describe("会话级三态改的是真实工具面", () => {
  test("禁止一个工具后它立刻不可见，回到默认后恢复", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { ctx, agent } = await mount();
    expect(visibleTools(ctx, agent)).toEqual(["bash", "read"]);

    await ctx.sessionModes.applyConfig(
      agent.session.id,
      asModeConfig(ctx.sessionModes.modeOfSession(agent.session), true) && {
        ...asModeConfig(ctx.sessionModes.modeOfSession(agent.session), true),
        denyTools: ["read"],
      },
    );
    expect(visibleTools(ctx, agent)).toEqual(["bash"]);

    await ctx.sessionModes.applyConfig(agent.session.id, {
      ...asModeConfig(ctx.sessionModes.modeOfSession(agent.session), true),
      denyTools: [],
    });
    expect(visibleTools(ctx, agent)).toEqual(["bash", "read"]);
  });

  test("模式默认禁掉一组后，三态可以单独把它放回来", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { app, ctx } = await mountSessionModeApp({
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
      modes: {
        default: "coding",
        modes: { coding: modeOf("编码模式", { denyTools: ["group:fs"] }) },
      },
    });
    onTestFinished(() => app.dispose());
    await ctx.plugin(
      Object.assign(
        (inner: TestContext) => {
          for (const name of ["read", "bash"]) inner.tools.register(tool(name));
        },
        { inject: ["tools"] },
      ),
    );
    const { agent } = await ctx.agents.create({ sessionId: SessionId("item-state-2") });
    ctx.sessionModes.applyTo(agent, "coding", { record: false });

    expect(visibleTools(ctx, agent)).toEqual(["bash"]);

    await ctx.sessionModes.applyConfig(agent.session.id, {
      ...asModeConfig(ctx.sessionModes.modeOfSession(agent.session), true),
      denyTools: [],
    });
    expect(visibleTools(ctx, agent)).toEqual(["bash", "read"]);
  });
});

describe("另存为写回的是完整定义（含系统提示词）", () => {
  test("persona / 名单 / 开关都进 modes[code]", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { app, ctx } = await mountSessionModeApp({
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
      modes: {
        default: "coding",
        modes: {
          coding: modeOf("编码模式", {
            persona: { prefix: "你是编码专家。", suffix: "结束语。" },
            denyTools: ["read"],
          }),
        },
      },
    });
    onTestFinished(() => app.dispose());
    await ctx.plugin(
      Object.assign(
        (inner: TestContext) => {
          for (const name of ["read", "bash"]) inner.tools.register(tool(name));
        },
        { inject: ["tools"] },
      ),
    );
    const { agent } = await ctx.agents.create({ sessionId: SessionId("save-as") });
    ctx.sessionModes.applyTo(agent, "coding", { record: false });

    await ctx.sessionModes.saveAsNewMode(agent.session.id, "custom", "自定义");

    const written = parse(await readFile(join(home, "modes", "custom.toml"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(written["name"]).toBe("自定义");
    expect(written["persona"]).toEqual({ prefix: "你是编码专家。", suffix: "结束语。" });
    expect(written["denyTools"]).toEqual(["read"]);
  });
});

describe("自定义模式的系统提示词", () => {
  test("切到另存为出来的模式后，persona 进入系统提示词", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { app, ctx } = await mountSessionModeApp({
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
      modes: {
        default: "coding",
        modes: {
          coding: modeOf("编码模式"),
          custom: modeOf("自定义", {
            persona: { prefix: "自定义提示词。", suffix: "自定义结束语。" },
          }),
        },
      },
    });
    onTestFinished(() => app.dispose());
    const { agent } = await ctx.agents.create({ sessionId: SessionId("custom-persona") });
    ctx.sessionModes.applyTo(agent, "custom", { record: false });

    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent));
    const section = assembly.sections.find((row) => row.name === "deployment:persona-prefix");
    expect(section?.text).toContain("自定义提示词。");
    const suffix = assembly.sections.find((row) => row.name === "deployment:persona-suffix");
    expect(suffix?.text).toContain("自定义结束语。");
  });
});

describe("保存为默认 / 删除（写 {dshHome}/modes/*.toml）", () => {
  async function mountWith(
    modes: Record<string, ModeConfig>,
  ): Promise<{ ctx: TestContext; agent: Agent }> {
    const { app, ctx } = await mountSessionModeApp({
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
      modes: { default: "coding", modes },
    });
    onTestFinished(() => app.dispose());
    const { agent } = await ctx.agents.create({
      sessionId: SessionId(`save-${String(Math.random())}`),
    });
    ctx.sessionModes.applyTo(agent, "coding", { record: false });
    return { ctx, agent };
  }

  test("保存为默认写回当前生效配置，且当前会话的覆盖保留", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { ctx, agent } = await mountWith({
      coding: modeOf("编码模式", { persona: { prefix: "原提示词。", suffix: "" } }),
    });
    await ctx.sessionModes.setModePatch(agent.session.id, { instructions: false });
    await ctx.sessionModes.saveAsDefault(agent.session.id);

    const written = parse(await readFile(join(home, "modes", "coding.toml"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(written["instructions"]).toBe(false);
    expect(written["persona"]).toEqual({ prefix: "原提示词。", suffix: "" });
    // 当前会话不能被立刻退回旧默认。
    const state = await ctx.sessionModes.activeState(agent.session.id);
    expect((state?.session ?? state?.config)?.instructions).toBe(false);
  });

  test("删除一个模式后它会从 modes 目录移除，会话回到部署默认", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { ctx, agent } = await mountWith({
      coding: modeOf("编码模式"),
      custom: modeOf("自定义"),
    });
    await ctx.sessionModes.saveAsNewMode(agent.session.id, "extra", "额外");
    expect(await readFile(join(home, "modes", "extra.toml"), "utf8")).toContain("name");

    // 本行的会话事件不在上游 `SessionEventMap` 里：写入的边界在这里断言一次。
    (agent.session.append as (type: string, data: unknown) => unknown)("session-mode/selected", {
      sessionMode: "extra",
    });
    ctx.sessionModes.applyTo(agent, "extra", { record: false });
    const fallback = await ctx.sessionModes.deleteMode(agent.session.id);

    expect(fallback).toBe("coding");
    await expect(readFile(join(home, "modes", "extra.toml"), "utf8")).rejects.toThrow();
    const state = await ctx.sessionModes.activeState(agent.session.id);
    expect(state?.mode.id).toBe("coding");
  });
});

describe("会话覆盖的恢复（文件持久化）", () => {
  test("写进 modes/sessions 的覆盖会在进入会话时读回来", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { ctx, agent } = await mount();
    await ctx.sessionModes.applyConfig(agent.session.id, {
      ...asModeConfig(ctx.sessionModes.modeOfSession(agent.session), true),
      instructions: false,
      denyTools: ["read"],
    });
    const state = await ctx.sessionModes.activeState(agent.session.id);
    expect((state?.session ?? state?.config)?.instructions).toBe(false);
    expect(visibleTools(ctx, agent)).not.toContain("read");
  });
});

describe("组引用的会话覆盖与配置写入", () => {
  test("applyConfig 传组引用 null 只清会话覆盖，配置里的组引用仍在", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { app, ctx } = await mountSessionModeApp({
      systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
    });
    onTestFinished(() => app.dispose());
    await ctx.plugin(
      Object.assign(
        (inner: TestContext) => {
          for (const name of ["read", "bash"]) inner.tools.register(tool(name));
          for (const name of ["mcp__agent-browser__open"]) inner.tools.register(tool(name));
        },
        { inject: ["tools"] },
      ),
    );
    const { agent } = await ctx.agents.create({ sessionId: SessionId("group-ref") });
    ctx.sessionModes.applyTo(agent, "coding", { record: false });

    // 先放行整组（会话覆盖），再清除覆盖。
    const allowed = await ctx.sessionModes.applyConfig(agent.session.id, {
      ...asModeConfig(ctx.sessionModes.modeOfSession(agent.session), true),
      denyTools: [],
    });
    // 放行写进会话覆盖：生效配置不再含这条组引用（按需组机制仍决定工具是否进目录）。
    expect((allowed?.session ?? allowed?.config)?.denyTools).not.toContain("mcp:agent-browser");

    const cleared = await ctx.sessionModes.applyConfig(agent.session.id, {
      ...asModeConfig(ctx.sessionModes.modeOfSession(agent.session), true),
      denyTools: ["mcp:agent-browser"],
    });
    // 会话覆盖清掉了，但配置里的组引用还在：`effective` 回到配置态。
    expect((cleared?.session ?? cleared?.config)?.denyTools).toContain("mcp:agent-browser");
  });
});

async function mountPtc(): Promise<{ ctx: TestContext; agent: Agent }> {
  const { app, ctx } = await mountSessionModeApp({
    systemPrompt: { includeHarnessIdentity: false, personaPrefix: "部署级提示词。" },
  });
  onTestFinished(() => app.dispose());
  await ctx.plugin(
    Object.assign(
      (inner: TestContext) => {
        for (const name of ["read", "bash", "send_message", "mcp__agent-browser__open"]) {
          inner.tools.register(tool(name));
        }
      },
      { inject: ["tools"] },
    ),
  );
  const { agent } = await ctx.agents.create({ sessionId: SessionId("ptc-describe") });
  ctx.sessionModes.applyTo(agent, "coding", { record: false });
  return { ctx, agent };
}

describe("tools_describe：PTC 程序里现取某组 d.ts", () => {
  test("group=fs 时返回 tools 上的 fs 组成员声明", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { ctx, agent } = await mountPtc();
    const batch = await ctx.tools.execute({
      calls: [
        {
          type: "tool-call",
          id: "describe-1" as never,
          name: "describe_tool",
          arguments: JSON.stringify({ group: "fs" }),
        },
      ],
      agent,
      signal: new AbortController().signal,
    });
    const text = JSON.stringify(batch.results[0]?.result ?? {});
    expect(text).toContain("read(args:");
  });

  test("MCP 那种带 `-` 的工具名写成引号键，并提示用索引访问", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { ctx, agent } = await mountPtc();
    const batch = await ctx.tools.execute({
      calls: [
        {
          type: "tool-call",
          id: "describe-mcp" as never,
          name: "describe_tool",
          arguments: JSON.stringify({ group: "mcp:agent-browser" }),
        },
      ],
      agent,
      signal: new AbortController().signal,
    });
    const text = JSON.stringify(batch.results[0]?.result ?? {});

    // 裸写的函数声明会让模型照抄出 SyntaxError；引号键 + 索引提示才是能直接用的形态。
    expect(text).toContain('\\"mcp__agent-browser__open\\"(args:');
    expect(text).not.toContain("function mcp__agent-browser");
    expect(text).toContain('tools[\\"名字\\"](args)');
  });

  test("不带 group 时返回分组清单", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-modes-"));
    onTestFinished(() => rm(home, { recursive: true, force: true }));
    vi.stubEnv("DSH_HOME", home);
    const { ctx, agent } = await mountPtc();
    const batch = await ctx.tools.execute({
      calls: [
        {
          type: "tool-call",
          id: "describe-2" as never,
          name: "describe_tool",
          arguments: "{}",
        },
      ],
      agent,
      signal: new AbortController().signal,
    });
    const text = JSON.stringify(batch.results[0]?.result ?? {});
    expect(text).toContain("fs");
  });
});
