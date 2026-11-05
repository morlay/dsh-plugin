// 运行环境替身：`AppEnv` 契约的完整实现，路径全部指向**本用例的临时目录**。
//
// 为什么不用 `configure(AppEnvDefault, …)`：`AppEnvDefault` 的 `values` 是类字段初值，
// 它没有构造参数，配置进不去，于是 `dataDir` 落在进程 cwd 的 `.dsh-store` 上——测试会互相污染
// （同一 session id 的 header 在多次运行之间残留）。这里显式给值。
import { join } from "node:path";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export class FakeAppEnv extends AppEnv {
  /** 本用例的临时根目录（测试在 `bootstrapApplication` 之前设置）。 */
  static root = "";

  readonly values: AppEnvValues = {
    dataDir: FakeAppEnv.root,
    profileDir: FakeAppEnv.root,
    dev: false,
    aggregate: [],
  };

  readonly cacheDir = join(FakeAppEnv.root, "cache");

  readonly packageRoot = FakeAppEnv.root;

  readonly appBootDir = join(FakeAppEnv.root, "boot");

  readonly profileManifest = join(FakeAppEnv.root, "package.json");
}
