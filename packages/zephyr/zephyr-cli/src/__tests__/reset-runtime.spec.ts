// 连续构建要幂等：`pnpm deploy` 只接受空目录，上一次留下的闭包必须先清掉。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetRuntime } from "../build/builder.ts";
import { layoutOf } from "../layout.ts";

/** 本轮建的临时工作区（用例结束统一删）。 */
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("运行时闭包目录", () => {
  it("构建前清空：上一次的 node_modules 不会让 deploy 报 DIR_NOT_EMPTY", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "zephyr-reset-"));
    created.push(workspace);
    const layout = layoutOf(workspace);
    const stale = join(layout.runtime, "node_modules", "@morlay", "zephyr");
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, "index.mjs"), "export {};\n", "utf8");

    await resetRuntime(layout);

    await expect(rm(layout.runtime, { recursive: true, force: true })).resolves.toBeUndefined();
    // 目录不存在时再次清理也应该成功（幂等）。
    await expect(resetRuntime(layout)).resolves.toBeUndefined();
  });
});
