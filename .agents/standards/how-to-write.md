# 如何写

写代码时守的约束。判据来自既有决策（见各层 `.agents/adrs/`，当前决策在根 [`adrs/`](../adrs)
与各包 `.agents/adrs/`），冲突时按 ADR 走。

## 接缝

- **接缝 = 接口即测试面**：改动前先定位这次要穿哪个接缝——它是调用方与测试共同的边界，测试只写在这些
  接缝上。**想越过接口去测，说明接口形状不对**：先改接口，再测。
- **包特有的接缝与判据在该包 `.agents/standards/`**：具体接缝与它对应的守护 spec 就近查，
  这里不索引、不复述。

## 分层与依赖方向

- **依赖单向**：编排 → 契约、实现 → 契约；实现层与编排层互不引用，两者只经 `ctx.sessionBranch` /
  `ctx.sessionPersistence` 这类服务面相遇。装配层依赖其余包，反向依赖成环即错。
  分层结构与各层职责见[系统设计](../designs/20260917-系统设计.md)。
- **引入 vendor 源码的包（薄壳 fork）**：这类包把上游源码拉进同一个 TS program，因此对 tsconfig 与
  合并接口有额外硬约束——见该包层规范。
- **上游不可修改**：`vendor/**` 与 `node_modules` 只读；扩展走 cordis 插件层（plugin / patch bundle /
  settings namespace）。本地 patch 是例外，流程见 `dsh-plugin-upstream-sync` 技能。
- **工具链在根**：各包 `package.json` 只声明自身依赖；上游包以 `workspace:*` 声明在 `peerDependencies`
  （插件契约面）或 `devDependencies`（测试用）。
- **运行期用到什么就声明在运行期面**：源码里 `import` 的包（含 client 半用到的 `react` 这类）要写在
  `dependencies` 或 `peerDependencies`——前端链的外置判据只认本包声明的运行期依赖，躺在 `devDependencies`
  里会被**内联**进产物（同一个库两份实例）。测试与构建用的（`vitest`、`@testing-library/*`、`@types/*`、
  构建插件）留在 `devDependencies`。
- **例外：`electron` 只能写在 `devDependencies`**（`packages/desktop/dsh-desktop-shell`）。electron-builder
  有硬规矩——它由打包器自己提供；而且壳的 app 目录是 `pnpm deploy --prod` 的产物，放运行期面就会被实体化进
  那份清单的 `dependencies`，打包直接报 `Package "electron" is only allowed in "devDependencies"`。

## 包出口

- **谁引到什么由 `exports` 决定**，新面先加出口再引。出口分五类：**host 面**（`.`）、
  **子能力出口**（按域拆分）、**测试辅助**（`./testing`）、**浏览器半**（`./client`）、
  **装配声明**（`./cordis.patch.yml`）。
- **client 半的开发态出口回源**：`./client` 就是一条指 `src/client/index.ts` 的字符串（不是
  `{ types, default }` 那种两份同值的形态）——与 host 面同一条规则。上游把这个路径拼成绝对路径后
  **直接读字节**（浏览器模块工厂执行的就是那份字节），那份 TS 由 `dev-client-bundles`
  （`dshdev dev` 装进 profile 的那一行）现场转换；**发布态**写成 `{ types, import, default }`，两个条件各指
  一份产物：`types` 与 `import` 指 ESM 库 `dist/client.mjs`——按 ESM 解析的消费方（`dsh-client-modules`
  的解析器优先取 `import`，见
  [`resolve.ts`](../../packages/client/dsh-client-modules/src/resolve.ts)）按它取普通库；`default` 是**兜底**
  条件，指 CJS 工厂 `dist/client.cjs`——按包名 + `./client` 解析并读字节的加载方走的正是它（CJS 的
  `require` / `require.resolve` 只认 `require` / `default`），而它读到的必须是 `__ModuleLoader__.load` 的
  注册脚本。工厂是自包含单文件（多文件产物会破坏 ModuleLoader 手递，约束与理由见
  [ADR-20260917-客户端bundle单文件与shadow渲染替换](../../packages/session/ui-conversation-message-actions/.agents/adrs/20260917-客户端bundle单文件与shadow渲染替换.md)），
  所以只许挂在 `default` 上：挂 `import` 会把工厂字节送给要普通库的 ESM 消费方。
