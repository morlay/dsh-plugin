# @local/devkit

构建期与审计工具：`devkit build` 管 cordis 插件包的打包与发布态清单，`devkit audit` 管结构性判据。只在构建期与 CI 跑，发布物里没有它。

## 用法

```sh
pnpm exec devkit build [--filter <包>]   # 从包的 exports 推导入口，rolldown 打 host 面并写回清单
pnpm exec devkit audit [--write]         # 逐包判据 + 根上汇总；--write 删未用依赖
```

`justfile` 的 `just build` / `just audit` 是它们的薄包装；命令口径见[设计 构建与审计](./.agents/designs/20261118-构建与审计.md)。

入口约定：`exports` 就是构建计划——`.` 对应 `src/index.ts`，`./x` 对应 `src/x.ts` 或 `src/x/index.ts`；
`./dsh-bundle` 只进发布态清单；`./client` 走 client 打包，不在 host 构建里。

## 出口

| 出口      | 是什么                                                                    |
| --------- | ------------------------------------------------------------------------- |
| `.`       | 门面：类型与常量                                                          |
| `./build` | `buildPackage` / `planOf` / `writeBuildManifest` / `writePackageManifest` |
| `./audit` | 判据规则与汇总器                                                          |

## 构建面

- **构建**：rolldown 打 ESM，依赖外置、`@local/*` 内联；CSS/资产内联，ui 面可直接被消费。
- **声明在构建里**：全仓声明树由 `dts-prepare` 的目录锁在 `devkit build` 内生成一次（多包并行也只生成一次，
  其余等锁），随后按入口聚合成 `dist/<入口>.d.mts`；`just dts` 只是手动重建入口。
- **清单写回**：顶层 `exports` 以现有清单为底、按入口更新（保留手写面）；`publishConfig.exports` 与 `engines.dsh` 只对 `private: false` 的包写。
- **bundle**：含 `./dsh-bundle`（源 `src/dsh-bundle.ts`）的包生成 **`dist/cordis.patch.yml`**，清单写 `dsh.bundle.patch = "./dist/cordis.patch.yml"`，并在 `publishConfig.exports` 里加 `./cordis.patch.yml` → `./dist/cordis.patch.yml`（顶层 `exports` 不加这条）；行清单声明在 `dsh-bundle.ts` 的 `rows`。

## 审计面

结构性判据：面边界、上游包唯一化、声明未用、扩展边界、类型纪律（契约面值边 / 双断言白名单）。逐包跑、根上汇总；**空输入退出 1**，不让判据假绿。

| 命令                   | 作用                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `devkit audit`         | 跑全部判据；任一判据**超出基线**（或 0 容忍判据有违规）就让命令 exit 1 |
| `devkit audit --write` | 同上，并把「声明未用」的依赖从各包 `package.json` 删掉                 |

判据口径与白名单在 `src/audit/rules.ts`，逐包扫描在 `src/audit/package-audit.ts`，汇总在 `src/audit/summarize.ts`；**判据口径只改 `rules.ts`**。基线是过渡：存量记基线、只挡增量，降到 0 后删基线常量。

## 验证

```sh
pnpm exec vitest run devpackages/devkit
pnpm exec devkit audit
pnpm exec oxlint devpackages/devkit
pnpm exec oxfmt --check devpackages/devkit
```

判据与接缝见[如何验证](./.agents/standards/how-to-verify.md)。
