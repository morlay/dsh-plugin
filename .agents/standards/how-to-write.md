# 如何写

写代码时守的约束。判据是命令，不是口头约定：`just lint`（类型 + 规则）、`just audit`（面边界 / 依赖声明 /
扩展边界）、`just build`（出口能出活）。任一红就是不合规。

## 判据一览

| 判据       | 命令                                     | 判什么                                                                                                     |
| ---------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 类型与规则 | `just lint`                              | oxlint `typeAware` + `typeCheck`（[`.oxlintrc.json`](../../.oxlintrc.json)），全仓                         |
| 面边界     | `just audit`                             | root / ui / server 互相越界即红                                                                            |
| 依赖声明   | `just audit`（`--write` 一键删）         | 声明却没有用到的依赖即红；「必须保留」的判据只在 [`rules.ts`](../../devpackages/devkit/src/audit/rules.ts) |
| 扩展边界   | `just audit`                             | `packages/agent-ex/*` 的入口越界与扩展间互相依赖                                                           |
| 出口能出活 | `just build`                             | 每个有 TS 源码入口的包（`exports` 的值指 `./src/*`）产物与 `exports` 对得上                                |
| 格式       | `just fmt` / `pnpm exec oxfmt --check .` | 换行、引号、表格对齐                                                                                       |

## 分层与依赖方向

依赖只许向下：`apps/*` → `packages/agent-ex/*` → `packages/agent/*` → `packages/zephyr/*` →
`vendor/deepseek-harness`。分层与落点的索引在[系统设计](../designs/20260917-系统设计.md)；各层职责、三种形态
（适配行 / 本地实现 / 本地新增）与层判据在层设计：[框架层](../../packages/zephyr/.agents/designs/20261113-框架层.md)、
[能力层](../../packages/agent/.agents/designs/20261113-能力层.md)、
[扩展层](../../packages/agent-ex/.agents/designs/20261113-扩展层.md)、
[装配层](../../apps/zephyr-custom/.agents/designs/20261113-装配层.md)、
[工具链层](../../devpackages/.agents/designs/20261113-工具链层.md)。这里只留判据。

- **反向依赖即错**：`agent` 不 import `agent-ex`；`zephyr` 不认识任何域包；装配面只写清单。
  判据：`just audit` 的「扩展边界」与「面边界」两项。
- **上游只读**：`vendor/**` 与 `node_modules` 不许手改；改上游只走 `just vendor sync` / `patch` /
  `vendor` / `prebuild`（[vendor 的 justfile](../../vendor/justfile)），入口是
  [zephyr-upstream-sync 技能的脚本](../skills/zephyr-upstream-sync/scripts/upstream-sync/src/cli.ts)。
  判据：`git status vendor/` 为空。
- **上游知识只出现在适配行**：上游的类型、字符串标识、私有字段名不泄漏到消费侧；替换实现走同一令牌的
  第二个适配器。判据：`just audit` 的「上游包唯一化」——同一上游包的同一个面（`pkg#host` /
  `pkg#client` / `pkg#remote`）只该有一个本地 owner（`zephyr` 组豁免）。

## 面边界

包内四个面：`root`（包根的 `index.ts` 与同目录的一文件一类型）、`server`、`ui`、共享面
（`contract` / `endpoint`）。越界由 [`package-audit.ts`](../../devpackages/devkit/src/audit/package-audit.ts) 判：

| 从 → 到                        | 允许                                                | 判据（越界即红）                             |
| ------------------------------ | --------------------------------------------------- | -------------------------------------------- |
| `ui` → `server`                | 不许                                                | `ui→host`                                    |
| `ui` → `root`                  | 只许类型与纯函数，不许 `*.service.ts` / `*.host.ts` | `ui→host`（按目标文件名判）                  |
| `server` → `ui`                | 不许                                                | `server→ui`                                  |
| `root` → `server` / `ui`       | 不许                                                | `root→face`                                  |
| `contract` / `endpoint` → 任意 | 只许类型与纯值                                      | 审计跳过共享面；靠 `just build` 与包层规范守 |

- **判据只覆盖生产代码**：`__tests__` 不参与面边界（测试装整个应用是正当的）。
- **装配面只写清单**：`apps/zephyr-custom` 的 `providers: [...]` 与 `zephyr.config.ts`；生命周期归
  `@morlay/zephyr-cli`。判据：`just custom build` 能构建 + 清单评审（apps 不设测试门禁）。
