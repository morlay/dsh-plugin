// zephyr 的公开接口：契约与令牌、注入、装配清单、应用入口。
export type { Awaitable, Context, Lifecycle, Newable, OnDispose, OnInit, TokenClass } from "./injection.ts";
export {
  Injectable,
  InjectionToken,
  inject,
  type InjectableOptions,
  type InjectPlaceholder,
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
export { bootstrapApplication, type App, type BootstrapOptions } from "./bootstrap.ts";
export { Debugger, DebuggerDefault, type DebugSnapshot } from "./debugger.ts";
export { Logger } from "./logger.ts";
export { EventEmitter, type EventOptions, type Next } from "./event-emitter.ts";
