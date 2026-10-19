import * as ConnectionPlugin from "@deepseek-ai/dsh-client-connection";
import { Credentials } from "@morlay/dsh-base/agent";
import { Connection } from "@morlay/dsh-base/connection";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { WebStartupToken } from "../web/web-startup.provider.ts";

@Injectable()
export class ConnectionDefault extends fromCordis(Connection, ConnectionPlugin) {
  startup = inject(WebStartupToken);

  credentials = inject(Credentials);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { trustedHosts: this.startup.trustedHosts, credentials: this.credentials });
    // 诊断：`/api/remote.mux` 的 WebSocket 在 101 之后被关掉时，`admitConnection` 的 rejection 码是
    // 唯一线索（`rejectRemoteStreamUpgrade` 不打日志）。这里包一层，把 401/403/409 打到 stderr。
    const service = (this as unknown as { providerContext?: { connection?: unknown } })
      .providerContext?.connection as
      | { admitConnection(request: unknown): { rejection?: number } }
      | undefined;
    if (service !== undefined) {
      const original = service.admitConnection.bind(service);
      service.admitConnection = (request: unknown) => {
        const admission = original(request);
        if (admission.rejection !== undefined) {
          process.stderr.write(`[connection] admission rejected ${String(admission.rejection)}\n`);
        }
        return admission;
      };
    }
  }
}
