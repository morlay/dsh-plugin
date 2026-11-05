# @morlay/zephyr-app

宿主与浏览器两半的**装配面**：http/web-server、connection、client 行清单与按需联邦产物（`/_zephyr/@modules/<pkg>@<ver>/<export>`）、页面骨架（`app-boot`），以及浏览器半的官方 client 链。

运行期语义全归 cordis（见 [`@morlay/zephyr` 的接口定义](../zephyr/.agents/designs/20261104-zephyr-是-cordis-plugin-的语法糖.md)）：本包只提供契约、`XxxDefault` 实现与**域装配函数**，不持有自己的服务表或作用域。

## 用法

```ts
// 宿主（node）：一行装配
const app = await bootstrapApplication({ providers: [...provideWeb(), ...provideClientModules()] });

// 浏览器：入口归应用，框架只提供「怎么装、怎么挂」
await bootstrapClient({ providers: [...provideClientChain(), ...provideSessions()] });
```

- 每个域导出一个 `provideXxx(...features)`；外部只调它，不手写 provider 清单。
- 契约 + `XxxDefault`：宿主面见 `src/{web,connection,rows,federation,http,api-gateway}/`，浏览器链见 `src/client/<domain>/`。
- 行清单由装配方经 `ClientRows` 契约给（`clientPackagesOf` 从入口的 provider 清单推导）。
- 路径全部来自 `AppEnv` 契约（`dataDir` / `profileDir` / `dev` / `aggregate` / `remotes`），不读环境变量、不向上找目录。它是**装配方必须给的**（`provideAppEnv(configure(AppEnvDefault, {...}))`）。
- 客户端产物按请求预编译、落盘缓存，详见 [.agents/designs/20261013-客户端资源的联邦式预编译.md](./.agents/designs/20261013-客户端资源的联邦式预编译.md)。
- 已知债：[.agents/debts/20261013-vite与宿主同进程.md](./.agents/debts/20261013-vite与宿主同进程.md)。

## 装配顺序（client 半）

清单顺序就是激活顺序，而几个上游行在 `apply` 期**同步**读别人的服务，所以顺序是硬要求：

```text
ConfigForms（装配面给：SettingsHost / ConfigFormsInMemory）
  → provideClientChain()            // Connection → Typert → Remote → Slots → Resources → Access
                                    //   → Projections → Locale → FileDrag → Shortcuts
  → provideTheme()                  // apply 期同步读 ctx.configForms
  → provideLayout()                 // apply 期同步读 ctx.theme
```

- **链的必需前置**：`ConfigForms` 的提供者（`SettingsHost` 或 `ConfigFormsInMemory`）必须先于 `provideClientChain()`。
- **链之后必须紧跟** `provideTheme()` 再 `provideLayout()`；两者都不在链里，漏了会缺渲染面（`Layout` 契约）。
- **`configForms` 不在链里**：cordis store 里一个名字只能有一个提供者，链里塞空实现等于让装配面再也装不进真实现。缺它是编译期错误（`Locale` / `Theme` 的必需注入）。
- **`Slots` 在 `Resources` / `Access` 之前**：`SlotContribution.onInit` 里就要 `slots.effect`。
- 测试里要一个不抛的配置面时用 `ConfigFormsInMemory`（从 `@morlay/zephyr-app/client` 出），它**不注册任何真设置**，只保证 `get()` 不炸。

## 观测点

长期观测（不是调试探针），都走 `inject(Logger)`（`Logger` 的值就是 cordis 的 `ctx.logger`）：

- `ClientModulesDefault` 在装配收尾打印路由表（`[routes] <kind> <path>`）——只有它知道路由是否都注册完了。
- `ConnectionDefault` 在 `rpc.intercept` 上包一层，打印 `[rpc] <channel>`。
- `LoggerExporterDefault` 把 `ctx.logger` 接到 stdout（cordis 默认只把消息留在内存里）；严重级别落 stderr。

## HMR

`ViteHandoff` 契约的 `hmrUpgrade(req, socket, head)` 交给 vite 的 ws（vite 8 的 `server.ws` 运行时是 `ws.WebSocketServer`，类型层用最小断言）。`ClientModulesDefault.install()` 在 `HMR_PATH` 上注册 upgrade 路由，卸载时撤销。

## 验证

- `pnpm exec vitest run packages/zephyr/zephyr-app/src` —— 两条端到端装配用例是判据：
  - 宿主：`src/__tests__/api-gateway.spec.ts`（真 http + 真 WebSocket 升级）；
  - 浏览器：`src/client/__tests__/render.smoke.spec.ts`（happy-dom 里装官方链 → layout 注册 `root` → mount 出 AppFrame）。
- `pnpm exec oxlint packages/zephyr/zephyr-app/src`（type-aware，含 `typeCheck`）。
