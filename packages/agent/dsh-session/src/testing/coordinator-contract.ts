// 会话域的**编排契约套件**：会话存储与落盘在一起时的那十几条语义（种子账目、续写、HMR、撕裂尾部）。
//
// 套件**不起装配**：ctx 怎么造、行怎么挂都由调用方给（`createCtx` / `mount` 两个回调），
// 套件只描述「装配好之后的行为」。用例名与断言是从源包一字不改搬来的。
import { describe, expect, it } from "vitest";
import { Session, SessionId, SessionLogOffset, SessionSeq } from "@deepseek-ai/dsh-session";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { Context as ZephyrContext } from "@morlay/zephyr";
/** 套件要的那份**落盘句柄**：只声明用到的方法（不 import 落盘实现包的类型，会话域不依赖持久化）。 */
export interface CoordinatorHandle {
  readonly header: { readonly [key: string]: unknown };
  readonly inheritedEventCount: number;
  read(): Promise<{ readonly [key: string]: unknown }>;
  append(events: readonly unknown[]): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * 套件要的那份**落盘面**：只用到 `open` / `create`。
 *
 * 成员签名与上游 `SessionPersistence` 保持一致（额外参数可选），这样任何实现都能直接传进来，
 * 不需要断言——会话域也因此不必为了"套件的类型"去依赖落盘包的声明。
 */
export interface CoordinatorPersistence {
  open(
    id: import("@deepseek-ai/dsh-session").SessionId,
    mode: "read" | "write",
    options?: unknown,
  ): Promise<CoordinatorHandle>;
  create(header: never, options?: unknown): Promise<CoordinatorHandle>;
}
import { appendLog, meta, oneTurnLog } from "./log.ts";

/**
 * 套件要的那份 ctx：会话存储 + 落盘（其余成员（`plugin` / `parallel` / `get`）由 zephyr 的 ctx 提供）。
 */
/** 套件要的那份**会话目录面**：只用到 `create` / `flush`（实现是谁都行）。 */
export interface CoordinatorSessions {
  create(id: never, options?: unknown): unknown;
  flush(session: unknown): Promise<void>;
}

export type CoordinatorContext = ZephyrContext & {
  readonly sessions: CoordinatorSessions;
  readonly sessionPersistence: CoordinatorPersistence;
};

/**
 * 一份装配的来源：造 ctx 与挂行都由调用方实现。
 *
 * `Ctx` 由调用方定：它自己的 ctx 类型只要**至少**有 `sessions` 与 `sessionPersistence`——
 * 套件按 `CoordinatorContext` 读这两个成员，调用方挂行时仍用自己那份更宽的类型。
 */
export interface CoordinatorFixture {
  /**
   * 造 ctx（调用方给实现；套件不自己起装配）。
   *
   * 返回类型是 **`unknown`**：调用方的 ctx 往往比 `CoordinatorContext` 更宽（上游面），
   * 让这里收窄会把"更宽的实现"挡在门外。套件内部按 `CoordinatorContext` 断言使用。
   */
  createCtx: () => unknown;

  // `CordisFiber`：cordis 的 fiber 面（只要 `dispose`）。
  mount: (ctx: CoordinatorContext) => Promise<{ dispose(): Promise<void> }>;

  /** 造一条撕裂的物理尾部（后端专用；没有就不测那一条）。 */
  corruptTail?: (id: SessionId, cwd: string | undefined) => Promise<void>;

  /** 每个用例之后的清理（删临时根）。 */
  cleanup: () => Promise<void>;
}

const WORK = "/w";

// `ctx.plugin(...)` 返回的是 cordis 的 fiber：运行期有 `dispose`（构造函数里赋值的 readonly 属性），
// 但 oxlint 的 typeCheck 在 `Fiber` 类型面上看不见它。这里按实际用到的面收窄一次，别在每个用例里重复。
function disposeFiber(fiber: object): Promise<void> {
  return (fiber as { dispose(): Promise<void> }).dispose();
}

// 夹具里的一条用户消息：`id` 是品牌字符串，这里在边界铸一次（不引 llm 的工厂，
// 那个包归 agent 域所有，会话域不该为一份 spec 数据反向依赖它）。
type UserMessageData = Extract<SessionEvent, { type: "user/message" }>["data"];

function userMessageOf(id: string, text: string): UserMessageData {
  return {
    id,
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "user" },
  } as unknown as UserMessageData;
}

