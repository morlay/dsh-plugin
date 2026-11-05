// @vitest-environment happy-dom
/**
 * **位置台账**：主流程要的五个面各自的位置有没有被声明。
 *
 * `Slots.keys()` 是这一层唯一的枚举面（上游 `SlotRegistry` 只能按 key 查）。
 * 判据是"位置被碰过"——某个面漏装时，它的父位置还在台账里，但它自己的位置不会出现。
 *
 * 为什么不用"条目数 > 0"：有些位置只是声明容器（`children`），本就没有直接条目；
 * 位置本身是否存在，才对应"这一面装没装"。
 */
import { configure, bootstrapApplication, type App } from "@morlay/zephyr";
import { clientPackagesOf, WebServer } from "@morlay/zephyr-app";
import { ClientConnectionDefault, Slots } from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it } from "vitest";
import { appClientProviders } from "../index.ts";
import { customProvidersOf } from "../../zephyr.provide.ts";

/** 主流程五个面 → 它们各自的位置 key。 */
const FACES: Readonly<Record<string, readonly string[]>> = {
  会话: ["conversation.session", "conversation.view", "conversation.content"],
  模型选择: ["conversation.input.model"],
  权限选择: ["conversation.input.permission"],
  命令: ["conversation.composer", "conversation.composer.bar"],
  "at 引用": ["conversation.user.text", "conversation.input.overlay"],
};

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0).reverse()) {
    await Promise.race([
      app.dispose().catch(() => {}),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 10_000);
      }),
    ]);
  }
}, 120_000);

describe("位置台账", { timeout: 240_000 }, () => {
  it("五个面的位置全部声明出来了", async () => {
    process.env.PORT = "0";
    const rows = [...new Set(await clientPackagesOf(customProvidersOf([])))];
    const backend = await bootstrapApplication({ providers: customProvidersOf(rows), timeoutMs: 90_000 });
    opened.push(backend);
    const port = (backend.get(WebServer) as { port?: number }).port;

    const frontend = await bootstrapApplication({
      providers: [
        ...appClientProviders(configure(ClientConnectionDefault, { origin: `http://127.0.0.1:${port}` })),
      ],
      timeoutMs: 90_000,
    });
    opened.push(frontend);

    const slots = frontend.get(Slots);
    const keys = slots.keys();
    expect(keys, "根位置必须有注册（否则壳渲染不出来）").toContain("root");

    // ② **条目**：位置存在只说明有人声明了它；界面要看得见，得有人往里注册条目。
    // 判据错在"只看位置"就是当前这四个问题的来源——位置在台账里，界面上却什么都没有。
    for (const [face, expected] of Object.entries(FACES)) {
      const counts = expected.map((key) => ({
        key,
        count: slots.entries(key as never).length,
      }));
      expect(
        counts.some((item) => item.count > 0),
        `${face} 的位置都在台账里，但没有一个有条目——界面因此什么都不显示：${JSON.stringify(counts)}`,
      ).toBe(true);
    }

    // 「打开配置文件」不注册：上游 `ui-settings-general` 按 `remote.$host.isLoopback` 决定，
    // 本部署不提供那个入口（配置由装配面给，不经界面改宿主磁盘）。位置在台账里但**没有条目**。
    const documentActions = slots
      .entries("settings.action")
      .filter((entry) => (entry as { id?: string }).id === "open-document");
    expect(documentActions, "「打开配置文件」不该被注册").toEqual([]);
    for (const [face, expected] of Object.entries(FACES)) {
      expect(
        expected.filter((key) => keys.includes(key)),
        `${face} 的位置一个都没出现，说明这一面没装上`,
      ).not.toEqual([]);
    }
  });
});

