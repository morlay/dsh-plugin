// host 侧的连接面：我们的契约只有**传输**；上游实现内置了认证（`browser-auth`），
// 它需要上层给的 `Credentials`——我们只**转交**，不定义认证契约、不实现认证。
import * as ConnectionPlugin from "@deepseek-ai/dsh-client-connection";
import { Credentials } from "@morlay/dsh-auth";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { loggerOf } from "../row-logger.ts";
import { Connection } from "./contract.ts";

/** 上游 `connection.rpc` 的两个注册面（`intercept` 是我们观测的那一条）。 */
interface RpcRegistry {
  readonly handle: (channel: string, handler: unknown) => () => Promise<void>;
  readonly intercept: (
    channel: string,
    matches: unknown,
    handler: unknown,
  ) => () => Promise<void>;
}

@Injectable()
export class ConnectionDefault extends fromCordis(Connection, ConnectionPlugin) {
  private readonly credentials = inject(Credentials);

  protected async onInit(ctx: Context): Promise<void> {
    // 上游 `apply` 里用 `credentials.modifyRecord(...)` 维护浏览器 cookie；认证本身由上层提供。
    await this.mount(ctx, undefined, { credentials: this.credentials });
    // 上游是函数插件（`apply` 里 `new HostConnectionService` 再 `ctx.provide`）：没有 `providerInstance`，
    // 行内发布的 `connection` 就是那个服务实例。
    observeRpc(this.providerScope?.get("connection"), ctx);
  }
}

// `rpc` 是上游实例的 getter（每次读都给新对象），所以包在实例上：定义自有属性 shadow 原型 getter，
// 上游自己的调用与契约面读到的都是同一个包装对象。
function observeRpc(instance: unknown, ctx: Context): void {
  const logger = loggerOf(ctx);
  if (typeof instance !== "object" || instance === null || logger === undefined) return;
  const connection = instance as { readonly rpc: RpcRegistry };
  const rpc = connection.rpc;
  const intercept = rpc.intercept;
  Object.defineProperty(connection, "rpc", {
    configurable: true,
    value: {
      handle: rpc.handle,
      intercept: (channel: string, matches: unknown, handler: unknown) => {
        logger.info("[rpc] %s", channel);
        return intercept(channel, matches, handler);
      },
    },
  });
}