- **跨包共享的测试辅助走 `./testing`**，不进 host 面。
- **装配链依赖 `./cordis.patch.yml` 出口**：装配行按包名 + 出口解析，改名或挪出口会打断装配面测试。
- **bundle 的 patch 由构建生成，不手写**：bundle 的 `tsdown.config.ts` 调 devkit 的 patch 插件写出包根那份
  `cordis.patch.yml`（首行是「由 …/tsdown.config.ts 生成，请勿手工编辑」）；能力包只发布实现与 `rows` 出口，
  patch 住在 bundle 里——这是 `ADR-profile层三分（配置初始化与提示词开关与能力清单）`
  的「一份数据、两种平面」约定，判据是各 bundle 的 `patch.spec.ts`。
- **清单由构建写回，不手写**：`exports` 与 `publishConfig.exports` 由 devkit 的 `packageExportsHook`
  在 `build:done` 里按**入口**推导后写回 `package.json`——顶层指源码（workspace 内直连 `src`），发布态
  指产物；手改这两段会在下次 `just build` 被覆盖。要加一个面就加一个入口（`src/<面>.ts` +
  `tsdown.config.ts` 的 `entries`）。入口约定、生成规则与理由都在
  [`devpackages/tsdown-plugin-cordis/src/package-exports.ts`](../../devpackages/tsdown-plugin-cordis/src/package-exports.ts)；
  写出的两份清单由 `publish-exports.spec.ts`（已提交的清单）与 `package-exports.spec.ts`（写回行为本身）守。
- **client 半的发布态出口按「库 + 工厂」两条条件写死**：`{ types, import: dist/client.mjs,
  default: dist/client.cjs }`，**不参与 ESM / CJS 的格式推导**——让推导去猜，它会把 `client.cjs` 当成 `.`
  的 require 变体，包根出口就指到了 client 半。两条条件各等自己那份产物：只有库或只有工厂时构建**推迟**写回
  （判据见 `package-exports.spec.ts`）。
- **装配面（`dsh.bundle` 的包）带 `engines.dsh`，也由构建写回**：上游装配前的
  `evaluatePluginCompatibility` 优先认这个字段，**有它就忽略 peer 范围**——peer 的 `^X.Y.Z-pre` 在 SemVer
  下只被同一 `major.minor.patch` 元组的候选接受，跨不得版本。范围从构建环境里的
  `DEEPSEEK_HARNESS_VERSION` 推导成 `>= <当前版本> < <major>.<minor>.<patch+1>`（env 缺失或认不出该形态
  时留原值不写，构建不因此失败）。**没有源码入口的数据包**（只有 patch / locale / icon 的那种）进不了
  tsdown 的 `build:done`，它的 `build` 脚本就是一行 `pnpm exec dshdev manifest`——与钩子共用同一份写回
  实现，口径不会两处漂移。
- **固定面按文件存在性补**：`./package.json` 一律在；`./cordis.patch.yml` 有该文件才有；`./locale/*.json`
  有 `locale/en.json` 才有。守卫见
  `devpackages/tsdown-plugin-cordis/src/__tests__/publish-exports.spec.ts`（发布态的键集合必须覆盖顶层的键集合——
  `publishConfig.exports` 是**整体替换**顶层 `exports`，漏一个键就是发布包少一个面，
  `@morlay/dsh-desktop-host` 的 `./package.json` 就这样丢过：
  `import.meta.resolve("<包名>/package.json")` 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，桌面打包整个起不来）。
- **插件清单的文案走 `./locale/*.json`**：每个发布包带 `locale/en.json`（基准，缺它别的语言不会被扫）与
  `locale/zh.json`，内容形如 `{ "meta": { "title": …, "description": … } }`；`files` 里要带上，出口由上面
  的生成器按 `locale/en.json` 是否存在补。上游 `app-boot` 的 `readPluginMeta` 按包名 + 该出口读插件
  清单页的标题与描述，缺了它就退化成 package.json 的英文 name/description。跨包守卫见
  `dshdev check-locale`（直接用上游读取器实测每个 `dsh.bundle` 的包）。
