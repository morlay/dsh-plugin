import type { TerminalRemote } from "@deepseek-ai/dsh-api-terminal-controller/client";
import { InjectionToken } from "@morlay/zephyr";

/**
 * `remote.terminal`（上游 `publishNamespace` 的**嵌套服务名**）。
 *
 * 名字取上游注册名 `remote.terminal`：装配期 `adoptNamedServices` 会把「按名字发布的服务」映射到同名令牌，
 * 所以这里 `inject` 得到的就是那个 proxy，**名字只活在令牌定义这一处**。
 *
 * 不用 `Remote.upstream[组名]`：那是个空对象（`remote.service.ts:297`），读出来永远 `undefined`。
 */
export const TerminalRemoteService = new InjectionToken<TerminalRemote>("remote.terminal");

// shell 域的 **RPC 面**（`@morlay/dsh-shell/endpoint`）：终端组的两端共用面。
export * from "./terminal.group.ts";
