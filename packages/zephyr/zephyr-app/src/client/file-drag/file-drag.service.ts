// 文件拖拽面（client 行）：上游 `ui-file-drag` 提供 `ctx.fileDrag`（应用内文件传输 + 本地化失败提示）。
//
// 上游 inject 是 `['slots', 'locale']`：`slots` 用来往 `shell.overlay` 注册失败提示，`locale` 是提示文案。
// 它自己 `ctx.provide('fileDrag', …)`——名字留在**本行作用域**，所以消费它的行按字面键 `"fileDrag"` 传
// （与 `goal-slots.ts` 的 `"remote.goals"` 同一做法），不给它另立契约。
import * as FileDragPlugin from "@deepseek-ai/dsh-client-ui-file-drag/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale } from "../locale/locale.contract.ts";
import { Slots } from "../renderer/slots.contract.ts";

@Injectable()
export class FileDragDefault extends fromCordis(FileDragPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { slots: this.slots, locale: this.locale });
  }
}
