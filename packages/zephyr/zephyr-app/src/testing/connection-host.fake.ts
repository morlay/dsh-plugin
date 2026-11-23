// 宿主连接面的**测试替身**：只兑现"谁往 `connection.fetch` 注册了 HTTP 路由"这一件事。
//
// 装配里装真 `provideConnection()` 要 `webServer` / `credentials` 一整套；只验"某行把路由登记进宿主"
// 的 spec 用它就够了（这也是上游 `fileUploads` 构造期唯一用到的宿主面）。
import type { ConnectionTrustRequest } from "@deepseek-ai/dsh-client-connection";
import { Injectable } from "@morlay/zephyr";
import { Connection } from "@morlay/zephyr-app/contract";

/** 一条登记进来的 fetch 路由（判据只看 `path`）。 */
export interface RegisteredFetchRoute {
  readonly path: string;
}

@Injectable()
export class FakeConnectionHost extends Connection {
  /** 登记过的路由（按登记顺序）。 */
  readonly routes: RegisteredFetchRoute[] = [];

  readonly rpc: Connection["rpc"] = {
    handle: () => async () => {},
    intercept: () => async () => {},
  } as Connection["rpc"];

  readonly fetch: Connection["fetch"] = {
    register: (route: never): (() => void) => {
      this.routes.push(route as RegisteredFetchRoute);
      return () => {};
    },
  } as Connection["fetch"];

  createSharedFetchHandler(): never {
    throw new Error("spec: 不建共享分派器");
  }

  admit(_request: ConnectionTrustRequest): never {
    throw new Error("spec: 不接连接");
  }

  readonly browserPeer = {} as never;
}
