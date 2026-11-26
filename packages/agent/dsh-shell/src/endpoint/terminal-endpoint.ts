// `terminal` 组的**两端共用面**：组名与组内每个方法的请求/响应形状。
//
// 形状一律从上游 `TerminalRemote`（`ClientRemote['terminal']`）派生——手写一遍只会多一份会漂的声明。
// 契约是普通类，**不**继承 `RemoteClientBase`：那个基类带 `inject(Remote)`，而 `Remote` 只有浏览器侧有，
// 契约还要给宿主侧（`server/`）用。
import type { TerminalRemote } from "@deepseek-ai/dsh-api-terminal-controller/client";
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";

/** `terminal` 组：会话的交互式终端（起进程、写输入、逐帧订阅输出）。 */
@RemoteGroup({ name: "terminal" })
export class TerminalEndpoint {
  /**
   * 挂上终端的逐帧面。
   * @param _args - 会话、终端 id 与取消信号。
   * @returns 帧流与上行写入面。
   */
  @RemoteMethod({ mode: "stream", parameters: ["agentId", "id"] })
  attach(..._args: Parameters<TerminalRemote["attach"]>): ReturnType<TerminalRemote["attach"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 关掉一个终端进程。
   * @param _args - 会话与终端 id。
   * @returns 无值结果。
   */
  @RemoteMethod({ parameters: ["agentId", "id"] })
  close(..._args: Parameters<TerminalRemote["close"]>): ReturnType<TerminalRemote["close"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 起一个新终端。
   * @param _args - 会话、创建请求（id / 尺寸 / 可选 shell）与取消信号。
   * @returns 新终端的元数据。
   */
  @RemoteMethod({ parameters: ["agentId", "request"] })
  create(..._args: Parameters<TerminalRemote["create"]>): ReturnType<TerminalRemote["create"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 读终端环境的边界（工作目录、尺寸与输入上限）。
   * @param _args - 会话与取消信号。
   * @returns 环境值。
   */
  @RemoteMethod({ parameters: ["agentId"] })
  environment(
    ..._args: Parameters<TerminalRemote["environment"]>
  ): ReturnType<TerminalRemote["environment"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 列一个会话的终端。
   * @param _args - 会话 id。
   * @returns 终端元数据列表。
   */
  @RemoteMethod({ parameters: ["sessionId"] })
  list(..._args: Parameters<TerminalRemote["list"]>): ReturnType<TerminalRemote["list"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 改终端标题。
   * @param _args - 会话、终端 id 与新标题。
   * @returns 无值结果。
   */
  @RemoteMethod({ parameters: ["agentId", "id", "title"] })
  rename(..._args: Parameters<TerminalRemote["rename"]>): ReturnType<TerminalRemote["rename"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 声明「这个窗口还留着这个终端」（进程据此不被回收）。
   * @param _args - 会话、终端 id 与取消信号。
   * @returns 保留帧流。
   */
  @RemoteMethod({ mode: "stream", parameters: ["sessionId", "id"] })
  retain(..._args: Parameters<TerminalRemote["retain"]>): ReturnType<TerminalRemote["retain"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 发现宿主可用的 shell。
   * @param _args - 会话与取消信号。
   * @returns 可启动的 shell 列表。
   */
  @RemoteMethod({ parameters: ["agentId"] })
  shells(..._args: Parameters<TerminalRemote["shells"]>): ReturnType<TerminalRemote["shells"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 订阅一个会话的终端清单变化。
   * @param _args - 会话 id 与取消信号。
   * @returns 清单帧流。
   */
  @RemoteMethod({ mode: "stream", parameters: ["sessionId"] })
  watch(..._args: Parameters<TerminalRemote["watch"]>): ReturnType<TerminalRemote["watch"]> {
    throw new Error("契约类未实现");
  }
}
/**
 * 覆盖守卫（**类型层**）：契约 ≡ 上游 `terminal` 的**客户端命名空间面**（`TerminalRemote`）。
 *
 * 基准为什么是客户端面、不是宿主类 `TerminalController`：本组宿主是上游控制器，我们只编**客户端**
 * descriptor（`TerminalEndpointClient` 的 `$mount`），而 `faceOf` 把裸值包成 `RemoteResult`。所以“我们的
 * 方法面”本来就是上游那张客户端表：
 * - 拿宿主类当基准会红在 `RemoteResult` 包装（宿主 `environment(): TerminalEnvironment`，客户端
 *   `Promise<RemoteResult<TerminalEnvironment>>`）与流型（宿主 `RemoteStream` vs 客户端
 *   `RemoteStreamHandle`）上——那不是缺陷，是两边本就不同的面；
 * - 类型层抓不到**参数名字**（`agentId` 与 `request` 在类型层都是 `string`）：名字由
 *   `__tests__/terminal-endpoint-wire.spec.ts` 与上游 `TYPERT.invocations` 逐字比来管。
 */
export type TerminalEndpointCovered = AssertTrue<AssertWireFace<TerminalRemote, TerminalEndpoint>>;
