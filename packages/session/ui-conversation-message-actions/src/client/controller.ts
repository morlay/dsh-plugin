import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session";
import {
  SESSION_EDITOR_PATH,
  type EditableMessageBlock,
  type SessionEditorOperation,
  type VersionOperation,
} from "../shared.ts";

/** 编辑器的 HTTP 路径：宿主（web 与桌面）在同一张路由表上服务它，页面不再按 ownsHost 加前缀。 */
const EDITOR_API_PATH = SESSION_EDITOR_PATH;

/**
 * 会话编辑的浏览器半门面：只保留消息渲染面真正用到的两个动作。
 *
 * 曾经这里还有一条「订阅会话列表 / 快照 → 拉全量 timeline → 装进 store」的刷新管路，
 * 它没有任何 UI 消费方，却把重放 / 流式期间的每一次快照抖动都换成一次全量 GET
 * （编辑 / 重试 / 撤回后尤甚），订阅本身也从不释放。现在动作成功后只刷新会话列表元数据，
 * 会话窗口交给上游的事件流收敛（不重建窗口、不整页重载）。
 */
export interface SessionEditorFace {
  // 属性式函数类型而非方法签名：这两动作要被渲染面解构后直接调用，没有 `this` 可言。
  retry: (turn: number, cascade: "truncate" | "preserve") => Promise<boolean>;

  // 撤回回填：文本由调用方（消息渲染面）给出**该消息的全部文本块**——不再靠 timeline 反查。
  recall: (message: EditableMessageBlock, texts: readonly string[]) => Promise<boolean>;
}

export class SessionEditorController {
  readonly face: SessionEditorFace;

  private readonly sessions: ISessions;
  private pending: VersionOperation | "recall" | null = null;

  constructor(
    ctx: ClientContext,
    private readonly sessionId: SessionId,
  ) {
    this.sessions = ctx.get("sessions") as unknown as ISessions;
    this.face = {
      retry: (turn, cascade) =>
        this.mutate({ action: "retry", sessionId: this.sessionId, turn, cascade }),
      recall: (message, texts) => this.recallAndEdit(message, texts),
    };
  }

  private async recallAndEdit(
    message: EditableMessageBlock,
    texts: readonly string[],
  ): Promise<boolean> {
    const applied = await this.mutate(
      { action: "recall", sessionId: this.sessionId, eventSeq: message.eventSeq },
      () => this.setComposerDraft(texts.join("\n\n")),
    );
    if (applied) this.returnViewportToEnd();
    return applied;
  }

  private async mutate(
    operation: SessionEditorOperation,
    onApplied?: () => void,
  ): Promise<boolean> {
    if (this.pending !== null) return false;
    this.pending = operation.action;
    try {
      const response = await fetch(EDITOR_API_PATH, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(operation),
      });
      const value = (await response.json()) as unknown;
      if (!response.ok) {
        const error = (value as { error?: unknown })["error"];
        throw new Error(
          typeof error === "string" ? error : `请求失败：HTTP ${String(response.status)}`,
        );
      }

      onApplied?.();

      // 会话窗口必须重建：rewind 把日志 seq 回退了，窗口里已渲染的旧节点不会自己消失
      // （实测：被裁剪的消息残留、新消息也追加不进去）。重建入口只在**运行时**对象上
      // （ClientSession 的 `resync()`；类型面 `SessionFace` 并未暴露它），所以逐个探测；
      // 都拿不到时记一条 warn 便于诊断，且不回退整页重载（刷新会打断用户）。
      try {
        await this.rebuildWindow();
      } catch (error: unknown) {
        console.warn("[session-editor] 操作已生效，但会话窗口重建失败：", error);
      }
      return true;
    } catch {
      return false;
    } finally {
      this.pending = null;
    }
  }

  /**
   * 让上游重开该会话的历史窗口（rewind 之后客户端窗口的 seq 基线已经失效）。
   *
   * 探测顺序：`binding(id).session.resync()`（上游 ClientSession 的重建入口，类型面没暴露）
   * → `sessions.refresh()`（只刷列表元数据，聊胜于无）→ 都没有就记一条 warn。
   */
  private async rebuildWindow(): Promise<void> {
    const sessions = this.sessions as unknown as {
      binding?: (id: SessionId) => { session?: { resync?: () => Promise<void> } } | undefined;
      refresh?: () => Promise<void>;
    };
    const face = sessions.binding?.(this.sessionId)?.session;
    const resync = face?.resync;
    if (typeof resync === "function") {
      await resync.call(face);
      return;
    }
    if (typeof sessions.refresh === "function") {
      await sessions.refresh();
      return;
    }
    console.warn(
      "[session-editor] 未找到会话窗口重建入口（binding.resync / refresh 都不可用），窗口可能停留在 rewind 之前的状态",
    );
  }

  /**
   * 撤回后把会话视口送回底部：rewind 把窗口换短，而上游 ChatView 只在读者已经贴底时
   * 才跟随（`tipMoved && atBottom`），停在中途的视口会悬在被截断的位置上；撤回的下一步
   * 是改完再发，所以这里无条件送到底。容器用上游既有契约 `[data-conversation-scroll]`
   * （ChatView / ConversationWidthControls / StatsPills 同用）。
   *
   * 窗口替换的渲染落在 resync 之后：写早了会被下一轮布局覆盖，因此等两帧再写。
   */
  private returnViewportToEnd(): void {
    const scrollport = document.querySelector<HTMLElement>("[data-conversation-scroll]");
    if (scrollport === null) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollport.scrollTop = scrollport.scrollHeight;
      });
    });
  }

  private setComposerDraft(text: string): void {
    if (this.sessions.binding(this.sessionId) === undefined) return;
    const scoped = this.sessions.scope(this.sessionId);
    if (scoped === undefined) return;
    const conversation = scoped.get("conversation") as
      | {
          input?: {
            for(ctx: ClientContext): { restoreDraft(draft: string): void };
          };
        }
      | undefined;
    conversation?.input?.for(scoped).restoreDraft(text);
  }
}
