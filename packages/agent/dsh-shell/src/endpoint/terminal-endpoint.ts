// `terminal` 组的**两端共用面**：组名与组内每个方法的请求/响应形状。
//
// 形状一律从上游 `TerminalRemote`（`ClientRemote['terminal']`）派生——手写一遍只会多一份会漂的声明。
// 契约是普通类，**不**继承 `RemoteClientBase`：那个基类带 `inject(Remote)`，而 `Remote` 只有浏览器侧有，
// 契约还要给宿主侧（`server/`）用。
import type { TerminalRemote } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";

/** wire 上的组名（`remote.<组名>`）。组名只有这一处，装饰器与读取面都从它取。 */
export const TERMINAL_GROUP = "terminal";

/** `terminal` 组：会话的交互式终端（起进程、写输入、逐帧订阅输出）。 */
@RemoteGroup({ name: "terminal" })
export class TerminalEndpoint {
  /**
   * 挂上终端的逐帧面。
   * @param args - 会话、终端 id 与取消信号。
   * @returns 帧流与上行写入面。
   */
  @RemoteMethod({ mode: "stream" })
  attach(...args: Parameters<TerminalRemote["attach"]>): ReturnType<TerminalRemote["attach"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 关掉一个终端进程。
   * @param args - 会话与终端 id。
   * @returns 无值结果。
   */
  @RemoteMethod()
  close(...args: Parameters<TerminalRemote["close"]>): ReturnType<TerminalRemote["close"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 起一个新终端。
   * @param args - 会话、创建请求（id / 尺寸 / 可选 shell）与取消信号。
   * @returns 新终端的元数据。
   */
  @RemoteMethod()
  create(...args: Parameters<TerminalRemote["create"]>): ReturnType<TerminalRemote["create"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 读终端环境的边界（工作目录、尺寸与输入上限）。
   * @param args - 会话与取消信号。
   * @returns 环境值。
   */
  @RemoteMethod()
  environment(...args: Parameters<TerminalRemote["environment"]>): ReturnType<TerminalRemote["environment"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 列一个会话的终端。
   * @param args - 会话 id。
   * @returns 终端元数据列表。
   */
  @RemoteMethod()
  list(...args: Parameters<TerminalRemote["list"]>): ReturnType<TerminalRemote["list"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 改终端标题。
   * @param args - 会话、终端 id 与新标题。
   * @returns 无值结果。
   */
  @RemoteMethod()
  rename(...args: Parameters<TerminalRemote["rename"]>): ReturnType<TerminalRemote["rename"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 声明「这个窗口还留着这个终端」（进程据此不被回收）。
   * @param args - 会话、终端 id 与取消信号。
   * @returns 保留帧流。
   */
  @RemoteMethod({ mode: "stream" })
  retain(...args: Parameters<TerminalRemote["retain"]>): ReturnType<TerminalRemote["retain"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 发现宿主可用的 shell。
   * @param args - 会话与取消信号。
   * @returns 可启动的 shell 列表。
   */
  @RemoteMethod()
  shells(...args: Parameters<TerminalRemote["shells"]>): ReturnType<TerminalRemote["shells"]> {
    throw new Error("契约类未实现");
  }

  /**
   * 订阅一个会话的终端清单变化。
   * @param args - 会话 id 与取消信号。
   * @returns 清单帧流。
   */
  @RemoteMethod({ mode: "stream" })
  watch(...args: Parameters<TerminalRemote["watch"]>): ReturnType<TerminalRemote["watch"]> {
    throw new Error("契约类未实现");
  }
}
