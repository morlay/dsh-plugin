// 全链路用例的**浏览器半**装配（薄封装）：真 store + 真端点客户端 + 真「进程内传输」（`LocalRemote`）。
//
// 换掉的只有「怎么到达宿主」——线上是 mux socket，这里是同一进程里的 `RemoteHandlers.invoke`
// （仓库认可的传输接缝，`@morlay/zephyr-app/testing` 的 `LocalRemote`）。业务侧全是真实现。
// 装配本身与宿主半同一份（`base.ts` 的 `mountRows`）：清单在这里，机制在那里。
//
// `SessionController` 是**上游 composer 面**的最小记录型替身：草稿回填与窗口重建是上游
// `ClientSessions` + 输入面的职责，不在本包（真 composer 的端到端在 apps 层覆盖）。
import { SessionController } from "@morlay/dsh-conversation/contract";
import { Locale, Remote } from "@morlay/zephyr-app/client";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { LocalRemote } from "@morlay/zephyr-app/testing";
import { SessionEditorStore } from "../../ui/session-editor/session-editor.store.ts";
import { SessionEditorEndpointClient } from "../../ui/session-editor/session-editor-endpoint.client.ts";
import { NS, zh } from "../../ui/session-editor/locales.ts";
import type { SessionEditorKey } from "../../ui/session-editor/locales.ts";
import { mountRows, type MountedRows, type RowEntry } from "./base.ts";

/**
 * 上游 composer 面的替身：记录「撤回回填的草稿」与「窗口重建」，让本包自己的那两步可断言。
 */
export class ComposerStub {
  /** 每次 `setDraft` 的会话与文本。 */
  readonly drafts: Array<{ sessionId: string; text: string }> = [];

  /** 每次 `resync`（窗口重建）的会话。 */
  readonly resyncs: string[] = [];

  /** 每次退化成刷列表的会话。 */
  readonly refreshes: string[] = [];

  binding(sessionId: string): unknown {
    return {
      session: {
        resync: async () => {
          this.resyncs.push(sessionId);
        },
      },
    };
  }

  scope(sessionId: string): unknown {
    return {
      get: (name: string): unknown =>
        name === "conversation"
          ? {
              input: {
                for: () => ({
                  setDraft: (text: string) => {
                    this.drafts.push({ sessionId, text });
                  },
                }),
              },
            }
          : undefined,
    };
  }

  async refresh(): Promise<void> {
    this.refreshes.push("*");
  }
}

/** 一份浏览器半装配。 */
export interface Client {
  readonly app: MountedRows;
  readonly store: SessionEditorStore;
  readonly composer: ComposerStub;
  dispose(): Promise<void>;
}

// 字典面：真字典（断言才落得住 DOM 上的文案），绑定面按结构用。
const localeStub = {
  register: () => () => {},
  bind: (ns: string) =>
    ns === NS
      ? (key: SessionEditorKey, params?: Record<string, unknown>): string => {
          const template = zh[key];
          if (params === undefined) return template;
          return Object.entries(params).reduce(
            (text, [name, value]) => text.replace("{" + name + "}", String(value)),
            template,
          );
        }
      : (key: string) => key,
  getSnapshot: () => ({ revision: 0 }),
  subscribe: () => () => {},
};

/**
 * 起一份浏览器半装配：它的 `remote.invoke` 直接打到宿主那份真 `RemoteHandlers`。
 * @param handlers - 宿主的 wire 路由表。
 * @returns 装配面（真 store + 记录型 composer 面）。
 */
export async function startClient(handlers: RemoteHandlers): Promise<Client> {
  const composer = new ComposerStub();
  const rows = [
    // 传输与两个上游面的替身：值条目，没有生命周期。
    { provide: RemoteHandlers as never, useValue: handlers },
    { provide: SessionController as never, useValue: composer },
    { provide: Locale as never, useValue: localeStub },
    LocalRemote,
    SessionEditorEndpointClient,
    SessionEditorStore,
  ] as readonly RowEntry[];
  const app = await mountRows(rows);
  return {
    app,
    store: app.get(SessionEditorStore),
    composer,
    dispose: () => app.dispose(),
  };
}

// `Remote` 只是为了让类型面显式：`LocalRemote` 已经按契约名发布，这里不额外提供。
export type { Remote };
