# @morlay/dsh-desktop-host

桌面部署里那个 **host 进程**：按 `desktop` profile 把 Web 应用启起来，然后**在进程内接管 `webServer`**——
不监听任何端口，Electron 壳把该应用自己的协议（`<app name>://app/*`）的请求经字节管道（FD 3/4）喂进来。

上游 `apps/desktop-host`（`@deepseek-ai/dsh-desktop-host`）是 `private: true` 的应用，外部装不到，所以这里
是它的**变体包**：argv / IPC 契约、`lib/index.js` 入口路径照旧，两处本地差别——Office 组合不再挂
`@deepseek-ai/dsh-skill-office`（见 [`src/office.ts`](./src/office.ts)），载波从「监听端口 + 壳认证反向代理」
换成「宿主内 webServer 替身 + 管道」（见 [`src/webserver.ts`](./src/webserver.ts) 与桌面层的
[设计 桌面无端口传输与窗口对齐](../dsh-desktopify/.agents/designs/20260920-桌面无端口传输与窗口对齐.md)）。

## 用法

被 [`@morlay/dsh-desktopify`](../dsh-desktopify/README.md) 使用，不单独跑：

- `dev` / `bundle` 把本包落位到部署的 `<runtime>/node_modules/@morlay/dsh-desktop-host`：`dev` 整份复制源码树，
  `bundle` 按 manifest `files` 复制。两条路都要带上这四样——`lib/index.js`（启动入口）、
  `lib/webserver.js`（桌面 patch 行按 `../lib/webserver.js` 加载）、`lib/wire.js`、
  `config/desktop.cordis.patch.yml`（入口按 `../config/desktop.cordis.patch.yml` 作为 `patchFiles` 读），
  缺任一样 host 都起不来；
- 壳按 `<runtime>/node_modules/@morlay/dsh-desktop-host/lib/index.js` 启动它（stdio 五元组：
  FD 3/4 是管道，FD 5 是 Node IPC），argv 为
  `[runtimeDir, projectDir, primaryRuntime, profileResolution, pnpmEntry, nodeBin]`；
- IPC：`ready { protocolVersion }` / `fatal { message }`，另外收 `shutdown`。

出口：`.`（启动入口）、`./webserver`（无端口 `webServer` 服务，供 patch 行加载）、`./wire`
（管道分帧，壳构建时内联，部署里不需要单独解析它）。

## 运行时做的事

1. `runProfile` 装配 `desktop` profile（保住 profileContext / proxy / fail-loud / appReady / shutdown 语义）；
2. 桌面 patch 禁用上游 `webserver` 行，插入本包的 `webServer` 替身——同一份路由面
   （`register` / `registerFallback` / `registerUpgrade` / `tapIndex` / `renderIndex` / `collectIndexInjections` /
   `port` / `host`），请求由 `dispatch(Request)` 从管道喂进来；
3. 接管浏览器认证：页面由壳独占、没有网络入口，`connection` 的 `requestRejection` 与 `authorizeIndex`
   被改写为放行（理由与代价见[债务 桌面宿主覆写 connection 认证方法](../dsh-desktopify/.agents/debts/20260920-桌面宿主覆写connection认证方法.md)）；
4. 注入客户端 transport（`__DSH_TRANSPORT__ = { ownsHost, openStream }`）并注册 `/.dsh/remote-stream`
   （POST NDJSON → `typertGateway.wireStream.open`）。

## 依赖边界

`@deepseek-ai/*` 全部由**部署自己的** `node_modules` 提供（与上游同边界）：

- `dependencies`：本包入口与替身真正 import 的 `@deepseek-ai/dsh`（含 `./profile-boot` 子路径）、
  `@deepseek-ai/dsh-app-boot`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-host-webserver`
  （`renderIndexInjections`）、`@deepseek-ai/schemastery`（替身的 Config schema）；
- `peerDependencies`：`@deepseek-ai/cordis`；
- 类型面 `@deepseek-ai/dsh-client-connection` / `@deepseek-ai/dsh-api-gateway` 只在 devDependencies
  （空 import 带 Context merge，构建后即被擦除）；
- vendor 里的 `workspace-dependencies` 模块在构建期内联，运行期不依赖 vendor 路径。

清单只声明**这份代码真正用到**的包：上游那份 app manifest 里的组合依赖
（`@deepseek-ai/dsh-skill-office`、`dsh-agent`、`dsh-jobs`、`dsh-tools` …）属于部署的官方闭包，
由 `@morlay/dsh-desktopify` 的部署步骤按 profile 提供，不该由本包声明。
