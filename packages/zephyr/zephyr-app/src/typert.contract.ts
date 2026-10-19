// Typert 运行时注册表契约（上游 `TypertRegistry` 的服务面）：只声明本仓用到的成员。
import { Injectable } from "@morlay/zephyr";
import type TypertRegistry from "@deepseek-ai/dsh-typert-registry";

@Injectable()
export abstract class Typert {
  abstract readonly local: TypertRegistry["local"];

  abstract readonly lookups: TypertRegistry["lookups"];

  abstract readonly contexts: TypertRegistry["contexts"];
}
