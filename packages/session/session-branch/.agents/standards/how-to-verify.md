# 如何验证（契约投影）

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的契约投影接缝与守护 spec。

## 接缝与守护 spec（`src/__tests__/`）

- **`balanceRewindPrefix`**（[`src/balance.ts`](../../src/balance.ts)）——含 step 配平自愈与 `keepOpenTail`
  口径：`balance.spec.ts`。

判据是**投影不变量**（保留前缀在 rewind、未闭合轮次、配平修复下的形状），不是实现细节。

## 未覆盖（有明确原因）

- **`rewindKeepLength`**（尾部窗口的配对修剪，`src/balance.ts`）在本包没有直接用例：它只在 rewind 的读
  窗口上调用，判据是「截断后的日志能继续 append」，由实现方的 rewind 接缝（`@morlay/session-rdb` 的
  `branch.spec.ts`）覆盖。
- **`session-branch/version` 的历史形状**（`src/types.ts` 的 `SessionBranchVersionEvent` 等）没有守护
  spec：它只用于识别旧数据里已落库的事件，本仓库当前没有生产方与消费者
  （[ADR-删除版本树投影并停止写版本效果](../adrs/20260920-删除版本树投影并停止写版本效果.md)）。
- **`src/branch.ts` 的抽象服务面与 `src/provider.ts` 的类型面**由实现方覆盖，本包不重复。
