// 提交路径上的两个**形状转换**：上游组件给的是它自己的 `PromptContentPart[]` / `QueueAction`，
// 我们的端点契约是自声明的同形类型。这里逐字段校验并复制，不用断言。
import type { SessionPromptContentPart, SessionQueueAction } from "../endpoint/session-endpoint.ts";

/** 一段文本（`QueueAction` 的 `edit` 内容）。 */
interface TextBlockLike {
  readonly type: "text";
  readonly text: string;
}

/**
 * 把一个未知值收窄成文本块。
 * @param value - 上游给的内容段。
 * @returns 文本块或 `undefined`。
 */
function textBlockOf(value: unknown): TextBlockLike | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("type" in value) || value.type !== "text") return undefined;
  if (!("text" in value) || typeof value.text !== "string") return undefined;
  return { type: "text", text: value.text };
}

/**
 * 把上游的内容段收窄成契约里的 `SessionPromptContentPart`。
 * @param content - 上游组件传入的内容段。
 * @returns 契约形状的内容段。
 * @throws 遇到无法识别的段时（不静默丢弃内容）。
 */
export function promptContentOf(content: readonly unknown[]): readonly SessionPromptContentPart[] {
  return content.map((part) => {
    const text = textBlockOf(part);
    if (text !== undefined) return text;
    if (typeof part !== "object" || part === null || !("type" in part)) {
      throw new Error("[sessions] prompt 内容段缺少 type");
    }
    if (part.type === "image" && "mediaType" in part && "data" in part
      && typeof part.mediaType === "string" && typeof part.data === "string") {
      const mediaType = part.mediaType;
      if (mediaType !== "image/png" && mediaType !== "image/jpeg" && mediaType !== "image/webp" && mediaType !== "image/gif") {
        throw new Error(`[sessions] 不支持的图片类型 "${mediaType}"`);
      }
      return {
        type: "image",
        mediaType,
        data: part.data,
        ...("name" in part && typeof part.name === "string" ? { name: part.name } : {}),
      };
    }
    if (part.type === "file" && "receiptId" in part && typeof part.receiptId === "string") {
      return { type: "file", receiptId: part.receiptId };
    }
    throw new Error("[sessions] 无法识别的 prompt 内容段");
  });
}

/**
 * 把上游的队列动作收窄成契约里的 `SessionQueueAction`。
 * @param action - 上游组件传入的动作。
 * @returns 契约形状的动作。
 * @throws 遇到无法识别的动作时。
 */
export function queueActionOf(action: unknown): SessionQueueAction {
  if (typeof action !== "object" || action === null || !("kind" in action)) {
    throw new Error("[sessions] 队列动作缺少 kind");
  }
  switch (action.kind) {
    case "remove":
      return { kind: "remove" };
    case "steer":
      return { kind: "steer" };
    case "edit": {
      if (!("content" in action) || !Array.isArray(action.content)) {
        throw new Error("[sessions] edit 动作缺少 content");
      }
      const blocks = action.content.map((block) => {
        const text = textBlockOf(block);
        if (text === undefined) throw new Error("[sessions] edit 内容只支持文本块");
        return text;
      });
      return { kind: "edit", content: blocks };
    }
    default:
      throw new Error("[sessions] 无法识别的队列动作");
  }
}