function send(session: Session, events: readonly SessionEvent[]): void {
  appendLog(session, events);
}

export function runCoordinatorContract(
  name: string,
  makeFixture: () => Promise<CoordinatorFixture>,
): void {
  describe(`SessionPersistenceRdb orchestration: ${name}`, () => {
    async function freshCtx(
      fix: CoordinatorFixture,
    ): Promise<{ ctx: CoordinatorContext; fiber: { dispose(): Promise<void> } }> {
      const ctx = fix.createCtx() as CoordinatorContext;
      const fiber = await fix.mount(ctx);
      return { ctx, fiber };
    }

    async function readAll(
      ctx: CoordinatorContext,
      id: SessionId,
    ): Promise<{ meta: Session["header"]; events: readonly SessionEvent[] }> {
      const handle = await ctx.sessionPersistence.open(id, "read");
      try {
        const { events } = await handle.read();
        return { meta: handle.header, events };
      } finally {
        await handle.close();
      }
    }

    it("persists a live session driven through the store, surviving reload", async () => {
      const fix = await makeFixture();
      const { ctx, fiber } = await freshCtx(fix);
      try {
        const session = ctx.sessions.create(SessionId("live"), { meta: { cwd: WORK } });
        send(session, oneTurnLog());
        await ctx.sessions.flush(session);

        const loaded = await readAll(ctx, SessionId("live"));
        expect(loaded.events).toHaveLength(6);
        expect(loaded.meta.cwd).toBe(WORK);
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("round-trips the seed boundary (inheritedEventCount) through persistence", async () => {
      const fix = await makeFixture();
      const { ctx, fiber } = await freshCtx(fix);
      try {
        let session!: Session;
        const sessionFiber = await ctx.plugin(
          Object.assign(
            (inner: CoordinatorContext) => {
              session = inner.sessions.create(SessionId("forked-child"), {
                seed: oneTurnLog().slice(0, 3),
                meta: { cwd: WORK, isSeeded: true },
                inheritedEventCount: SessionLogOffset(3),
              });
            },
            { inject: ["sessions"] },
          ),
        );
        send(session, oneTurnLog().slice(3));
        await ctx.sessions.flush(session);
        await disposeFiber(sessionFiber);

        const handle = await ctx.sessionPersistence.open(SessionId("forked-child"), "read");
        try {
          expect(handle.header.isSeeded).toBe(true);
          expect(handle.inheritedEventCount).toBe(3);
        } finally {
          await handle.close();
        }
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("round-trips the delegation depth through persistence", async () => {
      const fix = await makeFixture();
      const { ctx, fiber } = await freshCtx(fix);
      try {
        let session!: Session;
        const sessionFiber = await ctx.plugin(
          Object.assign(
            (inner: CoordinatorContext) => {
              session = inner.sessions.create(SessionId("delegated-child"), {
                meta: { cwd: WORK, parentSession: SessionId("root"), delegationDepth: 2 },
              });
            },
            { inject: ["sessions"] },
          ),
        );
        send(session, oneTurnLog());
        await ctx.parallel("session/flush", session);
        await disposeFiber(sessionFiber);

        const loaded = await readAll(ctx, SessionId("delegated-child"));
        expect(loaded.meta.delegationDepth).toBe(2);
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("source-frozen events cannot be mutated after buffering and persist unchanged", async () => {
      const fix = await makeFixture();
      const { ctx, fiber } = await freshCtx(fix);
      try {
        const session = ctx.sessions.create(SessionId("mutate"), { meta: { cwd: WORK } });
        session.append("turn/start", { turn: 1 });
        const ev = session.append("user/message", userMessageOf("mutate-user", "original"), {
          surfaceOp: "append",
        });
        expect(() => {
          (ev.data as unknown as { content: { type: "text"; text: string }[] }).content[0]!.text =
            "HACKED";
        }).toThrow(TypeError);
        session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
        await ctx.sessions.flush(session);

        const loaded = await readAll(ctx, SessionId("mutate"));
        const message = loaded.events.find((event) => event.type === "user/message");
        expect(
          message?.type === "user/message" && (message.data.content[0] as { text: string }).text,
        ).toBe("original");
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("fork: a seeded new session persists its seed once (no double-write on a no-op flush)", async () => {
      const fix = await makeFixture();
      const { ctx, fiber } = await freshCtx(fix);
      try {
        const seed = oneTurnLog();

        const forked = ctx.sessions.create(SessionId("forked"), { seed, meta: { cwd: WORK } });
        await ctx.sessions.flush(forked);
        const loaded = await readAll(ctx, SessionId("forked"));

        expect(loaded.events.slice(0, seed.length)).toEqual(seed);
        expect(loaded.events.at(-1)).toMatchObject({ type: "session/end-seed", seq: seed.length });

        await ctx.sessions.flush(forked);
        const reloaded = await readAll(ctx, SessionId("forked"));
        expect(reloaded.events).toEqual(loaded.events);
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("resume: a re-created session seeded with the loaded log does not re-append its seed and continues the seq", async () => {
      const fix = await makeFixture();
      const first = await freshCtx(fix);
      try {
        const s1 = first.ctx.sessions.create(SessionId("resumed"), { meta: { cwd: WORK } });
        send(s1, oneTurnLog());
        await first.ctx.sessions.flush(s1);
      } finally {
        await first.fiber.dispose();
      }

      const second = await freshCtx(fix);
      try {
        const loaded = await readAll(second.ctx, SessionId("resumed"));
        const s2 = second.ctx.sessions.create(SessionId("resumed"), {
          seed: loaded.events,
          meta: { cwd: WORK },
        });
        await second.ctx.sessions.flush(s2);
        s2.append("turn/start", { turn: 2 });
        s2.append("turn/end", { turn: 2, reason: { kind: "completed" } });
        await second.ctx.sessions.flush(s2);

        const reloaded = await readAll(second.ctx, SessionId("resumed"));

        expect(reloaded.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        expect(reloaded.events[6]).toMatchObject({ type: "session/end-seed" });
      } finally {
        await second.fiber.dispose();
        await fix.cleanup();
      }
    });

    it("HMR: applying the plugin seeds existing live sessions", async () => {
      const fix = await makeFixture();
      const ctx = fix.createCtx() as CoordinatorContext;

      const session = ctx.sessions.create(SessionId("pre-existing"), { meta: { cwd: WORK } });
      session.append("turn/start", { turn: 1 });
      session.append("user/message", userMessageOf("pre-existing-user", "hi"), {
        surfaceOp: "append",
      });
      session.append("turn/end", { turn: 1, reason: { kind: "completed" } });

      const fiber = await fix.mount(ctx);
      try {
        await ctx.sessions.flush(session);
        const loaded = await readAll(ctx, SessionId("pre-existing"));
        expect(loaded.events.length).toBeGreaterThanOrEqual(2);
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("HMR: dispose drains remaining buffers", async () => {
      const fix = await makeFixture();
      const ctx = fix.createCtx() as CoordinatorContext;
      const fiber = await fix.mount(ctx);
      const session = ctx.sessions.create(SessionId("drain"), { meta: { cwd: WORK } });
      session.append("turn/start", { turn: 1 });
      session.append("user/message", userMessageOf("drain-user", "buffered"), {
        surfaceOp: "append",
      });
      session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
      await fiber.dispose();

      const second = await freshCtx(fix);
      try {
        const loaded = await readAll(second.ctx, SessionId("drain"));
        expect(loaded.events.length).toBeGreaterThanOrEqual(2);
      } finally {
        await second.fiber.dispose();
        await fix.cleanup();
      }
    });

    it("a NEW live session colliding on a persisted id is rejected, not silently adopted", async () => {
      const fix = await makeFixture();
      const { ctx, fiber } = await freshCtx(fix);
      try {
        let first!: Session;
        const firstFiber = await ctx.plugin(
          Object.assign(
            (inner: CoordinatorContext) => {
              first = inner.sessions.create(SessionId("collide"), { meta: { cwd: WORK } });
            },
            { inject: ["sessions"] },
          ),
        );
        send(first, oneTurnLog());
        await ctx.sessions.flush(first);
        await disposeFiber(firstFiber);

        let second!: Session;
        await ctx.plugin(
          Object.assign(
            (inner: CoordinatorContext) => {
              second = inner.sessions.create(SessionId("collide"), { meta: { cwd: "/other" } });
            },
            { inject: ["sessions"] },
          ),
        );
        await expect(ctx.sessions.flush(second)).rejects.toThrow(/different cwd/);
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("an abandoned lazy session (never materialized) releases its id for reuse", async () => {
      const fix = await makeFixture();
      const { ctx, fiber } = await freshCtx(fix);
      try {
        let firstSession!: Session;
        const firstFiber = await ctx.plugin(
          Object.assign(
            (inner: CoordinatorContext) => {
              firstSession = inner.sessions.create(SessionId("abandoned"), { meta: { cwd: WORK } });
            },
            { inject: ["sessions"] },
          ),
        );
        await ctx.sessions.flush(firstSession);
        await disposeFiber(firstFiber);

        let reuse!: Session;
        await ctx.plugin(
          Object.assign(
            (inner: CoordinatorContext) => {
              reuse = inner.sessions.create(SessionId("abandoned"), { meta: { cwd: WORK } });
            },
            { inject: ["sessions"] },
          ),
        );
        await expect(ctx.sessions.flush(reuse)).resolves.toBe(true);
        reuse.append("turn/start", { turn: 1 });
        reuse.append("turn/end", { turn: 1, reason: { kind: "completed" } });
        await ctx.sessions.flush(reuse);
        const loaded = await readAll(ctx, SessionId("abandoned"));
        expect(loaded.events.map((e) => e.seq)).toEqual([0, 1]);
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("append adopts a storage-only session (fresh instance) and continues the seq", async () => {
      const fix = await makeFixture();
      const { ctx, fiber } = await freshCtx(fix);
      try {
        const m = meta("storage-only", WORK);
        const handle = await ctx.sessionPersistence.create(m);
        await handle.append(oneTurnLog());
        await handle.close();

        const writer = await ctx.sessionPersistence.open(SessionId("storage-only"), "write");
        await writer.append([
          { type: "turn/start", seq: SessionSeq(6), time: 7, data: { turn: 2 } },
          {
            type: "turn/end",
            seq: SessionSeq(7),
            time: 8,
            data: { turn: 2, reason: { kind: "completed" } },
          },
        ]);
        await writer.close();

        const loaded = await readAll(ctx, SessionId("storage-only"));
        expect(loaded.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("create rejects a duplicate id (in memory and on a persisted log)", async () => {
      const fix = await makeFixture();
      const { ctx, fiber } = await freshCtx(fix);
      try {
        const m = meta("dup-id", WORK);
        const first = await ctx.sessionPersistence.create(m);
        await expect(ctx.sessionPersistence.create(m)).rejects.toThrow(/already exists/);
        await first.append(oneTurnLog());
        await first.close();
        await expect(ctx.sessionPersistence.create(m)).rejects.toThrow(/already exists/);
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("round-trips a header with parentSession (fork lineage)", async () => {
      const fix = await makeFixture();
      const { ctx, fiber } = await freshCtx(fix);
      try {
        const m = meta("lineage", WORK);
        const handle = await ctx.sessionPersistence.create({
          ...m,
          parentSession: SessionId("parent"),
        });
        await handle.append(oneTurnLog());
        await handle.close();

        const loaded = await readAll(ctx, SessionId("lineage"));
        expect(loaded.meta.parentSession).toBe(SessionId("parent"));
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });

    it("torn-tail: a never-committed tail is truncated by the write path", async () => {
      const fix = await makeFixture();
      if (fix.corruptTail === undefined) return;
      const { ctx, fiber } = await freshCtx(fix);
      try {
        const m = meta("torn", WORK);
        const creator = await ctx.sessionPersistence.create(m);
        await creator.append(oneTurnLog());
        await creator.close();
        await fix.corruptTail(SessionId("torn"), WORK);

        const reader = await ctx.sessionPersistence.open(SessionId("torn"), "read");
        expect((await reader.read()).events).toEqual(oneTurnLog());
        await reader.close();

        const writer = await ctx.sessionPersistence.open(SessionId("torn"), "write");
        await writer.append([
          { type: "turn/start", seq: SessionSeq(6), time: 7, data: { turn: 2 } },
          {
            type: "turn/end",
            seq: SessionSeq(7),
            time: 8,
            data: { turn: 2, reason: { kind: "completed" } },
          },
        ]);
        expect((await writer.read()).events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        await writer.close();
      } finally {
        await fiber.dispose();
        await fix.cleanup();
      }
    });
  });
}
