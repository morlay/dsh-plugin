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

## 两个面

| 出口                                             | 内容                                                                                                                   | 谁用                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `@morlay/zephyr-dev`                             | 不需要装配的那一半：`bundlePackage` / `prebundleAll` / `planPrebundle` / 路由空间常量 / URL 前缀改写 / 解析规则        | `zephyr-cli` 的构建步骤、测试  |
| `@morlay/zephyr-dev/node`                        | 装配行：`provideClientModules()` / `provideServerHmr()` / `provideHttp()` / `FederationDefault` / `ViteHandoffDefault` | 工作区的装配面（`apps/**`）    |
| `@morlay/zephyr-dev/build`                       | `zephyrClientViteConfig()`：静态面构建用的 vite 配置片段                                                               | 应用的 `zephyr.config.ts`      |
| `@morlay/zephyr-dev/federation/prebundle(-plan)` | 构建期前端预编译（目标枚举 + 逐条产出）                                                                                | `zephyr-cli` 的 `build` 第四步 |

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

## 构建流程

```text
zephyr.config.ts（应用）  →  client.vite = zephyrClientViteConfig({ repoRoot })
zephyr build（CLI）      →  prebundleAll(planPrebundle(应用 client 入口的静态 import 图))
                          →  产物落 <dataDir>/cache/client-modules/<pkg>@<ver>/*
```

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

判据在 `src/__tests__/`：`bundle.spec`（产物与外部依赖）、`resolve.spec`（按 `exports` 找入口）、
`dev-files.spec`（当文件名单）、`vite-plugin.spec`（说明符分流）、`url-prefix.spec`（URL 空间收敛）、
`url-rewriting-wire.spec`（出站改写接到 `WebServer` 上）、`server-source.spec`（哪些文件算服务端源码）。
