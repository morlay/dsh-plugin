import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { devModeOf } from "../dev-mode.ts";
import { devToolsOf } from "../dev-tools.ts";
import type { InspectorPort, InspectorSession } from "../inspector.ts";
import { menuTemplateOf, type MenuItemSpec } from "../menu.ts";

/** 假适配器记下的调用（测试的「真值」是它记的事，不是实现里怎么写的）。 */
interface FakeInspector extends InspectorPort {
  readonly opens: number;
  readonly closes: number;
}

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** @returns 一个空的 userData。 */
async function tempUserData(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zephyr-dev-tools-"));
  dirs.push(dir);
  return dir;
}

/**
 * 假适配器：不真开端口，只记开 / 关次数与地址（`fail` 模拟端口全占）。
 * @param options - `fail` 让 `open` 抛。
 * @returns 接缝 + 计数。
 */
function fakeInspector(options: { fail?: boolean } = {}): FakeInspector {
  let session: InspectorSession | undefined;
  let opens = 0;
  let closes = 0;
  return {
    get opened(): boolean {
      return session !== undefined;
    },
    get address(): string | undefined {
      return session?.address;
    },
    get opens(): number {
      return opens;
    },
    get closes(): number {
      return closes;
    },
    async open(): Promise<InspectorSession> {
      opens += 1;
      if (options.fail === true) throw new Error("127.0.0.1 上从 9229 起连试 10 个端口都被占用。");
      session = {
        host: "127.0.0.1",
        port: 9230,
        address: "devtools://devtools/bundled/inspector.html?ws=127.0.0.1:9230/abc",
      };
      return session;
    },
    async close(): Promise<void> {
      closes += 1;
      session = undefined;
    },
  };
}

/**
 * @param template - 顶层菜单。
 * @returns 视图菜单的文案。
 */
function viewLabelsOf(template: readonly MenuItemSpec[]): string[] {
  const view = template.find((item) => item.label === "视图")?.submenu ?? [];
  return view.flatMap((item) => (item.label === undefined ? [] : [item.label]));
}

/**
 * @param template - 顶层菜单。
 * @param label - 项的文案。
 * @returns 那一项。
 */
function itemOf(template: readonly MenuItemSpec[], label: string): MenuItemSpec | undefined {
  const view = template.find((item) => item.label === "视图")?.submenu ?? [];
  return view.find((item) => item.label === label);
}

describe("开发面动作（DevMode + InspectorPort 的接线）", () => {
  it("点开发者模式：状态翻转、重画一次菜单；关掉时收起开发项并关掉 Inspector", async () => {
    const userData = await tempUserData();
    const devMode = await devModeOf({ userData, env: {}, argv: [] });
    const inspector = fakeInspector();
    const events: string[] = [];
    let rebuilds = 0;
    const devTools = devToolsOf({
      devMode,
      inspector,
      report: async (stage, detail) => {
        events.push(detail === undefined ? stage : `${stage} ${detail}`);
      },
      onChange: () => {
        rebuilds += 1;
      },
    });
    expect(devTools.enabled).toBe(false);
    expect(devTools.inspector.opened).toBe(false);

    await devTools.toggleDevMode();
    expect(devTools.enabled).toBe(true);
    expect(rebuilds).toBe(1);
    const opened = menuTemplateOf({
      platform: "darwin",
      appName: "Zephyr Custom",
      debug: devTools.enabled,
      inspector: devTools.inspector,
    });
    expect(viewLabelsOf(opened)).toContain("打开主进程 Inspector");

    // 开着 Inspector 时关模式：开发项收起，端口被关掉（不残留）。
    await devTools.toggleInspector();
    expect(inspector.opens).toBe(1);
    await devTools.toggleDevMode();
    expect(devTools.enabled).toBe(false);
    expect(inspector.closes).toBe(1);
    expect(inspector.opened).toBe(false);
    const closed = menuTemplateOf({
      platform: "darwin",
      appName: "Zephyr Custom",
      debug: devTools.enabled,
      inspector: devTools.inspector,
    });
    expect(viewLabelsOf(closed)).not.toContain("打开主进程 Inspector");
    expect(devTools.inspector.address).toBeUndefined();
  });

  it("点 Inspector：开着时勾选、地址进菜单与日志；再点关掉就清空", async () => {
    const userData = await tempUserData();
    const devMode = await devModeOf({ userData, env: { ZEPHYR_DESKTOP_DEBUG: "1" }, argv: [] });
    const inspector = fakeInspector();
    const events: string[] = [];
    const devTools = devToolsOf({
      devMode,
      inspector,
      report: async (stage, detail) => {
        events.push(detail === undefined ? stage : `${stage} ${detail}`);
      },
      onChange: () => undefined,
    });
    await devTools.toggleInspector();
    const address = "devtools://devtools/bundled/inspector.html?ws=127.0.0.1:9230/abc";
    expect(devTools.inspector).toEqual({ opened: true, address });
    expect(events.some((line) => line.includes(address))).toBe(true);
    const template = menuTemplateOf({
      platform: "darwin",
      appName: "Zephyr Custom",
      debug: devTools.enabled,
      inspector: devTools.inspector,
    });
    expect(itemOf(template, "打开主进程 Inspector")?.checked).toBe(true);
    expect(itemOf(template, "复制 Inspector 地址")?.enabled).toBe(true);

    await devTools.toggleInspector();
    expect(inspector.closes).toBe(1);
    // `failed` 只在标灰时出现：没失败过就不带这一位。
    expect(devTools.inspector).toEqual({ opened: false });
    const after = menuTemplateOf({
      platform: "darwin",
      appName: "Zephyr Custom",
      debug: devTools.enabled,
      inspector: devTools.inspector,
    });
    expect(itemOf(after, "打开主进程 Inspector")?.checked).toBe(false);
    expect(itemOf(after, "复制 Inspector 地址")?.enabled).toBe(false);
  });

  it("打不开（端口全占）：记一行原因、菜单项标灰，点击不抛到外面", async () => {
    const userData = await tempUserData();
    const devMode = await devModeOf({ userData, env: { ZEPHYR_DESKTOP_DEBUG: "1" }, argv: [] });
    const inspector = fakeInspector({ fail: true });
    const events: string[] = [];
    const devTools = devToolsOf({
      devMode,
      inspector,
      report: async (stage, detail) => {
        events.push(detail === undefined ? stage : `${stage} ${detail}`);
      },
      onChange: () => undefined,
    });
    await devTools.toggleInspector();
    expect(devTools.inspector).toEqual({ opened: false, failed: true });
    expect(events.some((line) => line.includes("都被占用"))).toBe(true);
    const template = menuTemplateOf({
      platform: "darwin",
      appName: "Zephyr Custom",
      debug: devTools.enabled,
      inspector: devTools.inspector,
    });
    expect(itemOf(template, "打开主进程 Inspector")?.enabled).toBe(false);
    expect(itemOf(template, "复制 Inspector 地址")?.enabled).toBe(false);
  });

  it("退出：关掉 Inspector（不残留端口）；没开着也不报错", async () => {
    const userData = await tempUserData();
    const devMode = await devModeOf({ userData, env: { ZEPHYR_DESKTOP_DEBUG: "1" }, argv: [] });
    const inspector = fakeInspector();
    const devTools = devToolsOf({
      devMode,
      inspector,
      report: async () => undefined,
      onChange: () => undefined,
    });
    await devTools.dispose();
    expect(inspector.closes).toBe(0);
    await devTools.toggleInspector();
    await devTools.dispose();
    expect(inspector.closes).toBe(1);
    expect(inspector.opened).toBe(false);
  });
});
