// **dev 形态**的装配入口：profile root 就是 app 目录本身，装配清单来自 app 自己的
// `package.json`（`dsh.profile.bundles`），解析锚点是安装根的 dsh。
//
// dev 的 web 形态需要它：上游 `dsh web` 按 profile 名到 `$DSH_HOME/profiles/<name>` 找 profile，
// 与「profile root 就是 app 目录」冲突。桌面形态不需要另起入口——它把 app 目录当 profile root
// 交给宿主，宿主按官方那两步装配（见 `./index.ts`）。
//
// 这一层为什么薄：装配在「app 目录即 profile root」之后是**数据**——清单、bundle 各自的 patch、
// profile 自己的 `cordis.patch.yml`、以及形态自己的 overlay；代码只剩「读哪个目录、挂哪些
// overlay、谁写根配置」。loader 的装载机制仍复用上游（`loadProfileDirectory` + `runProfile`），
// 不另起第二套启动路径（理由见 `../.agents/designs/20261010-app目录即profile-root.md`）。

import { join } from "node:path";
import {
  loadLayeredEnv,
  loadProfileDirectory,
  reportSkippedBundles,
} from "@deepseek-ai/dsh-app-boot";
import { runProfile } from "@deepseek-ai/dsh/profile-boot";
import type { RunProfileOptions } from "@deepseek-ai/dsh/profile-boot";

/** One booted app profile: the settled root context and its shutdown controller. */
export type AppProfileBoot = Awaited<ReturnType<typeof runProfile>>;

// 安装根的解析锚点：`<runtimeDir>/node_modules/@deepseek-ai/dsh/package.json`。官方 bundles 与 dsh
// 都从这个安装解析（profile 自己那份 node_modules 只解析 app 的 bundle）；宿主入口用同一形状。
function installAnchorOf(runtimeDir: string): string {
  return join(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "package.json");
}

/** Inputs for one app profile boot. */
export interface AppProfileOptions {
  /** profile root：app 目录本身，或它的部署副本。 */
  readonly profileDir: string;
  /** 安装根；锚点见 {@link installAnchorOf}。 */
  readonly runtimeDir: string;
  /** 形态名（`desktop` / `web`）：给 `profileContext.name` 与按 profile 名门控的行。 */
  readonly profile: string;
  /** 形态自己的 overlay patch 文件，按 argv 顺序排在 bundle 层与 profile 自己的 patch 之后。 */
  readonly patchFiles?: readonly string[];
  /** 交给树的内层参数，由注入的 app 插件自己解析（如 web 的 `--port`）。 */
  readonly args?: readonly string[];
  /** 应用自己的包操作通道；缺省时插件页的包操作回退到进程 PATH。 */
  readonly packageManager?: RunProfileOptions["packageManager"];
}

/**
 * 按 app 目录装配并启动一次 profile：bundle 层来自 app 的清单，patch 栈是
 * 「bundle 层 → app 目录自己的 `cordis.patch.yml` → `patchFiles`」；空根配置 `cordis.yml`
 * 写在 profile root 内（由 `runProfile` 每次启动重写）。
 * @param options - profile root、安装根、形态名、overlay 与内层参数。
 * @returns 装配完成的上下文与关停控制器。
 * @throws 清单、bundle 自身的 patch、或 overlay 读不出来时（跳过的 bundle 只上报，不抛）。
 */
export async function bootAppProfile(options: AppProfileOptions): Promise<AppProfileBoot> {
  const installAnchor = installAnchorOf(options.runtimeDir);
  const profile = loadProfileDirectory("dsh", options.profileDir, installAnchor);
  // 加载跳过原因由启动方上报（与上游 desktop-host 同一口径）。
  reportSkippedBundles("dsh", profile);
  return await runProfile({
    environment: loadLayeredEnv("dsh"),
    profile: options.profile,
    resolvedProfile: { profile, installAnchor },
    patchFiles: [...(options.patchFiles ?? [])],
    args: [...(options.args ?? [])],
    ...(options.packageManager === undefined ? {} : { packageManager: options.packageManager }),
  });
}
