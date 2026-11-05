# 如何验证（本包）

本包是构建期工具：没有运行期产物，判据也都不需要起服务。通用证据矩阵见
[仓库根的 how-to-verify](../../../../.agents/standards/how-to-verify.md)，这里只写本包的接缝与命令。

## 判据

| 命令                                                             | 判什么                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm exec vitest run devpackages/tsdown-plugin-cordis`          | 7 个 spec / 28 例全绿（清单写回、client 打包、样式与资产、依赖分流） |
| `pnpm exec oxlint devpackages/tsdown-plugin-cordis`              | 规则与类型（仓库根 `.oxlintrc.json` 的 `typeAware` + `typeCheck`）   |
| `pnpm exec oxfmt --check devpackages/tsdown-plugin-cordis`       | 格式                                                                 |
| `pnpm install --lockfile-only` 后看 `pnpm-lock.yaml` 的 importer | 改过 `package.json` 时 lock 认识新依赖                               |

从仓库根跑（测试里有 `process.chdir` 的用例，cwd 由 vitest 的 fork 隔离）。

## 接缝

- **清单写回**（`src/package-exports.ts`）：`packageExportsHook` 吃的是 tsdown 的 `build:done`
  上下文，用例用假 ctx（`{ chunks, options: { outDir } }`）直接喂两轮产物，不跑真构建。判据落在
  `src/__tests__/package-exports.spec.ts`——**产物齐没齐**是它唯一的分支，多格式那两轮的顺序由它覆盖。
- **配置合成**（`src/cordis-host.ts`）：`buildCordisConfig` 在临时目录里跑（写一份最小
  `package.json` + `src/index.ts`），断言产物配置的字段，不跑 tsdown。
- **client 打包**（`src/cordis-client.ts`）：真跑 rolldown，产物在 js 运行时里执行一遍再看注入的
  `<style>` 与 class 映射（`// @vitest-environment happy-dom`；本仓没有 jsdom）。
- **样式与资产**（`src/css.ts` / `src/assets.ts`）：`url()` 的处理用 `@supports` 内层 + `mask` 简写
  的样式文本钉住（正则最容易漏的形状）；资产两条策略各一条用例。
- **与上游名单对齐**（`src/__tests__/client-inline-safe.spec.ts`）：直接读
  `vendor/deepseek-harness/packages/client/tsdown.client.ts` 的 `INLINE_SAFE` 逐项比对。路径按文件位置
  解析，不依赖 cwd；**上游换形状时这条会红**，那是信号，不是噪声。

## 不许

- 不为过验收放宽断言（跳过用例、缩覆盖、改断言迁就实现）。`package-exports` 那条「产物没齐就不写」的
  用例删掉，等于把「清单写一半」放回来。
- 不在用例里手写一份"期望的清单"再喂回生成器：断言对着**行为**（产物齐了写什么、不齐写不写），不对着实现。
