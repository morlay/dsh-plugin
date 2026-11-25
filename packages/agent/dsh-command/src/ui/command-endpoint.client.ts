// `CommandEndpoint` 的**客户端形态**：只消费、不实现。
//
// 两个方法都**显式转发**（不用 `@RemoteClient()` 的生成转发）：`execute` 的 wire 是三个位置参数
// （会话 / 整行 / 附件），而生成转发的 unary 兜底是 `invoke('<组>/<方法>', { request: 实参[0] })`——
// 只包第一个实参，后两段会丢。真机的 `commands/execute: 缺少会话或命令名` 就是这么来的。
//
// 显式转发同时保住「装配期就能用」：它不依赖 `$mount` 已完成（`CommandRunner` 在 `$mount` 之前就可能被调）。
//
// 挂载仍归它自己：上游消费方（`ui-commands` / `ui-plan` / 会话面）读的是 `ctx.remote.commands`——那是
// **按 namespace 的**面，只有 `$mount` 过 descriptor 才有；我们的组不在上游 `TYPERT_REMOTE` 里，所以这份
// descriptor 由契约自己编译（`remoteDescriptorsOf`，与宿主侧 `registerRemoteGroup` 成对）。
//
// `remote` 字段在这里显式声明：契约类**不**继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import { CommandEndpoint, type CommandExecuteValue, type CommandListValue } from "@morlay/dsh-command/endpoint";
import { RemoteClient, groupNameOf, remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { inject, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";

/** `commands` 组的客户端契约实例。 */
@RemoteClient()
export class CommandEndpointClient extends CommandEndpoint implements OnInit {
  /** 转发目标：`remote.invoke`（wire 的命名参数由契约的 `parameters` 声明决定）。 */
  protected readonly remote = inject(Remote);

  /**
   * 挂上这一组的 descriptor：客户端形态**自己挂自己那一组**，不另开 binding 行。
   *
   * 面本身是给**上游消费方**用的（`ctx.remote.commands.execute(sessionId, line, attachments)`）；
   * 本仓自己的调用走下面的显式转发。
   * @param ctx - 本行 ctx：disposer 挂在它上面，卸载随行 fiber。
   */
  async onInit(ctx: Context): Promise<void> {
    const dispose = await this.remote.$mount(remoteDescriptorsOf(CommandEndpoint));
    ctx.effect(() => dispose);
  }

  /**
   * 列目录：wire 是 `{ sessionId }`（一个位置参数）。
   * @param sessionId - 目标会话。
   * @returns 目录（未知会话给空数组）。
   */
  override async list(sessionId: string): Promise<CommandListValue> {
    return (await this.invoke("list", { sessionId })) as CommandListValue;
  }

  /**
   * 执行一条命令：wire 是 `{ sessionId, line, submittedAttachments }`（三个扁平字段）。
   * @param sessionId - 目标会话。
   * @param line - 整行（`/plan off`）。
   * @param submittedAttachments - 随命令提交的附件（本装配不消费，仍按协议传）。
   * @returns 注册表给出的执行结果。
   */
  override async execute(
    sessionId: string,
    line: string,
    submittedAttachments: readonly unknown[],
  ): Promise<CommandExecuteValue> {
    return (await this.invoke("execute", { sessionId, line, submittedAttachments })) as CommandExecuteValue;
  }

  /**
   * 一次 unary 调用：端点名由组名（契约上的 `@RemoteGroup`）与方法名拼出，不另写字符串表。
   * @param method - 方法名。
   * @param args - wire 的命名参数。
   * @returns 宿主给的原样值。
   */
  private async invoke(method: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    return await this.remote.invoke(`${groupNameOf(this.constructor)}/${method}`, args);
  }
}
