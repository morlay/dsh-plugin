// 转发事件的**来源**：上游 `@deepseek-ai/dsh-api-remotes` 的 apply 经 `fromCordis` 照装。
//
// 它把「哪些 cordis 事件要转给浏览器」那张表（`API_REMOTE_FORWARDED_EVENTS`）里的每个事件接到
// `typertGateway.registerRemoteEvents` 上。**两类事件不是一回事**：
//
// - `emit`：单向通知（`api-session/added` 这些），参数原样进 wire；
// - `waterfall`：**要答复的请求**（`approval/request`、用户提问）。宿主把请求投影成 JSON 安全的形状
//   （去掉 `agent` / `signal`）后投给浏览器，浏览器的 `ctx.remote.$on(`approval/request`)` 返回值
//   经 unary 端点 `$events/result` 回到这里，再喂回那条 waterfall。
//
// 少了这一行：浏览器一条转发事件都收不到，且 `approval/request` 这类请求永远没有通道——
// 工具请求升级沙箱时上游直接 fail closed（`requires approval, but no approval channel is available`），
// 用户的批准按钮根本不会出现。
import * as ApiRemotesPlugin from "@deepseek-ai/dsh-api-remotes";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { TypertGateway } from "../typert/gateway.contract.ts";

/** 转发事件的来源行（宿主半）。 */
@Injectable()
export class RemoteEventsSource extends fromCordis(ApiRemotesPlugin) {
  private readonly gateway = inject(TypertGateway);

  override async onInit(ctx: Context): Promise<void> {
    // **挂在根上**：事件源是全宿主的一份，它要听见的是各处的 `ctx.emit`（会话存储、审批服务都在自己那一层发）。
    // cordis 的事件只向上流，挂在行 ctx 上的监听器收不到根（或兄弟行）发出的事件——症状正是
    // 「浏览器一条转发事件都收不到」。
    // 上游 apply 里只读 `ctx.typertGateway`：按 deps 交进去（它自己的静态 inject 声明也是这个名字）。
    await this.mount(ctx.root, undefined, { typertGateway: this.gateway });
  }
}
