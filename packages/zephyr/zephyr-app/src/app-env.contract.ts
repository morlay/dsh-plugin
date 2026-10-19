// 运行环境契约：**所有路径都由它提供**（装配方显式给值；不读环境变量、不向上找目录）。
import { Injectable } from "@morlay/zephyr";

export interface AppEnvValues {
  /** 数据根（sessions、credentials、logs 都在它下面）。 */
  readonly dataDir: string;
  /** 装配根（`package.json` 所在目录；依赖解析、pnpm store、缓存都从它派生）。 */
  readonly profileDir: string;
  /** 开发形态：仓库内的包逐文件走 vite（改它要 HMR），只有 `aggregate` 点名的包预编译。 */
  readonly dev: boolean;
  /** dev 形态下"不打算改、值得按包聚合"的包（glob）。 */
  readonly aggregate?: readonly string[];
  /** remote namespace 清单（按需装载，形如 `dsh-llm`）。 */
  readonly remotes?: readonly string[];
}

@Injectable()
export abstract class AppEnv {
  abstract readonly values: AppEnvValues;

  /** 联邦产物与聚合结果的缓存目录（与 vite 的 `.vite` 并列）。 */
  abstract readonly cacheDir: string;

  /** 本包自己的根（页面的骨架、`node-stub` 从它推）。 */
  abstract readonly packageRoot: string;

  /** 页面与入口所在的目录（vite 的 root）：本包的 `src/client/app-boot`。 */
  abstract readonly appBootDir: string;

  /** 装配根的清单：`<profileDir>/package.json`（依赖解析的基准）。 */
  abstract readonly profileManifest: string;
}
