// 会话 scope 的**读面**：上游 `sessions.scope(id)` 拿到的 ctx 必须能读到兄弟行发布的服务。
//
// 上游 `ui-conversation` 的两处消费都走这条路：
//   - `QueueDock` 的 `inject`：`actx.get('conversation')`，读不到就抛
//     `queue dock: conversation service unavailable`；
//   - `scopedConversation(sessions, id)`：同一个 `scope(id).get('conversation')`。
//
// 这个 ctx 是上游 `createScope()` 建的**真 cordis ctx**（`fiber.ctx.extend(…)`），而兄弟行的服务名
// 在我们的名字表里——所以 `scope()` 是唯一能补齐的地方，本 spec 就钉这一条。
import { bootstrapApplication, Injectable, type App, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Remote, SessionRemote } from "@morlay/zephyr-app/client";
import { describe, expect, it } from "vitest";
import { SessionController } from "../../contract/session-controller.contract.ts";
import { provideSessionsStore } from "../sessions.provide.ts";

/** 一行目录（上游 `session/list` 的 `{ items }`，必需字段齐全）。 */
const ROWS = {
  items: [
    {
      sessionId: "s1",
      running: false,
      blank: false,
      agentAvailable: true,
      updatedAt: 0,
      retainedBy: {},
    },
  ],
};

/** 目录面替身：本 spec 的被测面是 scope 读面，不是列表拉取。 */
@Injectable()
class FakeSessionRemote extends SessionRemote {
  async list(): Promise<unknown> {
    return ROWS;
  }

  async create(): Promise<unknown> {
    return { sessionId: "s1" };
  }

  async readPage(): Promise<unknown> {
    return { records: [], hasMore: false };
  }
}

/** 兄弟行：像 `ui-conversation` 那样按名字发布自己的服务（`ctx.provide('conversation', …)`）。 */
const conversationRow = {
  name: "fake-conversation-row",
  apply: (ctx: { provide(name: string, value: unknown): void }): void => {
    ctx.provide("conversation", { send: async (): Promise<void> => {} });
  },
};

/** 把那条兄弟行挂进装配。 */
@Injectable()
class ConversationRow extends fromCordis(conversationRow) {
  async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

/** scope 的读面（上游 `Context.get` 的最小形状）。 */
interface ScopeFace {
  get(name: string): unknown;
}

/**
 * 起装配并物化一个会话 scope。
 * @returns 应用与契约实例。
 */
async function boot(): Promise<{ app: App; sessions: SessionController }> {
  const app = await bootstrapApplication({
    providers: [
      { provide: SessionRemote, useFactory: () => new FakeSessionRemote() },
      // `sessions` 行要 `Remote`（转发面与 `$on`）；本 spec 不走 wire，给个只带订阅面的壳。
      {
        provide: Remote,
        useFactory: () =>
          ({
            session: undefined,
            $on: () => () => {},
            $mount: async () => () => {},
            whenMounted: async () => {},
            whenNamespace: async () => undefined,
          }) as unknown as Remote,
      },
      ConversationRow,
      ...provideSessionsStore(),
    ],
    timeoutMs: 20_000,
  });
  const sessions = app.get(SessionController);
  await sessions.refresh();
  // 上游 `binding()` / `scope()` 读的是已物化的 scope：先 retain。
  sessions.retain("s1" as never, { source: "gateway" });
  return { app, sessions };
}

describe("会话 scope 的读面", () => {
  it("兄弟行按名字发布的服务在 `scope(id).get()` 里读得到", { timeout: 20_000 }, async () => {
    const { app, sessions } = await boot();
    try {
      const scope = (sessions.scope as (id: string) => ScopeFace | undefined)("s1");
      expect(scope, "retain 之后必须有 scope").toBeDefined();
      expect(
        scope?.get("conversation"),
        "queue dock / scopedConversation 读的就是这个名字",
      ).toBeDefined();
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it(
    "契约实例就是装配里那一个（`app.get` 与 scope 的持有者是同一份）",
    { timeout: 20_000 },
    async () => {
      const { app, sessions } = await boot();
      try {
        expect(app.get(SessionController), "同一份目录只有一个实例").toBe(sessions);
      } finally {
        await app.dispose().catch(() => {});
      }
    },
  );

  it(
    "补读面之后 scope 身份不丢（`scopeOf` 仍认得出这是哪个会话）",
    { timeout: 20_000 },
    async () => {
      const { app, sessions } = await boot();
      try {
        const scope = (sessions.scope as (id: string) => ScopeFace | undefined)("s1");
        const id = (sessions.scopeOf as (ctx: unknown) => string | undefined).call(sessions, scope);
        expect(id, "scope ctx 上的会话身份要透传").toBe("s1");
      } finally {
        await app.dispose().catch(() => {});
      }
    },
  );
});
