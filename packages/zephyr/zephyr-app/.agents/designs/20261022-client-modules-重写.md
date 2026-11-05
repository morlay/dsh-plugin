# 宿主装配面与 client-modules

状态：已实现——宿主侧只有契约 + `XxxDefault` + 域装配函数；路由、页面兜底与 remote 装载由 `ClientModules` 收口。
范围：`packages/zephyr/zephyr-app/` 的宿主半（`src/{app-env,web,http,vite-handoff,client-modules,internal}/`）与它的入口形状（`.` / `./node` / `./client`）。
非目标：联邦产物的构建规则（[设计 客户端资源的联邦式预编译](./20261013-客户端资源的联邦式预编译.md)）、`/api` 前缀（[设计 connection 的 /api 前缀](./20261109-connection的api前缀.md)）、命令与四阶段（zephyr-cli）、浏览器半的渲染。
关联：[设计 客户端资源的联邦式预编译](./20261013-客户端资源的联邦式预编译.md)、[债务 vite dev server 与宿主同进程](./../debts/20261013-vite与宿主同进程.md)、[ADR-不fork上游前端组件只做插槽扩展](../../../../../.agents/adrs/20261001-不fork上游前端组件只做插槽扩展.md)。

## 一、决定

| #   | 议题     | 决定                                                                                                               | 一句话理由                                               |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 1   | 入口形状 | 主出口只出契约与 `provideXxx`；宿主清单实现走 `./node`；浏览器半走 `./client`                                      | 宿主进程加载包入口时不能带进 CSS / React                 |
| 2   | 路径     | 所有路径由 `AppEnv` 给（`dataDir` / `profileDir` / `cacheDir` / `packageRoot` / `appBootDir` / `profileManifest`） | 部署参数只有装配面知道值，业务不读环境变量、不向上找目录 |
| 3   | 路由     | 一种注册面三种形状：`register`（prefix / exact）、`registerFallback`、`registerUpgrade`；`routesOf()` 可读         | 路由表是「谁接管了哪个前缀」的唯一事实                   |
| 4   | 装配收口 | `ClientModules.install()` 一次注册 prefix → 联邦、fallback → 页面、upgrade → HMR，返回逆序撤销函数                 | 三条路由的顺序有语义（先具体、后兜底）                   |
| 5   | remote   | remote 由**提供者登记**的多值令牌 `RemoteDescriptor` 装载，装配面不写清单                                          | 能力包自己声明要用哪些 remote                            |
| 6   | dev 重载 | 整棵行树重载，且只在空闲时；HMR 属于应用、护栏属于 CLI                                                             | 换掉一个模块会让旧行继续握着旧实例                       |
| 7   | 诊断     | 路由表在装配收尾打印一次                                                                                           | 只有那时才知道路由是否都注册完了                         |

## 二、现状事实

- **入口**：`packages/zephyr/zephyr-app/src/index.ts`（契约与 `provideXxx`）、`src/node.ts`（`./node`，宿主清单实现）、`src/client/index.ts`（`./client`）。`package.json` 的 `exports` 还有 `./testing`、`./build`、`./remote`、`./client/remote` 等面。
- **AppEnv**：`src/app-env/app-env.contract.ts` 定义形状，`app-env.service.ts` 的 `AppEnvDefault` 给缺省值（`dataDir = <cwd>/.dsh-store`、`cacheDir = <dataDir>/cache`、`packageRoot` / `appBootDir` / `profileManifest` 从包位置与 `profileDir` 推）。
- **WebServer**：`src/web/web-server.contract.ts`。`register` / `registerUpgrade` 返回撤销函数；`routesOf()` 是方法（abstract 属性在运行时没有原型痕迹，面代理取不到）。
- **ClientModules**：`src/client-modules/client-modules.service.ts` 的 `install` 注册 `FEDERATION_PREFIX` → `Federation.serve`、`registerFallback` → `WebServe.handle`、`HMR_PATH` 的空 upgrade（真正的握手由 vite 在同一个 http server 上的监听器完成），然后打印 `routesOf()`；`onInit` 在 `RemoteDescriptor` 与 `Remote` 都在时调 `mountRemotes`。
- **页面**：`src/http/serve.service.ts`（`/` 与 `/index.html` 走 `appBootDir` 的骨架、`/@fs` 下的 `node_modules` 请求 302 到联邦地址、其余交 `ViteHandoff`）；页面响应头 `cache-control: no-cache`。
- **dev 重载**：`src/internal/server-hmr.ts` 的 `ServerHmr`（等空闲：`MuxServer.inFlight()` 加调用方的 `isIdle`；变化合并成一次重载；`pollMs` 缺省 200、`maxWaitMs` 缺省 60s）。装配面把它接到 CLI 的 `DevLifecycle.install({ restart })`（例：`apps/zephyr-custom/src/dev-lifecycle.ts`）。
- **vite 交接**：`src/vite-handoff/vite-handoff.service.ts` 起 middleware 模式的 dev server，`transformHtml` 注入入口 script，`onServerSourceChange` 只报服务端那半。

## 三、模块边界与接口

