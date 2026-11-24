// 缓存的命名空间：`<cacheDir>/<namespace>`，消费方不许自己拼根。
//
// 判据只钉两件事：白名单里的用途各自落在自己那层；`cacheDirOf` 是**具体方法**（只覆盖字段的替身就能用）。
import { Injectable } from "@morlay/zephyr";
import { join } from "node:path";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { AppEnv } from "../app-env/app-env.contract.ts";

/**
 * 只覆盖字段的最小测试实现。
 *
 * 这里**故意**不用 `TestingAppEnv`：本条要证明的是「只覆盖字段的实现也能直接用
 * `cacheDirOf`」，替身越完整，被测的那条前提越不明显。
 */
@Injectable()
class FieldsOnlyEnv extends AppEnv {
  readonly values = { dataDir: "/data", profileDir: "/profile", defaultWorkingDirectory: "/work" };
  readonly cacheDir = join("/data", "cache");
  readonly profileManifest = "/profile/package.json";
}

describe("缓存命名空间", () => {
  const env = new FieldsOnlyEnv();

  test("每个用途占 <cacheDir>/<namespace> 一层", () => {
    expect(env.cacheDirOf("client-modules")).toBe(join("/data", "cache", "client-modules"));
    expect(env.cacheDirOf("vite")).toBe(join("/data", "cache", "vite"));
  });

  test("cacheDirOf 是具体方法：只覆盖字段的实现不用再写一遍", () => {
    expect(typeof env.cacheDirOf).toBe("function");
    expect(env.cacheDirOf("vite")).not.toBe(env.cacheDir);
  });
});
