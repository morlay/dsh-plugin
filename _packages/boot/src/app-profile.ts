// 按 **profile root** 装配一次应用：读清单 → 解析各 bundle 层 → 起树。
//
// desktop 与 web 两个入口都从这里走（[`@morlay/dsh-desktop-host`](../../../desktop/dsh-desktop-host/README.md)），
// 两形态的差别只有 profile 名、形态自己的 overlay 与内层参数——同一份实现才不会出现"dev 对、打包不对"。

import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  loadLayeredEnv,
  loadProfileDirectory,
  reportSkippedBundles,
} from "@deepseek-ai/dsh-app-boot";
import type { ProfileContext } from "@deepseek-ai/dsh-app-boot";
import { runProfile } from "./profile-boot.ts";

/** 一次启动之后的根上下文与它的关停控制器。 */
export type AppProfileBoot = Awaited<ReturnType<typeof runProfile>>;

/**
 * 闭包根（解析锚点）：bundle 与它们的依赖都由它解析。
 *
 * 打包形态下，闭包与清单一起**打进 app**（`<Resources>/profile`）：宿主跑的是 Electron 的 node，
 * asar 补丁按 `*.asar/` 前缀生效，于是解析全在归档内——profile 那边**不需要**再落一份依赖。
 * dev 与 `--prod` 用 profile 自己那份（工作区 / deploy 目录）。
 * @param profileDir - profile root。
 * @returns 锚点清单的绝对路径。
 */
export async function installAnchorOf(profileDir: string): Promise<string> {
  const packaged =
    process.resourcesPath === undefined
      ? undefined
      : join(process.resourcesPath, "profile", "package.json");
  if (packaged !== undefined && (await pathExists(packaged))) return packaged;
  return join(profileDir, "package.json");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 一次应用 profile 启动的输入。 */
export interface AppProfileOptions {
  /** profile root：dev 是 app 目录本身，打包是 `$DSH_HOME/profiles/<name>`。 */
  readonly profileDir: string;
  /** 形态名（`desktop` / `web`）：给按 profile 名门控的行用。 */
  readonly profile: string;
  /** 形态自己的 overlay patch 文件，排在 bundle 层与 profile 自己的 patch 之后。 */
  readonly patchFiles?: readonly string[];
  /** 交给树的内层参数（app 插件自己的 flag family）。 */
  readonly args?: readonly string[];
  /** 应用自己的包操作通道；缺省时插件页回退到进程 PATH。 */
  readonly packageManager?: ProfileContext["packageManager"];
}

/**
 * 按 profile root 装配并启动一次。
 * @param options - profile root、形态名、overlay 与内层参数。
 * @returns 落定的根上下文与关停控制器。
 * @throws 清单、bundle 自身的 patch、或 overlay 读不出来时（跳过的 bundle 只上报，不抛）。
 */
export async function bootAppProfile(options: AppProfileOptions): Promise<AppProfileBoot> {
  const installAnchor = await installAnchorOf(options.profileDir);
  const profile = loadProfileDirectory("dsh", options.profileDir, installAnchor);
  // 加载跳过原因由启动方上报（与上游同一口径）：跳过就是少服务，必须看得见。
  reportSkippedBundles("dsh", profile);
  // 宿主侧**实际解析到的层**：出"bundle 态少东西"这类问题时，这是第一个要看的现场
  // （前端那份行清单只是 client 半，跟它不一定同源）。
  process.stderr.write(
    `[dsh] profile layers (${String(profile.layers.length)}): ${profile.layers
      .map((layer) => layer.packageName)
      .join(" ")}\n`,
  );
  const boot = await runProfile({
    environment: loadLayeredEnv("dsh"),
    profile: options.profile,
    resolvedProfile: { profile, installAnchor },
    patchFiles: [...(options.patchFiles ?? [])],
    args: options.args ?? [],
    ...(options.packageManager === undefined ? {} : { packageManager: options.packageManager }),
  });
  // **全部行（插件）的激活状态**：层只有 9 个 bundle，真正干活的是每层里的行。`未激活` 的那些就是
  // "界面里少东西"的来源，所以连状态一起打——比"没有报错"这种间接判断可靠。
  const rows = [...boot.ctx.loader.entries()].map((entry) => {
    const id = String(entry.options.id ?? entry.options.name ?? "(无 id)");
    return entry.fiber === undefined ? `${id}(未激活)` : id;
  });
  const inactive = rows.filter((row) => row.endsWith("(未激活)")).length;
  process.stderr.write(
    `[dsh] loader entries (${String(rows.length)} 行，未激活 ${String(inactive)}): ${rows.join(" ")}\n`,
  );
  return boot;
}
