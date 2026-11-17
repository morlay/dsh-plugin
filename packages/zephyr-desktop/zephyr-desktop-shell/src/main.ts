// 壳的**引导**（Electron 的 `main` 指到这里）：先把 TS 运行时挂上，再加载业务入口。
//
// 为什么必须是两层：壳的业务代码静态 import 了 `@morlay/zephyr`（→ cordis），而 cordis 的 `.ts` 里有
// 参数属性（`constructor(private ctx)`），Node/Electron 的 strip-only 解析**不支持**它。loader 必须在
// 任何 `.ts` 被加载**之前**挂上，所以不能写在业务模块里。
import { reportFailure } from "./failure.ts";

// 按**变量**动态 import：该包只有 `register.mjs`（没有类型声明），字面量形式会让 tsc 要一份 d.ts。
const loaderPackage: string = "@morlay/dsh-oxc-node";

await import(loaderPackage).catch(async (error: unknown) => {
  await reportFailure("引导（挂 TS 运行时）", error);
  throw error;
});

// 宿主的**子进程**（subprocess 的 runner、PTC 的 `node-script` worker）也要用它：上游那两处默认找
// `tsx/esm`，本仓库不装它（`vendor/patches/source-loader.patch` 已改成「没注入就抛」）。
// 记进环境而不是各调用点传：宿主动起来之后，它们派生的进程只继承 env——而且必须在**任何 `.ts` 之前**
// 就位，所以放在这里（壳的 `app.ts` 与宿主的装配都晚于这一行）。
process.env.DSH_SOURCE_LOADER ??= import.meta.resolve(loaderPackage);

// 桌面部署的第二个接缝：PTC 的子进程用 `process.execPath` 起（在 Electron 里那是**应用本体**），不带
// `ELECTRON_RUN_AS_NODE` 就会按应用启动——loader 参数与 `process.ts` 都被当成应用参数，落到 strip-only
// 解析。上游为防身份外泄会滤掉这个变量，所以只在显式开关下由补丁透传（见 `patches/source-loader.patch`）。
process.env.DSH_PTC_ELECTRON_RUN_AS_NODE ??= "1";

// 业务入口（动态：必须在 loader 之后）。源码里写 `.ts`，产物里 tsdown 会改写成 `app.mjs`。
await import("./app.ts").catch(async (error: unknown) => {
  await reportFailure("加载入口", error);
  throw error;
});
