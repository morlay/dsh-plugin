// Remote 服务契约（上游 `api-gateway` client 半提供的 `remote`）：只声明本仓用到的装载面。
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class Remote {
  /** 挂一个 Remote contribution；返回它的 disposer。 */
  abstract $mount(contribution: unknown): Promise<() => Promise<void>>;
}