- **浏览器半不引宿主专属的包根**：包根若只出宿主面（例：permission 的包根带三个宿主 service，远端身份在它的 `./endpoint`），浏览器半只引它的 `./contract` / `./endpoint`。`@morlay/zephyr` 的包根两端共用（DSL 与装配内核是同一份，浏览器里 cordis 是合法运行期），框架的浏览器面与类型断言工具是 `@morlay/zephyr-app/client`——这两者的用法按[框架层设计](../../packages/zephyr/.agents/designs/20261113-框架层.md)。
  判据：`grep -rn 'from "@morlay/dsh-permission"' packages/*/*/src/ui packages/*/*/src/client` 去测试后为 0（引一次就把三个宿主 service 拖进前端 bundle）；这些面里 `from "node:` 也为 0。

## 依赖声明

- **运行期用到什么就声明在运行期面**：源码 `import` 的包进 `dependencies`（宿主必须提供、我们不 import
  的契约进 `peerDependencies`）；只在测试里用的进 `devDependencies`。
- **声明未用就是死依赖**：`just audit` 报「声明未用」；AST 看不见的五类（自引用、`@types/*`、
  清单的 scripts 字段、清单其它字段、生成物运行时）由 `keepReason` 保下，想放宽先改
  [`rules.ts`](../../devpackages/devkit/src/audit/rules.ts) 与它的 `rules.spec.ts`。
- **转译器注入的 helper 不声明、由构建内联**：rolldown 的 oxc 降级 legacy 装饰器时会现写一条
  `@oxc-project/runtime/helpers/*` 的 import，源码里没有它。它由 `devkit build` 打进产物（产物里只剩
  那几个 helper 函数），发布包**不声明**它——声明了就得跟着 rolldown 的 oxc 版本线走，而消费方装不到它
  就是启动即 `Cannot find package`。判据（`dist` 里没有这条裸导入 + 干净 node 进程能加载）见
  [devkit 如何验证](../../devpackages/devkit/.agents/standards/how-to-verify.md)。
- **包内测试走包名**（`@morlay/<包>/<面>`）：测试是唯一每次 CI 都跑的消费方，它顺带守住 `exports`。
  自引用因此要在 `devDependencies` 里写自己的包名（`keepReason` ② 认这个理由）。
- **上游依赖不进装配面**：应用只声明它自己 import 的包与按字符串引用的包（`remoteDescriptor("<包名>")`
  这类），其余由提供方声明。判据见 [`apps/zephyr-custom/README.md`](../../apps/zephyr-custom/README.md)。

## 包出口

- **发布形态**：有 TS 源码入口的包统一产物包（`dist` + `.d.mts`）；`@morlay/dsh-oxc-node` 保持手写
  `register.mjs` 单文件；`devpackages/**` 私有、只出源码。发布集合、版本与通道见[设计 npm 发布线](../designs/20261118-npm发布线.md)。
- **清单由构建写回，不手写**：`exports` 与 `publishConfig.exports` 由 `devkit build` 按入口与产物写回——
  顶层指源码（工作区内直连 `src/**`），发布态指 `dist` 产物；手改会被下一次 `just build` 覆盖。生成规则见
  [设计 构建与审计](../../devpackages/devkit/.agents/designs/20261118-构建与审计.md)。
  **package.json 出口每个包都有**（`import.meta.resolve("<包名>/package.json")` 靠它）。
- **按面开出口，不凑数**：出口键写成 `"./<面>"`，面名是 contract / endpoint / server / ui / testing；
  谁有消费方谁开，没有消费方的面不开（多一条出口就是把同一份东西列两遍）。testing 面只给测试用。
- **加面 = 加文件 + 清单**：`src/<面>.ts`（或 `src/<面>/index.ts`）与入口声明同笔改。入口由 `devkit build`
  从 `exports` 推导——**没有第二份入口清单**（包内不挂 `tsdown.config.ts` 与 `build` 脚本）。
  清单由构建写回，手改无效。
  判据：`just build` 后产物目录里有同名文件，且包内测试按包名解析得到。
