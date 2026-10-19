// 测试专用出口（`@morlay/zephyr-app/testing`）：只给**测试**用，不进主出口。
//
// 这里包含实现（`*Default`）与内部工具——测试要能直接搭装配、看内部机制。
// 生产代码**不许**从这里取：那是 `@morlay/zephyr-app`（契约 + 装配函数）或 `@morlay/zephyr-app/client`。
//
// **显式清单**（不用 `export *`）：多个域 index 有同名符号，`export *` 互相遮蔽后
// 有的名字在装配期变成 `undefined`。清单 = 测试实际用到的那些（`grep` 生成，不手写猜测）。
export { ApiGatewayDefault } from "../api-gateway/api-gateway.service.ts";
export { provideApiGateway } from "../api-gateway/provide.ts";
export { provideMuxServer } from "../api-gateway/provide.ts";
export { AppEnv, type AppEnvValues } from "../app-env/app-env.contract.ts";
export { ClientRows } from "../rows/rows.contract.ts";
export { Federation } from "../federation/federation.contract.ts";
export { FederationDefault } from "../federation/federation.service.ts";
export { AppEnvDefault } from "../app-env/app-env.service.ts";
export { provideConnection } from "../connection/provide.ts";
export { provideRemoteAccess } from "../remote-access/provide.ts";
export { provideTypert } from "../typert/provide.ts";
export { provideWeb } from "../web/provide.ts";
export { WebServer } from "../web/web-server.contract.ts";
export { WebServerDefault } from "../web/web-server.service.ts";
export { WebStartup } from "../web/web-startup.contract.ts";
export { WebStartupDefault } from "../web/web-startup.service.ts";
export { BUNDLER_REV, bundlePackage, clientModulesAlias, urlOf } from "../federation/bundle.ts";
export { parseFederationUrl } from "../federation/parse-url.ts";
export { watchOf } from "../federation/watch.ts";
export { exportTargetOf, fileInPackage, packageRootOf } from "../internal/resolve.ts";
export { FEDERATION_PREFIX, HMR_PATH, addZephyrPrefix, attachUrlRewriting, rewriteUrls, stripZephyrPrefix } from "../internal/hmr-path.ts";
export { globToRegExp, isAggregated } from "../rows/aggregate.ts";
export { LocalRemote } from "./local-remote.ts";
export { provideLocalRemote } from "./provide.ts";
export { CredentialsInMemory } from "./credentials-in-memory.ts";
