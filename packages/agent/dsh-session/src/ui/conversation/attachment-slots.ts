// 上游附件 UI（client 行）：作者区的附件按钮与共享画廊。
//
// inject 是 `slots` 与 `fileDrag`：前者是输入区与画廊的座位，后者是拖拽传输面（上游 `ui-file-drag` 行提供，
// 名字由上游 `ctx.provide` 留在那一行的作用域里，这里按字面键传）。
import * as UiAttachmentPlugin from "@deepseek-ai/dsh-client-ui-attachment/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { FileDragDefault, Slots } from "@morlay/zephyr-app/client";

@Injectable()
export class AttachmentSlots extends fromCordis(UiAttachmentPlugin) {
  private readonly slots = inject(Slots);

  private readonly fileDrag = inject(FileDragDefault);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      // 字面键：上游按 `ctx.fileDrag` 读它。
      fileDrag: this.fileDrag,
    });
  }
}
