import { join } from "node:path";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";

/**
 * 部署事实的替身：数据根指向一个目录（**每个用例一个临时目录**，不要复用）。
 *
 * `AppEnv` 是"部署事实"（数据根、缓存根、清单路径），headless 装配也需要它——所以它的替身
 * 属本域的测试支撑，别在下游各写一份。
 */
export class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues;

  readonly cacheDir: string;

  readonly packageRoot: string;

  readonly appBootDir: string;

  readonly profileManifest: string;

  /**
   * @param root - 数据根（通常是 `mkdtemp` 出来的临时目录）。
   */
  constructor(root: string) {
    super();
    this.values = { dataDir: root, profileDir: root };
    this.cacheDir = join(root, "cache");
    this.packageRoot = root;
    this.appBootDir = join(root, "boot");
    this.profileManifest = join(root, "package.json");
  }
}
