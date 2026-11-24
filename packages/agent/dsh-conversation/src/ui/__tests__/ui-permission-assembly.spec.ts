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
  provideClientConnection,
  Locale,
  Remote,
  RemoteAccess,
  SessionRemoteBinding,
  SettingsSchema,
  Shortcuts,
  provideRenderer,
} from "@morlay/zephyr-app/client";
import { Connection, RemoteHandlers, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { FakeConnectionHost, provideLocalRemote } from "@morlay/zephyr-app/testing";
import { provideClientRemote } from "@morlay/zephyr-app/client";
import { CommandUi } from "@morlay/dsh-command/ui";
import { SessionController } from "@morlay/dsh-conversation/ui";
import { PermissionPresetsEndpointDefault } from "@morlay/dsh-permission/server";
import { Permission } from "@morlay/dsh-permission";
import { afterEach, describe, expect, it } from "vitest";
import { providePermissionUi } from "../permission-ui.provide.ts";
import { namespaceOf } from "../remote-namespace.ts";
import { PERMISSION_PRESETS_REMOTE } from "@morlay/dsh-permission/endpoint";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

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

  /** 装配期不给作用域（本 spec 不看它）。 */
  scopeOf(): undefined {
    return undefined;
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

  /** 装配期不 using：照契约给"明确失败"，别让它悄悄返回 undefined。 */
  using<T>(): Promise<T> {
    throw new Error("装配期不 using");
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
  // 两套装配两个 ctx：host 只有「端点 + 路由表」，client 只有 UI 链，LocalRemote 是唯一的桥。
  const host = await bootstrapApplication({
    providers: [
      {
        provide: Permission,
        useFactory: () => ({
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
        }),
      },
      RemoteHandlersDefault,
      PermissionPresetsEndpointDefault,
    ],
    timeoutMs: 20_000,
  });
  opened.push(host);
  // 诊断：host 装配里到底有没有路由表（拿不到说明装配把这一行跳过了）。
  if (host.tryGet(RemoteHandlers) === undefined) {
    throw new Error(`host 装配缺少 RemoteHandlers：${String(host.tryGet(RemoteHandlersDefault))}`);
  }
  const hostInvoker = async (endpoint: string, payload: unknown) =>
    host.get(RemoteHandlers).invoke(endpoint, payload);
  const app = await bootstrapApplication({
    providers: [
      ...provideLocalRemote(hostInvoker),
      ...provideRenderer(),
      // `ui-settings` 的 mirror：上游权限行装配期读 `describe()`（订阅 + ensure + 读视图）。
      {
        provide: ConfigForms,
        useFactory: () => ({
          describe: () => ({
            getSnapshot: () => ({ view: undefined }),
            subscribe: () => () => {},
            ensure: async () => {},
            acceptView: () => {},
          }),
          getSnapshot: () => ({}),
          subscribe: () => () => {},
        }),
      },
      ...provideClientConnection(),
      // 上游浏览器行按 `ctx.connection` 严格读：把浏览器面按那个名字发布。
      // 装了 upload 行：它构造期往**宿主**连接登记路由，所以宿主面也要有。
      { provide: Connection, useFactory: () => new FakeConnectionHost() },
      { provide: SessionController, useFactory: () => new FakeSessions() },
      // 命令 UI：本 spec 的判据是权限行自己的装配与两条 face，命令面板不在被测面内。
      // 这里给一个**真契约**的空面（不是 `undefined`：上游分支会读 `decorate` / `dismiss`）。
      {
        provide: CommandUi,
        useFactory: () => ({
          register: () => () => {},
          decorate: () => () => {},
          dismiss: () => {},
        }),
      },
      {
        provide: SessionRemoteBinding,
        useFactory: () => ({ onInit: async () => {} }),
      },
      { provide: RemoteAccess, useFactory: () => ({ can: () => true }) },
      {
        provide: Locale,
        useFactory: () => ({
          register: () => () => {},
          subscribe: () => () => {},
          bind: () => (key: string) => key,
        }),
      },
      {
        provide: Shortcuts,
        useFactory: () => ({
          catalog: { getSnapshot: () => [], subscribe: () => () => {} },
          register: () => () => {},
        }),
      },
      {
        provide: SettingsSchema,
        useFactory: () => ({ schemas: new Map(), register: () => {} }),
      },
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
          ...provideLocalRemote(() => Promise.reject(new Error("这条用例只验 $mount，不调端点"))),
          ...provideRenderer(),
          // `ui-settings` 的 mirror：上游权限行装配期读 `describe()`（订阅 + ensure + 读视图）。
          {
            provide: ConfigForms,
            useFactory: () => ({
              describe: () => ({
                getSnapshot: () => ({ view: undefined }),
                subscribe: () => () => {},
                ensure: async () => {},
                acceptView: () => {},
              }),
              getSnapshot: () => ({}),
              subscribe: () => () => {},
            }),
          },
          ...provideClientConnection(),
        ],
        timeoutMs: 20_000,
      });
      opened.push(app);
      const remote = app.get(Remote);
      await remote.$mount(PERMISSION_PRESETS_REMOTE);
      const face = namespaceOf(remote, "permissionPresets");
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
          ...provideClientConnection(),
        ],
        timeoutMs: 20_000,
      });
      opened.push(app);
      const remote = app.get(Remote);
      await remote.$mount(PERMISSION_PRESETS_REMOTE);
      const face = namespaceOf(remote, "permissionPresets");
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
      const remote = app.get(Remote);
      expect(
        namespaceOf(remote, "permissionPresets"),
        "`$mount` 之后 remote.permissionPresets 必须存在",
      ).toBeDefined();
      const face = namespaceOf(remote, "permissionPresets") as { catalog(): Promise<unknown> };
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
    const remote = app.get(Remote);
    // 装配没抛错本身也是一条判据：`fromCordis` 会逐条核对 `'remote.permissionPresets'` /
    // `'remote.settings'`，缺一个当场失败。
    expect(namespaceOf(remote, "permissionPresets")).toBeDefined();
    expect(namespaceOf(remote, "settings"), "`settings` 这组也要 `$mount` 过").toBeDefined();
  });
});
