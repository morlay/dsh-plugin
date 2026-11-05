// 运行形态：**CLI 提供的只读值行**。
//
// 应用清单装全了 providers，但它要知道「这一次是 dev 还是 preview、数据目录在哪、端口给没给」。
// 这些是部署参数，只有装配面知道值——所以由 CLI 提供一行值，应用用 `inject(CliMode)` 读，
// 而不是去读环境变量（`AppEnv` 契约里已经写明这条规矩）。
import { InjectionToken } from "@morlay/zephyr";

/** 一次运行的部署参数。 */
export interface CliModeValues {
  /** 命令路径（`['dev']`、`['desktop', 'bundle']`）：形态由命令自己决定，不由一个枚举决定。 */
  readonly command: readonly string[];
  /** 工作区（`zephyr.config.ts` 所在目录，绝对路径）。 */
  readonly workspace: string;
  /** 装配根：dev 是工作区；build/preview 是闭包目录；插件命令自己按需要取。 */
  readonly profileDir: string;
  /** 已解析的数据目录（`$DSH_HOME`），绝对路径。 */
  readonly dataDir: string;
  /** 数据目录的原始写法（`workspace` / `xdg` / 绝对路径）。 */
  readonly dataDirSpec: string;
  /** 配置文件绝对路径。 */
  readonly configFile: string;
  /** `--port` 给了就是它。 */
  readonly port?: number;
  /** `--host` 给了就是它。 */
  readonly host?: string;
}

/** 形态值令牌。 */
export const CliMode = InjectionToken<CliModeValues>("cli-mode");
