import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AppConfig } from "./appconfig.ts";

export function xdgDataHome(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support");
  const configured = process.env.XDG_DATA_HOME;
  if (configured !== undefined && configured.trim() !== "") return resolve(configured);
  return join(homedir(), ".local", "share");
}

/**
 * 解析 `dshHome` 的三态：`xdg`（平台数据目录 + app 名）、`env`（交给环境，这里没有具体路径）、
 * 绝对路径。打包壳与 dev CLI（`--home`）共用这一份，措辞与校验只写在这里。
 */
export function resolveConfiguredHome(name: string, spec: string): string | undefined {
  if (spec === "env") return undefined;
  if (spec === "xdg") return join(xdgDataHome(), name);
  if (!isAbsolute(spec)) {
    throw new Error(
      `dsh desktop: dshHome must be xdg, env, or an absolute path, got ${JSON.stringify(spec)}`,
    );
  }
  return spec;
}

export function resolveDshHome(config: AppConfig): string | undefined {
  const override = process.env.DSH_APP_DSH_HOME;
  if (override !== undefined && override.trim() !== "") return resolve(override);
  return resolveConfiguredHome(config.name, config.dshHome);
}
