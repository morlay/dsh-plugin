# @morlay/zephyr-dev

**开发运行时与构建器**：在 [`@morlay/zephyr-app`](../zephyr-app/README.md) 的运行时之上，添加前端动态构建 / HMR、后端换树，以及最终产物的构建流程。

一句话分界：`zephyr-app` 回答「应用起来之后怎么服务」，`zephyr-dev` 回答「产物怎么产出、源码变了怎么办」。

## 依赖方向

```text
zephyr-cli → zephyr-dev → zephyr-app → zephyr
```

**单向**。`zephyr-app` 不认识 `zephyr-dev`（连一条 `workspace:` 依赖都没有）——反向声明会让 `pnpm -r` 的任务图成环，
`just audit` / `just build` 直接拒跑（`ERR_PNPM_TASK_CYCLE`）。运行时不带构建链这条边界是靠**依赖清单**守的，
不是靠 `external` 表：判据见 `zephyr-app/src/__tests__/dev-deps-absent.spec.ts`。

## 门面（三个，别在自己的装配面里手写它们）

| 门面                 | 出口     | 干什么                                                                | 谁用                        |
| -------------------- | -------- | --------------------------------------------------------------------- | --------------------------- |
| `devProviders(mode)` | `./node` | 开发运行时的那几行（vite 旁路 + 联邦 + 页面兜底 + 换树时机）          | 工作区的装配面（`apps/**`） |
| `startDev(options)`  | `./node` | 把**已装配的树**起成一个 dev 会话（端口 / 地址 / 幂等 close）         | `zephyr dev`                |
| `compile(options)`   | 主出口   | 应用 client 图 → `client_modules/` 里的联邦产物（build 第四步的算法） | `zephyr-cli` 的 `build`     |

## 出口

| 出口                                             | 内容                                                                                                                                                             | 谁用                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `@morlay/zephyr-dev`                             | 不需要装配的那一半：`compile` / `bundlePackage` / `prebundleAll` / `planPrebundle` / 路由空间常量 / URL 前缀改写 / 解析规则                                      | `zephyr-cli` 的构建步骤、测试 |
| `@morlay/zephyr-dev/node`                        | 装配行与启动面：`devProviders()` / `startDev()` / `provideClientModules()` / `provideServerHmr()` / `provideHttp()` / `FederationDefault` / `ViteHandoffDefault` | 工作区的装配面（`apps/**`）   |
| `@morlay/zephyr-dev/build`                       | `zephyrClientViteConfig()`：静态面构建用的 vite 配置片段                                                                                                         | 应用的 `zephyr.config.ts`     |
| `@morlay/zephyr-dev/federation/prebundle(-plan)` | 构建期前端预编译的**实现**（`compile()` 的零件；通常直接用 `compile()`）                                                                                         | 测试、诊断                    |

装配行单独一个出口的理由：它们 `inject` 宿主运行时（`AppEnv` / `WebServer` / `Federation` / `ClientAssets`），
从主出口出来会把 vite 的模块图带进每个只想要 `bundlePackage` 的地方。

## 开发运行时（dev）

请求先到 `ClientAssets` 的 dev 实现 `ViteClientAssets`，它把两条口都委托给 `ViteHandoffDefault`。
**页面兜底也在本包**（`ServeDefault`）：它要认 vite 的 URL 空间（`/@fs` 的入口注入、`/@vite/client` 的 HMR 脚本、
`/@fs/…/node_modules/…` 到联邦地址的 302），这些全是构建链的事，所以整条链（`WebServe` 契约 → `ServeDefault` → `provideHttp()`）
都住在这里；`zephyr-app` 只提供 `WebServer`（路由表与 upgrade）。

- **页面与本地文件**归 vite；**裸说明符**归联邦链（`@client-modules/…`，按请求预编译 + 落盘缓存）；
- 判据是一条**正向白名单**（`Federation.dev.include`，默认 `@morlay/*`）：点名的包**当文件**逐文件走 vite（改它要 HMR），其余一律 prebundle。
- HMR 的 WebSocket 挂在宿主 http server 的 `/_zephyr/hmr` 上（同源同端口），`ClientModulesDefault` 注册 upgrade 路由占位。

**换树**（服务端 HMR）归 `ServerHmr`（`DevHmr` 的实现）：变更**来源**从 `ClientAssets.onServerSourceChange` 订阅
（谁服务前端资产谁知道哪些文件该触发换树），等业务空闲后调 `hooks.restart`。

