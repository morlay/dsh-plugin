// 临时探针：teammate（Agent Teams）的端到端面——成员资格决定工具可见性、任务板全流程、
// 以及 spawn 一个队友之后按名字分配任务。用假 LLM，不联网。
import {
  Llm,
  SubagentRegistry,
  ToolRegistry,
  provideAgent,
  provideWorkingDirectory,
} from "@morlay/dsh-agent";
import { LlmAdapter, ToolCallId } from "@morlay/dsh-agent/server";
import { FakeLlmAdapter } from "@morlay/dsh-agent/testing";
import { provideAgentLoop } from "@morlay/dsh-agent-loop";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SandboxPolicyDefault, provideSandbox } from "@morlay/dsh-sandbox";
import {
  provideSession,
  provideSessionProjection,
  provideSessionQuerySqlite,
} from "@morlay/dsh-session/server";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideShell } from "@morlay/dsh-shell/server";
import { agentPresetProjection } from "@morlay/session-mode";
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { AppEnv, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { describe, expect, test, type TestingAppEnv } from "@morlay/zephyr-app/testing";
import { TeamServiceDefault, provideAgentTeam } from "../server/index.ts";

/** 运行环境替身：数据根就是本文件的临时目录。 */
let callNumber = 0;
const signal = new AbortController().signal;

/**
 * 起一套带团队两行的真栈（假 LLM）。
 * @returns 应用、团队服务与循环服务。
 */
async function boot(appEnv: TestingAppEnv, adapter: LlmAdapter = new FakeLlmAdapter("队友收到。")) {
  const app = await bootstrapApplication({
    providers: [
      { provide: AppEnv, useValue: appEnv },
      ...provideSessionPersistence(),
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionQuerySqlite(),
      ...provideAgent(),
      ...provideShell(),
      ...provideSandbox(
        configure(SandboxPolicyDefault, {
          mode: "workspace-write",
          workspaceRoot: appEnv.values.dataDir,
        }),
      ),
      ...provideWorkingDirectory(),
      RemoteHandlersDefault,
      ...provideAgentLoop(),
      ...provideAgentTeam(),
    ],
    timeoutMs: 60_000,
  } as never);
  app.get(Llm).registerAdapter(["mock"], adapter);
  // 只注册会话模式里的 agentPreset 投影（子代理续跑读的那份会话事实）：
  // 装整套会话模式会按模式名单收窄工具，那是另一件事，会盖住本 spec 要判的团队工具可见性。
  const projections = app.get(SessionProjectionStore) as unknown as {
    register(spec: unknown): Promise<unknown>;
  };
  await projections.register(agentPresetProjection("ptc"));
  return { app, teams: app.get(TeamServiceDefault) };
}

/** 这一轮 agent 能看到哪些工具。 */
async function toolNames(app: Awaited<ReturnType<typeof boot>>["app"], agent: unknown) {
  const tools = app.get(ToolRegistry);
  const set = await tools.resolve({
    agent,
    modelSelection: { provider: "mock", model: "mock" },
    signal,
  } as never);
  try {
    return [
      ...(set as { view: (scope: unknown) => ReadonlyMap<string, unknown> }).view(agent).keys(),
    ].sort();
  } finally {
    (set as { dispose: () => void }).dispose();
  }
}

/** 执行一个工具并取出文本结果。 */
async function run(
  app: Awaited<ReturnType<typeof boot>>["app"],
  agent: unknown,
  name: string,
  args: unknown,
) {
  const tools = app.get(ToolRegistry);
  const set = await tools.resolve({
    agent,
    modelSelection: { provider: "mock", model: "mock" },
    signal,
  } as never);
  try {
    const batch = await tools.execute({
      calls: [
        {
          type: "tool-call",
          id: ToolCallId(`team-call-${String(++callNumber)}`),
          name,
          arguments: JSON.stringify(args),
        },
      ],
      signal,
      agent,
      toolSet: set,
    } as never);
    const first = (
      batch as {
        results: readonly {
          result: { content: readonly { type: string; text?: string }[]; isError?: boolean };
        }[];
      }
    ).results[0];
    const text =
      first === undefined
        ? ""
        : first.result.content
            .flatMap((block) =>
              block.type === "text" && block.text !== undefined ? [block.text] : [],
            )
            .join("");
    return { text, isError: first?.result.isError === true };
  } finally {
    (set as { dispose: () => void }).dispose();
  }
}

describe("teammate（Agent Teams）端到端", () => {
  test(
    "setEnabled 之后 agentTeam 投影跟着翻（浏览器开关读的就是这一份）",
    { timeout: 60_000 },
    async ({ appEnv }) => {
      const { app, teams } = await boot(appEnv);
      try {
        const loop = app.get(AgentLoop);
        const lead = await loop.create(SessionId("team-projection"), {
          provider: "mock",
          model: "mock",
        } as never);
        // 投影挂在 `snapshot(session).values` 里（与 `session-stats.spec` 同一口径）；浏览器
        // `useProjection('agentTeam')` 读的就是这一份 view。
        const store = app.get(SessionProjectionStore);
        const enabledOf = (): boolean => {
          const values = store.snapshot(lead.session).values;
          return values["agentTeam"]?.enabled === true;
        };
        const setEnabled = (enabled: boolean): Promise<void> => teams.setEnabled(lead, enabled);

        expect(enabledOf(), "默认关").toBe(false);
        await setEnabled(true);
        expect(enabledOf(), "启用后投影跟着翻").toBe(true);
        await setEnabled(false);
        expect(enabledOf(), "关闭后投影跟着翻").toBe(false);
      } finally {
        await app.dispose();
      }
    },
  );

  test(
    "成员资格决定团队工具是否可见；任务板走完 create→list→claim→complete",
    { timeout: 120_000 },
    async ({ appEnv }) => {
      const { app, teams } = await boot(appEnv);
      try {
        const loop = app.get(AgentLoop);
        const lead = await loop.create(SessionId("team-e2e-lead"), {
          provider: "mock",
          model: "mock",
        } as never);

        const before = await toolNames(app, lead);
        console.log(
          "未启用团队的工具有 team_task_*：",
          before.filter((name) => name.startsWith("team_task_")),
        );

        await (
          teams as unknown as { setEnabled(agent: unknown, enabled: boolean): Promise<void> }
        ).setEnabled(lead, true);
        const after = await toolNames(app, lead);
        console.log(
          "启用团队后的 team_task_*：",
          after.filter((name) => name.startsWith("team_task_")),
        );
        expect(after.filter((name) => name.startsWith("team_task_"))).toEqual([
          "team_task_create",
          "team_task_get",
          "team_task_list",
          "team_task_update",
        ]);

        const created = await run(app, lead, "team_task_create", {
          subject: "端到端任务",
          description: "验证任务板",
        });
        console.log("create →", created.text);
        expect(created.isError).toBeFalsy();
        const task = JSON.parse(created.text) as { id: string; revision: number };
        expect(task.id).toBeTruthy();

        const listed = await run(app, lead, "team_task_list", {});
        console.log("list →", listed.text);
        expect(JSON.parse(listed.text)).toMatchObject({ tasks: [{ id: task.id }] });

        const claimed = await run(app, lead, "team_task_update", {
          task_id: task.id,
          expected_revision: task.revision,
          action: "claim",
        });
        console.log("claim →", claimed.text);
        expect(JSON.parse(claimed.text)).toMatchObject({ status: "in_progress" });

        const current = JSON.parse(claimed.text) as { revision: number };
        const completed = await run(app, lead, "team_task_update", {
          task_id: task.id,
          expected_revision: current.revision,
          action: "complete",
        });
        console.log("complete →", completed.text);
        expect(JSON.parse(completed.text)).toMatchObject({ status: "completed" });

        // 派一个队友：假 LLM 回一句后转 idle；任务板要能按它的名字分配。
        const subagents = app.get(SubagentRegistry);
        const teammate = await (
          subagents as unknown as {
            startActivation(input: unknown): Promise<{
              name: string;
              childId: unknown;
              dispose(): Promise<void>;
            }>;
          }
        ).startActivation({
          provider: "spawn",
          label: "worker",
          prompt: [{ type: "text", text: "待命" }],
          parent: lead,
          signal,
          delivery: "parent",
        });
        console.log("队友 →", teammate.name, String(teammate.childId));

        const agents = await run(app, lead, "list_agents", {});
        console.log("list_agents →", agents.text);
        expect(agents.text).toContain(teammate.name);

        const shared = await run(app, lead, "team_task_create", {
          subject: "交给队友的活",
          description: "按名字分配",
        });
        const sharedTask = JSON.parse(shared.text) as { id: string; revision: number };
        const assigned = await run(app, lead, "team_task_update", {
          task_id: sharedTask.id,
          expected_revision: sharedTask.revision,
          action: "reassign",
          owner: teammate.name,
        });
        console.log("reassign →", assigned.text);
        expect(JSON.parse(assigned.text)).toMatchObject({ owner: teammate.name });

        const filtered = await run(app, lead, "team_task_list", { owner: teammate.name });
        console.log("按名字过滤 →", filtered.text);
        expect(JSON.parse(filtered.text)).toMatchObject({
          tasks: [{ id: sharedTask.id, owner: teammate.name }],
        });

        const sent = await run(app, lead, "send_message", {
          agent: teammate.name,
          message: "继续待命",
        });
        console.log("send_message →", sent.text);
        expect(sent.isError).toBeFalsy();

        const waited = await run(app, lead, "wait_agent", {
          agent: teammate.name,
          timeout_ms: 10_000,
        });
        console.log("wait_agent →", waited.text);

        await teammate.dispose();
      } finally {
        await app.dispose().catch(() => {});
      }
    },
  );

  test(
    "idle 的队友能被消息唤醒（续跑不需要 preset roster）",
    { timeout: 120_000 },
    async ({ appEnv }) => {
      const { app, teams } = await boot(appEnv);
      try {
        const lead = await app
          .get(AgentLoop)
          .create(SessionId("team-e2e-resume"), { provider: "mock", model: "mock" } as never);
        await (
          teams as unknown as { setEnabled(agent: unknown, enabled: boolean): Promise<void> }
        ).setEnabled(lead, true);

        const subagents = app.get(SubagentRegistry) as unknown as {
          startActivation(input: unknown): Promise<{
            name: string;
            childId: unknown;
            dispose(): Promise<void>;
          }>;
          sendMessage(
            from: unknown,
            to: unknown,
            content: unknown,
            options: unknown,
          ): Promise<unknown>;
        };
        const child = await subagents.startActivation({
          provider: "spawn",
          label: "worker",
          prompt: [{ type: "text", text: "第一轮" }],
          parent: lead,
          signal,
          delivery: "parent",
        });
        // 假 LLM 一轮就结束：等它转 idle 再发消息——投影兜底时这一步会抛
        // "selecting a child agent preset requires the agent-presets service"。
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const messageId = await subagents.sendMessage(
          lead,
          child.childId,
          [{ type: "text", text: "第二轮" }],
          { signal },
        );
        console.log("续跑送达 →", String(messageId));
        expect(typeof messageId).toBe("string");
        await child.dispose();
      } finally {
        await app.dispose().catch(() => {});
      }
    },
  );

  test("任务板的依赖与 revision CAS", { timeout: 120_000 }, async ({ appEnv }) => {
    const { app, teams } = await boot(appEnv);
    try {
      const lead = await app
        .get(AgentLoop)
        .create(SessionId("team-e2e-board"), { provider: "mock", model: "mock" } as never);
      await (
        teams as unknown as { setEnabled(agent: unknown, enabled: boolean): Promise<void> }
      ).setEnabled(lead, true);

      const first = await run(app, lead, "team_task_create", {
        subject: "先做",
        description: "被依赖的那条",
      });
      const firstTask = JSON.parse(first.text) as { id: string; revision: number };
      const second = await run(app, lead, "team_task_create", {
        subject: "后做",
        description: "依赖前一条",
        blocked_by: [firstTask.id],
      });
      console.log("带依赖的任务 →", second.text);
      expect(JSON.parse(second.text)).toMatchObject({ ready: false });

      const claimed = await run(app, lead, "team_task_update", {
        task_id: firstTask.id,
        expected_revision: firstTask.revision,
        action: "claim",
      });
      const completed = await run(app, lead, "team_task_update", {
        task_id: firstTask.id,
        expected_revision: (JSON.parse(claimed.text) as { revision: number }).revision,
        action: "complete",
      });
      expect(JSON.parse(completed.text)).toMatchObject({ status: "completed" });

      const blocked = JSON.parse(second.text) as { id: string };
      const ready = await run(app, lead, "team_task_get", { task_id: blocked.id });
      console.log("依赖完成后 →", ready.text);
      expect(JSON.parse(ready.text)).toMatchObject({ ready: true });

      // 旧 revision 再改动：CAS 必须拒绝，而不是静默覆盖。
      const stale = await run(app, lead, "team_task_update", {
        task_id: firstTask.id,
        expected_revision: firstTask.revision,
        action: "reopen",
      });
      console.log("旧 revision →", stale.text);
      expect(stale.isError).toBe(true);
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  test("运行中的队友能被 interrupt_agent 打断", { timeout: 120_000 }, async ({ appEnv }) => {
    const { app, teams } = await boot(appEnv, new HangLlmAdapter());
    try {
      const lead = await app
        .get(AgentLoop)
        .create(SessionId("team-e2e-interrupt"), { provider: "mock", model: "mock" } as never);
      await (
        teams as unknown as { setEnabled(agent: unknown, enabled: boolean): Promise<void> }
      ).setEnabled(lead, true);

      const subagents = app.get(SubagentRegistry) as unknown as {
        startActivation(input: unknown): Promise<{
          name: string;
          childId: unknown;
          dispose(): Promise<void>;
        }>;
      };
      const child = await subagents.startActivation({
        provider: "spawn",
        label: "hang",
        prompt: [{ type: "text", text: "一直跑" }],
        parent: lead,
        signal,
        delivery: "parent",
      });

      const interrupted = await run(app, lead, "interrupt_agent", { agent: child.name });
      console.log("interrupt →", interrupted.text, interrupted.isError);
      expect(interrupted.isError).toBeFalsy();

      await child.dispose();
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});

/** 永远不回话的假模型：留给「打断运行中的队友」那条用例。 */
class HangLlmAdapter extends LlmAdapter {
  stream(): AsyncIterable<never> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<never>>(() => undefined),
      }),
    };
  }
}
