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
 * @returns 匹配"非开发模块"的正则表；**没配就是全部**（见函数末尾的说明）。
 */
/**
 * 桌面形态（含 bundle）：**全部按非开发模块**处理。
 *
 * 它的页面跑在自定义协议下（`dsh-…://app/`），请求经壳的字节管道进来——每个逐文件请求都要走一趟这条路，
 * 几百个源码模块叠起来就是"刷新一次卡几十秒"。桌面形态本来也不需要"改哪个包只看哪个包"的细粒度取舍：
 * 全部按包预编译，改包时那一份重建 + 通知页面刷新（见壳的 ws 端点）。
 */
/**
 * 是不是**开发形态**（`dshdev web` / `dshdev desktop`；打包产物不是）。
 *
 * `DSH_DEV_FORM` 由 `dshdev` 注入给宿主（壳起宿主时会过滤掉 `DSH_DESKTOP_*`，那些是 Electron 侧的元数据；
 * web 形态没有壳，所以这条由 CLI 直接给）——值只说哪种形态，**有没有值**才是判据。这一判据**一个 home**：
 * 预编译策略（本文件）与"这条链的根在哪"（`src/index.ts` 的 `repoRootOf`）都用它。
 *
 * @returns dev 形态为 true；bundle（打包产物）为 false。
 */
export function isDevForm(): boolean {
  return process.env["DSH_DEV_FORM"] !== undefined;
}

export async function devExcluded(): Promise<RegExp[]> {
  if (isDevForm()) return [/.*/u];
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
  // **读不到配置就是"不打算改任何包"**：全部走按包预编译（桌面/bundle 形态没有 dev 配置，源码逐文件
  // 那条路对它们没有意义）。这正是两种形态"完美复用同一条链"的地方。
  return [/.*/u];
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
