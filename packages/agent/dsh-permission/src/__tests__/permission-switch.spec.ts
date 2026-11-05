// 权限 chip 的**宿主侧闭环**：上游 chip 点确认后只做一件事——把整行 `/permission <preset>` 交给会话的
// command writer（`live.command('/permission danger-full-access')`）。
//
// 这条 spec 直接构造那个调用（`commands/execute`），断言**真的切了档位**：契约上的 `permissions` 投影
// 变成新档位，而 `permissionPresets/catalog` 的默认档位（新会话用的那个）不受影响。
//
// 为什么值得单独测：实机上点确认"什么都不发"时，有两种可能——命令没注册（宿主侧），或 chip 早退（前端）。
// 这条绿了，就说明宿主侧一直是好的，问题只能在 chip 拿到的那条会话身份上。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { AgentLoopDefault, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { provideAgent } from "@morlay/dsh-agent";
import { COMMAND_EXECUTE_ENDPOINT, type CommandExecuteValue } from "@morlay/dsh-command/endpoint";
import { provideCommand } from "@morlay/dsh-command/server";
import { providePermissionFor } from "@morlay/dsh-permission/server";
import { BashSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import {
  AppEnv,
  RemoteHandlers,
  RemoteHandlersDefault,
  type AppEnvValues,
} from "@morlay/zephyr-app";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_PRESETS_CATALOG_ENDPOINT } from "../endpoint/permission-presets-endpoint.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-permission-switch-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 指向临时目录的运行环境。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/**
 * 起完整的一行：会话 + agent + 权限（默认 `workspace-write`）+ 命令面。
 * @returns handler 表、会话 id 与 app。
 */
async function boot(): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  handlers: RemoteHandlers;
  sessionId: string;
}> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      FakeAppEnv,
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
    timeoutMs: 20_000,
  });
  apps.push(app);
  const sessionId = app.get(SessionStore).prepare().id;
  await app
    .get(AgentLoop)
    .create(sessionId, { provider: "deepseek-official", model: "deepseek-flash" }, { cwd: root });
  return { app, handlers: app.get(RemoteHandlers), sessionId };
}

/** 会话的 `permissions` 投影（宿主侧注册表里的当前值）。 */
function permissionOf(
  app: Awaited<ReturnType<typeof bootstrapApplication>>,
  sessionId: string,
): unknown {
  const projections = app.get(SessionProjectionStore);
  const session = app.get(SessionStore).get(SessionId(sessionId));
  if (session === undefined) throw new Error(`会话 "${sessionId}" 不在 store 里`);
  return (projections.snapshot(session) as { values?: Record<string, { currentValue?: string }> })
    .values?.permissions;
}

describe("权限 chip 的宿主侧", () => {
  it("`/permission danger-full-access` 真的把会话档位切过去", { timeout: 30_000 }, async () => {
    const { app, handlers, sessionId } = await boot();
    // 起点：装配给的默认档位。
    expect(permissionOf(app, sessionId)).toMatchObject({ currentValue: "workspace-write" });

    // chip 点确认后发的那一行（上游 `submit` 就是 `live.command('/permission <preset>')`）。
    // `commands/execute` 回的是命令自己的结算值（裸值，不包 `RemoteResult`）：`{ kind, text }`。
    const executed = (await handlers.invoke(COMMAND_EXECUTE_ENDPOINT, {
      sessionId,
      name: "permission",
      input: "danger-full-access",
    })) as CommandExecuteValue;
    expect(executed.result.kind, "/permission 应成功结算").toBe("success");

    // 会话档位变了……
    expect(permissionOf(app, sessionId)).toMatchObject({ currentValue: "danger-full-access" });
    // ……而"新会话的默认档位"不受影响（它由设置文档管，不随当前会话切换）。
    const catalog = (await handlers.invoke(PERMISSION_PRESETS_CATALOG_ENDPOINT, {})) as {
      value?: { defaultPreset?: string };
    };
    expect(catalog.value?.defaultPreset).toBe("workspace-write");
  });

  it("不带 preset 的 `/permission` 只回报当前档位，不改它", { timeout: 30_000 }, async () => {
    const { app, handlers, sessionId } = await boot();
    const executed = (await handlers.invoke(COMMAND_EXECUTE_ENDPOINT, {
      sessionId,
      name: "permission",
      input: " ",
    })) as CommandExecuteValue;
    expect(executed.result.kind).toBe("success");
    expect(permissionOf(app, sessionId)).toMatchObject({ currentValue: "workspace-write" });
  });
});
