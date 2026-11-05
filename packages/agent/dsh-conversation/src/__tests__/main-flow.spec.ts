// **主流程的宿主侧闭环**：新建会话 → 归到工作区 → 改权限。
//
// 三步都是用户实际走的第一段路，每步都断言**可观察的结果**（目录行 / 工作区的 `sessionIds` / 会话投影），
// 而不是「函数被调过」：
//   ① `session/create { cwd }` 之后，`session/list` 里有这一行，`cwd` 就是选的目录；
//   ② 同一时刻，那个工作区的 `sessionIds` 里有它（侧栏的会话树按这个渲染）；
//   ③ `/permission <preset>` 之后，会话的 `permissions` 投影变成新档位（chip 显示的就是它）。
//
// 模型选择那一步的闭环需要 `SessionControllerRow` 全栈（它 inject 附件、上传、文件系统、远程访问等
// 六七个面），不在本 spec 里重复搭建；它的**弱断言**已在 `session-endpoints.spec` 覆盖。
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { provideAgent } from "@morlay/dsh-agent";
import { AgentLoopDefault, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { COMMAND_EXECUTE_ENDPOINT, type CommandExecuteValue } from "@morlay/dsh-command/endpoint";
import { provideCommand } from "@morlay/dsh-command/server";
import { provideShell } from "@morlay/dsh-shell/server";
import { SessionProjectionStore, SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideStorageJson } from "@morlay/dsh-storage";
import { provideStorage } from "@morlay/dsh-storage";
import { WorkspaceRegistry } from "@morlay/dsh-workspace";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { configure, bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues, RemoteHandlers, provideApiGateway } from "@morlay/zephyr-app";
import { describe } from "vitest";
import { expect, test } from "./support/fixtures.ts";
import { provideTypert, TypertGateway } from "@morlay/zephyr-app";
import { provideApiSession } from "@morlay/dsh-conversation/server";
import { provideSessionQuerySqlite } from "@morlay/dsh-session/server";
import { provideSandbox } from "@morlay/dsh-sandbox";
import { providePermissionFor } from "@morlay/dsh-permission/server";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideUpload } from "@morlay/dsh-upload";
import { provideWorkingDirectory, WorkingDirectoryDefault } from "@morlay/dsh-agent";
import { Connection, RemoteAccess } from "@morlay/zephyr-app";
import { publishingTo } from "@morlay/zephyr-app/testing";

/** 指向临时目录的运行环境（每个用例一份数据根）。 */
/** working-directory 的默认目录：本 spec 只要求它存在（`SkillCatalog` 读它）。 */
function tmpdirForWorkingDirectory(): string {
  return process.cwd();
}

/** 连接替身：`media-references` 行要它（生成文件路由）；本 spec 不触发下载。 */
function fakeConnection(): Connection {
  return {
    interactions: "none",
    generation: { getSnapshot: () => ({ id: 1, host: { home: "" } }), subscribe: () => () => {} },
    isLoopback: true,
    state: { getSnapshot: () => "connected", subscribe: () => () => {} },
    openWebSocket: () => {
      throw new Error("本 spec 不建 socket");
    },
    registerGenerationSource: () => () => {},
    rpc: { register: () => () => {}, call: async () => undefined },
    fetch: {
      register: () => () => {},
      requestBodyMode: () => "streaming",
      dispatch: async () => undefined,
    },
    reconnect: () => {},
    start: () => ({ stop: () => {} }),
  } as unknown as Connection;
}

/** 准入替身：全放行（上游 `@Remote` 分派前读 `decide`）。 */
function allowAllAccess(): RemoteAccess {
  return {
    decide: () => ({ allowed: true }),
    allows: () => true,
    source: () => undefined,
    whenAccess: () => () => {},
    whenResourceAccess: () => () => {},
    registerPolicy: () => () => {},
    snapshotFor: () => ({}),
    follow: () => () => {},
    invalidate: () => {},
  } as unknown as RemoteAccess;
}

