import { Agents } from "@morlay/dsh-base/agent";
import { SessionStore, SessionPersistence } from "@morlay/dsh-base/session";
import { StorageDomain } from "@morlay/dsh-base/storage";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionController } from "../session/session-controller.contract.ts";
import SchedulePlugin from "@deepseek-ai/dsh-schedule";

@Injectable()
export class Schedule extends fromCordis(SchedulePlugin) {
  agents = inject(Agents);

  sessions = inject(SessionStore);

  storageDomain = inject(StorageDomain);

  sessionController = inject(SessionController);

  sessionPersistence = inject(SessionPersistence);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      agents: this.agents,
      sessions: this.sessions,
      storageDomain: this.storageDomain,
      sessionController: this.sessionController,
      sessionPersistence: this.sessionPersistence,
    });
  }
}
