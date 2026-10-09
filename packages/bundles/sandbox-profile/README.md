# @morlay/sandbox-profile

[![NPM Version](https://img.shields.io/npm/v/%2540morlay%252Fsandbox-profile)](https://www.npmjs.com/package/@morlay/sandbox-profile)
[![NPM Downloads](https://img.shields.io/npm/dw/%40morlay%2Fsandbox-profile)](https://www.npmjs.com/package/@morlay/sandbox-profile)
[![NPM Downloads (18 months)](https://img.shields.io/npm/d18m/%2540morlay%252Fsandbox-profile)](https://www.npmjs.com/package/@morlay/sandbox-profile)

可配置沙箱与审批的运行时策略面：禁官方 `sandbox` / `fs-sandbox` 两行、插入替换行，并在**同一个 bundle 里**给出访问
规则的值。替换行同时接管模型看到的运行时快照（`sandbox:policy` / `approval:policy`）。

| 装什么                          | 数据从哪来                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------- |
| 禁官方两行 + 插 `sandbox-local` | [`@morlay/dsh-sandbox-local/rows`](../../sandbox/dsh-sandbox-local/src/rows.ts) |
| `sandbox-local` 的 `access` 值  | 本包的 `tsdown.config.ts`                                                       |

基础面（`@morlay/dsh-client-ui-primitives`）随用到它的 client 行内联，本包不插这一行。

行的语义（`rw` / `r-` / `--`）与两条运行时快照的接管在[能力包的 README](../../sandbox/dsh-sandbox-local/README.md)。
