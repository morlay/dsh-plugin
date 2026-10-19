import { SystemPrompt } from "@morlay/dsh-base/agent";
import { SessionProjections } from "@morlay/dsh-base/session-projection";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { WebRuntimeService } from "../web/web.service.ts";
import * as HarnessDevContextPlugin from "@deepseek-ai/dsh-harness-dev-context";

@Injectable()
export class HarnessDevContext extends fromCordis(HarnessDevContextPlugin) {
  systemPrompt = inject(SystemPrompt);

  sessionProjections = inject(SessionProjections);

  // `web-runtime` 在自研入口被停用（页面归 vite）：它是可选依赖。
  webApp = inject.optional(WebRuntimeService);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      systemPrompt: this.systemPrompt,
      sessionProjections: this.sessionProjections,
      webApp: this.webApp,
    });
  }
}
