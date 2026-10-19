// `toolResults/watch` 的宿主面：上游 `ui-trajectory` 的 **host 入口**（`SessionToolResults`）经
// `fromCordis` 接管，本行只把它的流式 `watch` 接到 wire 上。
//
// 上游 `static inject = ['sessions','typert']`（`client/ui-trajectory/src/index.ts:32`）：
// 它按会话保留工具结果（`tools/result` 与 `session/event` 的通知），`watch(request, signal)` 逐帧给出
// 「可用性 + 当前值」。帧**不**包 `RemoteResult`（流式方法与 `workspace/follow` 同口径）。
import SessionToolResults, {
  type SessionToolResultRequest,
  type SessionToolResultValue,
} from "@deepseek-ai/dsh-client-ui-trajectory";
import { SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { fromCordis } from "@morlay/zephyr/compat";
import { Typert } from "@morlay/zephyr-app";

/** 上游 `SessionToolResults` 里本行要转发的成员（形状直接取上游）。 */
type ToolResultsFace = Pick<SessionToolResults, "watch">;

/**
 * `providerInstance` 在上游适配面里的类型是 `object | undefined`：按运行时校验收窄。
 * @param value - 适配行挂载后拿到的上游实例。
 * @returns `watch` 是函数时是真。
 */
function isToolResultsFace(value: unknown): value is ToolResultsFace {
  return value !== null && typeof value === "object" && "watch" in value && typeof value.watch === "function";
}

@Injectable()
export class ToolResultsDefault extends fromCordis(SessionToolResults) {
  private readonly sessions = inject(SessionStore);

  private readonly typert = inject(Typert);

  private readonly handlers = inject(RemoteHandlers);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessions: this.sessions, typert: this.typert });
    const results = this.providerInstance;
    if (results === undefined || !isToolResultsFace(results)) {
      throw new Error("toolResults: 上游实例缺少 watch");
    }
    // 上游 descriptor 的参数名是 `request`（`{ sessionId, seq }`），我们的客户端按 `name` 发。
    this.handlers.registerStream("toolResults/watch", (args, signal) =>
      results.watch(requestOf(args), signal),
    );
  }
}

/**
 * wire 命名参数 → 上游的 `SessionToolResultRequest`。
 * @param args - wire 命名参数（`request`，或上游生成面的等价字段）。
 * @returns 会话身份与那一条工具结果的序号。
 */
function requestOf(args: Readonly<Record<string, unknown>>): SessionToolResultRequest {
  const raw = typeof args.request === "object" && args.request !== null ? args.request : args;
  const sessionId = "sessionId" in raw ? raw.sessionId : undefined;
  const seq = "seq" in raw ? raw.seq : 0;
  return { sessionId: SessionId(String(sessionId)), seq: Number(seq) };
}

export type { SessionToolResultValue };
