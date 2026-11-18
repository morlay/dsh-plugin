// 跨行令牌：**框架层放中立令牌**，业务域提供实现、其它域只认令牌。
//
// 为什么令牌在框架层而不是在会话域：别的域的 UI 行（技能、模型选择、命令）都要"当前会话"与
// "输入区触发源"这两样东西。令牌若定义在会话包里，那些域就得反向依赖会话聚合层——包间的环就是这么来的。
//
// **令牌面一律从上游的 `declare module '@deepseek-ai/cordis'` 派生**（`Context["<服务名>"]`）：
// 上游 `ctx.<服务名>` 写的是什么面，令牌就是什么面——不多一个成员、也不少一个，上游加成员时自动跟上。
// 空 `import type {}` 只为把那份声明带进 program（type-only，运行期不留边）。
import type { Context as ZephyrContext } from "@morlay/zephyr";
import { InjectionToken } from "@morlay/zephyr";
import type {} from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";

export { SidebarRightTabs } from "./sidebar-right-tabs.ts";

/** `ctx.sessions` 的面（上游 `ISessions`：会话目录）。 */
export type SessionsFace = ZephyrContext["sessions"];

/** `ctx.sessions`（会话目录；`ui-skill` / `ui-model-selection` 这类上游插件要的面）。 */
export const Sessions = new InjectionToken<SessionsFace>("sessions");

/** `ctx.inputTriggers` 的面（上游 `InputTriggerServiceContract`：输入区 `/`、`@` 的触发源注册面）。 */
export type InputTriggersFace = ZephyrContext["inputTriggers"];

/** `ctx.inputTriggers`（输入区 `/`、`@` 的触发源注册面）。 */
export const InputTriggers = new InjectionToken<InputTriggersFace>("inputTriggers");

/** `ctx.uiSession` 的面（上游 `UiSession`：会话界面服务）。 */
export type UiSessionFace = ZephyrContext["uiSession"];

/** `ctx.uiSession`（会话界面服务；右侧面板等行要读它）。 */
export const UiSession = new InjectionToken<UiSessionFace>("uiSession");

/** `ctx.sidebarRight` 的面（上游 `SidebarRightController` 实例：右侧面板的对外动作面）。 */
export type SidebarRightFace = ZephyrContext["sidebarRight"];

/** `ctx.sidebarRight`：面见 `SidebarRightFace`（上游发布的那个实例）。 */
export const SidebarRight = new InjectionToken<SidebarRightFace>("sidebarRight");

/** `ctx.uiConversation` 的面（上游 `UiConversation`：会话装配面）。 */
export type UiConversationFace = ZephyrContext["uiConversation"];

/** `ctx.uiConversation`（会话装配面：用户文本规则、绑定、视图）。 */
export const UiConversation = new InjectionToken<UiConversationFace>("uiConversation");
