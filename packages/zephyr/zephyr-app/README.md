# @morlay/zephyr-app

**运行时**（宿主与浏览器双态）：web server 与路由表、connection、remote、api-gateway、`AppEnv` 部署参数、client 行清单，以及浏览器半的官方 client 链。

运行期语义全归 cordis（见 [`@morlay/zephyr` 的接口定义](../zephyr/.agents/designs/20261104-zephyr-是-cordis-plugin-的语法糖.md)）：本包只提供契约、`XxxDefault` 实现与**域装配函数**，不持有自己的服务表或作用域。

**开发态的一切不在这里**：vite、联邦预编译、页面兜底（`/@fs` 与 HMR 注入）、服务端换树，连 `@oxc-project/runtime` 这种 node 侧补强也不在——它们住 [`@morlay/zephyr-dev`](../zephyr-dev/README.md) 与 [`@morlay/dsh-oxc-node`](../../boot/dsh-oxc-node/README.md)。

判据是**依赖清单**，不是注释：`src/__tests__/dev-deps-absent.spec.ts` 断言 `dependencies` / `devDependencies` / `peerDependencies` 里都没有 vite / chokidar / lightningcss / rolldown / `@oxc-project/runtime`。

## 用法

```ts
// 宿主（node）：运行时一行装配
import { provideWeb, provideAppEnv } from "@morlay/zephyr-app";

const app = await bootstrapApplication({ providers: [...provideAppEnv(), ...provideWeb()] });

// 浏览器：入口归应用，框架只提供「怎么装、怎么挂」
await bootstrapClient({ providers: [...provideClientChain(), ...provideSessions()] });
```

- 每个域导出一个 `provideXxx(...features)`；外部只调它，不手写 provider 清单。
- 契约 + `XxxDefault`：宿主面见 `src/{web,api-gateway,app-env,connection,remote,remote-access,typert}/`，浏览器链见 `src/client/<domain>/`。
- 路径全部来自 `AppEnv` 契约（`dataDir` / `profileDir` / `defaultWorkingDirectory` / `profileManifest` / `cacheDir`），不读环境变量、不向上找目录。
  它是**装配方必须给的**（`provideAppEnv(configure(AppEnvDefault, {...}))`）；`process.cwd()` 只在 `AppEnvDefault` 的构造里出现一次，
  其余代码一律读 `AppEnv` 给的派生值。
  `profileDir` 是**装配根**（`package.json`、依赖解析、产物根），`defaultWorkingDirectory` 是**新会话 / agent 的起始目录**——
  打包形态下前者是包内只读的 `Resources/runtime`，agent 不该在那儿干活，所以两者不能合并成一条路径。
- **`AppEnv` 只放两种形态都成立的事实**：开发态专属的路径（页面骨架在哪、vite 的 root）不在这里，
  由 `zephyr-dev` 从 `profileDir` 自己推。
- **remote 面不在装配方的配置里**：谁装了某个 remote 的宿主行，谁在自己的 `provideXxx()` 里用 `remoteDescriptor("<namespace>")` 登记一条（多值令牌 `RemoteDescriptor`）；开发运行时的 `ClientModulesDefault` 用 `inject.all(RemoteDescriptor)` 聚合后 `$mount`。新增一个 remote 只改提供方，装配面零改动。

## 两条空契约

形态问题不进运行时，这里只声明缝，实现在谁那儿归谁：

| 契约           | 签名                                                                       | dev 的实现                         | prod 的实现         |
| -------------- | -------------------------------------------------------------------------- | ---------------------------------- | ------------------- |
| `ClientAssets` | `serve(req, res)` / `transformHtml(html)` / `hmr` / `onServerSourceChange` | `zephyr-dev` 的 `ViteClientAssets` | 静态目录（T3 落地） |
| `DevHmr`       | `install({ isIdle?, restart })`                                            | `zephyr-dev` 的 `ServerHmr`        | 不装                |

**只声明、不含实现**。生产形态装的是 T3 随产物布局落地的静态目录投递——同样不引构建链。

## 装配顺序（client 半）

清单顺序就是激活顺序，而几个上游行在 `apply` 期**同步**读别人的服务，所以顺序是硬要求：

```text
ConfigForms（必需前置：SettingsHost 或 ConfigFormsInMemory）
  → provideClientChain()            // Connection → Typert → Remote → Slots → Resources → Access
                                    //   → Projections → Locale → FileDrag → Shortcuts
  → provideTheme()                  // apply 期同步读 ctx.configForms
  → provideLayout()                 // apply 期同步读 ctx.theme
```

- **链的硬约束**：`provideClientChain()` 激活时 `configForms` 必须已发布（`SettingsHost` 或 `ConfigFormsInMemory` 在前提供），否则 `Locale` / `Theme` 的必需注入不成立。
- **链之后必须紧跟** `provideTheme()` 再 `provideLayout()`；两者都不在链里，漏了会缺渲染面（`Layout` 契约）。
- **`configForms` 不在链里**：cordis store 里一个名字只能有一个提供者，链里塞空实现等于让装配面再也装不进真实现。缺它是编译期错误（`Locale` / `Theme` 的必需注入）。
- **`Slots` 在 `Resources` / `Access` 之前**：`SlotContribution.onInit` 里就要 `slots.effect`。
- 测试里要一个不抛的配置面时用 `ConfigFormsInMemory`（从 `@morlay/zephyr-app/client` 出），它**不注册任何真设置**，只保证 `get()` 不炸。

## 观测点

长期观测（不是调试探针），都走 `inject(Logger)`（`Logger` 的值就是 cordis 的 `ctx.logger`）：

- `ClientModulesDefault`（在 `zephyr-dev`）在装配收尾打印路由表（`[routes] <kind> <path>`）——只有它知道路由是否都注册完了。
- `ConnectionDefault` 在 `rpc.intercept` 上包一层，打印 `[rpc] <channel>`。
- `LoggerExporterDefault` 把 `ctx.logger` 接到 stdout（cordis 默认只把消息留在内存里）；严重级别落 stderr。

## 验证

```bash
pnpm exec vitest run packages/zephyr/zephyr-app/src
pnpm exec oxlint packages/zephyr/zephyr-app/src   # type-aware，含 typeCheck
```

两条端到端用例是主判据：

- 宿主：`src/__tests__/api-gateway.spec.ts`（真 http + 真 WebSocket 升级）；
- 浏览器：`src/client/__tests__/render.smoke.spec.ts`（happy-dom 里装官方链 → layout 注册 `root` → mount 出 AppFrame）。

`src/__tests__/dev-deps-absent.spec.ts` 守着「运行时不带开发态」。