- **插件清单的图标走 manifest 顶层的 `icon`**：相对包根的一个文件（如 `./icon.svg`），`files` 里要带上——
  漏了它装出来的包没图标，而本仓库开发态看不出来。上游 `app-boot` 的 `readPluginMeta` 把它读成 `data:` URI
  （绝对路径 / URL / `data:` 一律拒绝），清单页的卡片与行按它渲染，读不到就静默退回默认 artwork。
  图按上游 artwork 的 36×36 排面画（`viewBox="0 0 36 36"`、透明底自绘形、无文字），本仓库的 bundle 个个都有；
  跨包守卫见 `devpackages/devkit/src/__tests__/plugin-icon.spec.ts`。

## 日志

**一个出口一处名字**：名字交给日志出口（`ctx.logger(name)` / `logOf(scope)`），消息里**不自己拼** `[xxx]`
前缀——否则 exporter / 收日志的人拿不到结构化字段，只能从文本里再剥一遍。级别按用途分，别一律 `log`：

| 在哪                                                                         | 出口                                                                                                                                            | 怎么写                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cordis 树内的运行时插件（`packages/**` 的行、宿主）                          | `ctx.logger`（名字默认是 fiber 名，也可 `ctx.logger("federation")`）                                                                            | 失败 `warn`/`error`；里程碑 `info`；**细节（逐包、逐请求）`debug` 且由调用侧开关**（`DSH_TRACE=1`，见 `packages/client/dsh-client-modules/src/trace.ts`）——运行时的日志门槛不由我们定（loader 注册的 exporter 允许 DEBUG），所以"要不要打"由调用侧判断 |
| 壳（Electron 主进程，**没有 cordis 树**）                                    | 壳自己的 [`shellLog`](../../packages/desktop/dsh-desktop-shell/src/index.ts)（落 `$DSH_HOME/logs/shell.log`）与 `shellError`（再加一行 stderr） | 启动面与失败；dev 形态的逐请求日志用 `void shellLog(...)`（落盘，别 await 在请求路径上）                                                                                                                                                               |
| CLI 工具（`dshdev`、`dts-prepare`、`typert-generator`…，**没有 cordis 树**） | `logOf(scope)`（`@local/devkit/log`）                                                                                                           | `log.info` 进度与结果、`log.fail` 失败；scope 按子命令（`dshdev seed`、`dshdev bundle`）                                                                                                                                                               |
| 注入到页面 / preload 的脚本（浏览器里跑）                                    | `console`（页面没有 cordis 树）                                                                                                                 | 原样保留，并在代码里写明理由                                                                                                                                                                                                                           |
| 构建期插件（tsdown 插件等，面向构建者）                                      | `console`                                                                                                                                       | 同上                                                                                                                                                                                                                                                   |

**键名与值**：键名用 `.` 分层、**不带空格**（`seed.bundles`、`app.name`）；值别拼进文本——拼成
`key=value` 之后 exporter 只能从字符串里再剥一遍。落到各出口：

- **cordis（`ctx.logger`）没有"每次调用带 meta"**：`meta` 是 **logger 实例级**的（service 建 logger 时塞的是
  `{ fiber }`）。结构化字段因此走**参数**：`logger.debug("transport ready %o", { webServer, streamRoute })`
  （`%o` 是 `JSON.stringify`），`args` 里就是结构。
- **我们自己的出口**能直接收 meta：`logOf(scope).info("…", { "seed.bundles": n })`（尾部挂 JSON）、
  `shellLog` 目前只收一行文本（壳里那几条是"一句话"，够用）。
- 细节类（逐包、逐请求）走 `debug` + 调用侧开关（`DSH_TRACE=1`），它们的值同样走参数，不拼文本。

跨包守卫：`dshdev check-deps` 扫运行时 import；日志风格靠 review——新增日志时对照上表，别新开一个出口。

## 代码约定

