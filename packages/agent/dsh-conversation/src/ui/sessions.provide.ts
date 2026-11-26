// 会话目录的装配清单：数据面与 client 半分开导出。
import { provide } from "@morlay/zephyr";
import { SessionEndpointClient } from "@morlay/dsh-session/ui";
import { provideProjections } from "./projections/provide.ts";
import { SessionControllerDefault } from "./session-controller.service.ts";
import { SessionReferenceEndpointClient } from "./session-reference-endpoint.client.ts";

/**
 * 会话目录的**数据面**：只有服务本身。
 *
 * 与视图分开，是因为数据面不依赖渲染栈（`slots` / React）——非浏览器宿主（测试、CLI）
 * 只装这一层就能拿到「活目录」。
 *
 * 投影读面（`Projections`，本域的 `session/control` 中继）随它一起装：
 * `binding().session.projections.faceOf()` 的语义在那一层，分开装会出现「目录能读、投影永远空」的半装配。
 *
 * 会话目录的令牌是会话域的 `SessionController`（面 = 上游 `ISessions`）：技能、模型选择这些域的 UI 行
 * 按它注入，不反向依赖对话聚合层。
 */
export const provideSessionsStore = provide([
  ...provideProjections(),
  // `session` 组的客户端面：`SessionControllerDefault` 的 `control` 流走它。
  // 排在它前面——少这一行，装配期就报「没有提供者：session-endpoint」；
  // 那一组的 wire 描述符由它自己的 `onInit` 挂上（客户端形态自己挂自己那一组，没有额外的 binding 行）。
  SessionEndpointClient,
  SessionControllerDefault,
]);

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
 * providers 里是「会话引用组」的客户端形态：`@` 菜单的会话候选要它，而它的 descriptor 不属于
 * `session-controller` 那包（那份由 `provideClientRemote()` 挂）。挂载由它自己的 `onInit` 做，
 * 装配面只装 `provideSessions()` 就够，不必再记一条 client 行。
 */
export const provideSessions = provide([...provideSessionsStore(), SessionReferenceEndpointClient]);
