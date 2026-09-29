# @morlay/sandbox-profile

可配置沙箱与审批的运行时策略面：禁官方 `sandbox` / `fs-sandbox` 两行、插入替换行，并在**同一个 bundle 里**给出访问
规则的值。替换行同时接管模型看到的运行时快照（`sandbox:policy` / `approval:policy`）。

| 装什么                                 | 数据从哪来                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `ui-primitives-fork`（共享 client 行） | 每个 client bundle 各插一次：同 id 重复插入是幂等的（Loader 复用同一 Entry，后者胜） |
| 禁官方两行 + 插 `sandbox-local`        | [`@morlay/dsh-sandbox-local/rows`](../../sandbox/dsh-sandbox-local/src/rows.ts)      |
| `sandbox-local` 的 `access` 值         | 本包的 `tsdown.config.ts`                                                            |

行的语义（`rw` / `r-` / `--`）与两条运行时快照的接管在[能力包的 README](../../sandbox/dsh-sandbox-local/README.md)。
