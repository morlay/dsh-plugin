// `UiPermission` 的**装配闭环**：装上去之后，上游 client 行必须能读到
// `ctx.remote.permissionPresets`（它的 `PermissionCatalogDirectory` 构造里就调 `.catalog()`）。
//
// 实机上这条一直静默失败过：
//
//   ✗ ui-permission: Cannot read properties of undefined (reading 'catalog')
//
// 报错点漂到上游内部，看不出是"`$mount` 没注册"还是"`ctx.remote` 拿到的不是我们的实例"。
// 这条 spec 把它钉在装配面：只装 client 链（`provideLocalRemote` = 进程内传输），断言
// `UiPermission` 能装配、且 `remote.permissionPresets.catalog` 真的能调到（宿主侧给个最小实现）。
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import {
  ConfigForms,
  Connection,
  Locale,
  Remote,
  RemoteAccess,
  SessionRemoteBinding,
  SettingsSchema,
  Shortcuts,
  provideRenderer,
} from "@morlay/zephyr-app/client";
import { provideLocalRemote } from "@morlay/zephyr-app/testing";
import { provideClientRemote } from "@morlay/zephyr-app/client";
import { CommandUi } from "@morlay/dsh-command/ui";
import { SessionController } from "@morlay/dsh-session/ui";
import { PermissionPresetsEndpointDefault } from "@morlay/dsh-permission/server";
import { Permission } from "../../contract/index.ts";
import { afterEach, describe, expect, it } from "vitest";
import { providePermissionUi } from "../permission-ui.provide.ts";
import { TYPERT_REMOTE as PERMISSION_PRESETS_REMOTE } from "@deepseek-ai/dsh-permission-presets/remote";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/** 传输接缝的最小连接面（`provideLocalRemote` 不需要真 socket，但 `RemoteDefault` 注入它）。 */
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
    throw new Error("本 spec 用进程内传输，不建真 socket");
  };

  readonly registerGenerationSource = () => () => {};

  readonly rpc = {};

  reconnect(): void {}

  readonly start = () => ({ stop: () => {} });
}

/** 会话目录面：`ui-permission` 只在 slot 注入里读它，装配期不看。 */
@Injectable()
class FakeSessions extends SessionController {
  readonly list = {
    getSnapshot: () => ({ ids: [], byId: {}, phase: "ready" as const, projectionsBySession: {} }),
    subscribe: () => () => {},
  };

  readonly searchResultLimit = 20;

  binding(): undefined {
    return undefined;
  }

  retainInfo() {
    return { getSnapshot: () => ({ retainedBy: {} }), subscribe: () => () => {} };
  }

  scopeOf(
    ctx: Parameters<SessionController["scopeOf"]>[0],
  ): ReturnType<SessionController["scopeOf"]> {
    return ctx as unknown as ReturnType<SessionController["scopeOf"]>;
  }

  scope(): undefined {
    return undefined;
  }

  sessionOf(): undefined {
    return undefined;
  }

  get(): undefined {
    return undefined;
  }

  retain(): never {
    throw new Error("装配期不 retain");
  }

  using<T>(
    target: Parameters<SessionController["using"]>[0],
    options: Parameters<SessionController["using"]>[1],
    operation: Parameters<SessionController["using"]>[2] extends (reference: infer R) => unknown
      ? (reference: R) => T | Promise<T>
      : never,
  ): Promise<T> {
    void target;
    void options;
    return Promise.resolve(operation as unknown as T);
  }

  async create(): Promise<never> {
    throw new Error("装配期不 create");
  }

  async refresh(): Promise<void> {}

  async refreshProjections(): Promise<void> {}

  async fork(): Promise<never> {
    throw new Error("装配期不 fork");
  }

  async search(): Promise<never> {
    throw new Error("装配期不 search");
  }

  subagentAddress(): undefined {
    return undefined;
  }
}

/**
 * 装 client 链 + 权限的浏览器半（宿主侧只给 `permissionPresets` 那条端点，够 `catalog` 用）。
 * @returns app。
 */