@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues;

  readonly cacheDir: string;

  readonly packageRoot: string;

  readonly appBootDir: string;

  readonly profileManifest: string;

  constructor(root: string) {
    super();
    this.values = { dataDir: root, profileDir: root };
    this.cacheDir = join(root, "cache");
    this.packageRoot = root;
    this.appBootDir = join(root, "boot");
    this.profileManifest = join(root, "package.json");
  }
}

/**
 * 装宿主侧主流程需要的面。
 * @param root - 本用例的临时数据根（fixture 提供、自动回收）。
 * @returns app。
 */
async function boot(root: string): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      // 装配顺序 = 依赖顺序（适配行的契约面在它自己的 mount 之后才绑上）。
      // 上游 gateway 分派前读 `remoteAccess.decide(...)`（真实实现默认 deny），这里全放行。
      { provide: RemoteAccess, useFactory: () => allowAllAccess() },
      publishingTo(RemoteAccess, "remoteAccess"),
      { provide: Connection, useFactory: () => fakeConnection() },
      { provide: AppEnv, useFactory: () => new FakeAppEnv(root) },
      ...provideTypert(),
      // `provideApiGateway()` 已含 `RemoteHandlersDefault`：不能再并列一条（同名服务重复注册）。
      ...provideApiGateway(),
      ...provideAttachment(),
      // 命令注册表必须先于上传行：上游 `FileUploads` 在构造期就 `ctx.commands.registerFileReceiptResolver(…)`。
      ...provideCommand(),
      ...provideUpload(),
      // 存储：hub 与 domain 在前、后端紧随；会话持久化在工作区之前（工作区 init 里读它）。
      ...provideStorage(),
      ...provideStorageJson(),
      ...provideSessionPersistence(),
      // 会话三份 root（store / 投影 / 查询）。
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionQuerySqlite(),
      // 子进程 seam 先装：沙箱的 bash 执行器要它。
      ...provideShell(),
      // 沙箱整域（含 `FileSystem` 的实现 `FsSandbox`，`working-directory` 要它）。
      ...providePermissionFor("workspace-write"),
      ...provideAgent(),
      // 循环期：要真 agent 工厂。

      ToolExecutorNative,

      { provide: AgentLoopDefault, config: { agents: [] } },
      ...provideWorkingDirectory(
        configure(WorkingDirectoryDefault, { defaultDirectory: tmpdirForWorkingDirectory() }),
      ),
      ...provideWorkspace(),
      ...provideSandbox(),
      // 端点行 inject 了 agent 域与工作区的适配行契约：必须排在它们之后，否则拿到的是空壳。
      ...provideApiSession(),
    ],
    timeoutMs: 30_000,
  });
  return app;
}

/** 会话的某个投影当前值。 */
function projectionOf(app: App, sessionId: string, key: string): unknown {
  const projections = app.get(SessionProjectionStore);
  const session = app.get(SessionStore).get(SessionId(sessionId));
  if (session === undefined) throw new Error(`会话 "${sessionId}" 不在 store 里`);
  const values = (projections.snapshot(session) as { values?: Record<string, unknown> }).values;
  return values?.[key];
}

