// @vitest-environment node
// 「外观行点了没反应」的回归判据：`AppearanceRow` 的 `setTheme` 被调用后，**preference 变了、写请求也发了**。
//
// 这里的装配是真的：真 `SettingModule`（宿主端点 + 文档落盘）← 真 `RemoteDefault`（wire 面）
// ← `mockTransport`（唯一的替身：mock server）← 真 `SettingsHost`（上游 `ui-settings` 的 `ConfigForms`）
// ← 上游 `ui-theme` 的 `apply`（真 `ThemeRuntime` + 真 `AppearanceRow` 的注入面）。
//
// 只伪造 cordis 的上下文与 slot 登记表（`ctx.effect/on/emit/provide/inject` 与 `slots.inject/register`）：
// 它们不是被测面，被测面是「行的 `setTheme` → 运行时 → `ConfigForms` → wire → 宿主文档」。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TYPERT_REMOTE as SETTINGS_REMOTE } from "@deepseek-ai/dsh-api-settings-controller/remote";
import { THEME_SETTINGS_NAMESPACE } from "@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts";
import { apply as themeApply } from "@deepseek-ai/dsh-client-ui-theme/client";
import { provideAgent } from "@morlay/dsh-agent/server";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { RemoteHandlers, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { ConfigForms, Connection, Remote, mockTransport } from "@morlay/zephyr-app/client";
// `RemoteDefault` 只有模块入口导出（`@morlay/zephyr-app/client` 的 barrel 不带实现类）。
import { RemoteDefault } from "../../../../../zephyr/zephyr-app/src/client/remote/remote.service.ts";
import { afterEach, describe, expect, it } from "vitest";
import { Setting } from "../../contract/setting.contract.ts";
import { provideSetting } from "../../server/setting.provide.ts";
import { SettingsHost } from "../settings-host.ts";

const opened: App[] = [];
const roots: string[] = [];

/** 只给数据根的运行环境（配置文档落在 `<dataDir>/settings.json`）。 */
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues;

  readonly cacheDir: string;

  readonly packageRoot: string;

  readonly appBootDir: string;

  readonly profileManifest: string;

  constructor(root: string) {
    super();
    this.values = { dataDir: root, profileDir: root, dev: true } as AppEnvValues;
    this.cacheDir = join(root, "cache");
    this.packageRoot = root;
    this.appBootDir = join(root, "boot");
    this.profileManifest = join(root, "package.json");
  }
}

/**
 * 传输接缝的最小连接面：本 spec 的 wire 走 `mockTransport`，连接只用来满足 `RemoteDefault` 的注入
 * （真实现要浏览器 WebSocket）。
 */
class FakeConnection extends Connection {
  readonly interactions = "none" as const;

  readonly generation = {
    getSnapshot: () => ({ id: 1, host: { home: "" } }),
    subscribe: () => () => {},
  };

  readonly isLoopback = true;

  readonly state = { getSnapshot: () => "connected" as const, subscribe: () => () => {} };

  readonly openWebSocket = (): WebSocket => {
    throw new Error("本 spec 用 mockTransport，不建真 socket");
  };

  readonly registerGenerationSource = () => () => {};

  readonly rpc = {};

  reconnect(): void {}

  readonly start = () => ({ stop: () => {} });
}

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** 一条发出的 wire 调用（打点来自 mock transport）。 */
interface WireCall {
  readonly endpoint: string;
  readonly payload: unknown;
}

/**
 * 装整套：宿主（真 `provideSetting` + 真端点）+ 客户端（真 `Remote` 走 mock transport + 真 `SettingsHost`）。
 * @returns app、wire 记录（可按端点等）、以及取 `configForms` 的入口。
 */
