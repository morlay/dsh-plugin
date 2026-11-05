import { configure, type ProviderList } from "@morlay/zephyr";
import { SandboxPolicyDefault, provideSandbox } from "@morlay/dsh-sandbox";
import { provideShell } from "@morlay/dsh-shell/server";
import { provideWorkingDirectory } from "@morlay/dsh-agent";
import { provideAgentLoop } from "../agent-loop.provide.ts";

/**
 * 循环期 headless 层的最小清单：循环本体、执行器、检查点、输出与调用策略、子代理派生，
 * 以及它们要的下游（shell → sandbox → 工作目录）。
 *
 * 不含 `AppEnv`（部署事实由调用方给）、不含 wire。要"跑一轮对话"的测试装这份清单就够。
 * @param options.workspaceRoot - 沙箱的可写根（测试一般给临时目录）。
 * @returns 条目清单。
 */
export function headlessLoopProviders(options: { readonly workspaceRoot: string }): ProviderList {
  return [
    ...provideShell(),
    ...provideSandbox(
      configure(SandboxPolicyDefault, {
        mode: "workspace-write",
        workspaceRoot: options.workspaceRoot,
      }),
    ),
    ...provideWorkingDirectory(),
    ...provideAgentLoop(),
  ];
}
