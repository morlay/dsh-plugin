/**
 * dev 形态的分流配置：profile 的 `dsh.dev.exclude` 点名的包**不算开发模块**。
 *
 * 那些包（如 `@deepseek-ai/*`）在 dev 期间不打算改，于是不值得为它们付"逐文件请求"的代价——
 * 走按包聚合（一个包一份产物、共享 chunk），换掉模块级 HMR；没被点名的包是正在改的，保持逐文件走 vite。
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 一条 glob（只支持 `*`，够用）→ 正则。 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[/\\^$+?.()|[\]{}]/gu, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * 读 profile 的 `dsh.dev.exclude`。
 *
 * profile 根按这个顺序找：启动器给的 `DSH_DESKTOP_DEV_PROFILE_DIR`（桌面形态）；`DSH_HOME` 的父目录
 * （它总是 `<profile>/.dsh-store`，web 形态也有）；当前目录。
 *
 * @returns 匹配"非开发模块"的正则表；没配就是空的。
 */
export async function devExcluded(): Promise<RegExp[]> {
  const home = process.env["DSH_HOME"];
  const candidates = [
    process.env["DSH_DESKTOP_DEV_PROFILE_DIR"],
    home === undefined ? undefined : dirname(home),
    process.cwd(),
  ].filter((value): value is string => value !== undefined && value !== "");
  for (const profileRoot of candidates) {
    try {
      const manifest = JSON.parse(await readFile(join(profileRoot, "package.json"), "utf8")) as {
        dsh?: { dev?: { exclude?: string[] } };
      };
      const patterns = (manifest.dsh?.dev?.exclude ?? []).map(globToRegExp);
      if (patterns.length > 0) return patterns;
    } catch {
      // 换下一个候选。
    }
  }
  return [];
}

/**
 * profile 根：启动器给的 `DSH_DESKTOP_DEV_PROFILE_DIR`、或 `DSH_HOME` 的父目录、或当前目录。
 *
 * @returns 第一个存在的候选目录。
 */
export async function profileRootOf(): Promise<string> {
  const home = process.env["DSH_HOME"];
  const candidates = [
    process.env["DSH_DESKTOP_DEV_PROFILE_DIR"],
    home === undefined ? undefined : dirname(home),
    process.cwd(),
  ].filter((value): value is string => value !== undefined && value !== "");
  for (const candidate of candidates) {
    if (await readFile(join(candidate, "package.json"), "utf8").then(() => true, () => false)) {
      return candidate;
    }
  }
  return process.cwd();
}

/**
 * 该包是否走**聚合**（即"非开发模块"）。
 *
 * @param name - 包名。
 * @param patterns - {@link devExcluded} 的结果。
 * @returns 命中任一 glob 即为真。
 */
export function isAggregated(name: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(name));
}
