# client-modules 重写（2026-10-22）

**目标**：把宿主装配、页面骨架、client 行与联邦产物拆成各自有契约的模块；装配只有 provider 清单，依赖只有 `inject`；路径只有 `AppEnv`；去掉 `plugin.ts` 里混在一起的 700+ 行。

**判据**：`just web` 起来后，真浏览器加载页面 → `#root` 有内容（`.scratch/e2e-page.mjs` 的 `ROOT_LEN > 0`、`PAGEERRORS 0`、`HTTP 失败 0`）；`pnpm exec vitest run packages/zephyr` 全绿；`pnpm exec oxlint packages/zephyr` 0 error。

## 模块与契约

| 模块 | 契约 | 默认实现 | 职责 |
| --- | --- | --- | --- |
| `AppEnv` | 已有 | `AppEnvDefault` | **所有路径**：`dataDir` / `profileDir` / `cacheDir` / `packageRoot` / `appBootDir` / `profileManifest`，以及 `dev` / `aggregate` / `remotes`（装配方显式给） |
| `ClientRows` | 已有 | `ClientRowsDefault` | 行包清单（`clientPackagesOf` 从入口的 provider 清单推导后传入） |
| `Federation` | `federation.contract.ts` | `FederationDefault` | `serve(url, req, res)`：按需 `bundlePackage` + 落盘缓存 + 地址（`urlOf`） |
| `WebServe` | `http/serve.contract.ts` | `ServeDefault` | 页面（`app-boot/index.html` 注入）、`/@fs`、仓库路径拦截、交给 vite |
| `ViteHandoff` | `vite-handoff.contract.ts` | `ViteHandoffDefault` | vite server 的启停、`serve(req,res)`、`transformIndexHtml` |
| `ClientModules` | `client-modules.contract.ts` | `ClientModulesDefault` | 装配面：注册 `prefix /@client-modules` → `Federation`，`fallback` → `WebServe`；按 `AppEnv.remotes` 装 remote（client 半的入口就是包入口 `src/index.ts`，不再有 `client/` 子目录） |

## 不变量

1. **装配只有 provider 清单**：`bootstrapApplication({ providers })`；没有 `imports`、没有 Module 容器。
2. **依赖只有 `inject`**：`attachProviders` 串行按 `imports` 顺序；缺依赖立刻报错（不等待）。
3. **路径只有 `AppEnv`**：所有路径（`dataDir`/`profileDir`/`cacheDir`/`packageRoot`/`appBootDir`/`profileManifest`）都由它提供，不读环境变量、不向上找目录；`profileDir` = cwd 的 `package.json` 所在目录（没有就报错），`dataDir` = `DSH_HOME`（没有就报错）。
4. **包根解析只接受调用方传的 `root`**（`rootOf` 不再遍历基准）；行依赖从行的清单解析（node 原生 `createRequire`）。
5. **一个文件一个类/一契约**，契约与实现同目录。
6. **诊断日志**统一走 `AppEnv.debug`（默认关），不散落在业务代码里。

## 目录（重写后）

```
src/
├── app-env.contract.ts / app-env.service.ts   所有路径（dataDir / profileDir / cacheDir / packageRoot / appBootDir / profileManifest）
├── rows/        client-rows.contract.ts / .service.ts / client-packages.ts / aggregate.ts / module.ts
├── federation/  federation.contract.ts / .service.ts / bundle.ts / parse-url.ts / watch.ts / module.ts
├── http/        serve.contract.ts / .service.ts / module.ts
├── vite-handoff.contract.ts / .service.ts / .module.ts
├── client-modules.contract.ts / .service.ts / .module.ts
├── web/         web-server.contract.ts / web-startup.* / webserver.service.ts / web-runtime.service.ts / module.ts
├── connection/  contract.ts / connection.service.ts / module.ts
├── api-remotes/mount.ts                        remote 清单的按需装载（清单由 AppEnv.remotes 给）
├── resolve.ts                                包根 / exports / 入口解析（node 原生）
├── serve-vite.ts / vite-plugin.ts / trace.ts   vite dev server 的内部实现（被 ViteHandoffDefault 收编）
├── index.ts                   包入口：`export default ClientModulesModule`（`./client-module` 指向它）
└── app-boot/                  页面骨架与 node-stub
```

**已删除**：`dirs.ts`（路径职责归 `AppEnv`）、`plugin.ts`、`client-rows.ts`、`zephyr.module.ts`、`zephyr.service.ts`、`config.ts`、`modules/`、`terminal-recovery/`、`client/`。

## 测试口径

- 纯函数：`federation/parse-url.ts`、`federation/watch.ts`、`rows/aggregate.ts`、`federation/bundle.ts`（`urlOf`/`bundlePackage` 的出口规则）各一个 spec；
- 契约/服务：`attachProviders` 装最小模块，断言路由注册（prefix/fallback 的顺序与路径）、`Federation.serve` 对 404/命中两种输入的行为；
- 端到端：`.scratch/e2e-page.mjs`（真 Chrome），判据见上。

## 结论（2026-10-23）

重写完成，页面可用：

```
just web → bootstrapped → UiRenderer.mount → #root 800 字节
e2e: ROOT_LEN 800 / PAGEERRORS 0 / HTTP_FAILED 0
vitest packages/zephyr → 40 files / 402 passed
oxlint packages/zephyr → 0 errors
```

**关键取舍（现已改走官方渲染链）**：渲染器曾用我们自己的最小 shell（`RendererDefault`，**不引上游 `ui-layout`**）—— 它的
`inject` 要 `slots`/`theme`/`locale`/`shortcuts`/`remote`/`configForms`/`settingsSchema`，等于把上游整套
client 行装回来，与「最小可用封装」的目标相反。契约留了 `UiRenderer`，之后要接上游 renderer 只换实现。

**过程中修掉的真 bug**（都在 `packages/zephyr`）：

1. `from-cordis.ts` 的两处依赖校验把「纯包装行」（`deps` 缺省）也拦了 → 只有接管依赖的适配行才校验；
2. `serve-vite.ts` 的 `appRoot` 指向 `../app-boot`（`app-boot` 移到 `src/` 后已不存在）；
3. `Federation.depsUrl` 拒绝子路径（`react/jsx-dev-runtime`）→ 子路径也映射成联邦地址；
4. `/@fs/**/node_modules/**` 被 vite 当源码服务 → 302 到联邦地址；
5. `.files.json` 的键是出口名（`client`），`replyFile` 用文件名判 MIME 导致 `application/octet-stream`；
6. 传递依赖的包根只在引用方可见 → `depsUrl` 记包根、`serve` 复用，并把 `resolved` 落进清单供缓存命中重放；
7. vite 8 的转译走 oxc：`decorator: { legacy: true }`，否则 `@Injectable` 原样留进产物；
8. `__DEFINES__` 是 vite 客户端脚本的全局，要在 HTML 里先声明。
