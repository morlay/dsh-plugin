// 会话编辑的浏览器半状态：按会话懒建一个控制器，界面只拿它的那几个动作。
//
// 动作成功后只重建该会话的窗口（rewind 让客户端的 seq 基线失效），不整页重载；会话列表由宿主的事件流收敛。
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { Locale } from "@morlay/zephyr-app/client";
import type { EditableMessageBlock, SessionEditorFace } from "./session-editor.contract.ts";
import { SessionEditorEndpointClient } from "./session-editor-endpoint.client.ts";
import { NS, type SessionEditorTranslate } from "./locales.ts";

// 一次动作的在线结果：`ok` 是 wire 的结果封装，缺它按宿主给的原样值算成功（本地直连替身）。
interface WireOutcome {
  readonly ok?: boolean;
  readonly error?: { readonly message?: string };
}

// 字典面按结构使用（字典名只在本包注册）。
interface Dictionaries {
  bind(ns: string): SessionEditorTranslate;
}

@Injectable()
export class SessionEditorStore {
  private readonly endpoint = inject(SessionEditorEndpointClient);

  private readonly sessions = inject(SessionController);

  private readonly logger = inject(Logger);

  private readonly locale = inject(Locale) as unknown as Dictionaries;

  private readonly controllers = new Map<string, SessionEditorController>();

  faceOf(sessionId: string): SessionEditorFace {
    let controller = this.controllers.get(sessionId);
    if (controller === undefined) {
      controller = this.newController(sessionId);
      this.controllers.set(sessionId, controller);
    }
    return controller.face;
  }

  private newController(sessionId: string): SessionEditorController {
    return new SessionEditorController(
      this.endpoint,
      this.sessions,
      this.logger,
      this.locale.bind(NS),
      SessionId(sessionId),
    );
  }
}

class SessionEditorController {
  readonly face: SessionEditorFace;

  private pending = false;

  constructor(
    private readonly endpoint: SessionEditorEndpointClient,
    private readonly sessions: SessionController,
    private readonly logger: Logger,
    private readonly t: SessionEditorTranslate,
    private readonly sessionId: SessionId,
  ) {
    this.face = {
      retry: (turn, cascade) =>
        this.mutate(() => this.endpoint.retry({ sessionId, turn, cascade })),
      recall: (message, texts) => this.recallAndEdit(message, texts),
      fork: (atSeq) => this.mutate(() => this.endpoint.fork({ sessionId, atSeq })),
      editorT: this.t,
    };
  }

  private async recallAndEdit(
    message: EditableMessageBlock,
    texts: readonly string[],
  ): Promise<boolean> {
    const applied = await this.mutate(
      () => this.endpoint.recall({ sessionId: this.sessionId, eventSeq: message.eventSeq }),
      () => {
        this.setComposerDraft(texts.join("\n\n"));
      },
    );
    if (applied) this.returnViewportToEnd();
    return applied;
  }

  private async mutate(run: () => Promise<unknown>, onApplied?: () => void): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    try {
      const outcome = (await run()) as WireOutcome | undefined;
      if (outcome === undefined) throw new Error("sessionEditor 未接通：装配里没有 remote 面");
      if (outcome.ok === false) {
        throw new Error(outcome.error?.message ?? "会话编辑失败");
      }
      onApplied?.();
      try {
        await this.rebuildWindow();
      } catch (error: unknown) {
        this.logger.warn("会话编辑已生效，但窗口重建失败：%o", error);
      }
      return true;
    } catch (error: unknown) {
      this.logger.warn("会话编辑失败：%o", error);
      return false;
    } finally {
      this.pending = false;
    }
  }

  // 重建窗口：先问会话面自己的 resync，再退到刷列表；两条都没有就留一条 warn（不整页重载）。
  private async rebuildWindow(): Promise<void> {
    const binding = this.sessions.binding(this.sessionId) as
      | { session?: { resync?: () => Promise<void> } }
      | undefined;
    const resync = binding?.session?.resync;
    if (typeof resync === "function") {
      await resync.call(binding?.session);
      return;
    }
    await this.sessions.refresh();
  }

  // 撤回回填：写输入面的草稿。拿不到输入面（会话没打开 / 面未就绪）就只撤回、不回填。
  private setComposerDraft(text: string): void {
    if (this.sessions.binding(this.sessionId) === undefined) return;
    const scoped = this.sessions.scope(this.sessionId);
    if (scoped === undefined) return;
    const conversation = scoped.get("conversation") as
      | { input?: { for(scope: unknown): { setDraft(draft: string): void } } }
      | undefined;
    conversation?.input?.for(scoped).setDraft(text);
  }

  // 撤回把窗口换短，而消息流只在读者贴底时跟随：撤回的下一步是改完再发，所以这里无条件送到底。
  private returnViewportToEnd(): void {
    const scrollport = globalThis.document?.querySelector<HTMLElement>(
      "[data-conversation-scroll]",
    );
    if (scrollport === null || scrollport === undefined) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollport.scrollTop = scrollport.scrollHeight;
      });
    });
  }
}
