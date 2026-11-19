// 读配置：**只有一份**，没有第二份可回落（`package.json` 的 `dsh` 段不再读）。
import { access } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CliError } from "../errors.ts";
import { layoutOf } from "../layout.ts";
import type { HmrSwitches, ResolvedConfig, ZephyrConfig } from "./contract.ts";

/** 配置文件名。 */
export const CONFIG_FILENAME = "zephyr.config.ts";

/** 说明一份配置该有什么（报错时贴出来，省得人去翻文档）。 */
const SHAPE_HINT = [
  "工作区配置长这样：",
  "  export default {",
  "    server: { entry: './src/server.ts' },",
  "    client: { entry: './src/client/index.html' },",
  "    desktop: { id: 'ai.example.app', name: 'Example' },",
  "    dataDir: 'workspace',",
  "    plugins: [...provideDesktopBundle({ })],",
  "  } satisfies ZephyrConfig",
].join("\n");

/**
 * 读并校验工作区配置。
 *
 * 找不到文件是**错误而不是回落**：清单是唯一的装配面，缺省清单会让「为什么我的插件没生效」
 * 变成必须读实现才能回答的问题。
 * @param options - 工作区与可选的配置文件路径。
 * @returns 解析后的配置（路径全部绝对化）。
 */
export async function loadConfig(options: {
  readonly cwd: string;
  readonly configFile?: string;
  /**
   * 环境变量的面（缺省 `process.env`）。
   *
   * 只有**显式开关**从这里读（HMR 的两个），测试因此不必改进程环境。
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<ResolvedConfig> {
  const configFile =
    options.configFile === undefined
      ? join(options.cwd, CONFIG_FILENAME)
      : resolve(options.cwd, options.configFile);
  if (!(await exists(configFile))) {
    throw new CliError(`没有找到 ${CONFIG_FILENAME}（找的是 ${configFile}）。\n${SHAPE_HINT}`);
  }
  const module = (await import(pathToFileURL(configFile).href)) as { default?: unknown };
  const config = assertConfig(module.default, configFile);
  const workspace = dirname(configFile);
  const appName = config.desktop?.name ?? workspace.split(/[\\/]/u).at(-1) ?? "zephyr-app";
  // 产物根归配置（设计决定 3）：相对配置文件或绝对，缺省 `target/<应用名>`。
  const layout = layoutOf(workspace, config.server.outputDir, appName);
  return {
    config,
    configFile,
    workspace,
    layout,
    serverEntry: absolutize(workspace, config.server.entry),
    clientEntry: absolutize(workspace, config.client.entry),
    appName,
    // 配置写一次、环境变量临时覆盖：合成只有这一处（见 `HmrSwitches`）。
    hmr: hmrOf(config, options.env ?? process.env),
  };
}

/**
 * 文件在不在（异步：命令行的读盘不该占住事件循环）。
 * @param path - 绝对路径。
 * @returns 判断结果。
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验默认导出的形状；只校验「没有它就跑不下去」的字段。
 * @param value - `export default` 的值。
 * @param configFile - 出错信息里要指出的文件。
 * @returns 配置。
 */
function assertConfig(value: unknown, configFile: string): ZephyrConfig {
  if (typeof value !== "object" || value === null) {
    throw new CliError(`${configFile} 的默认导出不是对象。\n${SHAPE_HINT}`);
  }
  const config = value as Partial<ZephyrConfig>;
  if (typeof config.server?.entry !== "string") {
    throw new CliError(
      `${configFile} 缺少 server.entry（服务端入口，那个文件默认导出 provider 清单）。`,
    );
  }
  if (typeof config.client?.entry !== "string") {
    throw new CliError(
      `${configFile} 缺少 client.entry：写页面那个文件（./src/client/index.html），不是 JS 入口。`,
    );
  }
  if (config.plugins !== undefined && !Array.isArray(config.plugins)) {
    throw new CliError(
      `${configFile} 的 plugins 必须是清单数组（把 provideXxx() 的返回值内联展开）。`,
    );
  }
  return config as ZephyrConfig;
}

/**
 * 相对配置文件所在目录解析。
 * @param workspace - 配置文件所在目录。
 * @param target - 原始路径。
 * @returns 绝对路径。
 */
function absolutize(workspace: string, target: string): string {
  return isAbsolute(target) ? target : resolve(workspace, target);
}

/** 两个 HMR 的显式开关（环境变量名即 home：命令与文档都按这里写）。 */
const HMR_ENV = {
  client: "ZEPHYR_HMR_CLIENT",
  server: "ZEPHYR_HMR_SERVER",
} as const;

/** 认作「关」的写法。 */
const SWITCH_OFF = new Set(["0", "false", "off", "no"]);

/** 认作「开」的写法。 */
const SWITCH_ON = new Set(["1", "true", "on", "yes"]);

/**
 * HMR 的两半生效值：环境变量 > 配置 > 缺省（开）。
 * @param config - 工作区配置。
 * @param env - 环境变量的面。
 * @returns 两半的生效值（取值非法时由 {@link switchOf} 抛 `CliError`）。
 */
function hmrOf(
  config: ZephyrConfig,
  env: Readonly<Record<string, string | undefined>>,
): HmrSwitches {
  const configured = config.dev?.hmr;
  return {
    client: switchOf(HMR_ENV.client, env[HMR_ENV.client], configured?.client),
    server: switchOf(HMR_ENV.server, env[HMR_ENV.server], configured?.server),
  };
}

/**
 * 一个开关的生效值。
 * @param name - 环境变量名（报错要指出是哪个）。
 * @param raw - 环境变量原值。
 * @param fallback - 配置里的值（没写就是开）。
 * @returns 生效值。
 * @throws CliError 取值不在两组合法写法里。
 */
function switchOf(name: string, raw: string | undefined, fallback: boolean | undefined): boolean {
  const text = raw?.trim().toLowerCase() ?? "";
  if (text === "") return fallback ?? true;
  if (SWITCH_OFF.has(text)) return false;
  if (SWITCH_ON.has(text)) return true;
  throw new CliError(
    `${name} 只接受 ${[...SWITCH_OFF, ...SWITCH_ON].join(" | ")}（或不设），收到 ${JSON.stringify(raw)}`,
  );
}
