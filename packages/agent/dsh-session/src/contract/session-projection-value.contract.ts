// 投影**值**的词汇（上游 `@deepseek-ai/dsh-session-projection`）：检查点、快照与键选择。
//
// 与 `session-projection-store.contract.ts` 的分界：那里是**端口**（注册表服务），这里是它折出来的**数据**。
export type {
  ProjectionCheckpoint,
  ProjectionCheckpointRow,
  ProjectionKeySelection,
  ProjectionSnapshot,
  SessionProjectionMap,
} from "@deepseek-ai/dsh-session-projection";
