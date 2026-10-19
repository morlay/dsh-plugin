import * as ThemePlugin from "@deepseek-ai/dsh-client-ui-theme/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale } from "../locale/locale.contract.ts";
import { Remote } from "../../remote/remote.contract.ts";
import { Slots } from "../renderer/slots.contract.ts";
import { ConfigForms } from "../settings/config-forms.contract.ts";
import { Theme } from "./theme.contract.ts";

@Injectable()
export class ThemeDefault extends fromCordis(Theme, ThemePlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly configForms = inject(ConfigForms);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      configForms: this.configForms,
    });
  }
}
