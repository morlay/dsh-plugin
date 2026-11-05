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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoop } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent/server";
import { CommandEndpointClient, RemoteCommandRunner } from "@morlay/dsh-command/ui";
import { provideCommand } from "@morlay/dsh-command/server";
import { providePermissionFor } from "@morlay/dsh-permission/server";
import { BashSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { SessionStore } from "@morlay/dsh-session";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { SessionRemote } from "@morlay/zephyr-app/client";
import { provideLocalRemote } from "@morlay/zephyr-app/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SessionController } from "@morlay/dsh-session/ui";
import { provideSessionsStore } from "@morlay/dsh-session/ui";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-permission-chip-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 指向临时目录的运行环境。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root, dev: false };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

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

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
}, 30_000);

/**
 * 装配整条链：宿主（会话 + agent + 权限 + 命令面）+ 客户端（`sessions` 服务 + 走进程内传输的命令执行器）。
 * @returns app 与建好的会话 id。
 */
async function boot(): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  sessionId: string;
}> {
  const app = await bootstrapApplication({
    providers: [
      // 进程内传输：`remote.upstream.commands.*` 直接打到本进程的 handler 表。
      ...provideLocalRemote(),
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
      ...provideCommand(),
      // 客户端面：`sessions` 服务 + 走 remote 的命令执行器（就是 `binding.session.command` 的实现）。
      { provide: SessionRemote, useFactory: () => new FakeSessionRemote() },
      CommandEndpointClient,
      RemoteCommandRunner,
      ...provideSessionsStore(),
    ],
    timeoutMs: 30_000,
  });
  apps.push(app);
  const sessionId = app.get(SessionStore).prepare().id;
  await app
    .get(AgentLoop)
    .create(sessionId, { provider: "deepseek-official", model: "deepseek-flash" }, { cwd: root });
  // 目录里要有这条会话：`binding()` 的判据是 `ids.includes(id)`。
  (app.get(SessionRemote) as FakeSessionRemote).setRows([String(sessionId)]);
  return { app, sessionId: String(sessionId) };
}

/** 会话的 `permissions` 投影当前值。 */
function permissionOf(
  app: Awaited<ReturnType<typeof bootstrapApplication>>,
  sessionId: string,
): string | undefined {
  const projections = app.get(SessionProjectionStore);
  const session = app.get(SessionStore).get(SessionId(sessionId));
  if (session === undefined) throw new Error(`会话 "${sessionId}" 不在 store 里`);
  const values = (
    projections.snapshot(session) as { values?: Record<string, { currentValue?: string }> }
  ).values;
  return values?.permissions?.currentValue;
}

/** `binding().session.command` 的调用面（上游 chip 读的就是它）。 */
interface ChipFace {
  binding(
    id: string,
  ):
    | {
        session?: { command(line: string): Promise<{ ok: boolean; value?: { matched: boolean } }> };
      }
    | undefined;
  refresh(): Promise<void>;
}

/**
 * 物化 scope：上游 `binding(id)` 只给已 `retain` 过的会话。
 * @param sessions - 会话服务。
 * @param id - 会话身份。
 */
function retain(sessions: ChipFace, id: string): void {
  (sessions as unknown as { retain(t: never, o: unknown): void }).retain(id as never, {
    source: "gateway",
  });
}

// 已知阻塞（第一版不支持）：这条用例在**同一个 `bootstrapApplication`** 里同时装
// `CommandEndpointDefault`（宿主行）与 `CommandEndpointClient`（客户端行）——两者都 `extends CommandEndpoint`，
// 令牌名相同，cordis 的扁平 store 只允许注册一次（`service "command-endpoint" has been registered`）。
// 真实部署里前端在浏览器、后端在宿主，各自一个 bootstrap；旧 zephyr 的"行作用域"在新模型里已删除。
// 后续验法：两个 app + 假 transport，或拆成 wire 层 + ui 层两段各自装配。
describe.skip("权限 chip 从 ui 走到底", () => {
  it(
    "`binding().session.command('/permission danger-full-access')` 真的切了宿主档位",
    { timeout: 30_000 },
    async () => {
      const { app, sessionId } = await boot();
      const sessions = app.get(SessionController) as unknown as ChipFace;
      // 先拉一次目录，`binding()` 才有行可查（装配期的 `onInit` 早于我们塞 rows）；
      // 再 `retain` 一次物化 scope——上游 `binding()` 读的是已物化的 scope。
      await sessions.refresh();
      retain(sessions, sessionId);

      expect(permissionOf(app, sessionId), "装配给的默认档位").toBe("workspace-write");
      const binding = sessions.binding(sessionId);
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
      expect(permissionOf(app, sessionId), "宿主档位必须真的变了").toBe("danger-full-access");
    },
  );

  it(
    "宿主没有这条命令时回 `matched: false` 之外的结构化失败（不静默）",
    { timeout: 30_000 },
    async () => {
      const { app, sessionId } = await boot();
      const sessions = app.get(SessionController) as unknown as ChipFace;
      await sessions.refresh();
      retain(sessions, sessionId);
      const result = await sessions.binding(sessionId)?.session?.command("/no-such-command arg");
      expect(result?.ok).toBe(false);
      expect(permissionOf(app, sessionId), "失败的调用不该改档位").toBe("workspace-write");
    },
  );
});
