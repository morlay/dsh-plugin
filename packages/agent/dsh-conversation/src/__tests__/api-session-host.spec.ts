// **上游会话端点经我们自己的 discovery 可调用**：这是"复用上游端点"的最后一段验证。
//
// 链路：上游 `SessionController` 装成我们清单里的一行 → 它把 `session` 组的 `@Remote` 方法登记进
// `typert` 绑定（`typertRemote`）→ 我们的 `TypertGateway` 从**自己的名字表**扫到它 → `invoke` 通。
//
// 判据用上游协议的形状：`session/list` 返回 `{ items: [...] }`（不是我们自研端点的 `{ ids, byId }`）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideAgent } from "@morlay/dsh-agent";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideCommand } from "@morlay/dsh-command/server";
import { provideSandbox } from "@morlay/dsh-sandbox";
import {
  provideSession,
  provideSessionProjection,
  provideSessionQuerySqlite,
} from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideStorageJson } from "@morlay/dsh-storage";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { provideStorage } from "@morlay/dsh-storage";
import { provideUpload } from "@morlay/dsh-upload";
import { provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import {
  AppEnv,
  Connection,
  RemoteAccess,
  TypertGateway,
  type AppEnvValues,
  provideApiGateway,
} from "@morlay/zephyr-app";
import { provideTypert } from "@morlay/zephyr-app";
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { publishingTo } from "@morlay/zephyr-app/testing";
import { afterEach, describe, expect, it } from "vitest";
import { provideApiSession } from "../server/api-session.provide.ts";

/** 连接替身：上传行要它（生成下载地址）；本 spec 不触发上传。 */
@Injectable()
class FakeConnection extends Connection {
  readonly interactions = "none" as const;

  readonly generation = {
    getSnapshot: () => ({ id: 1, host: { home: "" } }),
    subscribe: () => () => {},
  };

  readonly isLoopback = true;

  readonly state = { getSnapshot: () => "connected" as const, subscribe: () => () => {} };

  readonly openWebSocket = (): WebSocket => {
    throw new Error("本 spec 不建 socket");
  };

  readonly registerGenerationSource = () => () => {};

  /** 上传行往 `rpc` 上注册下载端点：形状与契约不同，本 spec 只需这两个方法存在。 */
  readonly rpc = {
    register: () => () => {},
    call: async () => undefined,
  } as unknown as Connection["rpc"];

  readonly fetch = {
    register: () => () => {},
    requestBodyMode: () => "streaming",
    dispatch: async () => undefined,
  };

  reconnect(): void {}

  readonly start = () => ({ stop: () => {} });
}

/** 准入替身：全放行。 */
function allowAllAccess(): RemoteAccess {
  return {
    allows: () => true,
    decide: () => ({ allowed: true }),
    source: () => undefined,
    whenAccess: () => () => {},
    whenResourceAccess: () => () => {},
    registerPolicy: () => () => {},
    snapshotFor: () => ({}),
    follow: () => () => {},
    invalidate: () => {},
    // **不给 `typertRemote`**：gateway 的 SRC 回退会逐个服务读它，非 `undefined` 就按
    // `{ service, serviceKey, namespace }` 校验——空对象过不了，整个 `session/list` 抛
    // `Service "remote-access" has an inconsistent typertRemote binding`。
    // 真实现由 `bindTypertRemote` 产出，替身没有那层绑定，就该缺这个键。
  } as unknown as RemoteAccess;
}

const apps: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

/**
 * 装宿主栈（会话 + agent + 附件 + 上传 + 沙箱 + 工作区 + typert）+ 上游会话端点行。
 * @returns app。
 */
async function boot(): Promise<App> {
  const root = await mkdtemp(join(tmpdir(), "dsh-api-session-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionQuerySqlite(),
      {
        provide: AppEnv,
        useFactory: () => new FakeEnv(root),
      },
      ...provideAgent(),
      ...provideAttachment(),
      // 命令注册表必须先于上传行：上游 `FileUploads` 在构造期就 `ctx.commands.registerFileReceiptResolver(…)`。
      ...provideCommand(),
      ...provideUpload(),
      ...provideSandbox(),
      ...provideStorage(),
      ...provideStorageJson(),
      ...provideSessionPersistence(),
      ...provideWorkingDirectory(),
      ...provideWorkspace(),
      ...provideTypert(),
      // `typertGateway` 的实现是上游 `api/gateway` 的 `TypertGatewayService`（我们不再自己写）。
      // `provideApiGateway()` 已含 `RemoteHandlersDefault`：不能再并列一条（同名服务重复注册）。
      ...provideApiGateway(),
      { provide: RemoteAccess, useFactory: () => allowAllAccess() },
      publishingTo(RemoteAccess, "remoteAccess"),
      { provide: Connection, useFactory: () => new FakeConnection() },
      SubprocessDefault,
      // 被测面：上游会话端点（`session` 组的全部方法）。
      ...provideApiSession(),
    ],
    timeoutMs: 20_000,
  });
  apps.push(app);
  return app;
}

/** 指向临时目录的运行环境。 */
@Injectable()
class FakeEnv extends AppEnv {
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

describe("上游会话端点经自研 discovery", () => {
  it("`session/list` 按上游协议返回 `{ items }`", { timeout: 20_000 }, async () => {
    const app = await boot();
    const gateway = app.get(TypertGateway);
    const listed = await gateway.invoke({
      namespace: "session",
      method: "list",
      args: {},
      peer: {
        id: "p",
        signal: new AbortController().signal,
        interactions: "answer",
        // 上游分派前读 `peer.principal.kind`（资源准入）。
        principal: { kind: "browser", id: "spec" },
      } as never,
    });
    expect(listed, "上游协议是 `{ items }`，不是自研端点的 `{ ids, byId }`").toMatchObject({
      items: expect.any(Array),
    });
  });
});
