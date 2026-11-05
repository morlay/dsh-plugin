// 读配置：**只有一份**，没有第二份可回落（`package.json` 的 `dsh` 段不再读）。
import { access } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CliError } from "../errors.ts";
import { layoutOf } from "../layout.ts";
import type { ResolvedConfig, ZephyrConfig } from "./contract.ts";

/** 配置文件名。 */
export const CONFIG_FILENAME = "zephyr.config.ts";

/** 说明一份配置该有什么（报错时贴出来，省得人去翻文档）。 */
const SHAPE_HINT = [
  "工作区配置长这样：",
  "  export default {",
  "    server: { entry: './src/server.ts' },",
  "    client: { entry: './src/client/index.tsx' },",
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
  const layout = layoutOf(workspace, config.build?.outDir);
  return {
    config,
    configFile,
    workspace,
    layout,
    serverEntry: absolutize(workspace, config.server.entry),
    clientEntry: absolutize(workspace, config.client.entry),
    appName,
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