| 模块                                            | 拥有（职责与不变量）                                             | 不拥有（明确排除）                                                | 依赖方向                  | 接缝 / 适配器                                                |
| ----------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------ |
| `AppEnv`（`src/app-env/`）                      | 部署参数与派生路径的唯一来源                                     | 端口与数据目录的**取值策略**（CLI 的 `CliMode` 给）；宿主外部环境 | 无                        | 契约 + `AppEnvDefault`；测试用 `src/testing/fake-app-env.ts` |
| `WebServer`（`src/web/web-server.contract.ts`） | http 宿主的启停、路由注册与快照                                  | 各前缀的语义（谁注册谁负责）                                      | ← node http               | 契约 + 实现；`@hono/node-server` 只提供 `HttpHost` 面        |
| `WebServe`（`src/http/`）                       | 页面骨架、`/@fs` 与 `node_modules` 请求的去向、兜底交 vite       | 前端页面路由；联邦构建                                            | ← `AppEnv`、`ViteHandoff` | 契约 `WebServe.handle`                                       |
| `ViteHandoff`（`src/vite-handoff/`）            | vite dev server 的启停、`serve`、`transformHtml`、服务端源码变更 | HMR 的传输实现（vite 自己）；行的重载动作                         | ← vite                    | 契约；无 vite 的形态给替身                                   |
| `Federation`（`src/federation/`）               | 联邦产物的构建与按 URL 服务                                      | 见[联邦设计](./20261013-客户端资源的联邦式预编译.md)              | ← `internal/`             | 契约 `serve` / `depsUrl`                                     |
| `ClientModules`（`src/client-modules/`）        | 路由注册顺序、remote 装载、收尾诊断                              | 各路由背后的实现；remote 的清单                                   | ← 上面五个契约            | 契约 `install()`                                             |
| `ServerHmr`（`src/internal/server-hmr.ts`）     | 变化合并、空闲判据（传输层 + 业务层）、重载一次                  | 重载怎么做（`DevLifecycle` 的 `restart`）                         | ← `MuxServer`             | 值 + `install(options)`                                      |

**接口**：`ClientModules.install(): Promise<() => Promise<void>>`（逆序撤销）；`WebServer.register` / `registerUpgrade` / `registerFallback` 各返回撤销函数；`ViteHandoff.serve` 返回「是否已应答」；`Federation.serve` 返回「是否接管」。
不变量：撤销顺序与注册顺序相反；页面只由 fallback 接管；`routesOf()` 在装配收尾才完整。

**深度**：删掉 `ClientModules`，每个装配面都要自己记「先注册哪个前缀、HMR 那条为什么必须注册、remote 什么时候装」——这几条顺序错了的表现都是白屏或 404。

## 四、行为与边界

- 正常：`install()` 注册三条路由 → 打印路由表 → 有 remote 就挂载。
- 错误：`WebServer` 对未注册路径直接 destroy socket（所以 HMR 那条即使 handler 为空也必须注册）；页面骨架读不到时记 warn 并回兜底。
- 取消：`onDispose` 逆序撤销（upgrade → fallback → prefix）。
- 生命周期：dev 形态下源码变化 → `ServerHmr` 合并 → 等空闲（超时也重载并 warn）→ `restart`（CLI 拆旧树 + 装配新树）。
- 并发：重载期间再来的变化攒进 `pending`，本次结束后续一轮。

## 五、验收判据

| #   | 判据（Done when）                                                      | 测试面（接缝）                                    | 证据（命令 / 用例名）                                                                                                           |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 路由注册即记录：prefix / fallback / upgrade 都出现在 `routesOf()`      | `WebServer`                                       | `src/__tests__/webserver.spec.ts`「注册即记录：prefix / fallback / upgrade 都出现在 routesOf()」                                |
| 2   | 页面与兜底：`/` 回骨架、`/@fs` 的 `node_modules` 请求 302、其余交 vite | `WebServe`                                        | `webserver.spec.ts` 里路由表与 fallback 那组用例                                                                                |
| 3   | `AppEnv` 的派生路径跟着覆盖走                                          | `AppEnvDefault`                                   | `src/__tests__/app-env-config.spec.ts`「`profileDir` / `dataDir` 覆盖进 `values`，三个派生路径跟着走」                          |
| 4   | 服务端源码变化触发的重载只在空闲时发生，且变化合并                     | `ServerHmr`                                       | `src/__tests__/server-hmr.spec.ts`                                                                                              |
| 5   | 服务端源码变更的订阅只报服务端那半                                     | `ViteHandoff.onServerSourceChange`                | `src/__tests__/server-source.spec.ts`、`src/__tests__/watch.spec.ts`                                                            |
| 6   | vite 插件与 URL 前缀的行为                                             | `internal/vite-plugin.ts`、`internal/hmr-path.ts` | `src/__tests__/vite-plugin.spec.ts`、`src/__tests__/url-prefix.spec.ts`                                                         |
| 7   | 整装清单起得来（页面骨架 + 路由 + 联邦面）                             | 人工门 / 组装验证                                 | `just custom build` + 清单评审（不靠 apps 的整装 spec），真浏览器按[how-to-e2e](../../../../../.agents/standards/how-to-e2e.md) |

命令：`pnpm exec vitest run packages/zephyr/zephyr-app`（从仓库根）。

## 六、取舍

- 不做 Module 容器 / `imports`：装配只有 provider 清单，依赖只有 `inject`。
- 不从包门面导出服务实现：`XxxDefault` 是装配内部的东西，测试走 `./testing`。
- 不让 `WebServer` 认识任何前缀语义：注册面只记形状，语义归注册方。
- 不在 dev 做模块级热替换：行之间靠实例互相引用，整树重载的语义更清楚。
- 不在 `AppEnv` 里读环境变量：部署值由 CLI 的 `CliMode` 给。

## 七、不做与已知债

- 不实现 `/api` 前缀的语义（归 `ConnectionDefault`，见[它的设计](./20261109-connection的api前缀.md)）。
- 不做浏览器半的渲染与槽位（归 `zephyr-ui` 与各 client 行）。
- 已知债：[vite dev server 与宿主同进程](./../debts/20261013-vite与宿主同进程.md)。

## 八、开放问题

- `ServerHmr` 的 `maxWaitMs` 到点后「仍然重载」：忙的时候重载会打断在途调用。是否改成「超时即拒绝重载、提示重启」，未定。
