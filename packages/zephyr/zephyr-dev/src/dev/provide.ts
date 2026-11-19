// 开发形态的行：**应用清单只需要这一行**（装配面不再手写 `configure(FederationDefault, …)`）。
//
// 内容是「把 dev 那几行收成一个函数」：`provideClientModules(...)`（vite handoff + 联邦 + 页面兜底 + 路由安装）
// 加 `provideServerHmr()`（换树时机）。判据只有一条 `packaged`——
//   - 打包形态（桌面壳的随包产物）：名单清空 = **全部预编译**；
//   - 其余形态：`@morlay/*` 当文件走 vite（改它们靠 HMR）。
//
// **不要在这里加第二、第三个形态开关**：`packaged` 是过渡脚手架（T5 之后打包形态走静态前端，
// 那时本函数连同这个参数一起删掉）。
import { configure, type ProviderList } from "@morlay/zephyr";
import { provideClientModules } from "../client-modules/provide.ts";
import { FederationDefault } from "../federation/federation.service.ts";
import { provideServerHmr } from "../dev-hmr/provide.ts";
import { ViteHandoffDefault } from "../vite-handoff/vite-handoff.service.ts";

/** dev 行的开关：形态（打包与否）与两半 HMR。 */
export interface DevProviderMode {
  /** 打包形态：`dev.include` 清空（全部预编译）；否则 `@morlay/*` 当文件走 vite。 */
  readonly packaged?: boolean;
  /**
   * HMR 的两半开关（缺省都开）：客户端（vite 热更）与服务端（等空闲后换树）。
   *
   * 取值由装配面合成（CLI 的 `ResolvedConfig.hmr`：配置 ⊕ 环境变量），这里只按结果装行。
   */
  readonly hmr?: {
    readonly client?: boolean;
    readonly server?: boolean;
  };
}

/**
 * dev 行清单。
 * @param mode - 形态（缺省非打包）。
 * @returns provider 清单。
 */
export function devProviders(mode: DevProviderMode = {}): ProviderList {
  return [
    ...provideClientModules(
      configure(FederationDefault, {
        dev: { include: mode.packaged === true ? [] : ["@morlay/*"] },
      }),
      // 客户端 HMR 关掉：vite 不建 ws、页面不注入客户端（页面仍由 vite 出，只是不再自己热更）。
      ...(mode.hmr?.client === false ? [configure(ViteHandoffDefault, { hmr: false })] : []),
    ),
    // 服务端 HMR 关掉：**不装换树行**（`DevHmr` 没人提供，CLI 的 `tryGet` 自然就是空）。
    ...(mode.hmr?.server === false ? [] : provideServerHmr()),
  ];
}
