import { provide } from "@morlay/zephyr";
import { ShellEnvDefault } from "./shell-env.service.ts";
import { TerminalDefault } from "./terminal.service.ts";
import { SubprocessDefault } from "./subprocess.service.ts";

// 子进程先于 shell 环境：后者是纯注册表，但消费方（`dsh-tool-bash`）两者都读。
/** 无部署值：直接 `providers: [...provideShell()]`。 */
export const provideShell = provide([SubprocessDefault, ShellEnvDefault]);

/**
 * 宿主终端：**单独一份清单**。
 *
 * 它要 `sandboxPolicy` / `workingDirectory` / `typert`（起进程要前者、查 agent 的工作目录要中间那个、
 * 登记 `terminal/*` 端点要后者）——并进 `provideShell()` 会让「只想跑个子进程」的装配被迫拉起这三份。
 */
export const provideTerminal = provide([TerminalDefault]);
