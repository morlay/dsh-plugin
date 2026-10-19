// 子进程运行时契约：令牌按服务语义命名（上游注册名 `subprocess`）。
import type { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `SubprocessRuntime` 的全部公开成员，与上游同名同签名。
 *
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SubprocessCovered = AssertTrue<AssertCovered<SubprocessRuntime, Subprocess>>;

@Injectable()
export abstract class Subprocess {
  abstract readonly resolveExecutable: SubprocessRuntime["resolveExecutable"];

  abstract readonly terminalEnvironment: SubprocessRuntime["terminalEnvironment"];

  abstract readonly spawn: SubprocessRuntime["spawn"];

  abstract readonly spawnTerminal: SubprocessRuntime["spawnTerminal"];
}

