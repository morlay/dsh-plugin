// 缓存的命名空间：`<cacheDir>/<namespace>`，消费方不许自己拼根。
//
// 判据只钉两件事：白名单里的用途各自落在自己那层；`cacheDirOf` 是**具体方法**（`FakeAppEnv` 只覆盖字段就能用）。
import { Injectable } from "@morlay/zephyr";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppEnv } from "../app-env/app-env.contract.ts";

/** 只覆盖字段的最小测试实现（与各包 `FakeAppEnv` 同形）。 */
@Injectable()
class FieldsOnlyEnv extends AppEnv {
  readonly values = { dataDir: "/data", profileDir: "/profile" };
  readonly cacheDir = join("/data", "cache");
  readonly packageRoot = "/package";
  readonly appBootDir = "/profile/src/client";
  readonly profileManifest = "/profile/package.json";
}

describe("缓存命名空间", () => {
  const env = new FieldsOnlyEnv();

  it("每个用途占 <cacheDir>/<namespace> 一层", () => {
    expect(env.cacheDirOf("client-modules")).toBe(join("/data", "cache", "client-modules"));
    expect(env.cacheDirOf("vite")).toBe(join("/data", "cache", "vite"));
  });

  it("cacheDirOf 是具体方法：只覆盖字段的实现不用再写一遍", () => {
    expect(typeof env.cacheDirOf).toBe("function");
    expect(env.cacheDirOf("vite")).not.toBe(env.cacheDir);
  });
});
