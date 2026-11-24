// 缓存失效：缓存是否新鲜只认 `contentRev`（规则版本 + 源码内容指纹）。
//
// 为什么钉这一条：workspace 包的版本号是固定的 `0.0.1`，只看版本/规则版本会让"同版本改了源码"
// 继续复用旧产物——症状是浏览器那边「模块里没有新加的导出」。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { contentRev } from "@morlay/zephyr-dev/testing";

/** 本轮建的临时目录（用例结束统一删）。 */

/**
 * 造一个"源码包"目录（`src/index.ts`）。
 * @param body - 文件内容。
 * @returns 目录。
 */
async function sourcePackage(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zephyr-rev-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "index.ts"), body, "utf8");
  return dir;
}

describe("预编译缓存的内容指纹", () => {
  test("内容变了，指纹就变（同版本源码改动必须失效）", async () => {
    const dir = await sourcePackage("export const a = 1;\n");
    const before = await contentRev([dir]);
    await writeFile(join(dir, "index.ts"), "export const a = 2;\n", "utf8");
    const after = await contentRev([dir]);
    expect(after).not.toBe(before);
    expect(before).toContain(":");
  });

  test("内容没变：指纹稳定（只是重新 stat 一遍）", async () => {
    const dir = await sourcePackage("export const a = 1;\n");
    expect(await contentRev([dir])).toBe(await contentRev([dir]));
  });
});
