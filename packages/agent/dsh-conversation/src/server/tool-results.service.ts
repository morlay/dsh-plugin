// 上游 `SessionToolResults`（`ui-trajectory` 的 host 入口）的**适配行**：只负责把它装起来。
//
// 上游 `static inject = ['sessions','typert']`（`client/ui-trajectory/src/index.ts:32`）：它按会话保留
// 工具结果（`tools/result` 与 `session/event` 的通知），`watch(request, signal)` 逐帧给出
// 「可用性 + 当前值」。
//
// 为什么拆成两行：wire 端点行要 `extends ToolResultsEndpoint`（组名与方法名从契约的原型链上取），
// 而 `fromCordis(...)` 也是继承，不能同时继承。所以「装上游」在这里，「接 wire」在
// `server/tool-results-endpoint.service.ts`。
import SessionToolResults, {
  type SessionToolResultValue,
} from "@deepseek-ai/dsh-client-ui-trajectory";
import { SessionStore } from "@morlay/dsh-session";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Typert } from "@morlay/zephyr-app";

/** 上游 `SessionToolResults` 里本行要转发的成员（形状直接取上游）。 */
export type ToolResultsFace = Pick<SessionToolResults, "watch">;

/**
 * 适配面拿到的上游实例是 `unknown`（上游没发布服务时 `undefined`）：按运行时校验收窄。
 * @param value - 适配行挂载后拿到的上游实例。
 * @returns `watch` 是函数时是真。
 */
export function isToolResultsFace(value: unknown): value is ToolResultsFace {
  return (
    value !== null &&
    typeof value === "object" &&
    "watch" in value &&
    typeof value.watch === "function"
  );
}

/** 契约：上游 `SessionToolResults` 对外的面（本行只声明 `watch`，类型直接取上游成员，不手抄）。 */
@Injectable()
abstract class SessionToolResultsContract {
  /** 逐帧给出「可用性 + 当前值」（`watch(request, signal)`）。 */
  abstract readonly watch: SessionToolResults["watch"];
}

/**
 * `remote.toolResults` 的上游宿主服务。
 *
 * 适配行**发布的是上游实例**：`inject(ToolResultsDefault)` 拿到的就是 `SessionToolResults`
 * （它挂上来的那一面），wire 端点行因此直接调 `watch`。
 */
@Injectable()
export class ToolResultsDefault extends fromCordis(SessionToolResultsContract, SessionToolResults) {
  private readonly sessions = inject(SessionStore);

  private readonly typert = inject(Typert);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessions: this.sessions, typert: this.typert });
  }
}

export type { SessionToolResultValue };
