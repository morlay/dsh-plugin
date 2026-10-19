// 子进程运行时契约：令牌按服务语义命名（上游注册名 `subprocess`）。
import type { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
import { Injectable } from "@morlay/zephyr";

interface SubprocessFace {
  readonly resolveExecutable: SubprocessRuntime["resolveExecutable"];
  readonly terminalEnvironment: SubprocessRuntime["terminalEnvironment"];
  readonly spawn: SubprocessRuntime["spawn"];
  readonly spawnTerminal: SubprocessRuntime["spawnTerminal"];
}

@Injectable()
export abstract class Subprocess implements SubprocessFace {
  abstract readonly resolveExecutable: SubprocessFace["resolveExecutable"];

  abstract readonly terminalEnvironment: SubprocessFace["terminalEnvironment"];

  abstract readonly spawn: SubprocessFace["spawn"];

  abstract readonly spawnTerminal: SubprocessFace["spawnTerminal"];
}
