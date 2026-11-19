// 转发事件的**来源**：由本行自己实现（不再照装上游 `@deepseek-ai/dsh-api-remotes` 的 apply）。
//
// 为什么自己实现：上游那份把 `queue.push` 的返回值当「源还在不在」的判据，队列一旦结束就静默
// 降级成 `next()`——表现是「转发源登记了、`$events` 流也 ready，但每次提问/审批都按『无人应答』结束」，
// 而且这条生命周期是 vendor 内部的隐藏状态，装配侧补不出来。这里只照它的**协议**（帧形状、`resolve`/
// `reject` 语义）重写，转发名单仍读上游的 `API_REMOTE_FORWARDED_EVENTS`（一份名单，不抄第二份）。
//
// 两类事件不是一回事：
// - `emit`：单向通知（`api-session/added` 这些），参数原样进 wire；
// - `waterfall`：**要答复的请求**（`approval/request`、用户提问）。宿主把请求投影成 JSON 安全的形状
//   （去掉 `agent` / `signal`）后投给浏览器，浏览器的 `ctx.remote.$on(...)` 返回值经 unary 端点
//   `$events/result` 回到这里，再喂回那条 waterfall。
import { API_REMOTE_FORWARDED_EVENTS } from "@deepseek-ai/dsh-api-remotes";
import { carrierKeyOf, scopeTarget } from "@deepseek-ai/dsh-scope";
import { homedir } from "node:os";
import { inject, Injectable, Logger, type Context } from "@morlay/zephyr";
import { TypertGateway } from "../typert/gateway.contract.ts";
import { RemoteQuestions, type ScopedAgentRef } from "./remote-questions.contract.ts";

/** 一条 waterfall 请求里我们要的 agent 面（上游 `Agent` 的这两个成员）。 */
interface ScopedAgent {
  readonly id: string;
  readonly ctx: object;
}

/** 一条要答复的请求，交给 gateway 的那份记录。 */
interface InvocationDispatch {
  readonly event: string;
  readonly request: Record<string, unknown>;
  readonly context: { readonly value: object; readonly subject: object; readonly agentId: string };
  readonly resolve: (outcome: { readonly kind: string; readonly value?: unknown }) => void;
  readonly reject: (error: unknown) => void;
}

/** 一条单向通知，交给 gateway 的那份记录。 */
interface EmitDispatch {
  /** 上游 `assertRemoteEventFrame` 认这个判别位，缺了整条消费循环会抛错并关掉源。 */
  readonly type: "emit";
  readonly event: string;
  readonly args: readonly unknown[];
}

/** 判别：带 `context` 的是要答复的请求，其余是单向通知（与 gateway 的 `'context' in dispatch` 同判据）。 */
function isInvocation(value: unknown): value is InvocationDispatch {
  return typeof value === "object" && value !== null && "context" in value;
}

/**
 * 宿主 → 浏览器的帧队列：可拉取、可中止。
 *
 * 中止时把**在途请求**全部按原因拒绝，别让它们在浏览器那边永远挂着（宿主重启后旧请求没人认领）。
 */
class ForwardQueue {
  private readonly buffer: unknown[] = [];

  private waiter: (() => void) | undefined;

  private done = false;

  /**
   * 推一帧。
   * @param frame - 一条通知或一条要答复的请求。
   * @returns 队列是否还活着（已结束时调用方应当 `next()`）。
   */
  push(frame: unknown): boolean {
    if (this.done) return false;
    this.buffer.push(frame);
    this.waiter?.();
    return true;
  }

  /**
   * 结束队列：清空缓冲、拒绝在途请求、唤醒等待者。
   * @param reason - 给在途请求的失败原因。
   */
  end(reason: unknown): void {
    if (this.done) return;
    this.done = true;
    for (const frame of this.buffer.splice(0)) {
      if (isInvocation(frame)) frame.reject(reason);
    }
    this.waiter?.();
    this.waiter = undefined;
  }

  /**
   * 逐帧读出；`signal` 中止时结束队列并退出。
   * @param signal - 这次登记的寿命。
   * @returns 帧序列。
   */
  async *iterate(signal: AbortSignal): AsyncGenerator<unknown> {
    const abort = (): void => this.end(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    try {
      while (!this.done && !signal.aborted) {
        while (this.buffer.length > 0) yield this.buffer.shift();
        await new Promise<void>((resolve) => {
          this.waiter = resolve;
        });
        this.waiter = undefined;
      }
    } finally {
      signal.removeEventListener("abort", abort);
      this.end(signal.reason ?? new Error("forwarded Remote event source ended"));
    }
  }
}

/**
 * 转发事件的来源行（宿主半）。
 *
 * 一行两件事：照上游的名单把 `ctx` 上的事件接成帧；把要答复的请求挂到 gateway 的 `remoteEventClients`，
 * 等浏览器经 `$events/result` 回值。
 */
@Injectable()
export class RemoteEventsSource extends RemoteQuestions {
  private readonly gateway = inject(TypertGateway);

