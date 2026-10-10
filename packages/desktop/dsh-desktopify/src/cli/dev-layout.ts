// dev 形态的两格锚点。**profile root 就是 app 目录本身**，安装根是工作区自己那套 pnpm 布局的
// 扁平 store：官方闭包、前端产物（`@deepseek-ai/dsh-web-frontend/dist`）与 host 载荷都在那里，
// 因此不需要再把它镜像 / 复制成一份临时安装（两种 dev 形态共用这两格，见
// `../../.agents/designs/20261010-app目录即profile-root.md`）。

import { access } from "node:fs/promises";
import { join } from "node:path";
import { DESKTOP_HOST_PACKAGE } from "@morlay/dsh-desktop-shell/official";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** dev 安装根：`<workspaceRoot>/node_modules/.pnpm`（它的 `node_modules/` 是扁平 store）。 */
export function devRuntimeRoot(workspaceRoot: string): string {
  return join(workspaceRoot, "node_modules", ".pnpm");
}

/** 解析锚点：`<runtimeDir>/node_modules/@deepseek-ai/dsh/package.json`（与宿主 app-boot 同形）。 */
export function devInstallAnchor(runtimeDir: string): string {
  return join(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "package.json");
}

/** 宿主载荷入口：`<runtimeDir>/node_modules/@morlay/dsh-desktop-host/lib/index.js`。 */
export function devHostEntry(runtimeDir: string): string {
  return join(runtimeDir, "node_modules", ...DESKTOP_HOST_PACKAGE.split("/"), "lib", "index.js");
}

/**
 * 校验 dev 安装根可用：锚点（官方闭包与 dsh）与 host 载荷入口都得在。失败信息带上具体路径，
 * 锚点这类问题一眼能看出是「装没装 / 构建没构建」。
 * @param runtimeDir - {@link devRuntimeRoot} 给出的安装根。
 * @throws 锚点或 host 载荷缺失时。
 */
export async function requireDevRuntime(runtimeDir: string): Promise<void> {
  const anchor = devInstallAnchor(runtimeDir);
  if (!(await pathExists(anchor))) {
    throw new Error(
      `desktop development: the workspace installation is missing at ${anchor}; ` +
        "run pnpm install (the dev runtime is the workspace pnpm store)",
    );
  }
  const hostEntry = devHostEntry(runtimeDir);
  if (!(await pathExists(hostEntry))) {
    throw new Error(
      `desktop development: bundled ${DESKTOP_HOST_PACKAGE} is missing at ${hostEntry}; ` +
        "run the tool build (pnpm build)",
    );
  }
}
