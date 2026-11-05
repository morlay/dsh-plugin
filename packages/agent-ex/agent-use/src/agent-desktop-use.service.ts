// `agent-desktop mcp` 那一行：声明式注册（模板在 `@McpClient`）。
import { Injectable } from "@morlay/zephyr";
import { McpClient } from "@morlay/dsh-agent";

@McpClient({ name: "agent_desktop", command: "agent-desktop" })
@Injectable()
export class AgentDesktopUse {}