async function boot(): Promise<{ app: App; wire: WireCall[]; configForms: ConfigForms }> {
  const root = await mkdtemp(join(tmpdir(), "dsh-theme-row-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    
      { provide: AppEnv, useFactory: () => new FakeAppEnv(root) },
      // `settings/describe` 的枚举源头是 provider 目录：真 `Llm` + 两条 provider 行。
      ...provideAgent(),
      ...provideSetting(),
      { provide: Connection, useFactory: () => new FakeConnection() },
      RemoteHandlersDefault,
      RemoteDefault,
      SettingsHost,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  const handlers = app.get(RemoteHandlers);
  const remote = app.get(RemoteDefault);
  const wire: WireCall[] = [];
  // mock server = 真宿主端点：客户端发出的每一帧都打点，再原样打回宿主。
  remote.useTransport(
    mockTransport({
      "settings/describe": (payload) => {
        wire.push({ endpoint: "settings/describe", payload });
        return handlers.invoke("settings/describe", {});
      },
      "settings/mutate": (payload) => {
        wire.push({ endpoint: "settings/mutate", payload });
        const args = (payload as { args?: Record<string, unknown> }).args ?? {};
        return handlers.invoke("settings/mutate", { ns: args.ns, ops: args.ops });
      },
    }),
  );
  await remote.$mount(SETTINGS_REMOTE);
  return { app, wire, configForms: app.get(ConfigForms) };
}

/** 一行（`AppearanceRow` 的 slot 登记）：上游 `slots.register` 的载荷。 */
interface RowEntry {
  readonly store: { create(): { actions: unknown } };
  readonly inject: (actions: unknown) => {
    setTheme(id: string): void;
    setFontSize(role: string, px: number): void;
  };
}

/**
 * 上游 `ui-theme` 的 `apply` 需要的 cordis 面：只实现它真正用到的成员。
 * @param configForms - 真 `SettingsHost` 提供的 `ConfigForms`。
 * @returns 假 ctx、登记的 slot 行、以及 `apply` 里 `provide` 出来的服务。
 */
function themeContextOf(configForms: ConfigForms): {
  ctx: unknown;
  rows: RowEntry[];
  provided: Map<string, unknown>;
} {
  const rows: RowEntry[] = [];
  const provided = new Map<string, unknown>();
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const services: Record<string, unknown> = {
    configForms,
    // `locale.register` 只在 apply 期被调一次；行文案不在被测面。
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    // slot 登记：上游 `inject(scope, factory)` 的语义是「scope 出现后再注册」，这里直接登记。
    slots: {
      inject: (_scope: string, factory: () => unknown) => {
        factory();
        return () => {};
      },
      register: (entry: RowEntry) => {
        rows.push(entry);
        return () => {};
      },
    },
  };
  const ctx = {
    ...services,
    effect: (run: () => unknown) => {
      run();
      return () => {};
    },
    on: (name: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(name) ?? [];
      list.push(listener);
      listeners.set(name, list);
      return () => {};
    },
    emit: (name: string, ...args: unknown[]) => {
      for (const listener of listeners.get(name) ?? []) listener(...args);
    },
    provide: (name: string, value: unknown) => {
      provided.set(name, value);
      return () => {};
    },
    // 只有 `shortcuts`（桌面快捷键）走这条：本装配没给，就不回调。
    inject: (names: readonly string[], callback?: (scope: unknown) => unknown) => {
      if (callback === undefined) return () => {};
      if (!names.every((name) => services[name] !== undefined)) return () => {};
      callback(ctx);
      return () => {};
    },
  };
  return { ctx, rows, provided };
}

describe("外观行的写路径", () => {
  it("行上的 `setTheme` 一调用：preference 变、发出 `settings/mutate`、宿主文档落值", {
    timeout: 20_000,
  }, async () => {
    const { app, wire, configForms } = await boot();
    // `SettingsHost` 在 `onInit` 里 `$mount` 过一遍；mock transport 换掉后由测试重新 mount。
    await app.get(Remote).$mount(SETTINGS_REMOTE);

    const { ctx, rows, provided } = themeContextOf(configForms);
    themeApply(ctx as never);
    const appearance = rows[0];
    if (appearance === undefined) throw new Error("ui-theme 没有登记外观行");

    // 行拿到的注入面（上游 `injected(actions)`）：这就是按钮 `onClick` 调的 `setTheme`。
    const face = appearance.inject(appearance.store.create().actions);
    face.setTheme("light");

    // ① 运行时状态：`ThemeRuntime.setTheme` 同步改 preference 并 publish。
    const runtime = provided.get("theme") as { getTheme(): { preference: string } } | undefined;
    expect(runtime?.getTheme().preference).toBe("light");

    // ② 写请求：客户端真的发了 `settings/mutate`（wire 面），且 ops 指向 ui-theme 的 preference。
    // 写是异步的（`ThemeRuntime.write` 不阻塞事件处理），所以等它上 wire。
    await expect.poll(() => wire.length, { timeout: 5_000 }).toBeGreaterThan(0);
    const mutate = wire.find((call) => call.endpoint === "settings/mutate");
    expect(mutate?.payload).toMatchObject({
      args: {
        ns: THEME_SETTINGS_NAMESPACE,
        ops: [{ op: "set", path: ["preference"], value: "light" }],
      },
    });

    // ③ 落值：宿主的配置文档里存的是 light（「刷新读回」的前一半）。
    await expect
      .poll(() => app.get(Setting).snapshot()[THEME_SETTINGS_NAMESPACE], { timeout: 5_000 })
      .toEqual({ preference: "light" });
  });
});
