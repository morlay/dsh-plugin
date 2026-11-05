// 测试装置：**临时数据根**用 vitest fixture 管，不用每个 spec 手写 `mkdtemp` + `roots` 数组 + 清理。
//
// 好处是"一次声明、自动回收"：用例失败/超时抛出时 `await use(dir)` 之后的清理照样跑，
// 也不会出现"忘了把 root push 进数组"的泄漏。装配侧的用法：
//
//   test("…", async ({ tmpdir }) => { const app = await boot(tmpdir); … })
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "vitest";

/** fixture 提供的装置。 */
export interface TestFixtures {
  /** 本用例独占的临时目录（用完自动删）。 */
  tmpdir: string;
}

export const test = base.extend<TestFixtures>({
  tmpdir: async ({ task: _task }, use) => {
    const dir = await mkdtemp(join(osTmpdir(), "dsh-test-"));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },
});

export { expect } from "vitest";
