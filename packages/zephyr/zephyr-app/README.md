# @morlay/zephyr-app

宿主侧的装配面：http/web-server、connection、client 行清单与**按需联邦产物**（`/@client-modules/<pkg>@<ver>/<export>`）、页面骨架（`app-boot`），以及浏览器半的官方 client 链。

- 契约 + `XxxDefault`：宿主面见 `src/{web,connection,rows,federation,http}/`，浏览器链见 `src/client/<domain>/`；宿主装配入口是 `src/client-modules.module.ts`，浏览器入口是 `src/app-boot/index.ts`（`ClientChainModule`）。
- 行清单由装配方经 `ClientRows` 契约给（`clientPackagesOf` 从入口的 provider 清单推导）。
- 路径全部来自 `AppEnv` 契约（`dataDir` / `profileDir` / `dev` / `aggregate` / `remotes`），不读环境变量、不向上找目录。
- 客户端产物按请求预编译、落盘缓存，详见 [.agents/designs/20261013-客户端资源的联邦式预编译.md](./.agents/designs/20261013-客户端资源的联邦式预编译.md)。
- 已知债：[.agents/debts/20261013-vite与宿主同进程.md](./.agents/debts/20261013-vite与宿主同进程.md)。

## 观测点

长期观测（不是调试探针），都走 `ctx.logger.info`：

- `WebServerDefault` 在上游实例的 `register` / `registerUpgrade` / `registerFallback` 上包一层，每条注册打印 `[routes] <kind> <path>`（`fallback` 只有名字）；上游内部自注册（`api-gateway` 的 `/api` upgrade）同样被记录。
- `ConnectionDefault` 在 `rpc.intercept` 上包一层，打印 `[rpc] <channel>`。

## HMR

`ViteHandoff` 契约的 `hmrUpgrade(req, socket, head)` 交给 vite 的 ws（vite 8 的 `server.ws` 运行时是 `ws.WebSocketServer`，类型层用最小断言）。`ClientModulesDefault.install()` 在 `HMR_PATH`（`/__dsh_hmr`）上注册 upgrade 路由，卸载时撤销。

## 渲染链（client 半）

`src/client/` 按官方 client 行装配，顺序（提供方在前）：`Connection → Typert → Remote → ConfigForms → Slots → Locale → Shortcuts → Theme → UiRenderer → Layout`。

- 四个跨行上游名有了契约：`Slots`（`slots`）、`Theme`（`theme`）、`Locale`（`locale`）、`Shortcuts`（`shortcuts`）；`UiRenderer` 是渲染挂载面。
- `Slots` 行是**唯一**挂载 `@deepseek-ai/dsh-client-ui-renderer/client` 的行（`slots` 与 `uiRenderer` 是同一插件的两个名字）；`UiRendererDefault` 转发它的 `mount`。
- 上游插件按名字读的服务都要有同名契约：`ConfigForms`（`configForms`）、`Remote`（`remote`）、`Connection`（`connection`）、`Typert`（`typert`）。
- `ConfigFormsDefault` 是**最小实现**（表单不可用、写入一律被拒）：官方 settings 行要 `remote.settings`，那是 gateway `$mount` 装进 Remote 行行内的 namespace 服务，按当前行隔离模型跨行不可达。
- 本轮链不含 `ui-session`（它要 `remote.session` 等 namespace），layout 渲染 `session-maybe` scope 需要 scope adapter 与 `useSessions`/`useSessionStatus` seat；`render.smoke.spec.ts` 用空会话替身覆盖这段。

## 验证

- `pnpm exec vitest run packages/zephyr/zephyr-app`（含 `render.smoke.spec.ts`：happy-dom 里装官方链 → layout 注册 `root` → mount 出 AppFrame；`routes-observability.spec.ts` / `rpc-observability.spec.ts` 用真 http server 断言路由、upgrade 与 `[rpc]`；`hmr-upgrade.spec.ts` 断言 HMR 转发）
- `pnpm exec vitest run packages/zephyr`
- `pnpm exec oxlint packages/zephyr`
