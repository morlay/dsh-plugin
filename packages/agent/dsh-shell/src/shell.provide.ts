import { provide } from "@morlay/zephyr";
import { ShellEnvDefault } from "./shell-env.service.ts";
import { SubprocessDefault } from "./subprocess.service.ts";

// 子进程先于 shell 环境：后者是纯注册表，但消费方（`dsh-tool-bash`）两者都读。
/** 无部署值：直接 `providers: [...provideShell()]`。 */
export const provideShell = provide([SubprocessDefault, ShellEnvDefault]);