async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideLocalRemote(),
      ...provideRenderer(),
      // `ui-settings` 的 mirror：上游权限行装配期读 `describe()`（订阅 + ensure + 读视图）。
      {
        provide: ConfigForms,
        useFactory: () =>
          ({
            describe: () => ({
              getSnapshot: () => ({ view: undefined }),
              subscribe: () => () => {},
              ensure: async () => {},
              acceptView: () => {},
            }),
            getSnapshot: () => ({}),
            subscribe: () => () => {},
          }) as unknown as ConfigForms,
      },
      { provide: Connection, useFactory: () => new FakeConnection() },
      { provide: SessionController, useFactory: () => new FakeSessions() },
      // 命令 UI：本 spec 的判据是权限行自己的装配与两条 face，命令面板不在被测面内。
      // 这里给一个**真契约**的空面（不是 `undefined`：上游分支会读 `decorate` / `dismiss`）。
      {
        provide: CommandUi,
        useFactory: () =>
          ({
            register: () => () => {},
            decorate: () => () => {},
            dismiss: () => {},
          }) as unknown as CommandUi,
      },
      {
        provide: SessionRemoteBinding,
        useFactory: () => ({ onInit: async () => {} }) as unknown as SessionRemoteBinding,
      },
      { provide: RemoteAccess, useFactory: () => ({ can: () => true }) as unknown as RemoteAccess },
      {
        provide: Locale,
        useFactory: () =>
          ({
            register: () => () => {},
            subscribe: () => () => {},
            bind: () => (key: string) => key,
          }) as unknown as Locale,
      },
      {
        provide: Shortcuts,
        useFactory: () =>
          ({
            catalog: { getSnapshot: () => [], subscribe: () => () => {} },
            register: () => () => {},
          }) as unknown as Shortcuts,
      },
      {
        provide: SettingsSchema,
        useFactory: () =>
          ({ schemas: new Map(), register: () => {} }) as unknown as typeof SettingsSchema,
      },
      // 宿主侧：`permissionPresets/catalog` 的实现 + 它要的 `Permission` 面（只给 catalog）。
      {
        provide: Permission,
        useFactory: () =>
          ({
            catalog: () => ({
              options: [
                { value: "read-only", name: "read-only" },
                { value: "workspace-write", name: "workspace-write" },
                { value: "danger-full-access", name: "danger-full-access" },
              ],
              defaultOptions: [
                { value: "read-only", name: "read-only" },
                { value: "workspace-write", name: "workspace-write" },
                { value: "danger-full-access", name: "danger-full-access" },
              ],
              defaultPreset: "workspace-write",
            }),
          }) as unknown as Permission,
      },
      PermissionPresetsEndpointDefault,
      // 被测面：权限的浏览器半。
      ...providePermissionUi(),
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("remote 的 $mount（ui-permission 的前提）", () => {
  it(
    "`$mount(PERMISSION_PRESETS_REMOTE)` 之后能读到 `remote.permissionPresets.catalog`",
    { timeout: 20_000 },
    async () => {
      const app = await bootstrapApplication({
        providers: [
          ...provideLocalRemote(),
          ...provideRenderer(),
          // `ui-settings` 的 mirror：上游权限行装配期读 `describe()`（订阅 + ensure + 读视图）。
          {
            provide: ConfigForms,
            useFactory: () =>
              ({
                describe: () => ({
                  getSnapshot: () => ({ view: undefined }),
                  subscribe: () => () => {},
                  ensure: async () => {},
                  acceptView: () => {},
                }),
                getSnapshot: () => ({}),
                subscribe: () => () => {},
              }) as unknown as ConfigForms,
          },
          { provide: Connection, useFactory: () => new FakeConnection() },
        ],
        timeoutMs: 20_000,
      });
      opened.push(app);
      const remote = app.get(Remote);
      await remote.$mount(PERMISSION_PRESETS_REMOTE);
      const face = (remote as unknown as Record<string, unknown>)["permissionPresets"] as
        | { catalog?: unknown }
        | undefined;
      expect(face, "`$mount` 之后 remote.permissionPresets 必须存在").toBeDefined();
      expect(typeof face?.catalog, "`catalog` 必须是函数").toBe("function");
    },
  );
});

describe("remote 的 $mount（真 RemoteDefault）", () => {
  it(
    "换成生产用的 `RemoteDefault`，`$mount` 之后同样能读到这条 face",
    { timeout: 20_000 },
    async () => {
      const app = await bootstrapApplication({
        providers: [
          // 只装 Remote 的实现（`provideClientRemote()` 就是它那几行），不装 client chain：
          // 后者会拖 theme（构建期依赖，单测装不起来）。
          ...provideClientRemote(),
          { provide: Connection, useFactory: () => new FakeConnection() },
        ],
        timeoutMs: 20_000,
      });
      opened.push(app);
      const remote = app.get(Remote);
      await remote.$mount(PERMISSION_PRESETS_REMOTE);
      const face = (remote as unknown as Record<string, unknown>)["permissionPresets"] as
        | { catalog?: unknown }
        | undefined;
      expect(face, "`RemoteDefault.$mount` 之后必须有这条 face").toBeDefined();
      expect(typeof face?.catalog).toBe("function");
    },
  );
});

describe("UiPermission 的装配", () => {
  it(
    "装配成功能读到 `remote.permissionPresets.catalog`（上游 client 行构造期就调它）",
    { timeout: 20_000 },
    async () => {
      const app = await boot();
      // `$mount` 之后命名空间必须在：上游 `PermissionCatalogDirectory` 的构造里直接读它。
      const remote = app.get(Remote) as unknown as Record<string, unknown>;
      expect(
        remote["permissionPresets"],
        "`$mount` 之后 remote.permissionPresets 必须存在",
      ).toBeDefined();
      const face = remote["permissionPresets"] as { catalog(): Promise<unknown> };
      const result = (await face.catalog()) as {
        ok?: boolean;
        value?: { options?: readonly { value?: string }[] };
      };
      expect(result.ok).toBe(true);
      expect(result.value?.options?.map((option) => option.value)).toEqual([
        "read-only",
        "workspace-write",
        "danger-full-access",
      ]);
    },
  );

  it("两条 face 都跟着 `$mount` 就位（摊平后不能丢任何一条）", { timeout: 20_000 }, async () => {
    const app = await boot();
    const remote = app.get(Remote) as unknown as Record<string, unknown>;
    // 装配没抛错本身也是一条判据：`fromCordis` 会逐条核对 `'remote.permissionPresets'` /
    // `'remote.settings'`，缺一个当场失败。
    expect(remote["permissionPresets"]).toBeDefined();
    expect(remote["settings"], "`settings` 这组也要 `$mount` 过").toBeDefined();
  });
});
