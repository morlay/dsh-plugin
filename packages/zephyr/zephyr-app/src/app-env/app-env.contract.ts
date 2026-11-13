// 运行环境契约：**所有路径都由它提供**（装配方显式给值；不读环境变量、不向上找目录）。
//
// home 在装配层（`zephyr-app`）：它是**部署参数**，只有装配面知道值；实现 `AppEnvDefault` 同目录。
// 业务包要落盘路径这类部署值，正确做法是装配面 `configure(X, { root })` 喂进去，而不是读全局 env。
import { join } from "node:path";
import { Injectable } from "@morlay/zephyr";

/**
 * 缓存的**命名空间**：每个用途占 `<cacheDir>/<namespace>` 一层。
 *
 * 白名单是刻意的：新增用途要改这个联合类型（外加目录契约里登记一行），
 * 否则缓存根下又会散落出一堆认不出来源的目录。
 */
export type CacheNamespace = "client-modules" | "vite";

export interface AppEnvValues {
  /** 数据根（sessions、credentials、logs 都在它下面）。 */
  readonly dataDir: string;
  /** 装配根（`package.json` 所在目录；依赖解析、pnpm store、缓存都从它派生）。 */
  readonly profileDir: string;
}

@Injectable()
export abstract class AppEnv {
  abstract readonly values: AppEnvValues;

  /** 缓存的**根**：只给 `cacheDirOf`、doctor 与测试读；消费方一律走 {@link AppEnv.cacheDirOf}。 */
  abstract readonly cacheDir: string;

  /**
   * 某个用途的缓存目录（`<cacheDir>/<namespace>`）。
   *
   * 具体方法而不是抽象成员：各包的 `FakeAppEnv` 只覆盖字段，不该为一条路径规则各写一遍实现。
   * @param namespace - 用途（白名单见 {@link CacheNamespace}）。
   * @returns 该用途的缓存根。
   */
  cacheDirOf(namespace: CacheNamespace): string {
    return join(this.cacheDir, namespace);
  }

  /** 本包自己的根（页面的骨架、`node-stub` 从它推）。 */
  abstract readonly packageRoot: string;

  /** 页面与入口所在的目录（vite 的 root）：本包的 `src/client/app-boot`。 */
  abstract readonly appBootDir: string;

  /** 装配根的清单：`<profileDir>/package.json`（依赖解析的基准）。 */
  abstract readonly profileManifest: string;
}
