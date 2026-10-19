import CompactionBasicService from "@deepseek-ai/dsh-compaction-basic";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Compaction } from "./contract/compaction.contract.ts";
import { Llm } from "@morlay/dsh-agent";
import { SessionStore } from "@morlay/dsh-session";
import { TokenMeter } from "@morlay/dsh-session";

@Injectable()
export class CompactionBasic extends fromCordis(Compaction, CompactionBasicService) {
  llm = inject(Llm);

  tokenMeter = inject(TokenMeter);

  sessions = inject(SessionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      llm: this.llm,
      tokenMeter: this.tokenMeter,
      sessions: this.sessions,
    });
  }
}
