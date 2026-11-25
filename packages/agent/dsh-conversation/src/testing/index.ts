// `@morlay/dsh-conversation/testing`：本包 UI 测试的入口 = base 的 `test` + **每个用例自动跑的收尾**。
//
// 为什么是 fixture 而不是全局 `setupFiles`：`auto: true` 挂在**这个包导出的 `test`** 上，
// 谁 import 谁就得到这份收尾——从 import 行就读得出来，spec 里也不用写 `afterEach(cleanup)`。
import { cleanup } from "@testing-library/react";
import { test as base } from "@morlay/zephyr-app/testing";
import { vi } from "vitest";

export { describe, expect } from "@morlay/zephyr/testing";
export type { AppEnvFixture, AppEnvFixtures, TestingAppEnv } from "@morlay/zephyr-app/testing";

/**
 * 挂了本包 `test` 的 spec 自动得到：
 *
 * - `rtlCleanup`：卸载本轮渲染的 DOM（`@testing-library/react` 的 `cleanup`）；
 * - `stubRestore`：还原 `vi.stubEnv` / `vi.stubGlobal` / `vi.spyOn`（不靠 vitest 的隐式全局开关）。
 */
export const test = base.extend({
  rtlCleanup: [
    async ({}, use: (value: undefined) => Promise<void>) => {
      await use(undefined);
      cleanup();
    },
    { auto: true },
  ],
  stubRestore: [
    async ({}, use: (value: undefined) => Promise<void>) => {
      await use(undefined);
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
    { auto: true },
  ],
});
