// shell 域的 **RPC 面**（`@morlay/dsh-shell/endpoint`）：终端组的两端共用面（组名 + 每个方法的形状）。
import type { TerminalRemote } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { InjectionToken } from "@morlay/zephyr";

/**
 * `remote.terminal`（上游 `publishNamespace` 的**嵌套服务名**）——**待删**：本提交后由
 * `TerminalEndpointClient` 取代（`InjectionToken` 不表达服务面，且字段填充期拿不到挂载面）。
 */
export const TerminalRemoteService = new InjectionToken<TerminalRemote>("remote.terminal");

export * from "./terminal-endpoint.ts";
