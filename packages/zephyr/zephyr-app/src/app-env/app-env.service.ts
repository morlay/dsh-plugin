// 默认值：profileDir = 当前运行目录，dataDir = `<profileDir>/.dsh-store`，
// defaultWorkingDirectory = 当前运行目录（与 profileDir 同一个兜底，但语义不同，见契约注释）。
//
// **读 cwd 在本仓库的这条链上只有下面构造里这一处**：cwd 是「我在哪个目录」的唯一事实来源，
// 其余代码（含各域、各上游行）只读 `AppEnv` 给的派生值。装配面要换目录就给值，
// 不要自己去读 cwd——那等于把同一事实抄成两份，抄漏一处就是路径分叉。
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
  /**
   * 比契约更窄：**本类的 `values` 一定带 `defaultWorkingDirectory`**（构造里必然填，缺省 cwd）。
   *
   * 契约上它是可选的（各包手写的替身只给两条路径也成立），所以窄这一层是给这里加守卫：
   * 谁把构造里那一行删了，编译就报错，而不是让消费方悄悄落到基类 getter 的兜底上。
   */
  readonly values: AppEnvValues & { readonly defaultWorkingDirectory: string };

  // `../../package.json`：本文件在 `src/app-env/` 下，往上两层才是**包根**（`src/` 的上一层）。
  // 契约里的 `packageRoot` 是包根——`node-stub` 这类路径都按 `<packageRoot>/src/…` 拼。
  /**
   * 本包自己的根。
   *
   * **惰性求值**：`import.meta.url` 在非 `file:` 运行时里（vitest 的 happy-dom 环境是
   * `http://localhost/…`）会让 `fileURLToPath` 抛 `The URL must be of scheme file`——
   * 写成字段初始化器的话，**类一被求值就崩**，整份装配都加载不了。
   * @returns 包根目录的绝对路径。
   */
  get packageRoot(): string {
    return dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));
  }

  /** 页面与 vite 入口所在的目录：**应用**自己的 `src/client`（入口归应用）。 */
  readonly appBootDir: string;

  readonly profileManifest: string;

  readonly cacheDir: string;

  /**
   * @param values 装配面经 `configure` 绑定的覆盖；缺省项用本类的默认值。
   */
  constructor(values: Partial<AppEnvValues> = {}) {
    super();
    // cwd 只读这一次：其余路径从它（或装配面给的覆盖）派生。写成两行的话，cwd 在构造期间被
    // chdir 改掉就会分叉成两个根——同一事实两个来源，正是这一票要消灭的东西。
    const cwd = process.cwd();
    const profileDir = values.profileDir ?? cwd;
    this.values = {
      profileDir,
      defaultWorkingDirectory: values.defaultWorkingDirectory ?? cwd,
      dataDir: values.dataDir ?? join(profileDir, ".dsh-store"),
    };
    this.appBootDir = join(this.values.profileDir, "src", "client");
    this.profileManifest = join(this.values.profileDir, "package.json");
    // 运行 cache 落在**数据根**下（`{DSH_HOME}/cache`）：它是运行期产物，不该跟着装配面走
    // （装配面在打包形态是 asar 内的只读目录）。
    this.cacheDir = join(this.values.dataDir, "cache");
  }
}
