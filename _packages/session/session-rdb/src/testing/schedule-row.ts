// 测试用：官方 `schedule` 行的就地适配（依赖按字段 inject(契约类)，mount 显式传入）。

import { SessionStore, SessionPersistence } from "@morlay/dsh-base/session";
import { StorageDomain } from "@morlay/dsh-base/storage";
import { inject, Injectable, InjectionToken, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import Schedule from "@deepseek-ai/dsh-schedule";

export const AgentRegistryToken = new InjectionToken<{ get(id: unknown): unknown }>("agentRegistry");

export const SessionControllerToken = new InjectionToken<{
  resolveAgent(id: unknown): Promise<unknown>;
}>("sessionController");

@Injectable()
export class ScheduleRow extends fromCordis(Schedule) {
  agents = inject(AgentRegistryToken);

  sessions = inject(SessionStore);

  storageDomain = inject(StorageDomain);

  sessionController = inject(SessionControllerToken);

  sessionPersistence = inject(SessionPersistence);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      agents: this.agents,
      sessions: this.sessions,
      storageDomain: this.storageDomain,
      sessionController: this.sessionController,
      sessionPersistence: this.sessionPersistence,
    });
  }
}
