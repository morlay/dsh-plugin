# 如何验证

「验证过」= 有**最小充分**的证据，并且贴出真实输出。命令入口在根 [`justfile`](../../justfile)
（`just --list`），版本见 [`mise.toml`](../../mise.toml)。

## 证据矩阵

按改动落在哪选证据，够用就好——不要反射式跑全量：

| 改动                        | 至少跑                                                                                                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单包源码                    | 该行为对应的测试（全量 `just test`；要只跑一处就 `pnpm exec vitest run <包路径>`，接缝见该包 `.agents/standards/`）                                                                                                                                         |
| 跨包契约 / 公共类型面       | 涉及包的测试，加全量 `just test`                                                                                                                                                                                                                            |
| 测试 / 构建配置、依赖       | 全量 `just test`                                                                                                                                                                                                                                            |
| 浏览器 e2e（页面渲染 / 行装载） | 真浏览器走一遍：[`how-to-e2e.md`](./how-to-e2e.md) 的判据（title、`#root` 有内容、关键服务就绪、无 `pageerror`） |
| 浏览器半（client bundle）   | 相关 happy-dom 用例 + `just build`；产物里 `window.__ModuleLoader__.load` 只应出现一次（内联了别的 client 行，页面就会注册两次并抛 `duplicate factory registration`）；**内联库**（清单标 `dsh.client.inline`）是设计不是重复注册——它只内联库代码、不带工厂外壳 |
| 包出口、构建路径            | `just build`                                                                                                                                                                                                                                                |
| 文档与记录                  | 相对链接可达、无悬挂引用                                                                                                                                                                                                                                    |
| vendor 上游（同步 / patch） | 全量 `just test` + `just lint` + `just build`                                                                                                                                                                                                               |

## 测试落点

- 位置：各包 `src/__tests__/`（vitest include `packages/**` 与 `devpackages/**` 下的
  `src/__tests__/**/*.spec.ts(x)`，exclude `node_modules` 与 `target`）；共享辅助放该包
  `src/testing/`，经 `./testing` 出口暴露。共享工具链 `devpackages/devkit` 同形——它没有
  自己的构建链，被测的构建行为（如 `bundleClientFactory` 的现场打包）就写在它的 spec 里。
- 浏览器半测试用文件头 `// @vitest-environment happy-dom`（vitest 未开 globals，
  `@testing-library/react` 需在 spec 里显式 `cleanup`）。
- **单测等待上限 3s**：`vitest.config.ts` 的 `testTimeout`，以及 zephyr 行运行时的等待上限都是 3s；超时即失败并暴露原因，不把失败拖成默认 5s 超时。
- **测试描述行为，不描述实现**：行为变更必须连同测试一起改。
- **按功能利用组织**：只经公开使用面描述功能（provider 的 `search()` / `available()`、Module 装配行为），
  不直测内部映射函数；配置 schema / volatile 引用这类解析不单独测；不新增 e2e（不联网）。
- **装配测试用我们自己的框架**：`bootstrapApplication` + 我们的 Provider，不起官方 loader / 不直接
  `new Context()` 装上游插件。
- **纯装配不写测试**：bundle 只组合 Provider / 覆盖 config 时，生成物由 patch 生成与校验覆盖，不另写 spec。
- **包特有的环境门控、装配辅助与判据在该包 `.agents/standards/`**：需要外部环境或平台的用例
  （数据库连接串、OS 能力）由该包写明触发方式与跳过条件，这里不复述——门控要有明确原因，
  不静默跳过、不为过验收放宽。

## 交付与发布

- **发布走 CI**：`.github/workflows/release.yml`（`main` 与 `next` 分支：`prepare`（sync → patch → dep → prebuild）→
  `build` → `lint` → `test`（注入外部服务门控所需的环境变量）→ `build` → GitHub Packages publish）。
- **dist-tag 随版本号走**（[`dshdev publish`](../../devpackages/dshdev/src/cli/publish.ts)）：稳定版 →
  `latest`；`-alpha.*` → `alpha`；其余预发布（rc / beta / …）→ `next`。预发布绝不落在 `latest`。
- **本地私有包统一 `@local/*` 前缀，既不发布、也不进发布清单**：构建时一律内联进产物
  （规则 [`isLocalPackage`](../../devpackages/tsdown-plugin-cordis/src/cordis-host.ts)，devkit 预设与
  `dshdev` 的 tsdown 配置共用）；内联后运行时真要的第三方依赖按公开包声明在
  `dependencies`，否则消费方解析不到它们的原生二进制。
- **严禁本地私自 `pnpm publish`**（包括用 `--registry` 指向 GitHub Packages 的发布）。版本 bump
  提交后由 CI 发布；本地只构建验证。
- **bump 前确认该版本号没被占用**：CI 的 `publish-if-need` 见到版本已存在就**静默 skip**，撞上旧仓库
  （`better-session`）或历史预发布占用的号，表现是「bump 提交了，新构建却永远发不出去」，而消费方
  按新 API 构建就会 `failed to import`。改版本前先 `pnpm view <pkg>@<新版本> version` 确认，或直接
  跳到未被占用的号段。
- 改动收尾时 `just lint` 只要不引入**新**错误即可，必要时 `just fmt`。
- **调试探针当轮删掉**：页面里的 `console.debug` 观测、入口里的验证调用、只为这次验证加的临时代码，
  **改动完成即删除**；需要长期保留的观测按级别收进 logger。判据是 `git diff` 里不出现「只为这一次验证」的代码
  ——用测试覆盖逻辑，不要用探针。
- **日常验证不要跑 `verify-session-mode.mts` / `just pg test` 这类起真实服务的探针**：
  它们绑端口、装依赖，会被机器上别的进程（残留的 dev server、另一个探针）阻塞住，卡住的是验证本身而不是被测
  代码。装配链的回归用不起服务的证据覆盖——生成物断言、`composeLayers` 式的层组合断言、以及各包的行为用例；
  那两支探针（`node --import @oxc-node/core/register
  packages/desktop/dsh-desktop-host/tool/<探针>.mts`）只在人工排查"真装配下才看得见的事实"时手动跑。

## 失败怎么处理

- 相关检查失败就停下修掉，或说明阻塞点；不要推着「CI 可能会过」往下走。
- 看起来像环境问题的，先证明：记下确切命令、失败用例、平台差异，再判断是环境还是回归。
- 不要为了过验收放宽检查（降低阈值、跳过用例、缩小覆盖范围），也不要改断言来迁就实现。