- **类型安全**：`strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
  （`devpackages/devkit/tsconfig.json`）。跨边界 id 使用 branded 类型（如 `SessionId`），不做裸
  `string`。**类型检查由 `just lint` 承担**（oxlint 的 `typeAware` + `typeCheck`，后端
  `oxlint-tsgolint`）——本仓库没有独立的 `tsc` 步骤，类型报错就是 lint 报错。
- **host / client 是两个 compiler face，各自成 program**：形状是**上游那条规矩**——solution 根 + face 叶
  （"face-specific leaf configs + a solution-only root"）：根 `tsconfig.json` 只写 `files: []` 与
  `references`（`tsconfig.host.json` / `tsconfig.client.json`），自己不装 program。为什么非这样不可 +
  为什么下面几条边界是硬的，都有实测依据：
  - 上游对同一份合并接口（`Context` / `Events`）在两个 face 各声明一次（如 `Context.sessions`：宿主面
    `SessionStore`、client 面 `ISessions`）。塞进同一个 program 时后绑定的那份把先绑定的挤掉（`TS2717`
    报在 vendor 侧、被 lint 的 ignorePatterns 吞掉），看见的是 `TS2339: Property 'get'/'flush' does not
    exist on type 'ISessions'`、`TS2554: Expected 0-1 arguments, but got 2`（`sessions.create(id, opts)`）
    这一批——宿主面**不许 import client 面**，别让它们进同一个 program。
  - **client 面的文件按目录分家**：`**/src/client/**` 归 client 叶；client 面的测试住
    `src/client/__tests__/`（与它测的那半同目录，跟宿主面的 `src/__tests__/` 分开），不要用文件名后缀或
    额外的就近 `tsconfig.json` 去表达 face。新开一个 client 半目录什么都不用加：client 叶的
    `include` 认的是 `packages/*/*/src/client/**/*` 这个目录形状。
  - **跨包、跨面的依赖走 export 路径**（`@morlay/<包>`、`@morlay/<包>/client`、`./testing`），
    相对路径只在同包同面内用（本地相对 import 带 `.ts`）。外部测试要用的内部件先开出口再引
    （测试辅助走 `./testing`；client 面的组件/算法走 `/client`）。
  - 两叶 `composite`（devkit 的 base 给的）是 references 的前提，也带来两条硬约束：被引用的项目不许
    disable emit（所以宿主叶 `noEmit: false` + `emitDeclarationOnly`，声明落进 gitignore 的
    `.tmp/tsc-host`，只给 `tsc -b` 的类型图用）；program 里的文件必须都在自己或引用项目的 `include` 里
    （TS6307）——上面两条边界就是为它服务的。跨项目 import 还要关掉 `rewriteRelativeImportExtensions`
    （否则 `TS2878`），上游两片 aggregate 同样关着。
  - 门仍是 `just lint`：oxlint 的 typeCheck 按文件就近发现 tsconfig、再按 references 解析到叶。`tsc -b`
    （或 `tsc -p` 两份叶）能把两片都过一遍，本仓文件 0 条，但会带 vendor 侧既有的 TS6307 之类的噪音。
  - 构建（dts）**不走 tsconfig 文件**：全仓声明由 `@local/devkit` 的 `generateWorkspaceDts` 按两个 face 各扫
    一次生成到 `target/dts`（`noCheck`，只要声明不要诊断），各包再由 `emitDts` 按路径取自己的那份合并——
    每包一份类型图是 tsdown 默认路径的主要成本（实测单包 dts 4.8s、占该包构建 82%）。配置由 devkit 生成到
    `.tmp/`，仓库里不再有第三份 tsconfig。
- **`node/no-sync` 全开、无豁免**：运行时代码、测试与脚本（含 `.agents/skills/` 的同步 / patch / build
  脚本）一律用异步 node API（`node:fs/promises`、`promisify(execFile)`、`spawn` + Promise 包装），
  不用 `*Sync` 变体。`node:sqlite` 的 `DatabaseSync` 与 better-sqlite3 的同步用法是该驱动的语义、
  不是本规则目标。
- 文件以单个换行结尾。
- **注释不做设计说明**（判据）：只写「这段在做什么 / 有什么约束」，不写为什么这样设计、不写取舍与沿革（那是
  `.agents/` 记录的 home，注释里最多一行指过去）。
- **不用 JSDoc**：注释一律 `//`，不写 `/** … */`，也不用 `@param` / `@returns` / `@throws` / `{@link}` 这类标签
  （签名自解释的参数说明直接不要；有信息量的并进首行）。
  **例外——薄壳 fork 的保留文件随上游**：`packages/subagent/dsh-subagent/src/{index,continuation,continuation-messages}.ts`
  与 `vendor/` 逐行比对（`src/__tests__/upstream-wiring.spec.ts`），注释保持上游形态，不按本条清理。
- 生成物的注释由生成器给出（`gen-design-tokens.mts`、`gen-official-packages.ts`）：要改注释就改那里的模板。