- **浏览器半只有两种出口**：`./ui` 是**纯 ESM** 面（zephyr 前端装配用）；`./client` 只给 dsh 插件
  （`dsh.bundle` 且有前端的包），发布态按「库 + 工厂」两条条件。两者并存，不互相替代；node 专属实现
  与宿主 service 留在包根——包根只出宿主面时，浏览器半只引它的 `./contract` / `./endpoint`（见[面边界](#面边界)）。
- **bundle 包（dsh 行入口）是固定目录形态，不开源码出口**：`src/dsh-bundle.ts` 具名导出 `name` /
  `inject` / `apply`（行插件本体，`unwrapExports` 取命名空间），另导出 `rows` 作为 patch 的行清单；
  浏览器半是固定文件 `src/dsh-bundle.client.ts`（同名三件套）。没有 `src/index.ts`——包根就是
  `dsh-bundle.ts` 的产物。清单里 **`exports` 是空对象**（源码不被当库消费），构建按固定文件认出 bundle
  包并推导入口；发布态出口由 `devkit build` 写进 `publishConfig.exports`：`.` → `{ "default":
  "./dist/index.mjs" }`（**没有 `types`**：bundle 包不出 `.d.mts`）、`./package.json`、
  `./cordis.patch.yml`，有浏览器半时再加 `./client` → `{ "default": "./dist/client.cjs" }`。
  开发态只走 `provideXxx()` 清单，不从 bundle 包的产物装配。
- **`dsh.bundle` 指产物里的 patch**：bundle 包写 `"dsh.bundle": { "patch": "./dist/cordis.patch.yml" }`——
  patch 是构建产物（实际发布物是 `dist/cordis.patch.yml`，发布态另有 `./cordis.patch.yml` 出口指同一文件），
  不是包根下的源文件；行清单声明在包的 `src/dsh-bundle.ts` 的 `rows`（首行「由 … 生成，请勿手工编辑」）。
  判据：`just build` 后 `dist/cordis.patch.yml` 存在，清单里的 `dsh.bundle.patch` 指向它。
- **发布包带 `prepublishOnly`，内容调 `devkit build`**：写成 `"prepublishOnly": "pnpm exec devkit build --filter <包名>"`
  （`zephyr-desktop-shell` 另接 `pnpm exec tsdown` 补 `preload.mjs`）。发布时忘了先构建，发出去的就是旧产物或
  根本没有 `dist`；`devkit` 的 bin 在根上，包目录里 `pnpm exec devkit` 解析得到。判据：`just audit` 的
  「发布包带 prepublishOnly 且调 devkit build」。
- **`publishConfig.exports` 只在 `private: false` 的包上有意义**：它是**整体替换**，键集合必须覆盖顶层
  `exports` 每个键（外加 `./package.json` 与只发布态入口），漏一个键就是发布包少一个面；`private: true`
  的包只写 `exports`，不写 `publishConfig` / `engines.dsh`。
- **`engines.dsh` 只写在 `private: false` 的包上**：范围与 [`mise.toml`](../../mise.toml) 的
  `DEEPSEEK_HARNESS_VERSION` 同源，跨 major.minor 就换新范围。判据：
  `grep -h '"dsh"' packages/*/*/package.json` 与 `mise.toml` 对照。
- **应用图标随包走**：`icon.svg` 在应用包根、`files` 里带上，`zephyr.config.ts` 的 `desktop.icon`
  指向它（当前唯一实例是 [`apps/zephyr-custom`](../../apps/zephyr-custom/zephyr.config.ts)）。
  判据：`files` 含 `icon.svg`，且 `icon` 指的文件存在。

## 类型

- **类型口径只来自根 [`tsconfig.json`](../../tsconfig.json)**：`strict`、`noUncheckedIndexedAccess`、
  `exactOptionalPropertyTypes`、`include: ["**/*"]`；**类型检查由 `just lint` 承担**（`typeAware` +
  `typeCheck`），本仓没有独立的 `tsc` 步骤。
- **另有两份非口径的 tsconfig，新增第三份要在文件头写清用途**：
  [`devpackages/typert-generator/tsconfig.json`](../../devpackages/typert-generator/tsconfig.json)（包内自检）
  与
  [zephyr-app 的 federation 解析用 tsconfig](../../packages/zephyr/zephyr-dev/federation.resolve.tsconfig.json)
  （rolldown 的模块解析输入，不是编译）。
- **声明树是产物，不进 git**：`target/dts` 由
  [`@local/dts-prepare`](../../devpackages/dts-prepare/src/dts.ts) 的 `ensureWorkspaceDts` 生成，是
  [typert-generator](../../devpackages/typert-generator/src/index.ts) 的输入；各包 `dist/*.d.mts` 由
  `devkit build` 从这棵树按入口聚合（不再有第二个出声明的地方）。`tsc -b` 只在需要类型图时手动跑。
- **跨边界 id 用 branded 类型，不做裸 `string`**；跨包契约由契约包显式导出，消费方只引用。

## 令牌与依赖注入

- **有实现类的服务就用契约类当令牌**：`@Injectable() abstract class`，名字是类名的连字符化形（同时是
  cordis 服务名与 dsh 行 id，见 [`token.ts`](../../packages/zephyr/zephyr/src/token.ts)）。
- **`InjectionToken<T>` 只用于「没有实现类、由上游行在 mount 期按名字发布」的服务**——若有实现类，用 `@Injectable({ name })` 抽象类（`uiWorkspace` 已从令牌改成抽象类，见 `dsh-workspace/src/ui/ui-workspace.token.ts`）
  与纯值配置；类型参数写真实类型，不写 `unknown`。
- **依赖写成字段注入**：`inject(Token)` / `inject.optional()` / `inject.all()`；不写 `static inject`
  数组、不按字符串 `ctx.get("名字")` 取服务。装配语法（`provide` / `without` / `configure` /
  `fromCordis` / `toCordis`）的唯一 home 是
  [`how-to-write.md`](../../packages/zephyr/zephyr/.agents/standards/how-to-write.md)。

## 代码约定

- **不许增强上游的运行期契约**：不给 `Context` / `Events` 这类合并接口加成员。**例外是上游自己约定的
  类型扩展点**（CSS 模块声明、`@deepseek-ai/dsh-client-ui-slots` 的 `SlotMap` 这类声明面），
  每处要在同文件注释写清「谁贡献了哪个键、为什么必须在这里声明」。判据：
  `grep -rn 'declare module "@deepseek-ai' packages` 的每一处都能在上游找到同形的扩展点。
- **外部 I/O 可注入**：数据根、目录、时钟、网络作为构造参数或 `AppEnv` 契约给
  （[`zephyr-app` 的 `AppEnv`](../../packages/zephyr/zephyr-app/src/app-env/app-env.contract.ts)：
  `dataDir` / `profileDir` / `dev` / `devFiles`）；运行期读 `process.env` 只许两类——显式开关
  （`DSH_TRACE`、`DSH_BUNDLE_*`）与「按配置给的变量名读密钥」（`apiKeyEnv`）。
- **oxlint 的 `no-sync` 规则全开、无豁免**（[`.oxlintrc.json`](../../.oxlintrc.json) 的 `error`）：运行时、测试与
  脚本一律用异步 node API。仅 `node:sqlite` / better-sqlite3 这类驱动语义例外。
- **注释写「在做什么 / 有什么约束」**：设计理由与取舍归 `.agents/` 记录，注释里最多一行指过去。
  判据：新注释里不出现「原来 / 曾经 / 已废弃 / 被 X 取代」。
- **导出的 API 用 JSDoc**：`/** … */` 首行是一句话结论，参数与返回值用 `@param` / `@returns`；
  签名自明的参数说明可以省。判据：`just lint`；风格照
  [`from-cordis.ts`](../../packages/zephyr/zephyr/src/compat/from-cordis.ts)。
- **文件以单个换行结尾**：`pnpm exec oxfmt --check .` 判。

## 日志

一个出口一处名字：名字交给 logger，消息里不拼 `[xxx]` 前缀。级别按用途分，不一律 `log`。

| 在哪                                              | 出口                                                                                                                           | 怎么写                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| cordis 树内（`packages/**` 的行、宿主、CLI 装配） | `ctx.logger(name)`（`@morlay/zephyr` 的 `Logger` 契约；`LoggerExporterDefault` 接 stdout，严重级别落 stderr）                  | 失败 `warn` / `error`；里程碑 `info`；逐包 / 逐请求的细节走 `traceOf(ctx, name)`，由 `DSH_TRACE=1` 开 |
| 壳（Electron 主进程，没有 cordis 树）             | `shellDebugOf(env)` 的 `log` / `fail`（[`debug.ts`](../../packages/zephyr-desktop/zephyr-desktop-shell/src/debug.ts)，stderr） | 生命周期与失败；`fail` 不受 `ZEPHYR_DESKTOP_DEBUG` 开关吞掉                                           |
| 注入到页面 / preload 的脚本（浏览器里跑）         | `console`                                                                                                                      | 原样保留，代码里写明理由                                                                              |

- **键名用 `.` 分层、不带空格**（`seed.bundles`）；**值走参数不拼文本**：cordis 的 `meta` 是 logger
  实例级的，结构化字段只能作 `%o` 参数传（[`trace.ts`](../../packages/zephyr/zephyr-dev/src/internal/trace.ts)）。
- 判据：`grep -rn 'ctx.logger(' packages` 与 `grep -rn 'traceOf(' packages` 对得上；新增日志不新开出口。
