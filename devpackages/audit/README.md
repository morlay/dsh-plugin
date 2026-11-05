# @local/audit

结构性判据：面边界、上游包唯一化、声明未用、扩展边界、类型纪律（契约面值边 / 双断言白名单）。逐包跑、根上汇总。

## 用法

| 命令                 | 作用                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `just audit`         | 跑全部判据；任一判据**超出基线**（或 0 容忍判据有违规）就让命令 exit 1 |
| `just audit --write` | 同上，并把「声明未用」的依赖从各包 `package.json` 删掉                 |

逐包扫描在 `src/package-audit.ts`（每包输出一行 JSON），判据口径与白名单在 `src/rules.ts`，汇总与
判定在 `src/summarize.ts`。**判据口径只改 `rules.ts`**，别在别处再写一份。

## 类型纪律的两条判据

| 判据                  | 口径                                                                                                                                      | 白名单                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 契约 / 端点面上游值边 | `src/{contract,endpoint}/**` 对 `@deepseek-ai/<包根>` 的**值边**（`import` 与再导出都算；`import type` / `export type` 不算；子路径不算） | `CONTRACT_VALUE_EDGE_ALLOWLIST`（空：一条都不放行）                        |
| 双断言白名单          | 生产代码里的 `as unknown as` 只许出现在边界桥；测试（`__tests__`）不受限                                                                  | `BRIDGES`：装配入口（cordis Context）、cordis 兼容桥、rdb 行映射（SQL 行） |

白名单的判据是「**桥的另一头是什么外部形状**」，不是「这个文件里断言多」：域内断言（例如
`better-session/src/rdb/log/repair.ts`）不进白名单。要放宽先改 `rules.ts`，再同步
`src/__tests__/rules.spec.ts`。

## 基线是过渡

两条判据的存量是**已接受的债**，0 容忍会把 `just audit` 长期弄红、判据就没人看了。所以它们先记基线、
**只挡增量**（基线常量在 `rules.ts` 的 `TYPE_DISCIPLINE_BASELINE`）：

| 当前数 vs 基线 | 结果                                                        |
| -------------- | ----------------------------------------------------------- |
| 超出           | exit 1，打印「超出基线 N 达 M 条」与逐条明细                |
| 等于           | exit 0，打印当前数与基线（记基线当时：值边 56、双断言 172） |
| 低于           | exit 0，打印当前数并提示「可以下调基线到 N」                |

**删基线的判据**：`just audit` 打印的当前数降到 **0**（T5 清完契约面值边、T4 清完白名单外的双断言）后，
删掉 `TYPE_DISCIPLINE_BASELINE` 的两条常量与 `summarize.ts` 的 `reportAgainstBaseline`，这两条判据
改回 `report()` 的 **0 容忍**。收敛过程中基线值跟着实际数**逐档下调**，不要一次留大。

## 验证

```sh
pnpm exec vitest run devpackages/audit
pnpm exec oxlint devpackages/audit
pnpm exec oxfmt --check devpackages/audit
```
