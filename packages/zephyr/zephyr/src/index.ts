// root 出口：只导出**消费方要用**的装配 API。
//
// 三块，别的一概不出：
//   1. 令牌与注入（`inject` / `Injectable` / `InjectionToken` / 生命周期类型）
//   2. 装配声明（`ProviderEntry` / `ProviderList` / `configure` / `without` / `provide` / `contribute`）
//   3. 装配入口（`bootstrapApplication` / `App`）
//
// 适配层（`fromCordis` / `toCordis` / `jsExpr`）在 `@morlay/zephyr/compat`。
// 装配运行时里只出四个"外部确实要用"的（`resolveService*` / `serviceNamesOf` / `attachProviders`）：
// 业务包按名解析（`dsh-session` 的 ui 行）与装配层测试（federation）要用；其余内部机制不出。
export type {
  Awaitable,
  Context,
  Lifecycle,
  LoggerService,
  Newable,
  OnDispose,
  OnInit,
  Token,
} from "./injection.ts";
export {
  Injectable,
  InjectionToken,
  inject,
  type Inject,
  type InjectionTokenOptions,
} from "./token.ts";
export { APIGroup, EventEmitter, input, output, type EventConsumer, type EventProducer } from "./api-group.ts";
export {
  configure,
  contribute,
  provide,
  without,
  type ConfigProvider,
  type ConfiguredProviderClass,
  type DeepPartial,
  type FactoryProvider,
  type MultiProvider,
  type ProviderConfig,
  type ProviderEntry,
  type ProviderFeature,
  type ProviderList,
  type RawPluginEntry,
  type WithoutRef,
} from "./provider.ts";
export {
  resolveService,
  resolveServiceByTokenName,
  resolveServiceName,
  serviceNamesOf,
} from "./service-resolver.ts";
export { attachProviders } from "./attach.ts";
export { dedupeProviders } from "./provider-list.ts";
export { bootstrapApplication, type App, type BootstrapOptions } from "./bootstrap.ts";
export { Logger } from "./logger.ts";
// 转发事件的应答三态（waterfall 频道的上行帧）：wire 的家在这里，消费者不各写一份。
export type { RemoteEventReply } from "./remote-event-reply.ts";
