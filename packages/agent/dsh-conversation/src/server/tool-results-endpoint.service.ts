// `toolResults` 组的**宿主实现**：继承 `endpoint/` 的契约类，转发到上游 `SessionToolResults`。
//
// 组名与方法名都来自契约（`@RemoteGroup` / `@RemoteMethod({ mode: "stream" })`），
// `registerRemoteGroup` 按 `mode` 自动走 `registerStream`——这里不出现 `"toolResults/watch"` 这种字符串。
import type {
  SessionToolResultRequest,
  SessionToolResultValue,
} from "@deepseek-ai/dsh-client-ui-trajectory";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, Injectable, type OnDispose } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { ToolResultsEndpoint } from "../endpoint/tool-results.group.ts";
import { isToolResultsFace, ToolResultsDefault } from "./tool-results.service.ts";

/** `toolResults` 组的宿主实现。 */
@RemoteGroup()
@Injectable()
export class ToolResultsEndpointRow extends ToolResultsEndpoint implements OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  /** 上游 `SessionToolResults` 的适配行发布的就是它本身（那条 `watch` 流）。 */
  private readonly results = inject(ToolResultsDefault);

  private readonly disposers: (() => void)[] = [];

  onInit(): void {
    // 装配期就报「上游实例与 wire 面不同步」，而不是等第一次请求炸成
    // `this.results.watch is not a function`。
    if (!isToolResultsFace(this.results)) {
      throw new Error("toolResults: 上游实例缺少 watch");
    }
    this.disposers.push(registerRemoteGroup(this.handlers, this));
  }

  /**
   * 逐帧给出某条工具结果的「可用性 + 当前值」。
   * @param request - wire 的 `request`（`{ sessionId, seq }`；上游生成面也可能发平铺的同名字段）。
   * @param signal - wire 的取消信号。
   * @returns 逐帧的工具结果。
   */
  override watch(
    request: SessionToolResultRequest,
    signal: AbortSignal,
  ): AsyncIterable<SessionToolResultValue> {
    // 品牌与数字在边界上收一次：wire 上进来的是裸字符串 / 数字。
    return this.results.watch(
      { sessionId: SessionId(String(request.sessionId)), seq: Number(request.seq) },
      signal,
    );
  }

  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}
