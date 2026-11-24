// 默认权限档位的**读写闭环**：装配给的档位 → `permissionPresets/catalog` 的 `defaultPreset`；
// 设置里改写 → 落盘 → 下一次启动按落盘值建会话。
//
// 全走真的 `RemoteHandlers.invoke`：目录读 `permissionPresets/catalog`，默认档位的写走设置域的
// `settings/mutate`（上游 client 行的设置行正是这条路径），落盘由真 `SettingLoader` 写到
// `<dataDir>/settings.json`。
import { createTestingAppEnv } from "@morlay/zephyr-app/testing";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideAgent } from "@morlay/dsh-agent";
import { providePermissionFor } from "@morlay/dsh-permission/server";
import { BashSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { provideSetting } from "@morlay/dsh-setting/server";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { LocalRemote } from "@morlay/zephyr-app/testing";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { PermissionPresetsEndpointClient } from "../ui/permission-presets-endpoint-client.ts";

/** 只给数据根的运行环境（设置文档落在 `<dataDir>/settings.json`）。 */
/**
 * 起真权限栈：`providePermission` 的装配值是 `workspace-write`；设置域用真模块（JSON 文档 + `settings/*`）。
 * @param existingRoot - 复用上一轮的数据根（模拟「刷新/重启」）；缺省新建临时目录。
 * @returns 应用、handler 表与数据根。
 */
async function boot(
  existingRoot?: string,
): Promise<{ app: App; handlers: RemoteHandlers; root: string }> {
  const root = existingRoot ?? (await mkdtemp(join(tmpdir(), "dsh-permission-default-")));
  if (existingRoot === undefined) onTestFinished(() => rm(root, { recursive: true, force: true }));
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),

      // 类令牌用 `useFactory` 给实例（`useValue` 只对 `InjectionToken` 生效）。
      { provide: AppEnv, useValue: createTestingAppEnv({ root: root }) },
      ...provideAgent(),
      // 顺序即装配顺序：`shell` / `bash` 的适配面要先就位，权限行构造期就读 `ctx.shell.sandboxMode`。
      SubprocessDefault,
      SandboxDefault,
      SandboxPolicyDefault,
      BashSandbox,
      // 顺序即装配顺序：权限行在 onInit 里写设置文档，`Setting` 那一行必须先就位（它的 loader 已填好）。
      ...provideSetting(),
      ...providePermissionFor("workspace-write"),
      RemoteHandlersDefault,
      // 客户端半：目录走契约的客户端形态读（`client.catalog()`），不再拼 wire 名。
      LocalRemote,
    ],
    timeoutMs: 20_000,
  });
  onTestFinished(() => app.dispose().catch(() => {}));
  return { app, handlers: app.get(RemoteHandlers), root };
}

/** `permissionPresets` 目录的 `defaultPreset`（契约客户端：`client.catalog()`，wire 回来是 `{ ok, value }`）。 */
async function catalogDefaultOf(app: App): Promise<unknown> {
  const result = await app.get(PermissionPresetsEndpointClient).catalog();
  if (!result.ok) throw new Error("permissionPresets/catalog 失败：" + result.error.message);
  return result.value.defaultPreset;
}

describe("默认权限档位的读写", () => {
  test(
    "读到的默认档位就是装配给的值，并已写进设置文档（设置行拿得到这一档）",
    { timeout: 20_000 },
    async () => {
      const { app, handlers } = await boot();

      expect(await catalogDefaultOf(app)).toBe("workspace-write");

      const described = (await handlers.invoke("settings/describe", {})) as {
        ok?: unknown;
        value?: { namespaces?: readonly { ns: string; value?: unknown }[] };
      };
      expect(described.ok).toBe(true);
      expect(described.value?.namespaces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ns: "permission",
            value: { defaultPreset: "workspace-write" },
          }),
        ]),
      );
    },
  );

  test("在设置里改写默认档位后落盘，下一次启动按新值建会话", { timeout: 30_000 }, async () => {
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
    expect(await catalogDefaultOf(second.app)).toBe("danger-full-access");
  });
});
