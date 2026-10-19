// `api-gateway` 的对外面：只暴露我们真正用到的一条能力——「按 `namespace/method` 调一个 Remote 方法」。
//
// 上游 `api-gateway` 的服务实例上本来就有 `invoke`，但它的类型与一堆内部结构绑在一起；
// 这里只声明调用方需要的部分，实现行负责把请求转过去。
import { Injectable } from "@morlay/zephyr";

/** 一次 Remote 调用（与上游 `InvokeRemoteRequest` 的必需字段一致）。 */
export interface ApiGatewayInvocation {
  /** Remote namespace（descriptor 里的 `namespace`）。 */
  readonly namespace: string;
  /** Service 的方法名（descriptor 里的 `method`）。 */
  readonly method: string;
  /** 命名参数（与 descriptor 的 `parameters` 对应）。 */
  readonly args: Readonly<Record<string, unknown>>;
}

@Injectable()
export abstract class ApiGateway {
  /**
   * 调用一个 Remote 方法。
   * @param invocation - namespace / method / 命名参数。
   * @returns 业务结果。
   */
  abstract invoke(invocation: ApiGatewayInvocation): Promise<unknown>;
}
