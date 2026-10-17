// 没有源码入口的数据包的**清单写回**：`dsh.bundle` 的纯数据包（只有 patch / locale / icon）没有可打包的
// 入口，进不了 tsdown 的 `build:done`，所以它的 `build` 脚本就是这条命令——出口与 dsh 版本要求仍由构建
// 推导（同一份实现：`@local/tsdown-plugin-cordis` 的 `writePackageManifest`），不手写。
import { resolve } from "node:path";
import { writePackageManifest } from "@local/tsdown-plugin-cordis";

/**
 * 写回某个包的清单。
 *
 * @param cwd - 包目录；缺省当前目录。
 */
export async function runManifest(cwd?: string): Promise<void> {
  const directory = resolve(cwd ?? process.cwd());
  await writePackageManifest(directory);
  process.stdout.write(`[manifest] 写回 ${directory}\n`);
}
