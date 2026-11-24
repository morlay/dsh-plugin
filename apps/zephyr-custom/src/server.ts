// 服务端入口：**只交出清单**，不自己 bootstrap。
//
// 生命周期（装配、重载、端口、退出码）归 `zephyr`：入口从具名 `providers`（或 `(mode) => 清单` 的函数）
// 取清单（CLI 的读出点：`module.providers ?? module.default`，见 `zephyr-cli` 的 `server-entry.ts`），
// 这样 dev / build / preview 三条路用的是同一份清单，差别只在 `CliMode` 里的部署值。
//
// `CliModeValues` 是**类型**导入：产物里的 `src/server.ts` 是源码面，闭包里的 loader 会剥掉类型，
// 运行期不需要 `@morlay/zephyr-cli` 在场（它只在仓库里、由 devDependencies 给 tsc 看）。
import type { CliModeValues } from "@morlay/zephyr-cli";
import { customProvidersOf } from "./zephyr.provide.ts";

/**
 * 本工作区的清单。
 * @param mode - 本次运行的部署参数（路径全部从它来，不再读全局 env）。
 * @returns provider 清单。
 */
export function providers(mode: CliModeValues) {
  return [
    ...customProvidersOf({
      profileDir: mode.profileDir,
      dataDir: mode.dataDir,
      defaultWorkingDirectory: mode.defaultWorkingDirectory ?? mode.profileDir,
    }),
  ];
}
