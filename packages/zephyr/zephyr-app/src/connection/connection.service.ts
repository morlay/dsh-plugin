// host 侧的连接面：我们的契约只有**传输**；上游实现内置了认证（`browser-auth`），
// 它需要上层给的 `Credentials`——我们只**转交**，不定义认证契约、不实现认证。
import * as ConnectionPlugin from "@deepseek-ai/dsh-client-connection";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { Credentials } from "../credentials/credentials.contract.ts";
import { fromCordis } from "@morlay/zephyr/compat";
import { loggerOf } from "../internal/row-logger.ts";
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
    // 上游 `ClientRemoteService.$host` 无条件读 `connection.generation.getSnapshot()`：
    // 未连接时上游给的是 `undefined`，一渲染就炸。这里把 `generation` 收敛成**总是 observable**。
    const viaCtx = (ctx as unknown as { get?: (n: string) => unknown }).get?.("connection");
    console.debug(
      `[connection] providerScope=${this.providerScope === undefined ? "none" : "ok"} viaCtx=${viaCtx === undefined ? "undefined" : "ok"} same=${String(viaCtx === this.providerScope?.get("connection"))}`,
    );
    const instance = (viaCtx ?? this.providerScope?.get("connection")) as {
      generation?: { getSnapshot?: () => unknown; subscribe?: (fn: () => void) => () => void };
    } | undefined;
    const real = instance?.generation;
    const fallback = { getSnapshot: () => ({ id: 0, host: undefined }), subscribe: () => () => {} };
    // 上游实例的 `generation` 是原型 getter：包一层自有属性，**未连接时**回落到兜底 observable。
    if (instance !== undefined) {
      Object.defineProperty(instance, "generation", {
        value: {
          getSnapshot: () =>
            typeof real?.getSnapshot === "function" ? real.getSnapshot() : fallback.getSnapshot(),
          subscribe: (fn: () => void) =>
            typeof real?.subscribe === "function" ? real.subscribe(fn) : fallback.subscribe(),
        },
        configurable: true,
      });
    }
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
