// 会话目录的装配清单：数据面与 client 半分开导出。
import { provide } from "@morlay/zephyr";
import { SessionReferenceRemoteBinding } from "./input/session-reference-remote.ts";
import { SessionControllerDefault } from "./session-controller.service.ts";

/**
 * 会话目录的**数据面**：只有服务本身。
 *
 * 与视图分开，是因为数据面不依赖渲染栈（`slots` / React）——非浏览器宿主（测试、CLI）
 * 只装这一层就能拿到「活目录」。
 */
export const provideSessionsStore = provide([SessionControllerDefault]);

/**
 * 会话目录的 client 半：数据面 + descriptor 绑定。
 *
 * 主区的空态**不自写**：`ui-conversation` 那一行把 `ConversationPanel` 注册到 `main` 位置的
 * `conversation` key 上，`AppFrame` 在没有面板时默认渲染它（`entryKey: panelId ?? 'conversation'`），
 * 无会话时由它的 `EmptyHero`（`hero.headline` =「探索未至之境」）负责。我们曾经在这里注册过一个
 * `main/empty` 的自写欢迎页，那是抢位置。
 *
 * **不提供 root 标准源**：上游 `ui-session` 行自己 `provideRoot(...)`；同名空字段会盖掉真实状态。
 *
 * providers 里是 `remote.sessionReferenceResolver` 的 descriptor 绑定：`@` 菜单的会话候选要它，
 * 而它不属于 `session-controller` 那包 descriptor（由 `provideClientRemote()` 挂）。绑定住在这里，
 * 装配面只装 `provideSessions()` 就够，不必再记一条 client 行。
 */
export const provideSessions = provide([...provideSessionsStore(), SessionReferenceRemoteBinding]);
