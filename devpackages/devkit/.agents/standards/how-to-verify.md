# 如何验证（devkit）

devkit 是构建期与审计工具的合体：没有运行期产物，判据都不需要起服务。通用证据矩阵见
[仓库根的 how-to-verify](../../../../.agents/standards/how-to-verify.md)，这里只写本包的接缝与命令。

## 判据

| 命令                                                             | 判什么                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm exec vitest run devpackages/devkit`                        | 构建侧 8 个 spec + 审计侧规则用例全绿                              |
| `pnpm exec devkit audit`                                         | 逐包判据 + 根上汇总（与 `just audit` 同一条命令）                  |
| `pnpm exec devkit build --filter <包>`                           | 单包构建与清单写回（与 `just build` 同一条命令）                   |
| `pnpm exec oxlint devpackages/devkit`                            | 规则与类型（仓库根 `.oxlintrc.json` 的 `typeAware` + `typeCheck`） |
| `pnpm exec oxfmt --check devpackages/devkit`                     | 格式                                                               |
| `pnpm install --lockfile-only` 后看 `pnpm-lock.yaml` 的 importer | 改过 `package.json` 时 lock 认识新依赖                             |

从仓库根跑（测试里有 `process.chdir` 的用例，cwd 由 vitest 的 fork 隔离）。

## 接缝

- **清单写回**（`src/build/package-exports.ts`）：`packageExportsHook` 吃的是 tsdown 的 `build:done`
  上下文，用例用假 ctx（`{ chunks, options: { outDir } }`）直接喂两轮产物，不跑真构建。判据落在
  `src/build/__tests__/package-exports.spec.ts`——**产物齐没齐**是它唯一的分支，多格式那两轮的顺序由它覆盖。
- **配置合成**（`src/build/cordis-host.ts`）：`buildCordisConfig` 在临时目录里跑（写一份最小
  `package.json` + `src/index.ts`），断言产物配置的字段，不跑 tsdown。
- **client 打包**（`src/build/cordis-client.ts`）：真跑 rolldown，产物在 js 运行时里执行一遍再看注入的
  `<style>` 与 class 映射（`// @vitest-environment happy-dom`；本仓没有 jsdom）。
- **样式与资产**（`src/build/css.ts` / `src/build/assets.ts`）：`url()` 的处理用 `@supports` 内层 + `mask` 简写
  的样式文本钉住（正则最容易漏的形状）；资产两条策略各一条用例。
- **转译器注入的 helper**（`src/build/compile.ts` 的 `INJECTED_RUNTIME` / `hostBuildOptions`）：真跑一次
  rolldown 打一份带 legacy 装饰器的 fixture，再用**干净环境的 node 子进程**加载产物。两处坑：fixture 得自带
  `tsconfig.json`（legacy 开关只在 tsconfig 里，`target/**` 被根 tsconfig 排除，别在那儿建）；子进程不能继承
  vitest 的 `NODE_PATH`（指进 `.pnpm/node_modules`，那份 `@oxc-project/runtime` 会让「装不到」判不出来）与
  `NODE_OPTIONS`。对照组（同一注入被外置）必须报 `Cannot find package`——它是上面那条的分母，删了等于没判。
- **审计规则**（`src/audit/rules.ts`）：面边界、声明未用、上游包唯一化、扩展边界各一组用例；汇总器对空输入退出 1。
- **与上游名单对齐**（`src/build/__tests__/client-inline-safe.spec.ts`）：直接读
  `vendor/deepseek-harness/packages/client/tsdown.client.ts` 的 `INLINE_SAFE` 逐项比对。路径按文件位置
  解析，不依赖 cwd；**上游换形状时这条会红**，那是信号，不是噪声。

## 不许

- 不为过验收放宽断言（跳过用例、缩覆盖、改断言迁就实现）。`package-exports` 那条「产物没齐就不写」的
  用例删掉，等于把「清单写一半」放回来。
- 不在用例里手写一份"期望的清单"再喂回生成器：断言对着**行为**（产物齐了写什么、不齐写不写），不对着实现。
