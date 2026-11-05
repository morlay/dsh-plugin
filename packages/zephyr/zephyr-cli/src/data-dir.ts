// 数据目录（`$DSH_HOME`）：三态一条规则，dev 与打包形态共用。
//
// 三种写法的**缺省不同**是部署事实，不是实现细节，所以它出现在配置里、也出现在 `--data-dir` 上：
//   - `workspace`：`<profileDir>/.dsh-store`——开发时数据跟着工作走走，删工作区就清干净；
//   - `xdg`：系统应用数据目录——打包形态该落在这里；
//   - 绝对路径：显式指定（测试、双开对比）。
import { isAbsolute, join } from "node:path";

/**
 * 三态写法：`workspace` / `xdg` / 路径。
 *
 * 类型层面就是 `string`——把它拆成字面量联合只会让调用方多写一次收窄，
 * 取值约束由 `--data-dir` 的枚举声明与 {@link resolveDataDir} 共同保证。
 */
export type DataDirSpec = string;

/** 解析所需的上下文。 */
export interface DataDirContext {
  /** 原始写法。 */
  readonly spec: string;
  /** 装配根（dev 是工作区，打包形态是闭包目录）。 */
  readonly profileDir: string;
  /** 应用名（`xdg` 时作为目录名；取 `desktop.name` 或包名）。 */
  readonly appName: string;
  /** 平台（注入以便测三平台）。 */
  readonly platform?: NodeJS.Platform;
  /** 家目录（注入以便测试）。 */
  readonly homeDir?: string;
}

/**
 * 把三态写法解析成绝对路径。
 * @param context - 写法与上下文。
 * @returns 绝对路径。
 * @throws CliError 写法既不是两个关键字也不是绝对路径。
 */
export function resolveDataDir(context: DataDirContext): string {
  if (context.spec === "workspace") return join(context.profileDir, ".dsh-store");
  if (context.spec === "xdg") {
    const platform = context.platform ?? process.platform;
    const home = context.homeDir ?? process.env.HOME ?? "";
    if (platform === "darwin") return join(home, "Library", "Application Support", context.appName);
    if (platform === "win32") {
      const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
      return join(appData, context.appName);
    }
    const xdg = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
    return join(xdg, context.appName);
  }
  if (isAbsolute(context.spec)) return context.spec;
  return join(context.profileDir, context.spec);
}
