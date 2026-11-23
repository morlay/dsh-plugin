// 自研 `@RemoteGroup` 组的 **wire 入口**：把它们挂到上游共享的 `/api` RPC 通道上。
//
// 上游载体只认 `ctx.typert` 注册表里的 `@Remote` 服务方法；我们的组注册在 `RemoteHandlers` 里，
// 没有这条桥就一个都调不到（`POST /api/settings/describe` → 404）。桥只接管 **unary**：
// 拦截器一次只回一个值，`has` 因此不放行 `registerStream` 注册过的端点（流式端点在 mux 载具上）。
//
// 上游一条共享通道只容一个物理拦截器，多个贡献方怎么共存归 `Connection` 行（`shareRpcChannels`）：
// 这里只管登记自己那一段认领范围。
import type { ConnectionRpcHandlerResult, PeerScope } from "@deepseek-ai/dsh-client-connection";
import { inject, Injectable, Logger, type OnDispose } from "@morlay/zephyr";
import { Connection } from "../connection/contract.ts";
import { failureOf } from "../remote/remote-result.ts";
import { RemoteHandlers } from "./remote-handlers.contract.ts";

/**
 * 上游共享通道的**拦截器注册面**（`HostConnectionRpc.intercept`）。
 *
 * 契约 `Connection` 出的是客户端消费面（`rpc.open`），宿主面的 `intercept` 不进去——两边共用一个
 * 运行期对象，所以这一读法收在本文件，别处不再各写一次。
 */
interface HostRpcChannel {
  intercept(
    channel: "/api",
    matches: (endpoint: string) => boolean,
    handler: (
      endpoint: string,
      payload: unknown,
      signal: AbortSignal,
      peer: PeerScope,
    ) => Promise<ConnectionRpcHandlerResult>,
  ): () => Promise<void>;
}

@Injectable()
export class RemoteHandlersRpcBridge implements OnDispose {
  // **可选**：只装数据面的装配（纯端点测试、headless 组合）没有 wire 载体，桥不装即可；
  // 缺了它就是「自研组的端点全是 404」，所以真装上载体时下面那段仍是 fail loud。
  private readonly connection = inject.optional(Connection);

  private readonly logger = inject(Logger);

  private readonly handlers = inject(RemoteHandlers);

  /** 物理拦截项的注销函数（`onDispose` 里调）。 */
  private dispose: (() => Promise<void>) | undefined;

  onInit(): void {
    if (this.connection === undefined) return;
    // 契约面就是这个上游实例（`Connection` 行显式 `new HostConnectionService`），它的 `rpc` 上已经装好
    // 共享通道层（见 `shareRpcChannels`）：物理拦截器一条通道只能有一个。
    const rpc = hostRpcOf(this.connection);
    if (rpc === undefined) {
      // 缺了这一面就是「自研组的端点全是 404」，而装配期一切正常——失败必须落在这里。
      throw new Error(
        "remote-handlers rpc-bridge: connection 没有 rpc.intercept，自研端点无处认领",
      );
    }
    this.dispose = rpc.intercept(
      "/api",
      (endpoint) => this.handlers.has(endpoint),
      async (endpoint, payload) => await this.invoke(endpoint, payload),
    );
  }

  async onDispose(): Promise<void> {
    const dispose = this.dispose;
    this.dispose = undefined;
    await dispose?.();
  }

  /**
   * 一条已认领的 wire 调用：`payload.args` 交给路由表，结果包成 Connection 的结果面。
   * @param endpoint - `<namespace>/<method>`。
   * @param payload - wire 载荷（`{ args: 命名参数 }`）。
   * @returns `{ ok: true, value }`，或失败面（`code` 取异常的 `HarnessError.code`）。
   */
  private async invoke(endpoint: string, payload: unknown): Promise<ConnectionRpcHandlerResult> {
    try {
      return { ok: true, value: await this.handlers.invoke(endpoint, argsOf(payload)) };
    } catch (error) {
      const failure = failureOf(error);
      const details: unknown = failure.details;
      return {
        ok: false,
        error: {
          code: failure.code,
          message: failure.message,
          // Connection 的失败面要求 `details` 是对象；拿不到形状就交空对象（不塞 `undefined`）。
          details: typeof details === "object" && details !== null ? details : {},
        },
      };
    }
  }
}

/**
 * 从 `Connection` 契约实例上取宿主侧的 rpc 注册面。
 * @param connection - `Connection` 契约实例（运行期是上游 `connection` 服务）。
 * @returns 注册面；上游没有这一面时 `undefined`。
 */
function hostRpcOf(connection: object): HostRpcChannel | undefined {
  const rpc: unknown = Reflect.get(connection, "rpc");
  if (typeof rpc !== "object" || rpc === null) return undefined;
  const intercept: unknown = Reflect.get(rpc, "intercept");
  return typeof intercept === "function" ? (rpc as HostRpcChannel) : undefined;
}

/**
 * wire 载荷 → 路由表的命名参数。
 *
 * 上游 unary 的载荷形如 `{ args: {…} }`（客户端 `callUnary` 与上游分派器同形）；
 * 没有这一层（或不是对象）时按空参数——与上游「载荷必须带 args」的失败口径不同：
 * 这里的失败由业务处理器自己说，不额外造一层。
 * @param payload - wire 载荷。
 * @returns 命名参数。
 */
function argsOf(payload: unknown): Readonly<Record<string, unknown>> {
  const args: unknown =
    typeof payload === "object" && payload !== null ? Reflect.get(payload, "args") : undefined;
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}