**启动**归 `startDev(options)`：它**接收已装配的树**（不是自己 bootstrap 一棵只含 dev 行的树）。
理由是「`zephyr dev` 只有一棵树」——清单 = `devProviders(mode)` + 应用 `server.ts` 的清单，换树（`dispose` 后带 `?v=` 重新
import 清单）归 CLI，部署事实只有 `AppEnv` 一处。它只回 `{ port, url, close() }`，行树不外露；`close()` 幂等。

`devProviders(mode)` 的 `mode` 只有**一个字段** `packaged`：打包形态把 `dev.include` 清空（全部预编译），其余形态
`@morlay/*` 当文件走 vite。别在这里加第二、第三个形态开关——`packaged` 是过渡脚手架，T5 之后随静态前端一起删。

## 构建流程

```text
zephyr.config.ts（应用）  →  client.entry = ./src/client/index.html（+ 可选的 vite 片段）
zephyr build（CLI）      →  compile({ workspace, appName, outDir, pageEntry })
                          →  内部：planPrebundle(应用 client 入口的静态 import 图) → prebundleAll
                          →       + 应用入口自己作为一个联邦目标（<app>@<ver>/client.js）
                          →  产物落 <outputDir>/client_modules/<pkg>@<ver>/*（含 index.html）
```

**同一语义、只换目录**（设计决定 7）：`outDir` 由调用方给——dev 传 `<dataDir>/cache/client-modules`，
build 传 `<outputDir>/client_modules`。两处只有这一处差别，算法是同一份。

页面骨架也在这里落盘：`index.html` 复制进 `outDir`，入口 script（`type="module"` + 相对 src）
改写成应用入口的**联邦地址** `/_zephyr/@modules/<app>@<ver>/client.js?v=<BUNDLER_REV>`——改完页面只认地址，
不认源码（与 dev 期 `ServeDefault.replyPage` 的「本地入口 → 交付地址」同一条规则）。

`compile()` 的判据（**一字不改**从 CLI 搬来）：清单为空、缺 `REQUIRED_PREBUNDLE` 里的已知包，都是构建失败（抛错并带上
应用 / 入口 / 数据根写法 / 产物落点）；逐条打包的失败汇总进 `CompileResult.failures`，由 CLI 翻成 `CliError`。

清单枚举的两条基准（`planPrebundle` 的头注释里也有，这里只说结论）：

- **解析基准是引用方**，不是应用清单。`shiki` 只装在 `@deepseek-ai/dsh-client-ui-primitives` 的
  `node_modules` 里，从应用清单出发解析不到（应用没声明它）——不是因为不在盘上（`pnpm deploy` 会沿依赖图
  把它装进闭包），而是因为应用清单不是它的引用方。
- **下潜范围**是 `@morlay/*` 与 `@deepseek-ai/dsh-client*`：shiki 的真实来源链要经过第二段
  （`@morlay/zephyr-ui` → `dsh-client-ui-primitives` → `src/markdown/highlight.ts`）。目标按**实际见到的
  说明符**出，不按 `exports` 全枚举（`@shikijs/langs` 有 361 个子路径）。

预编译与 dev 期**同一条算法**（`bundlePackage`），差异只在「什么时候跑」：dev 按请求跑，build 一次跑完。
产物与地址一一对应（`/_zephyr/@modules/<pkg>@<ver>/<file>`），所以生产态可以只做文件投递。

## 解析规则（与 dev 同源）

`clientModulesAlias()` / `clientAssetPlugin` / `cssInlinePlugins` 三样在 dev 与 build 里是**同一份**：
换成两套解析就会出现「dev 能跑、build 白屏」。`node:*` 的浏览器替身有两份形态
（ESM 给 dev 的逐文件服务、CJS 给 rolldown 直出，见 `src/node-stub/`），语义相同。

## 验证

```bash
pnpm exec vitest run packages/zephyr/zephyr-dev/src
```

判据在 `src/__tests__/`：`dev-start.spec`（首页 200、`close()` 后端口释放、部署事实错配当场报错）、
`compile.spec`（空清单 / 缺已知包各报一次点名错误）、`dev-providers.spec`（`packaged` 的两个名单与行清单）、
`bundle.spec`（产物与外部依赖）、`resolve.spec`（按 `exports` 找入口）、`dev-files.spec`（当文件名单）、
`vite-plugin.spec`（说明符分流）、`url-prefix.spec`（URL 空间收敛）、
`url-rewriting-wire.spec`（出站改写接到 `WebServer` 上）、`server-source.spec`（哪些文件算服务端源码）。
