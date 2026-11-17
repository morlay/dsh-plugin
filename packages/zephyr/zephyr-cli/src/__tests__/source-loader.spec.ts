// 判据：`DSH_SOURCE_LOADER` 是部署接缝——注入一次、不覆盖别人的值、拿到的必须是能 import 的真入口。
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installSourceLoaderEnv } from "../source-loader.ts";

const saved = process.env.DSH_SOURCE_LOADER;

afterEach(() => {
  if (saved === undefined) delete process.env.DSH_SOURCE_LOADER;
  else process.env.DSH_SOURCE_LOADER = saved;
});

describe("源码转译器注入（DSH_SOURCE_LOADER）", () => {
  it("没设时从给定的部署根解析到 @morlay/dsh-oxc-node 的入口", () => {
    delete process.env.DSH_SOURCE_LOADER;
    const loader = installSourceLoaderEnv();
    expect(loader).toContain("dsh-oxc-node");
    expect(process.env.DSH_SOURCE_LOADER).toBe(loader);
  });

  it("已经有值就不覆盖（宿主/壳按自己的闭包给的那份优先）", () => {
    process.env.DSH_SOURCE_LOADER = "/tmp/some/loader.mjs";
    expect(installSourceLoaderEnv()).toBe("/tmp/some/loader.mjs");
    expect(process.env.DSH_SOURCE_LOADER).toBe("/tmp/some/loader.mjs");
  });

  it("空串当作没设（不把空值带进子进程）", () => {
    process.env.DSH_SOURCE_LOADER = "";
    const loader = installSourceLoaderEnv();
    expect(loader).toContain("dsh-oxc-node");
    expect(process.env.DSH_SOURCE_LOADER).toBe(loader);
  });
});
