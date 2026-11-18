// `toolResults` 组的**两端共用面**：组名、deps 键、方法名与那条流的帧形状。
//
// 上游是 `@deepseek-ai/dsh-client-ui-trajectory` 的 host 入口（轨迹视图要的工具结果流）；
// 宿主行随会话端点一起归对话域。
//
// 组名与方法名的家是下面契约类上的 `@RemoteGroup({ name })` / `@RemoteMethod({ mode: "stream" })`：
// 宿主侧（`server/tool-results-endpoint.service.ts`）继承它实现方法。客户端形态不在本仓：这一组的
// 客户端面由上游 `@deepseek-ai/dsh-client-ui-trajectory` 的 `$mount` 面提供。
import type {
  SessionToolResultRequest,
  SessionToolResultValue,
} from "@deepseek-ai/dsh-client-ui-trajectory";
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";

/**
 * `toolResults` 组：一条工具结果流。
 *
 * 帧**不**包 `RemoteResult`（流式方法与 `workspace/follow` 同口径：帧本身即业务值）。
 */
@RemoteGroup({ name: "toolResults" })
export class ToolResultsEndpoint {
  /**
   * 逐帧给出某条工具结果的「可用性 + 当前值」。
   * @param _request - 会话身份与那一条工具结果的序号（descriptor 的 `request` 参数）。
   * @param _signal - wire 的取消信号（流承载关闭时 abort）。
   * @returns 逐帧的工具结果。
   */
  @RemoteMethod({ mode: "stream" })
  watch(
    _request: SessionToolResultRequest,
    _signal: AbortSignal,
  ): AsyncIterable<SessionToolResultValue> {
    throw new Error("toolResults/watch：契约类未实现（宿主侧要在子类里实现它）");
  }
}
