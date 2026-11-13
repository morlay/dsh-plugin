# @morlay/dsh-conversation

**对话域（BFF）**：会话界面 + 端点聚合。

- 会话界面（`@morlay/dsh-conversation/ui`）：会话布局与各域槽位（chat / tool / attachment /
  secret-mask / subagent / trajectory / workflow-run / deliverables 的行由各域自己提供）、客户端 `SessionController`、
  以及 `provideSessions` / `provideSessionShell` / `provideSessionSlots` / `provideSessionShellSlots` /
  `provideSessionInputSlots` 五个装配面。
- 设置面分**两条清单**（顺序是硬约束）：`provideSettingHost()` 只装入口行（`configForms` /
  `settingsSchema` 的真实现），**必须在链之前**；`provideSettingUi()` 装页面位置与输入区的模型选择器，
  **必须在链之后**（它读 `configForms` 的面）。
- 端点聚合（`@morlay/dsh-conversation/server`）：会话端点（上游 `SessionController` 那一族）、会话引用、
  文件引用，以及 `toolResults/watch` 的宿主行。

## 定位：BFF 层

它是**场景聚合**，不是能力包：只依赖 `dsh-*` 能力包与 `zephyr*`，**不**依赖 `agent-ex`，也不拥有
其它域的类型与实现——那些从下层的能力包取（例如会话数据面是 `@morlay/dsh-session`）。

```ts
// 宿主侧
bootstrapApplication({ providers: [...provideSessionRemote(), ...provideApiSession()] });
// 浏览器侧
bootstrapApplication({ providers: [...provideSessions(), ...provideSessionSlots()] });
```

## 它拥有什么：三个面，没有数据面

BFF 的判据不是"名字里带 conversation"，而是**它直接 import 的上游包落在哪个面**。本包的上游清单
（`just audit` 的 `dsh-conversation` 行）只有三面：

| 面                 | 上游包                                                                                           | 是什么                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **端点（宿主）**   | `@deepseek-ai/dsh-api-session-controller` · `dsh-session-reference` · `dsh-file-reference-local` | 三个 wire 端点组：`session` / `sessionReference` / `fileReferences`（`dsh-file-reference-local` 是最后一组里 `@` 引用候选的本地实现，没有独立数据面） |
| **界面（client）** | 26 个 `@deepseek-ai/dsh-client-ui-*`                                                             | 会话 / 输入 / 侧栏（3 个）/ 附件 / 子代理 / 工具 / 轨迹 / 工作流 / 引用 / 密文 / 聊天                                                                 |
| **传输**           | `@deepseek-ai/dsh-api-gateway` 的 **`/client` 子路径**                                           | 只有 `RemoteStream`——浏览器半的流式 remote 助手（`ui/remote-session.ts`）。**不是**宿主 gateway：本包不碰 `/api` 的 rpc 分派与 peer 准入              |

**没有数据面**：`dsh-session` / `dsh-session-persistence` / `dsh-session-query` / `dsh-session-projection*` /
`dsh-storage*` 一条都不在本包的上游清单里——它们分别归 `dsh-session` / `dsh-session-persistence` /
`dsh-storage` 三个域。下次想往这里塞 `dsh-session*`，这张表就是拒绝的依据：数据面归数据域的包，
BFF 只做**端点 + 界面 + 传输助手**。

## 历史

本包原名 `dsh-session-api`（那时只有宿主端点行）。改名与「会话界面整块搬进来」是同一批：
界面的 home 是对话域，数据面留在 `dsh-session`。
