// 闭包冒烟的两个「不做」：没有闭包、没有入口时**跳过**，而不是红。
//
// 为什么要有这一条：`runBuild` 在装配级用例里配的是假 steps（只验编排），仓库里也没有真闭包；
// 冒烟若无条件跑，它会报 `ENOENT`——把"没东西可冒烟"说成"冒烟失败"。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { layoutOf } from "../layout.ts";
import { smokeClosure } from "../build/builder.ts";

/** 本轮建的临时工作区（用例结束统一删）。 */
const created: string[] = [];

/**
 * 造一个临时工作区，按需建出 `runtime` 与 `entry.mjs`。
 * @param shape - 要建哪几样。
 * @returns 布局。
 */
async function layoutWith(shape: { readonly runtime: boolean; readonly entry: boolean }) {
  const workspace = await mkdtemp(join(tmpdir(), "zephyr-smoke-"));
  created.push(workspace);
  const layout = layoutOf(workspace);
  if (shape.runtime) await mkdir(layout.runtime, { recursive: true });
  if (shape.entry) {
    await mkdir(layout.runtime, { recursive: true });
    await writeFile(layout.entry, "export default {};\n", "utf8");
  }
  return layout;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("运行时闭包冒烟", () => {
  it("闭包不存在：跳过，不报错", async () => {
    const layout = await layoutWith({ runtime: false, entry: false });
    await expect(smokeClosure(layout)).resolves.toBe("skipped");
  });

  it("闭包在但没有入口：跳过（入口是第三步的产物，前两步跑完时还没有）", async () => {
    const layout = await layoutWith({ runtime: true, entry: false });
    await expect(smokeClosure(layout)).resolves.toBe("skipped");
  });
});
