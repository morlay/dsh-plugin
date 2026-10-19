// 工具注册表契约：令牌按服务语义命名（上游注册名 `tools`）。
import type ToolRuntime from "@deepseek-ai/dsh-tools";
import { Injectable } from "@morlay/zephyr";

interface ToolsFace {
  readonly register: ToolRuntime["register"];
  readonly get: ToolRuntime["get"];
}

@Injectable()
export abstract class Tools implements ToolsFace {
  abstract readonly register: ToolsFace["register"];

  abstract readonly get: ToolsFace["get"];
}
