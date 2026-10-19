import * as LocalePlugin from "@deepseek-ai/dsh-client-locale/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Remote } from "../../remote.contract.ts";
import { Slots } from "../renderer/slots.contract.ts";
import { ConfigForms } from "../settings/config-forms.contract.ts";
import { Locale } from "./locale.contract.ts";

@Injectable()
export class LocaleDefault extends fromCordis(Locale, LocalePlugin) {
  private readonly slots = inject(Slots);

  private readonly remote = inject(Remote);

  private readonly configForms = inject(ConfigForms);

  protected async onInit(ctx: Context): Promise<void> {
    console.error(
      "[locale] slots ctor=",
      (this.slots as { constructor?: { name?: string } }).constructor?.name,
      "installLocale=",
      typeof (this.slots as { installLocale?: unknown }).installLocale,
    );
    await this.mount(ctx, undefined, {
      slots: this.slots,
      remote: this.remote,
      configForms: this.configForms,
    });
  }
}
