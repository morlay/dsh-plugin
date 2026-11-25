// 子进程运行时契约：令牌按服务语义命名（上游注册名 `subprocess`）。
import type { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
import { Injectable } from "@morlay/zephyr";

@Injectable({ name: "subprocess" })
export abstract class Subprocess implements SubprocessRuntime {
  abstract readonly resolveExecutable: SubprocessRuntime["resolveExecutable"];

  abstract readonly terminalEnvironment: SubprocessRuntime["terminalEnvironment"];

  abstract readonly spawn: SubprocessRuntime["spawn"];

  abstract readonly spawnTerminal: SubprocessRuntime["spawnTerminal"];
}