/**
 * 右栏与统计那几面：判据都在**装配出来的服务**上，不在 DOM。
 *
 * 这几条各自踩过一次坑，且**都不会在装配期报错**：
 * - 右栏的 tab 类型要靠 `sidebarRightTabs.register` 一类一类的注册（`files` / `text` / `terminal`）；
 *   少一类，界面上的入口就没有，或者点开一个文件是 `no registered tab type claims "dsh-resource://…"`；
 * - `remote.terminal` / `remote.workspaceFiles` 要各自 `$mount` 自己那份 `TYPERT_REMOTE`（浏览器里没有
 *   全局的 remotes 装载）；少了它终端的第一次 `environment()` 就是 `reading 'environment'`、
 *   文件树永远停在「正在读取…」；
 * - `conversation.view` 里 `trajectory` 的可见性由 `ui-settings.developerTools.enabled` 决定，
 *   而那个命名空间要靠 `SettingSchema.register` 才进 `settings/describe`。
 */
describe("右栏与统计的装配面", { timeout: 240_000 }, () => {
  it("tab 类型齐、remote 面挂上、轨迹视图在列", async () => {
    process.env.PORT = "0";
    const rows = [...new Set(await clientPackagesOf(customProvidersOf([])))];
    const backend = await bootstrapApplication({ providers: customProvidersOf(rows), timeoutMs: 90_000 });
    opened.push(backend);
    const port = (backend.get(WebServer) as { port?: number }).port;

    const frontend = await bootstrapApplication({
      providers: [
        ...appClientProviders(configure(ClientConnectionDefault, { origin: `http://127.0.0.1:${port}` })),
      ],
      timeoutMs: 90_000,
    });
    opened.push(frontend);

    // ① 右栏的 tab 类型：`files`（文件树）、`text`（文件预览）、`terminal`（终端）+ 上游自带的三个。
    const tabs = frontend.ctx.get("sidebarRightTabs", false) as
      | { readonly kinds: Map<string, unknown> }
      | undefined;
    expect(tabs, "右栏的注册表要在（`SidebarRightSlots` 装的就是它）").toBeDefined();
    expect([...(tabs?.kinds.keys() ?? [])]).toEqual(
      expect.arrayContaining(["guide", "files", "text", "terminal"]),
    );

    // ② 两份 remote 面：浏览器里没有全局的 remotes 装载，谁用谁挂。
    const remote = frontend.ctx.get("remote", false) as
      | { readonly terminal?: unknown; readonly workspaceFiles?: unknown; readonly commands?: unknown }
      | undefined;
    expect(remote?.terminal, "终端的 `terminal/*` 端点面").toBeDefined();
    expect(remote?.workspaceFiles, "文件树的 `workspaceFiles/*` 端点面").toBeDefined();
    expect(remote?.commands, "`/` 面板的 `commands/*` 端点面").toBeDefined();

    // ③ 统计的两枚 pill 与轨迹视图：位置上的条目数就是"装没装"。
    const slots = frontend.get(Slots);
    expect(slots.entries("conversation.composer.dock").length, "activity + usage 两枚").toBeGreaterThanOrEqual(2);
    const viewIds = slots
      .entries("conversation.view")
      .map((entry) => (entry as { options?: { id?: string } }).options?.id);
    expect(viewIds).toEqual(expect.arrayContaining(["chat", "trajectory"]));

    // ④ 轨迹的可见性开关：`ui-conversation` 的视图列表直接读 `configForms.developerTools.enabled`
    //    （`!enabled && id === 'trajectory'` 就过滤掉）。这里只钉"这个偏好面存在且可读"——
    //    它的取值来自设置文档，那条链在 `dsh-setting` 的 `settings/describe` 用例里断言（默认 true）。
    const configForms = frontend.ctx.get("configForms", false) as
      | { readonly developerTools?: { readonly enabled: { getSnapshot(): boolean } } }
      | undefined;
    expect(configForms?.developerTools, "`ui-settings` 的偏好在 client 侧要有投影面").toBeDefined();
    expect(typeof configForms?.developerTools?.enabled.getSnapshot()).toBe("boolean");
  });
});
