// ImageOffload（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ImageOffloadPlugin from "@deepseek-ai/dsh-compaction-image-offload";
import { Agents } from "@morlay/dsh-base/agent";
import { SessionStore } from "@morlay/dsh-base/session";

@Injectable()
export class ImageOffload extends fromCordis(ImageOffloadPlugin) {
  agents = inject(Agents);

  sessions = inject(SessionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { agents: this.agents, sessions: this.sessions });
  }
}
