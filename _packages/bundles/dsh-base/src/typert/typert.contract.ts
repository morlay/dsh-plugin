// typert 注册表契约：令牌按服务语义命名（上游注册名 `typert`）。
import type { TypertRegistry } from "@deepseek-ai/dsh-typert-registry";
import { Injectable } from "@morlay/zephyr";

interface TypertFace {
  readonly lookups: TypertRegistry["lookups"];
  readonly contexts: TypertRegistry["contexts"];
}

@Injectable()
export abstract class Typert implements TypertFace {
  abstract readonly lookups: TypertFace["lookups"];

  abstract readonly contexts: TypertFace["contexts"];
}
