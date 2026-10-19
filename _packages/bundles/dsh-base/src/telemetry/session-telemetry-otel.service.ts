// 会话遥测（OTel 后端）：上游 `OpenTelemetrySessionBackend` 经 `fromCordis` 接管。
import OpenTelemetrySessionBackend from "@deepseek-ai/dsh-session-telemetry-otel";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionStore } from "@morlay/dsh-base/session";
import { SessionTelemetry } from "./session-telemetry.contract.ts";
import { Otel } from "./otel.contract.ts";

@Injectable()
export class SessionTelemetryOtel extends fromCordis(SessionTelemetry, OpenTelemetrySessionBackend) {
  sessions = inject(SessionStore);

  otel = inject(Otel);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { sessions: this.sessions, otel: this.otel });
  }
}
