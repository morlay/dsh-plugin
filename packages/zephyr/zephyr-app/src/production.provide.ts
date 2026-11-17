// 生产态的装配行：`bootstrap.mjs` 调它（设计 §八 的那一份）。
//
// 它装的是**生产态才成立**的那一条链——静态目录投递（`StaticClientAssets`）与页面兜底（`ServeStatic`）。
//
// **`AppEnv` 不在这里**：它是装配面的部署参数，应用清单本来就要用它（各域 `configure` 里带 `dataDir`），
// 两处都装会撞 `service "app-env" has been registered`。所以 `bootstrap.mjs` 把部署值并进 `mode`
// 交给 `providers(mode)`（那份清单自己把它灌进 `AppEnv`）——部署值仍然只有 `bootstrap.mjs` 一个来源。
//
// **不引开发运行时那个包**（依赖方向是「命令行 → 开发运行时 → 运行时」的单向，而且产物里不该有构建器）：
// 这里认的地址空间只有静态目录那一条，不认识 vite、不认识 `/@fs`、不认识联邦的按请求构建。
import { configure, provide, type ProviderList } from "@morlay/zephyr";
import { StaticClientAssets } from "./client-assets/static-client-assets.service.ts";
import { ServeStatic } from "./web/serve-static.service.ts";

/** 生产态装配的输入。 */
export interface ProductionOptions {
  /** 静态前端目录（`<outputDir>/client_modules`）。 */
  readonly clientModulesDir?: string;
}

/**
 * 生产态的行清单。
 *
 * 顺序：`ClientAssets` 的实现排在消费它的页面兜底之前（同批装配时按依赖序，这里只是同层基准）。
 * @param options - 静态目录的位置。
 * @returns provider 清单。
 */
export function productionProviders(options: ProductionOptions = {}): ProviderList {
  return staticRows(
    configure(
      StaticClientAssets,
      options.clientModulesDir === undefined ? {} : { dir: options.clientModulesDir },
    ),
  );
}

/** 行清单（**不带部署值**）：目录经 `configure` 叠上去。 */
const staticRows = provide([StaticClientAssets, ServeStatic]);
