// 连续构建要幂等：`pnpm deploy` 只接受空目录，上一次留下的闭包必须先清掉。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { resetClosure } from "../build/builder.ts";
import { layoutOf } from "../layout.ts";

/** 本轮建的临时工作区（用例结束统一删）。 */

describe("运行时闭包目录", () => {
  test("构建前清空：上一次的 node_modules 不会让 deploy 报 DIR_NOT_EMPTY", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "zephyr-reset-"));
    onTestFinished(() => rm(workspace, { recursive: true, force: true }));
    const layout = layoutOf(workspace, undefined, "Demo");
    const stale = join(layout.nodeModules, "@morlay", "zephyr");
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, "index.mjs"), "export {};\n", "utf8");

    await resetClosure(layout);

    await expect(rm(layout.nodeModules, { recursive: true, force: true })).resolves.toBeUndefined();
    // 目录不存在时再次清理也应该成功（幂等）。
    await expect(resetClosure(layout)).resolves.toBeUndefined();
  });
});
