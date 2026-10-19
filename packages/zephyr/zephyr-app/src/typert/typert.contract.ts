// Typert 运行时注册表契约（上游 `TypertRegistry` 的服务面）：只声明本仓用到的成员。
import { Injectable } from "@morlay/zephyr";
import type TypertRegistry from "@deepseek-ai/dsh-typert-registry";

@Injectable()
export abstract class Typert {
  abstract readonly local: TypertRegistry["local"];

  abstract readonly lookups: TypertRegistry["lookups"];

  abstract readonly contexts: TypertRegistry["contexts"];

  /**
   * 登记一个 remote namespace 的宿主实现（上游 `TypertRegistry.register`）。
   *
   * 这是「前后端同一份契约」的写法：宿主侧 `register({ namespace, methods })`，
   * 客户端侧用 `@RemoteGroup` 的契约方法调它。
   */
  abstract register(contribution: Parameters<TypertRegistry["register"]>[0]): ReturnType<TypertRegistry["register"]>;
}
