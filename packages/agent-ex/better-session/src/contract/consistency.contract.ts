// 体检报告的共享形状：**最底层**（`contract/session-rdb-store.contract.ts` 的 `checkConsistency`
// 返回它，而 data 是它的下层）。体检的实现与口径在 `admin/consistency.ts`，这里只有形状。
export type ConsistencyIssueKind =
  // 用量行没有事件行（collectOrphans 会删的形态）。
  | "orphan-usage-row"
  // 会话的 token 合计比「按桥接行重算」少：旁路累加漏记。
  | "session-usage-missing"
  // 会话的四项计数合计比「按桥接行重算」少：旁路累加漏记。
  | "session-counts-missing"
  // 用量行的归属标记漏了：有桥接行（或子代理会话）指向它，但标记仍是 0。
  | "usage-flag-missing"
  // f_seed_length 大于日志长度：这份会话按继承前缀读不出来。
  | "seed-length-drift";

/** 一条不一致：subject 指会话 id 或事件 id，detail 给期望与实际的差。 */
export interface ConsistencyIssue {
  readonly kind: ConsistencyIssueKind;
  readonly subject: string;
  readonly detail: string;
}

/** 一次校验的报告：扫过多少行 + 发现哪些不一致；ok 只是 issues 为空。 */
export interface ConsistencyReport {
  readonly ok: boolean;
  readonly checked: {
    readonly sessions: number;
    readonly events: number;
    readonly bridges: number;
    readonly usageRows: number;
    readonly countRows: number;
  };
  readonly issues: readonly ConsistencyIssue[];
}
