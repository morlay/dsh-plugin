// 权限 chip 的**前端闭环**：把上游 `PermissionSelect.submit` 干的事原样走一遍——
//
//   sessions.binding(sessionId)?.session.command('/permission danger-full-access')
//
// 断言落在**宿主档位真的变了**（`permissions` 投影），而不是"函数被调过"。
//
// 为什么这条最重要：实机上点确认"没反应"时，上游 `submit` 的调用方是 `.catch(() => false)`，
// 任何一环失败都被吞成静默。这条 spec 把每一环都换成真实现（`sessions` 服务、`RemoteCommandRunner`
// → 契约转发 → `CommandEndpointDefault` → `CommandRegistryDefault` → 上游 `CommandRuntime`），
// 唯一替身是目录读取（`FakeSessionRemote`），于是"是宿主没实现，还是前端没发出去"一眼可分。
import { AgentLoopDefault, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { provideAgent } from "@morlay/dsh-agent";
import { CommandEndpointClient, RemoteCommandRunner } from "@morlay/dsh-command/ui";
import { provideCommand } from "@morlay/dsh-command/server";
import { providePermissionFor } from "@morlay/dsh-permission/server";
import { BashSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { SessionStore } from "@morlay/dsh-session";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { Injectable, type App } from "@morlay/zephyr";
import { AppEnv, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { SessionRemote } from "@morlay/zephyr-app/client";
import { bootTwoSided, clientWithTransport } from "@morlay/zephyr-app/testing";
import { describe, expect, test, type AppEnvFixture } from "@morlay/dsh-conversation/testing";
import { SessionController } from "@morlay/dsh-conversation/ui";
import { provideSessionsStore } from "@morlay/dsh-conversation/ui";

/** 目录读取的替身：本 spec 的被测面是"那一行命令"，不是列表拉取。 */
@Injectable()
class FakeSessionRemote extends SessionRemote {
  private rows: readonly string[] = [];

  setRows(ids: readonly string[]): void {
    this.rows = ids;
  }

  async list(): Promise<unknown> {
    // 上游 `session/list` 的响应是 `{ items: SessionSummary[] }`。
    return {
      items: this.rows.map((sessionId) => ({
        sessionId,
        agentAvailable: true,
        running: false,
        blank: false,
        updatedAt: 0,
      })),
    };
  }

  async create(): Promise<unknown> {
    return { sessionId: "s1" };
  }

  async readPage(): Promise<unknown> {
    return { entries: [], hasMore: false };
  }
}

/**
 * 装配整条链：宿主（会话 + agent + 权限 + 命令面）+ 客户端（`sessions` 服务 + 走进程内传输的命令执行器）。
 * 生命周期由 `bootTwoSided` 跟着 `appEnv` 的清理链收，这里不返回卸载函数。
 * @param appEnv - 本用例的运行环境（数据根是它的临时目录）。
 * @returns 前端 app（被测面）、后端 app 与建好的会话 id。
 */
async function boot(appEnv: AppEnvFixture): Promise<{
  /** 前端装配：chip 的调用面在这一侧。 */
  app: App;
  /** 后端装配：宿主档位在这一侧的投影里。 */
  host: App;
  sessionId: string;
}> {
  const two = await bootTwoSided({
    createHost: () => [
      RemoteHandlersDefault,
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
      ...provideCommand(),
      // 循环期：要真 `AgentLoop` 建会话、真命令运行时派发这一行（与宿主侧同一份行清单）。
      ToolExecutorNative,
      { provide: AgentLoopDefault, config: { agents: [] } },
    ],
    // client = sessions + 命令执行器；传输由 `clientWithTransport` 接到 host 的执行面上。
    createClient: (booted) =>
      clientWithTransport(booted, [
        { provide: SessionRemote, useFactory: () => new FakeSessionRemote() },
        CommandEndpointClient,
        RemoteCommandRunner,
        ...provideSessionsStore(),
      ]),
    // 卸载跟着 fixture 的清理链走：它跑在「删临时目录」之前（`onTestFinished` 更晚，见 `fixtures.ts`）。
  }, appEnv);
  if (two.client === undefined) throw new Error("client 没装上");
  // 会话建在**后端**：`SessionStore` / `AgentLoop` 是宿主那侧的行。
  const sessionId = two.host.get(SessionStore).prepare().id;
  await two.host
    .get(AgentLoop)
    .create(
      sessionId,
      { provider: "deepseek-official", model: "deepseek-flash" },
      { cwd: appEnv.values.dataDir },
    );
  // 目录里要有这条会话：`binding()` 的判据是 `ids.includes(id)`。
  (two.client.get(SessionRemote) as FakeSessionRemote).setRows([String(sessionId)]);
  return { app: two.client, host: two.host, sessionId: String(sessionId) };
}

/** 会话的 `permissions` 投影当前值。 */
function permissionOf(app: App, sessionId: string): string | undefined {
  const projections = app.get(SessionProjectionStore);
  const session = app.get(SessionStore).get(SessionId(sessionId));
  if (session === undefined) throw new Error(`会话 "${sessionId}" 不在 store 里`);
  const values = (
    projections.snapshot(session) as { values?: Record<string, { currentValue?: string }> }
  ).values;
  return values?.permissions?.currentValue;
}

/** `binding().session.command` 的调用面（上游 chip 读的就是它；契约面把 `binding` 标成 `unknown`）。 */
type ChipBinding =
  | {
      session?: {
        command(line: string): Promise<{ ok: boolean; value?: { matched: boolean } }>;
      };
    }
  | undefined;

/**
 * 物化 scope 并取那一行的 binding。
 *
 * 上游 `binding(id)` 只给已 `retain` 过的会话（`scopes.get(id)?.binding`），所以先 `retain` 一次——
 * 契约面把 `binding` 的返回标成 `unknown`（本装配不承诺上游 `SessionBinding` 的完整面），这里收窄一次。
 * @param sessions - 会话服务（契约面）。
 * @param id - 会话身份。
 * @returns 那一行的 binding 读面。
 */
function bindingOf(sessions: SessionController, id: string): ChipBinding {
  sessions.retain(SessionId(id), { source: "gateway" });
  return sessions.binding(id) as ChipBinding;
}

// 这条曾经是 skip：那时宿主的 `CommandEndpointDefault` 与客户端的 `CommandEndpointClient` 装在同一份清单里，
// 两者都 `extends CommandEndpoint`、令牌同名，cordis 的扁平 store 只许注册一次。双端装配（`bootTwoSided`，
// 前端行在后端行之外的那个 app 里）之后令牌不再撞名，宿主再补上循环期那两行就能真跑通。
describe("权限 chip 从 ui 走到底", () => {
  test(
    "`binding().session.command('/permission danger-full-access')` 真的切了宿主档位",
    { timeout: 30_000 },
    async ({ appEnv }) => {
      const { app, host, sessionId } = await boot(appEnv);
      const sessions = app.get(SessionController);
      // 先拉一次目录，`binding()` 才有行可查（装配期的 `onInit` 早于我们塞 rows）。
      await sessions.refresh();

      expect(permissionOf(host, sessionId), "装配给的默认档位").toBe("workspace-write");
      const binding = bindingOf(sessions, sessionId);
      // 只判类型、不持有引用：`command` 是绑定在 session 上的方法，取出来单独断言会丢 `this`。
      expect(typeof binding?.session?.command, "chip 依赖的 `session.command` 必须是函数").toBe(
        "function",
      );

      // 上游 `PermissionSelect.submit` 的原样调用。
      const result = await binding?.session?.command("/permission danger-full-access");
      expect(result, "调用必须成功（失败会被上游 `.catch(() => false)` 吞掉）").toMatchObject({
        ok: true,
        value: { matched: true },
      });
      expect(permissionOf(host, sessionId), "宿主档位必须真的变了").toBe("danger-full-access");
    },
  );

  test(
    "宿主没有这条命令时回 `matched: false` 之外的结构化失败（不静默）",
    { timeout: 30_000 },
    async ({ appEnv }) => {
      const { app, host, sessionId } = await boot(appEnv);
      const sessions = app.get(SessionController);
      await sessions.refresh();
      const result = await bindingOf(sessions, sessionId)?.session?.command("/no-such-command arg");
      expect(result?.ok).toBe(false);
      expect(permissionOf(host, sessionId), "失败的调用不该改档位").toBe("workspace-write");
    },
  );
});
