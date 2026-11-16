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

/** 形态：**只有打包与否这一个事实**（枚举要两个以上取值才需要，这里只有一个）。 */
export interface DevProviderMode {
  /** 打包形态：`dev.include` 清空（全部预编译）；否则 `@morlay/*` 当文件走 vite。 */
  readonly packaged?: boolean;
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
    ),
    ...provideServerHmr(),
  ];
}
