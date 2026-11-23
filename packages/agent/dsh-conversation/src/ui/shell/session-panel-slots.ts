// 会话面板（上游 `ui-session-panel` 的 client 行）：会话头部的开关 + Chat View aside 里的浮动面板。
//
// 它是 0.2.3 起 `panel.section` / `panel.indicator` / `panel.fold` / `panel.details` 这些槽位的
// **声明方**——`job-list`（`background-jobs`）、`subagent-list`（`subagents`）以及它们运行中的
// 指示点都注册在这些位置下。不装它，那些注册无处挂：条目不会出现在界面上。
//
// 上游的 `export const inject` 是 `['slots', 'locale', 'remote']`，三个都按下文显式交给它。
import * as UiSessionPanelPlugin from "@deepseek-ai/dsh-client-ui-session-panel/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";

/** 会话面板行（浏览器半）：声明会话面板区的槽位并渲染 Environment 一节。 */
@Injectable()
export class SessionPanelSlots extends fromCordis(UiSessionPanelPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
    });
  }
}
