// `sessionListMetadata` 投影：会话列表要的两件事——**是不是空白**、**最后一次人类提问的时间**。
//
// 上游 `SessionQueryEngine` 在自己的 init 里注册这份定义（`@deepseek-ai/dsh-session-query` 的
// `list-metadata.ts`）。本包**替代**那条实现，所以这份定义由本包自己拥有：冷会话（落库但进程里没有
// 活实例）只读投影缓存，没有这份定义就拿不到 `blank`，上游 `summarizeCold` 会按
// `metadata?.blank ?? false` 兜成「非空」——于是没名字的空白会话全被列出来。
//
// 形状与上游逐字段一致（`stateVersion` 也保持 1）：已落库的投影检查点要能直接读。
import type { SessionEvent, SessionListMetadata } from "@morlay/dsh-session/contract";
import { z } from "zod";

const sessionListMetadataSchema: z.ZodType<SessionListMetadata> = z.object({
  blank: z.boolean(),
  lastPromptAt: z.number().nullable(),
});

/**
 * 折叠一条事件：`turn/start` 之后不再空白；人类发言（`user/message` 且 `source.kind === 'user'`）刷新时间。
 * @param state - 当前状态。
 * @param event - 一条会话事件。
 * @returns 新状态（没变化时返回原对象，投影据此跳过重算）。
 */
function applySessionListMetadata(
  state: SessionListMetadata,
  event: SessionEvent,
): SessionListMetadata {
  const blank = state.blank && event.type !== "turn/start";
  const lastPromptAt =
    event.type === "user/message" && event.data.source.kind === "user"
      ? event.time
      : state.lastPromptAt;
  return blank === state.blank && lastPromptAt === state.lastPromptAt
    ? state
    : { blank, lastPromptAt };
}

/** 会话列表元数据的投影定义（键与上游同名，检查点可直接读）。 */
export const sessionListMetadataDefinition = {
  key: "sessionListMetadata",
  stateSchema: sessionListMetadataSchema,
  init: (): SessionListMetadata => ({ blank: true, lastPromptAt: null }),
  apply: applySessionListMetadata,
  wire: { viewSchema: sessionListMetadataSchema, view: (state: SessionListMetadata) => state },
  stateVersion: 1,
} as const;
