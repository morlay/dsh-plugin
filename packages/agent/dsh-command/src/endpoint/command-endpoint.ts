// `commands` 这一组的**跨端契约**：组名、组内每个方法的名字与请求/响应形状。
//
// 两端共用同一份声明：宿主侧实现它（`server/`），浏览器侧按它消费（`ui/` 的 remote 实现）。
// 契约是普通类：客户端形态（`@RemoteClient()`）与宿主形态各自继承它。
// **它不继承 `RemoteClientBase`**：那个基类带一个 `inject(Remote)` 字段，而 `Remote` 只有浏览器侧有；
// 契约被两端共用，继承它会让宿主装配去解析一个不存在的服务。
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";
import type { CommandEntry } from "@morlay/dsh-command/endpoint";

/** wire 上的端点名（与上游 descriptor 一致）。 */
export const COMMAND_LIST_ENDPOINT = "commands/list";

/** `commands/list` 的请求。 */
export interface CommandListRequest {
  readonly sessionId: string;
}

/**
 * `commands/list` 的响应：**裸数组**。
 *
 * 消费方是上游 `ui-commands` 的目录（`const list = await ctx.remote.commands.list(id)` 之后直接迭代），
 * 包一层 `{ commands }` 会让它报 `list is not iterable`。
 */
export type CommandListValue = readonly CommandEntry[];

/** wire 上的端点名。 */
export const COMMAND_EXECUTE_ENDPOINT = "commands/execute";

/** `commands/execute` 的请求。 */
export interface CommandExecuteRequest {
  readonly sessionId: string;
  readonly name: string;
  readonly input?: string;
}

/**
 * `commands/execute` 的响应：上游 `CommandExecution`——`commandId`（生命周期配对 id）加归一化结果。
 *
 * `result` 是判别式联合（`success` / `error`），消费方按 `kind` 分派；写成 `unknown` 会让
 * HTTP 层的形状校验退化成"什么都收"，调用方只能靠猜（实测就踩过：把 `result.text` 当成 `text`）。
 */
export interface CommandExecuteValue {
  /** 这次执行的生命周期配对 id（`command/run` / `command/done` 上带着它）。 */
  readonly commandId: string;
  /** 处理器归一化的结果。 */
  readonly result:
    | { readonly kind: "success"; readonly text?: string; readonly sourceEventSeq?: number }
    | { readonly kind: "error"; readonly text: string };
}

/** `commands` 组：列目录、执行命令。 */
@RemoteGroup({ name: "commands" })
export class CommandEndpoint {
  /**
   * 列出某个会话可见的命令。
   *
   * wire 上是 `{ sessionId }` 而不是 `{ request }`：上游消费方（`ui-commands` 的目录）按
   * `remote.commands.list(sessionId)` 传**位置标量**，宿主侧 `requestOf(args)` 取回的应是
   * `{ sessionId }`。
   * @param request - 会话 id。
   * @returns 目录（未知会话给空数组）。
   */
  @RemoteMethod({ parameters: ["sessionId"] })
  async list(_request: CommandListRequest): Promise<CommandListValue> {
    throw new Error("commands/list：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 执行一条命令。
   * @param request - 会话、命令名与可选输入。
   * @returns 注册表给出的执行结果。
   */
  @RemoteMethod()
  async execute(_request: CommandExecuteRequest): Promise<CommandExecuteValue> {
    throw new Error("commands/execute：契约类未实现（宿主侧要在子类里实现它）");
  }
}
