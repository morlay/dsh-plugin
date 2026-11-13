# @morlay/dsh-agent-team

Agent Teams 的宿主行与工具集：接管上游 `TeamService`（服务名 `agentTeams`）与它那套团队工具，让 Lead 能派发队友、
共享任务板并等待结果。

## 用法

```ts
import { provideAgentTeam } from "@morlay/dsh-agent-team/server";

...provideAgentTeam(),
```

`provideAgentTeam()` 的清单两行（顺序即清单内顺序）：

| 行                   | 上游                               | 做什么                                                                                                               |
| -------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `TeamServiceDefault` | `@deepseek-ai/dsh-agent-team`      | 团队服务（成员、任务板、消息）                                                                                       |
| `ToolAgentTeam`      | `@deepseek-ai/dsh-tool-agent-team` | 模型面那套工具：`spawn_teammate` / `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` / `team_task_*` |

## 依赖

服务行的 `deps`：`AgentDirectory` / `SessionStore` / `SessionPersistenceStore` / `SessionProjectionStore` /
`SubagentRegistry`。

工具行按「这个 agent 是不是 Team 成员」在 `agent/created` 上装工具：**没加入团队的会话不会有团队工具**；
上游普通 `subagent` / `subagent_fork` 本包不动（上游那套 profile 会禁掉它们，本包不禁）。

## 出口

`.`：`TeamServiceDefault` / `ToolAgentTeam`；`./server`：`provideAgentTeam`；`./ui`：Agent Teams 的浏览器行。本包不拥有装配清单与行间取舍。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
