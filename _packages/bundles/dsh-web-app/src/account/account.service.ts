import AccountControllerPlugin from "@deepseek-ai/dsh-api-account-controller";
import { Agents, DeepseekAccount } from "@morlay/dsh-base/agent";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class AccountController extends fromCordis(AccountControllerPlugin) {
  deepseekAccount = inject(DeepseekAccount);

  agents = inject(Agents);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { deepseekAccount: this.deepseekAccount, agents: this.agents });
  }
}