  private readonly logger = inject(Logger);

  /** 行 ctx：没有客户端时用它在进程内派发事件（应答者可能就在本进程里）。 */
  private ctx: Context | undefined;

  /** 登记的撤销函数：只在**本行卸载**时调（不用 `ctx.effect`——它的清理时机在装配期就会触发一次）。 */
  private disposeEvents: (() => Promise<void>) | undefined;

  onInit(ctx: Context): void {
    this.ctx = ctx;
    this.disposeEvents = this.gateway.registerRemoteEvents((signal) => this.sourceOf(ctx, signal), {
      home: homedir(),
    });
  }

  onDispose(): void {
    void this.disposeEvents?.();
    this.disposeEvents = undefined;
  }

  /**
   * 派发一条要答复的请求。
   *
   * **只有一条路**：在行 ctx 上发 cordis 的 `waterfall`，由 {@link RemoteEventsSource.sourceOf}
   * 挂的监听器接住并投给浏览器。浏览器与进程内应答者因此走同一条链——之前这里还额外把请求直接
   * 推进队列，同一条请求就会投两遍（界面弹两张卡、宿主收两个答复）。
   *
   * 没有客户端接的时候，监听器按上游语义走 `next()`，落到这里的兜底 `next`：
   * 立即以「没有应答者」失败，而不是永远挂着。
   * @param event - 事件名。
   * @param request - 请求本体（`agent` 由这里补上，监听器要用它做 carrier 校验）。
   * @param agent - 请求所属的 agent（同时作为 scope carrier）。
   * @returns 应答者给出的答案。
   */
  async ask(event: string, request: object, agent: ScopedAgentRef): Promise<unknown> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error("转发事件源还没 mount");
    return await ctx.waterfall(scopeTarget(agent, agent), event, { ...request, agent }, () =>
      Promise.reject(new Error("no user-questions answerer accepted the request")),
    );
  }

  /**
   * 一次登记的帧源：按上游名单挂监听器，返回可中止的帧序列。
   * @param ctx - 挂监听器的那一层（根：事件只向上流，行 ctx 收不到兄弟行发出的）。
   * @param signal - 这次登记的寿命。
   * @returns 帧序列。
   */
  private sourceOf(ctx: Context, signal: AbortSignal): AsyncIterable<unknown> {
    const queue = new ForwardQueue();
    const disposers = API_REMOTE_FORWARDED_EVENTS.map((entry) => {
      const event = entry.event;
      if (entry.mode === "emit") {
        return ctx.on(event, ((...args: readonly unknown[]) => {
          const frame: EmitDispatch = { type: "emit", event, args };
          queue.push(frame);
        }) as never);
      }
      return ctx.on(event, function (
        this: unknown,
        request: unknown,
        next: () => unknown,
      ): unknown {
        const carrier = carrierKeyOf(this);
        if (carrier === undefined) return next();
        const agent = (request as { readonly agent?: ScopedAgent }).agent;
        if (agent === undefined || agent !== carrier) {
          throw new TypeError(`forwarded scoped event ${event} must carry its Agent directly`);
        }
        const settled = Promise.withResolvers<unknown>();
        const delegate = (): void => {
          void Promise.resolve().then(next).then(settled.resolve, settled.reject);
        };
        const dispatch: InvocationDispatch = {
          event,
          // gateway 自己按 `source.context.subject` 投影（它还要用 `request.agent` 做归属校验），
          // 这里交**原始请求**，不要提前把 `agent` 抹掉。
          request: request as Record<string, unknown>,
          context: { value: agent.ctx, subject: agent, agentId: agent.id },
          resolve: (outcome) => {
            if (outcome.kind === "result") {
              settled.resolve(outcome.value);
              return;
            }
            delegate();
          },
          reject: settled.reject,
        };
        if (!queue.push(dispatch)) delegate();
        return settled.promise;
      } as never);
    });
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
        try {
          yield* queue.iterate(signal);
        } finally {
          for (const dispose of disposers) dispose();
        }
      },
    };
  }
}
