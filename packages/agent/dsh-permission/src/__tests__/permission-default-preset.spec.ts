// 默认权限档位的**读写闭环**：装配给的档位 → `permissionPresets/catalog` 的 `defaultPreset`；
// 设置里改写 → 落盘 → 下一次启动按落盘值建会话。
//
// 全走真的 `RemoteHandlers.invoke`：目录读 `permissionPresets/catalog`，默认档位的写走设置域的
// `settings/mutate`（上游 client 行的设置行正是这条路径），落盘由真 `SettingLoader` 写到
// `<dataDir>/settings.json`。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideAgent } from "@morlay/dsh-agent/server";
import { providePermission, providePermissionFor } from "@morlay/dsh-permission/server";
import { BashSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSetting } from "@morlay/dsh-setting/server";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { bootstrapApplication, type App, configure } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { RemoteHandlers, RemoteHandlersDefault } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { PERMISSION_PRESETS_CATALOG_ENDPOINT } from "../endpoint/permission-presets-endpoint.ts";

const apps: App[] = [];
const roots: string[] = [];

/** 只给数据根的运行环境（设置文档落在 `<dataDir>/settings.json`）。 */
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues;

  readonly cacheDir: string;

  readonly packageRoot: string;

  readonly appBootDir: string;

  readonly profileManifest: string;

  constructor(root: string) {
    super();
    this.values = { dataDir: root, profileDir: root, dev: false };
    this.cacheDir = join(root, "cache");
    this.packageRoot = root;
    this.appBootDir = join(root, "boot");
    this.profileManifest = join(root, "package.json");
  }
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

/**
 * 起真权限栈：`providePermission` 的装配值是 `workspace-write`；设置域用真模块（JSON 文档 + `settings/*`）。
 * @param existingRoot - 复用上一轮的数据根（模拟「刷新/重启」）；缺省新建临时目录。
 * @returns 应用、handler 表与数据根。
 */
async function boot(existingRoot?: string): Promise<{ app: App; handlers: RemoteHandlers; root: string }> {
  const root = existingRoot ?? (await mkdtemp(join(tmpdir(), "dsh-permission-default-")));
  if (existingRoot === undefined) roots.push(root);
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    
      // 类令牌用 `useFactory` 给实例（`useValue` 只对 `InjectionToken` 生效）。
      { provide: AppEnv, useFactory: () => new FakeAppEnv(root) },
      ...provideAgent(),
      ...providePermissionFor("workspace-write"),
      ...provideSetting(),
      RemoteHandlersDefault,
      SubprocessDefault,
      SandboxDefault,
      SandboxPolicyDefault,
      BashSandbox,
    ],
    timeoutMs: 20_000,
  });
  apps.push(app);
  return { app, handlers: app.get(RemoteHandlers), root };
}

/** `permissionPresets/catalog` 的 `defaultPreset`（wire 是 `{ ok, value }`）。 */
async function catalogDefaultOf(handlers: RemoteHandlers): Promise<unknown> {
  const result = (await handlers.invoke(PERMISSION_PRESETS_CATALOG_ENDPOINT, {})) as {
    ok?: unknown;
    value?: { defaultPreset?: unknown };
  };
  expect(result.ok, "permissionPresets/catalog 应成功").toBe(true);
  return result.value?.defaultPreset;
}

describe("默认权限档位的读写", () => {
  it("读到的默认档位就是装配给的值，并已写进设置文档（设置行拿得到这一档）", { timeout: 20_000 }, async () => {
    const { handlers } = await boot();

    expect(await catalogDefaultOf(handlers)).toBe("workspace-write");

    const described = (await handlers.invoke("settings/describe", {})) as {
      ok?: unknown;
      value?: { namespaces?: readonly { ns: string; value?: unknown }[] };
    };
    expect(described.ok).toBe(true);
    expect(described.value?.namespaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ns: "permission", value: { defaultPreset: "workspace-write" } }),
      ]),
    );
  });

  it("在设置里改写默认档位后落盘，下一次启动按新值建会话", { timeout: 30_000 }, async () => {
    const first = await boot();
    const written = (await first.handlers.invoke("settings/mutate", {
      ns: "permission",
      ops: [{ op: "set", path: ["defaultPreset"], value: "danger-full-access" }],
    })) as { ok?: unknown };
    expect(written.ok).toBe(true);

    // 卸载时 `SettingLoader` 等写盘队列清空：此时文件里应已是新值。
    await first.app.dispose();
    const document = JSON.parse(await readFile(join(first.root, "settings.json"), "utf8")) as {
      permission?: { defaultPreset?: string };
    };
    expect(document.permission?.defaultPreset).toBe("danger-full-access");

    const second = await boot(first.root);
    expect(await catalogDefaultOf(second.handlers)).toBe("danger-full-access");
  });
});
