// 权限 chip 的**宿主侧闭环**：上游 chip 点确认后只做一件事——把整行 `/permission <preset>` 交给会话的
// command writer（`live.command('/permission danger-full-access')`）。
//
// 这条 spec 直接构造那个调用（`commands/execute`），断言**真的切了档位**：契约上的 `permissions` 投影
// 变成新档位，而 `permissionPresets/catalog` 的默认档位（新会话用的那个）不受影响。
//
// 为什么值得单独测：实机上点确认"什么都不发"时，有两种可能——命令没注册（宿主侧），或 chip 早退（前端）。
// 这条绿了，就说明宿主侧一直是好的，问题只能在 chip 拿到的那条会话身份上。
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { AgentLoopDefault, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { provideAgent } from "@morlay/dsh-agent";
import { CommandEndpointClient } from "@morlay/dsh-command/ui";
import { provideCommand } from "@morlay/dsh-command/server";
import { providePermissionFor } from "@morlay/dsh-permission/server";
import { BashSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { type App } from "@morlay/zephyr";
import { AppEnv, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { Remote } from "@morlay/zephyr-app/contract";
import { bootTwoSided, clientWithTransport } from "@morlay/zephyr-app/testing";
import { describe, expect, test, type AppEnvFixture } from "@morlay/zephyr-app/testing";
import { PermissionPresetsEndpointClient } from "../ui/permission-presets-endpoint.client.ts";

/** 指向临时目录的运行环境。 */
/** 一份双端装配：host 断后端、client 断前端；生命周期由 `bootTwoSided` 自己收。 */
interface Booted {
  /** 后端装配（会话 / agent / 权限 / 命令都在这一侧）。 */
  readonly host: App;
  /** 前端装配（只持传输，`LocalRemote` 是两 ctx 之间唯一的桥）。 */
  readonly client: App;
  readonly sessionId: string;
}

/**
 * 起完整的一行：会话 + agent + 权限（默认 `workspace-write`）+ 命令面。
 * @returns 双端装配与建好的会话 id。
 */
async function boot(appEnv: AppEnvFixture): Promise<Booted> {
  const two = await bootTwoSided({
    createHost: () => [
      ...provideSession(),
      ...provideSessionProjection(),
      { provide: AppEnv, useValue: appEnv },
      ...provideAgent(),
      // 顺序即装配顺序：`shell` / `bash` 的适配面要先就位，权限行构造期就读 `ctx.shell.sandboxMode`。
      SubprocessDefault,
      SandboxDefault,
      SandboxPolicyDefault,
      BashSandbox,
      ...providePermissionFor("workspace-write"),
      // `/permission` 这条命令由上游 `permission-presets` 往命令注册表里注册（`ctx.inject(['commands'])`）。
      ...provideCommand(),
      // 循环期：要真 `AgentLoop` 建会话。
      ToolExecutorNative,
      { provide: AgentLoopDefault, config: { agents: [] } },
      RemoteHandlersDefault,
    ],
    // client 装配：只持传输（`LocalRemote` 是两 ctx 之间唯一的桥）。
    createClient: (booted) => clientWithTransport(booted, []),
    // 卸载跟着 fixture 的清理链走：它跑在「删临时目录」之前（`onTestFinished` 更晚，见 `fixtures.ts`）。
  }, appEnv);
  if (two.client === undefined) throw new Error("client 没装上");
  const sessionId = two.host.get(SessionStore).prepare().id;
  await two.host
    .get(AgentLoop)
    .create(
      sessionId,
      { provider: "deepseek-official", model: "deepseek-flash" },
      { cwd: appEnv.values.dataDir },
    );
  return { host: two.host, client: two.client, sessionId };
}

/**
 * 契约的客户端形态：只挂 `remote`，不进装配（宿主实现与它同一个令牌）。
 * @param app - 装配结果（`remote` 走它的 `LocalRemote`）。
 * @returns 可以直接 `execute(…)` 的客户端。
 */
function commandClientOf(client: App): CommandEndpointClient {
  return Object.assign(new CommandEndpointClient(), { remote: client.get(Remote) });
}

/** 会话的 `permissions` 投影（宿主侧注册表里的当前值）。 */
function permissionOf(app: App, sessionId: string): unknown {
  const projections = app.get(SessionProjectionStore);
  const session = app.get(SessionStore).get(SessionId(sessionId));
  if (session === undefined) throw new Error(`会话 "${sessionId}" 不在 store 里`);
  return (projections.snapshot(session) as { values?: Record<string, { currentValue?: string }> })
    .values?.permissions;
}

describe("权限 chip 的宿主侧", () => {
  test(
    "`/permission danger-full-access` 真的把会话档位切过去",
    { timeout: 30_000 },
    async ({ appEnv }) => {
      const { host, client, sessionId } = await boot(appEnv);
      // 起点：装配给的默认档位。
      expect(permissionOf(host, sessionId)).toMatchObject({ currentValue: "workspace-write" });

      // chip 点确认后发的那一行（上游 `submit` 就是 `live.command('/permission <preset>')`）。
      // `commands/execute` 回的是命令自己的结算值（裸值，不包 `RemoteResult`）：`{ kind, text }`。
      const executed = await commandClientOf(client).execute({
        sessionId,
        name: "permission",
        input: "danger-full-access",
      });
      expect(executed.result.kind, "/permission 应成功结算").toBe("success");

      // 会话档位变了……
      expect(permissionOf(host, sessionId)).toMatchObject({ currentValue: "danger-full-access" });
      // ……而"新会话的默认档位"不受影响（它由设置文档管，不随当前会话切换）。
      // 端点客户端是**前端形态**：只挂 `Remote`，不进装配（后端那份是同令牌的宿主实现）。
      const catalog = await Object.assign(new PermissionPresetsEndpointClient(), {
        remote: client.get(Remote),
      }).catalog();
      if (!catalog.ok) throw new Error("permissionPresets/catalog 失败：" + catalog.error.message);
      expect(catalog.value.defaultPreset).toBe("workspace-write");
    },
  );

  test(
    "不带 preset 的 `/permission` 只回报当前档位，不改它",
    { timeout: 30_000 },
    async ({ appEnv }) => {
      const { host, client, sessionId } = await boot(appEnv);
      const executed = await commandClientOf(client).execute({
        sessionId,
        name: "permission",
        input: " ",
      });
      expect(executed.result.kind).toBe("success");
      expect(permissionOf(host, sessionId)).toMatchObject({ currentValue: "workspace-write" });
    },
  );
});
