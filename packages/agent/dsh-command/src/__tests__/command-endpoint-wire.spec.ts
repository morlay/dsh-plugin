/**
 * `commands` 组的**wire 形状**判据：`execute` 是三个位置参数（会话 / 整行 / 附件），不是「一个请求对象」。
 *
 * 为什么要有这条：上游的消费方全都按位置调（`ui-commands` 的 `ctx.remote.commands.execute(sessionId, line, attachments)`、
 * `ui-plan` 的 `execute(sessionId, '/plan off', [])`、会话面的 `execute(this.sessionId, line, [])`）。契约里曾漏了
 * `parameters` 声明，descriptor 于是把第一个实参编成 `request` —— 整行与附件都丢，宿主只收到一个字符串，
 * 真机症状是 `commands/execute: 缺少会话或命令名`。这里同时钉两层：**descriptor 的参数名**（客户端那半）
 * 与 **handler 收到的东西**（宿主那半）。
 */
import type { CommandInvocation, CommandResult } from "@morlay/dsh-command/server";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { AgentLoopDefault, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { provideAgent } from "@morlay/dsh-agent";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { RemoteHandlers, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { Command, CommandRegistryDefault } from "../index.ts";
import { CommandEndpointDefault, RegistryCatalog, RegistryRunner } from "@morlay/dsh-command/server";
import { CommandEndpoint } from "../endpoint/index.ts";

/** 会话身份：agent 目录与命令目录都按它寻址。 */
const SESSION = SessionId("s1");

/** 被测命令：只记下它收到的原始输入，用来判「整行被拆对了」。 */
@Command()
class ProbeCommand {
  readonly name = "probe";

  readonly description = "探针命令";

  readonly handled: string[] = [];

  handler(invocation: CommandInvocation): CommandResult {
    this.handled.push(invocation.rawInput.trim());
    return { kind: "success", text: "ok" };
  }
}

/**
 * 装起来：真注册表 + 真 agent 目录 + `commands` 组的宿主实现 + handler 表。
 * @returns 应用。
 */
async function commandApp(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideAgent(),
      ToolExecutorNative,
      { provide: AgentLoopDefault, config: { agents: [] } },
      // handler 表：`CommandEndpointDefault` 在 `onInit` 里往它注册这一组的方法。
      RemoteHandlersDefault,
      CommandRegistryDefault,
      RegistryCatalog,
      RegistryRunner,
      ProbeCommand,
      CommandEndpointDefault,
    ],
    timeoutMs: 20_000,
  });
  await app.get(AgentLoop).create(SESSION, { provider: "deepseek-official", model: "deepseek-flash" });
  return app;
}

describe("commands 组的 wire 形状", () => {
  test("descriptor：`execute` 的三个位置参数按上游的名字声明（不是 `request`）", () => {
    const descriptor = remoteDescriptorsOf(CommandEndpoint).descriptors.find(
      (one) => one.method === "execute",
    );
    expect(descriptor?.parameters.map((parameter) => parameter.name)).toEqual([
      "sessionId",
      "line",
      "submittedAttachments",
    ]);
  });

  test("宿主：扁平参数名（上游调用方的形状）能执行，包一层 `request` 的不行", async () => {
    const app = await commandApp();
    try {
      const handlers = app.get(RemoteHandlers);
      // ① 上游形状：三个扁平字段 → 命令真的跑了，且整行被拆成「名字 + 输入」。
      const executed = (await handlers.invoke("commands/execute", {
        sessionId: String(SESSION),
        line: "/probe v2",
        submittedAttachments: [],
      })) as { result: { kind: string } };
      expect(executed.result.kind).toBe("success");
      expect(app.get(ProbeCommand).handled).toEqual(["v2"]);
      // ② 旧形状（`{ request: {...} }`）：宿主拿不到会话，必须**明确报错**而不是静默丢写。
      await expect(handlers.invoke("commands/execute", { request: {} })).rejects.toThrow(/没有 agent/);
    } finally {
      await app.dispose();
    }
  });
});
