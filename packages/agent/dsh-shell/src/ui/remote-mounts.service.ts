// 终端组的**客户端挂载**：把上游 `TYPERT_REMOTE` 的 descriptor 挂进 `Remote`。
//
// 为什么单独一行：挂载只能发生在某个 `onInit` 里，而读这一面的一方（`WebTerminalsDefault`）的字段
// 在它自己的 `onInit` **之前**就填完了。两件事拆成两行，顺序才排得明白
// （`provide([...])` 的顺序就是装配序：本行要在消费方之前）。
//
// 浏览器里没人跑全局的 remotes 清单（`provideClientModules` 只在宿主装）：每个域自己 `$mount`
// 自己那份 `TYPERT_REMOTE`。少了这一步 `remote.terminal` 永远是 `undefined`。
import { TYPERT_REMOTE as TERMINAL_REMOTE } from "@deepseek-ai/dsh-api-terminal-controller/remote";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";

/** `terminal` 这一组的 client 挂载：装配时装一次，卸载随本行 fiber。 */
@Injectable()
export class RemoteMountsDefault implements OnInit {
  // `inject` 是**字段初始化器**：写在方法体里拿到的是占位对象（`$mount` 直接 `is not a function`）。
  private readonly remote = inject(Remote);

  /**
   * 挂上 `terminal` 的 descriptor（`remote.terminal` 那一面由此存在）。
   * @param ctx - 本行 ctx：disposer 挂它的 effect，服务随本行卸载。
   * @returns 装配完成。
   */
  async onInit(ctx: Context): Promise<void> {
    const dispose = await this.remote.$mount(TERMINAL_REMOTE);
    ctx.effect(() => dispose);
  }
}
