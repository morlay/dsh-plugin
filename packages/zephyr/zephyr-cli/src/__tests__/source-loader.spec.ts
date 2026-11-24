// 判据：`DSH_SOURCE_LOADER` 是部署接缝——注入一次、不覆盖别人的值、空串当作没设。
//
// 不在这里验「真能解析到 `@morlay/dsh-oxc-node`」：那是集成事实（包在不在、入口对不对），
// 交给 `just verify-release` / e2e 验一次；单元测试只钉接缝的语义，解析入口由测试注入。
import { describe, expect, test } from "@morlay/zephyr/testing";
import { vi } from "vitest";
import { installSourceLoaderEnv } from "../source-loader.ts";

/** 假的 loader 入口（`file://` URL 形状，不真解析）。 */
const FAKE = "file:///fake/loader.mjs";

describe("源码转译器注入（DSH_SOURCE_LOADER）", () => {
  test("没设时写入解析出来的入口，并把它返回给调用方", () => {
    vi.stubEnv("DSH_SOURCE_LOADER", "");
    const loader = installSourceLoaderEnv({ resolve: () => FAKE });
    expect(loader).toBe(FAKE);
    expect(process.env.DSH_SOURCE_LOADER).toBe(FAKE);
  });

  test("已经有值就不覆盖（宿主/壳按自己的闭包给的那份优先）", () => {
    vi.stubEnv("DSH_SOURCE_LOADER", "/tmp/some/loader.mjs");
    expect(installSourceLoaderEnv({ resolve: () => FAKE })).toBe("/tmp/some/loader.mjs");
    expect(process.env.DSH_SOURCE_LOADER).toBe("/tmp/some/loader.mjs");
  });

  test("空串当作没设（不把空值带进子进程）", () => {
    vi.stubEnv("DSH_SOURCE_LOADER", "");
    const loader = installSourceLoaderEnv({ resolve: () => FAKE });
    expect(loader).toBe(FAKE);
    expect(process.env.DSH_SOURCE_LOADER).toBe(FAKE);
  });
});
