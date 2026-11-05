// 宿主终端（上游 `api/terminal-controller` 的 `TerminalController`）。
//
// 它给浏览器侧提供 `terminal/*` 端点（起进程、写输入、订阅输出帧），自己按 `static inject` 读
// `subprocess` / `sandboxPolicy` / `workingDirectory` / `typert` —— 都在这条链上，所以整行直装，
// 不重写任何行为。
import TerminalController from "@deepseek-ai/dsh-api-terminal-controller";
import { TYPERT_REMOTE as TERMINAL_REMOTE } from "@deepseek-ai/dsh-api-terminal-controller/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Typert } from "@morlay/zephyr-app";

@Injectable()
export class TerminalDefault extends fromCordis(TerminalController) {
  private readonly typert = inject(Typert);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
    // **端点的调用描述要在服务端登记**：`MuxServer` 靠 `typert.remotes.get(endpoint)?.mode` 判断
    // 一个端点是不是流式，没登记就按 unary 调，`terminal/attach` 会得到
    // `stream Remote methods must be opened through the stream carrier`——界面上就是终端卡在
    // 「正在启动…」。上游的 `TypertRemoteService` 只把绑定挂在实例上、等 gateway 的 source 扫描；
    // 而那次扫描在第一次 remote 调用时就冻结了（`srcClaims ??= …`），本行又排在 gateway 之后装，
    // 所以必须显式登记（`ApiSessionControllerHost` 也是这么做的）。
    (this.typert.remotes as unknown as { register(contribution: unknown): unknown }).register(
      TERMINAL_REMOTE,
    );
  }
}
