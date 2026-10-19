// shell 环境契约：令牌按服务语义命名（上游注册名 `shellEnv`）。
import type { ShellEnvRegistry } from "@deepseek-ai/dsh-shell-env";
import { Injectable } from "@morlay/zephyr";

interface ShellEnvFace {
  readonly register: ShellEnvRegistry["register"];
  readonly collect: ShellEnvRegistry["collect"];
  readonly list: ShellEnvRegistry["list"];
}

@Injectable()
export abstract class ShellEnv implements ShellEnvFace {
  abstract readonly register: ShellEnvFace["register"];

  abstract readonly collect: ShellEnvFace["collect"];

  abstract readonly list: ShellEnvFace["list"];
}
