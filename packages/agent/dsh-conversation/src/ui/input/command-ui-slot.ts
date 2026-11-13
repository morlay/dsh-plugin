// 命令 UI 行：装上游 `ui-commands` 的 client 半，让 `ctx.commandUi` 真的存在。
//
// 上游那一行做三件事（同一个 apply）：注册 `/` 的命令源（`inputTriggers.registerSource`）、
// 把宿主目录与客户端贡献合并成候选、把 `command-popup` 壳注册进 `conversation.input.overlay`。
// 三者同源，装整行即可——不拆成「服务壳 + 复刻注册」。
//
// **放在输入区这一组**：它 `static inject` 的头一项就是 `inputTriggers`，与 `InputTriggerSlot` 同源；
// 排在它后面（`InputTriggers` 的令牌由那一行提供）。
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";
// 上游 ui-commands 的适配基类在 command 域（那边 owning）：本行只补会话侧的注入。
import { CommandUiRow } from "@morlay/dsh-command/ui";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { InputTriggers } from "./input.token.ts";
import { COMMANDS_REMOTE_KEY } from "@morlay/dsh-command/endpoint";

@Injectable()
export class CommandUiSlot extends CommandUiRow {
  private readonly inputTriggers = inject(InputTriggers);

  private readonly sessions = inject(SessionController);

  private readonly remote = inject(Remote);

  private readonly locale = inject(Locale);

  private readonly slots = inject(Slots);

  override async onInit(ctx: Context): Promise<void> {
    // 上游按 cordis 服务名读这几项（`ctx.locale` / `ctx.slots` / `ctx.get('inputTriggers')` /
    // `ctx.remote` / `ctx.remote.commands`）：按名字替换交给 `deps`，不走 cordis 的 inject 检查。
    await this.mount(ctx, undefined, {
      inputTriggers: this.inputTriggers,
      sessions: this.sessions,
      remote: this.remote,
      [COMMANDS_REMOTE_KEY]: (this.remote as unknown as Record<string, unknown>)["commands"],
      locale: this.locale,
      slots: this.slots,
    });
  }
}
