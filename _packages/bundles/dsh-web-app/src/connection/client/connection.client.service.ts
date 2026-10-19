// 浏览器侧连接面（我们的实现）：直接调上游的 `installConnection`，把 `transport` / `recovery` / `interactions`
// 作为**显式配置**传进去——不再读 `globalThis.__DSH_TRANSPORT__` / `__DSH_CONNECTION_RECOVERY__`。
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { Injectable, type Context } from "@morlay/zephyr";
import { providerContext } from "@morlay/zephyr/compat";

type InstallOptions = NonNullable<Parameters<typeof installConnection>[1]>;

export interface ConnectionClientConfig {
  /** 页面/壳注入的 transport hooks（fetch/openStream）。缺省走浏览器原生 fetch/WebSocket。 */
  transport?: InstallOptions["transport"];
  recovery?: InstallOptions["recovery"];
  interactions?: "answer" | "none";
  location?: { hostname: string };
}

@Injectable()
export class ClientConnection {
  constructor(private readonly config: ConnectionClientConfig = {}) {}

  protected onInit(ctx: Context): void {
    installConnection(providerContext(ctx), {
      ...(this.config.transport === undefined ? {} : { transport: this.config.transport }),
      ...(this.config.recovery === undefined ? {} : { recovery: this.config.recovery }),
      ...(this.config.interactions === undefined ? {} : { interactions: this.config.interactions }),
      ...(this.config.location === undefined ? {} : { location: this.config.location }),
    });
  }
}
