// `@McpClient()`：下游直接声明一条 MCP 客户端行，不用再手写「基类 + static defaults + 令牌 + 装配清单」。
//
//   @McpClient({ name: "agent_desktop", command: "agent-desktop" })
//   @Injectable()
//   class AgentDesktopUse {}
//
// 装饰器返回一个新类（TC39 装饰器允许替换类）。那个类做四件事：
//   1. 继承上游 `mcp-client` 那一行（`fromCordis`），把 `tools` 交给它；
//   2. 令牌按名字派生（`InjectionToken(name)`）——两条行不会撞同一个令牌；
//   3. 配置按「默认值 → 行配置 → 上游 schema」解析（装配面 `configure` 改的就是它）；
//   4. 登记 `@Injectable({ token })`，装配器与 `app.get()` 都按令牌区分。
import * as McpClientPlugin from "@deepseek-ai/dsh-mcp-client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ToolRegistry } from "./tool-registry.contract.ts";

/** 一条 MCP 客户端行的声明。 */
export interface McpClientOptions {
  /** MCP 的 `serverName`：工具名会带成 `mcp__<name>__<tool>`。 */
  readonly name: string;
  /** stdio 要起的命令（全局 bin 名，装没装由 PATH 决定）。 */
  readonly command: string;
  /** 命令参数（默认 `["mcp"]`）。 */
  readonly args?: readonly string[];
  /** 传输方式（默认 `stdio`）。 */
  readonly transport?: string;
}

/** 上游行的运行时形状（`fromCordis` 的产物）。 */
interface UpstreamRow {
  mount(ctx: Context, config: unknown, deps: Record<string, unknown>): Promise<void>;
}

type UpstreamCtor = new (config?: unknown) => object;

/**
 * 声明一条 MCP 客户端行。
 * @param options - server 名与启动命令。
 * @returns 类装饰器（返回替换后的类）。
 */
export function McpClient<T extends abstract new (...args: never[]) => object>(
  options: McpClientOptions,
): (target: T) => T & (new (...args: never[]) => { readonly config: McpClientPlugin.Config }) {
  return (target) => {
    const Base = fromCordis(McpClientPlugin) as unknown as UpstreamCtor;

    class McpClientRow extends Base {
      private readonly tools = inject(ToolRegistry);

      /** 这一行的有效配置。 */
      declare readonly config: McpClientPlugin.Config;

      constructor(rowConfig?: unknown) {
        super(rowConfig);
        const patch =
          typeof rowConfig === "object" && rowConfig !== null && !Array.isArray(rowConfig)
            ? (rowConfig as Record<string, unknown>)
            : {};
        Object.defineProperty(this, "config", {
          value: McpClientPlugin.Config({
            transport: options.transport ?? "stdio",
            args: [...(options.args ?? ["mcp"])],
            serverName: options.name,
            command: options.command,
            ...patch,
          } as never),
          writable: false,
          enumerable: true,
        });
      }

      async onInit(ctx: Context): Promise<void> {
        // 上游按名字读 `tools`（`ctx.tools.register`）：用 deps 给，不注册进 cordis。
        await (this as unknown as UpstreamRow).mount(ctx, this.config, { tools: this.tools });
      }
    }

    Object.defineProperty(McpClientRow, "name", { value: target.name });
    // 令牌就是类自身：装配面 `configure(AgentDesktopUse, …)` 与 `app.get(AgentDesktopUse)` 都按它区分。
    Injectable({ token: McpClientRow as unknown as Function })(McpClientRow);
    return McpClientRow as unknown as T &
      (new (...args: never[]) => { readonly config: McpClientPlugin.Config });
  };
}
