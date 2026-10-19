// 沙箱提供者契约：令牌按服务语义命名（上游注册名 `sandbox`）。
import type { SandboxProvider } from "@deepseek-ai/dsh-sandbox";
import { Injectable } from "@morlay/zephyr";

interface SandboxFace {
  readonly confine: SandboxProvider["confine"];
}

@Injectable()
export abstract class Sandbox implements SandboxFace {
  abstract readonly confine: SandboxFace["confine"];
}