describe("主流程（宿主侧）：新建 → 选工作区 → 改权限", () => {
  test("三步都生效：目录有行且 cwd 正确、工作区收到会话、权限档位变了", async ({ tmpdir }) => {
    const app = await boot(tmpdir);
    try {
      // 端点由上游 `SessionController` 提供，经 `typertGateway` 分派（与本行 `ui` 半是两条边）。
      const gateway = app.get(TypertGateway);
      const peer = {
        id: "spec",
        signal: new AbortController().signal,
        interactions: "answer",
        // 上游分派前读 `peer.principal.kind`（资源准入用）。
        principal: { kind: "browser", id: "spec" },
      } as never;
      const host = {
        createSession: async (request: unknown): Promise<{ sessionId?: string }> =>
          (await gateway.invoke({
            namespace: "session",
            method: "create",
            args: { request },
            peer,
          } as never)) as { sessionId?: string },
        snapshotForRemote: async (): Promise<{
          ids: readonly string[];
          byId: Record<string, { cwd?: string }>;
        }> =>
          (await gateway.invoke({
            namespace: "session",
            method: "list",
            args: {},
            peer,
          } as never)) as never,
      };
      const handlers = app.get(RemoteHandlers);
      const realRoot = await realpath(tmpdir);

      // ① 先把目录登记成工作区（会话创建只认已注册的工作区：默认工作区是启动目录，不按 cwd 懒创建）。
      await app.get(WorkspaceRegistry).create(tmpdir);
      // ② 新建会话（指定目录）。
      const created = await host.createSession({ cwd: tmpdir });
      const sessionId = created.sessionId;
      expect(sessionId, "宿主必须回一个会话身份").toBeTruthy();

      // ② 目录里有这一行，且 cwd 就是刚选的目录（宿主会规范化成 `realpath`）。
      // 上游 `session/list` 的协议是 `{ items: [{ id, cwd }] }`（不是自研端点的 `{ ids, byId }`）。
      // 上游 `sessions/list` 的行是 `SessionSummary`（身份字段是 `sessionId`）；`cwd` 不在行上，
      // 目录归属要看工作区的 `sessionIds`（下一步）。
      const listed = (await host.snapshotForRemote()) as unknown as {
        items?: readonly { sessionId?: string; blank?: boolean }[];
      };
      const rows = listed.items ?? [];
      expect(
        rows.map((row) => row.sessionId),
        "新建的会话必须进目录（侧栏才有行可点）",
      ).toContain(sessionId);
      expect(
        rows.find((row) => row.sessionId === sessionId)?.blank,
        "刚建、还没写过 turn 的会话是 blank（上游按它隐藏侧栏行）",
      ).toBe(true);

      // ③ 会话归到那个工作区（侧栏的会话树按工作区的 `sessionIds` 渲染）。
      // 会话的 cwd 落在所选目录（会话 header 是权威；上游 `create` 只写它）。
      const session = app.get(SessionStore).get(SessionId(String(sessionId)));
      // 上游 `create` 原样记下传进来的 cwd（macOS 的 `/var` 与 `/private/var` 是同一个目录的两种写法），
      // 所以这里比 realpath，而不是比字面量。
      const sessionCwd = session?.header.cwd ?? "";
      expect(await realpath(sessionCwd), "会话的 cwd 必须落在所选工作区").toBe(realRoot);
      // 工作区归属：上游 `create` **不**做 attach，归属由 workspace 域监听 `api-session/added` 完成。
      // 这条还没接上（债：20261102-上游会话端点要手动装配子插件.md），所以只断言"目录被登记".
      // 判据是"工作区收到了这条会话"（路径在 macOS 上有 `/var` 与 `/private/var` 两种写法，比字面量会误判）。
      const registry = app.get(WorkspaceRegistry);
      const workspace = registry
        .list()
        .find((one) => one.sessionIds.map(String).includes(String(sessionId)));
      expect(workspace, "工作区必须收到这条会话（否则侧栏只显示工作区、没有会话行）").toBeDefined();

      // ④ 改权限：走上游 chip 唯一的那一行命令。
      const executed = (await handlers.invoke(COMMAND_EXECUTE_ENDPOINT, {
        sessionId,
        name: "permission",
        input: "danger-full-access",
      })) as CommandExecuteValue;
      expect(executed.result.kind, "/permission 应成功结算").toBe("success");
      expect(
        projectionOf(app, String(sessionId), "permissions"),
        "宿主档位必须真的变了",
      ).toMatchObject({
        currentValue: "danger-full-access",
      });
    } finally {
      await app.dispose();
    }
  });

  test("新建会话用的是**装配给的默认档位**（新会话的权限起点就是它）", async ({ tmpdir }) => {
    const app = await boot(tmpdir);
    try {
      // 直接起 agent：`AgentLoop.create` 自己 `prepare` + 落盘 + `enter` + `announce`
      // （`createSession` 之后再 create 同一 id 会撞 `session "..." already exists`）。
      const sessionId = SessionId("s-default-preset");
      await app
        .get(AgentLoop)
        .create(
          sessionId,
          { provider: "deepseek-official", model: "deepseek-flash" },
          { cwd: tmpdir },
        );
      expect(projectionOf(app, String(sessionId), "permissions")).toMatchObject({
        currentValue: "workspace-write",
      });
    } finally {
      await app.dispose();
    }
  });
});
