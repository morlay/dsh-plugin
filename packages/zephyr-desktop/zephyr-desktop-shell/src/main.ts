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

// 业务入口（动态：必须在 loader 之后）。源码里写 `.ts`，产物里 tsdown 会改写成 `app.mjs`。
await import("./app.ts").catch(async (error: unknown) => {
  await reportFailure("加载入口", error);
  throw error;
});
