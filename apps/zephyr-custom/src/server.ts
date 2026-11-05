// 服务端入口：**只交出清单**，不自己 bootstrap。
//
// 生命周期（装配、重载、端口、退出码）归 `zephyr`：入口是导出（或 `(mode) => 清单` 的函数），
// 这样 dev / build / preview 三条路用的是同一份清单，差别只在 `CliMode` 里的部署值。
import type { CliModeValues } from "@morlay/zephyr-cli";
import { CustomDevLifecycle } from "./dev-lifecycle.ts";
import { customProvidersOf } from "./zephyr.provide.ts";

/**
 * 本工作区的清单。
 * @param mode - 本次运行的部署参数（数据目录从它来，不再读全局 env）。
 * @returns provider 清单。
 */
export default function serverProviders(mode: CliModeValues) {
  return [
    ...customProvidersOf({
      workspace: mode.workspace,
      dataDir: mode.dataDir,
    }),
    CustomDevLifecycle,
  ];
}
