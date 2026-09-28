# @morlay/sandbox-profile

可配置沙箱：禁官方 `sandbox` / `fs-sandbox` 两行、插入替换行，并在**同一个 bundle 里**给出访问规则的值。

| 装什么                          | 数据从哪来                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------- |
| 禁官方两行 + 插 `sandbox-local` | [`@morlay/dsh-sandbox-local/rows`](../../sandbox/dsh-sandbox-local/src/rows.ts) |
| `sandbox-local` 的 `access` 值  | 本包的 `tsdown.config.ts`                                                       |

行的语义（`rw` / `r-` / `--`）在[能力包的 README](../../sandbox/dsh-sandbox-local/README.md)。
