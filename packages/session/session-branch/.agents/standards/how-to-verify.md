# 如何验证（契约投影）

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的契约投影接缝与守护 spec。

## 接缝与守护 spec（`src/__tests__/`）

- **`balanceRewindPrefix`**（`balance.ts`）——含 step 配平自愈与 `keepOpenTail` 口径：
  `balance.spec.ts`。

判据是**投影不变量**（保留前缀在 rewind、未闭合轮次、配平修复下的形状），不是实现细节。

## 已删除的面

版本树投影（`buildTimeline` / `timeline.spec.ts`）与版本效果事件一起删除，理由见
[ADR-删除版本树投影并停止写版本效果](../adrs/20260920-删除版本树投影并停止写版本效果.md)：
`session-branch/version` 的历史形状仍留在 `types.ts`（识别旧数据），但没有新事件、也没有读者。
将来重建版本导航时按那条 ADR 的后果段走。
