// 默认值：dataDir = `<profileDir>/.dsh-store`，profileDir = 当前运行目录，dev=true，聚合名单为空。
//
// 配置从**构造参数**进来：`configure(AppEnvDefault, values)` 绑到子类后，zephyr 用
// `new impl(config)` 建实例（`attach.ts` 的 `construct`），配置只有落在构造参数上才收得到。
// 写成类字段初值的话装配面的覆盖会被静默丢掉——`values` 与三个派生路径因此都在构造里定。
import { Injectable } from "@morlay/zephyr";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppEnvValues } from "./app-env.contract.ts";
import { AppEnv } from "./app-env.contract.ts";

@Injectable()
export class AppEnvDefault extends AppEnv {
  readonly values: AppEnvValues;

  // `../../package.json`：本文件在 `src/app-env/` 下，往上两层才是**包根**（`src/` 的上一层）。
  // 契约里的 `packageRoot` 是包根——`node-stub` 这类路径都按 `<packageRoot>/src/…` 拼。
  readonly packageRoot = dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));

  /** 页面与 vite 入口所在的目录：**应用**自己的 `src/client`（入口归应用）。 */
  readonly appBootDir: string;

  readonly profileManifest: string;

  readonly cacheDir: string;

  /**
   * @param values 装配面经 `configure` 绑定的覆盖；缺省项用本类的默认值。
   */
  constructor(values: Partial<AppEnvValues> = {}) {
    super();
    this.values = {
      profileDir: process.cwd(),
      dataDir: join(process.cwd(), ".dsh-store"),
      dev: true,
      aggregate: [],
      ...values,
    };
    this.appBootDir = join(this.values.profileDir, "src", "client");
    this.profileManifest = join(this.values.profileDir, "package.json");
    this.cacheDir = join(this.values.profileDir, "node_modules", ".dsh-client-modules");
  }
}
