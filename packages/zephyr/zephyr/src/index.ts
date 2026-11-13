// zephyr 的公开接口：契约与令牌、注入、装配清单、应用入口。
export type {
  Awaitable,
  Context,
  Lifecycle,
  Newable,
  OnDispose,
  OnInit,
  TokenClass,
} from "./injection.ts";
export {
  Injectable,
  InjectionToken,
  inject,
  type InjectableOptions,
  type InjectPlaceholder,
  // `inject()` 的返回类型是 `T & Required<T>`；`Required` 是那份 phantom 品牌。生成 `.d.ts` 时要把
  // 它写成具名引用，所以它必须在公开面上（否则 `tsc` 报「inferred type cannot be named」）。
  type Required,
  // **令牌表的内部符号**：`compat` 面要用同一张表（它若是自己打包一份 `token.ts`，就有两张表——
  // `fromCordis` 注册的令牌与 `inject` 查的令牌对不上，直接表现是「没有提供者」）。这些不是
  // 设计给用户的新出口，只是让两个入口共用同一份模块级状态。
  hasTokenMeta,
  injectPlaceholderOf,
  kAdapted,
  kFace,
  kMounted,
  kProvider,
  providerOfPlugin,
  rowNameOf,
  tokenMetaOf,
} from "./token.ts";
export {
  configure,
  provide,
  without,
  type ClassProvider,
  type FactoryProvider,
  type ProviderEntry,
  type ProviderFeature,
  type ProviderList,
  type ValueProvider,
} from "./provider.ts";
export { bootstrapApplication, mountRow, type App, type BootstrapOptions } from "./bootstrap.ts";
export { Debugger, DebuggerDefault, type DebugSnapshot } from "./debugger.ts";
export { Logger } from "./logger.ts";
export { EventEmitter, type EventOptions, type Next } from "./event-emitter.ts";
