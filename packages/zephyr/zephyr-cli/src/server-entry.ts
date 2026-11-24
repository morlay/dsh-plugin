// 服务端入口：应用清单的**唯一**来源。
//
// 入口交出两种东西之一，名字是具名 `providers`（`export default` 仍然接住，见下面的读出点）：
//   - 一份清单：`export const providers = [...provideXxx()]`；
//   - 一个函数 `(mode) => 清单`：需要部署值（数据目录、工作区、端口）时用它——清单在装配前就要
//     把这些值算进去，而注入是装配之后的事。这与 vite 的 `defineConfig(({ mode }) => …)` 同构。
//
// 为什么要具名：`import/no-default-export` 在本仓是 error（默认导出只给「工具按 `module.default` 取」
// 的配置文件豁免），应用入口是**我们自己的模块**，所以走具名；默认导出留着是为了兼容旧工作区。
import { pathToFileURL } from "node:url";
import type { ProviderList } from "@morlay/zephyr";
import { CliError } from "./errors.ts";
import type { CliModeValues } from "./mode.ts";

/** 入口默认导出的两种形态。 */
export type ServerProviders = ProviderList | ((mode: CliModeValues) => ProviderList);

/**
 * 读一个服务端入口，把它归一成清单。
 *
 * @param entry - 入口绝对路径（源码树里的 `src/server.ts`，或产物里复制过去的那一份）。
 * @param mode - 本次运行的部署参数（函数形态的入参）。
 * @param version - 缓存失效用的版本号；重载时必须换，否则 import 拿回同一个模块。
 * @returns 提供清单。
 * @throws CliError 入口没有导出清单，或导出的东西不是清单。
 */
export async function loadServerProviders(
  entry: string,
  mode: CliModeValues,
  version = 0,
): Promise<ProviderList> {
  const url = `${pathToFileURL(entry).href}?v=${String(version)}`;
  const module = (await import(url)) as { default?: unknown; providers?: unknown };
  const exported = module.providers ?? module.default;
  const providers =
    typeof exported === "function"
      ? (exported as (m: CliModeValues) => ProviderList)(mode)
      : exported;
  if (!Array.isArray(providers)) {
    throw new CliError(
      `${entry} 没有导出 provider 清单：默认导出（或具名 providers）应当是 [...provideXxx()]，或一个 (mode) => 清单 的函数。`,
    );
  }
  return providers;
}
