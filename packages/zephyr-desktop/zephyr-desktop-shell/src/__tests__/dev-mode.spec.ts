import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { DEV_MODE_ARG, devModeOf } from "../dev-mode.ts";

/** 一个空的 userData（标记文件写在它下面）。 */
async function tempUserData(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zephyr-dev-mode-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * @param path - 文件。
 * @returns 在不在（不看内容）。
 */
async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe("开发者模式（三源合并 + 运行期切换 + 持久化 + 订阅）", () => {
  test("三个来源任一成立就开（环境变量 / --zephyr-debug / 标记文件）", async () => {
    const userData = await tempUserData();
    expect((await devModeOf({ userData, env: {}, argv: ["Zephyr Custom"] })).enabled).toBe(false);
    expect(
      (await devModeOf({ userData, env: { ZEPHYR_DESKTOP_DEBUG: "0" }, argv: [] })).enabled,
    ).toBe(false);
    expect(
      (await devModeOf({ userData, env: { ZEPHYR_DESKTOP_DEBUG: "1" }, argv: [] })).enabled,
    ).toBe(true);
    // 打包形态从 Finder 启动时没有环境变量：下面两条就是它的入口。
    expect(
      (await devModeOf({ userData, env: {}, argv: ["Zephyr Custom", DEV_MODE_ARG] })).enabled,
    ).toBe(true);
    // `touch <userData>/debug` 之后重启即生效。
    await writeFile(join(userData, "debug"), "", "utf8");
    expect((await devModeOf({ userData, env: {}, argv: [] })).enabled).toBe(true);
  });

  test("启动参数那条来源叫 --zephyr-debug：只有这个名字能真跑通", async () => {
    const userData = await tempUserData();
    expect(DEV_MODE_ARG).toBe("--zephyr-debug");
    expect(
      (await devModeOf({ userData, env: {}, argv: ["Zephyr Custom", DEV_MODE_ARG] })).enabled,
    ).toBe(true);
    // `--debug` 会被 Electron 先当 Node 的废弃开关拦掉（[DEP0062]，进程到不了入口），不再当来源。
    expect(
      (await devModeOf({ userData, env: {}, argv: ["Zephyr Custom", "--debug"] })).enabled,
    ).toBe(false);
  });

  test("切一次就写标记：重启后仍是开；再切关就删标记", async () => {
    const userData = await tempUserData();
    const devMode = await devModeOf({ userData, env: {}, argv: [] });
    await devMode.set(true);
    expect(devMode.enabled).toBe(true);
    expect(await exists(join(userData, "debug"))).toBe(true);
    // 「重启」= 新造一个（只读盘上的事实，不继承内存状态）。
    expect((await devModeOf({ userData, env: {}, argv: [] })).enabled).toBe(true);
    await devMode.set(false);
    expect(devMode.enabled).toBe(false);
    expect(await exists(join(userData, "debug"))).toBe(false);
    expect((await devModeOf({ userData, env: {}, argv: [] })).enabled).toBe(false);
  });

  test("每次切换都通知订阅者；退订后不再收到", async () => {
    const userData = await tempUserData();
    const devMode = await devModeOf({ userData, env: { ZEPHYR_DESKTOP_DEBUG: "1" }, argv: [] });
    const seen: boolean[] = [];
    const off = devMode.onChange((enabled) => seen.push(enabled));
    await devMode.set(false);
    await devMode.set(true);
    off();
    await devMode.set(false);
    expect(seen).toEqual([false, true]);
    // 标记文件与内存里的值一起变（关也持久化）。
    expect(await exists(join(userData, "debug"))).toBe(false);
    expect(devMode.enabled).toBe(false);
  });

  test("标记文件的内容不重要（`touch` 出来的空文件就是开）", async () => {
    const userData = await tempUserData();
    await writeFile(join(userData, "debug"), "0", "utf8");
    expect((await devModeOf({ userData, env: {}, argv: [] })).enabled).toBe(true);
    expect((await readFile(join(userData, "debug"), "utf8")).length).toBe(1);
  });
});
