// 跨行令牌：**框架层放中立令牌**，业务域提供实现、其它域只认令牌。
//
// 为什么令牌在框架层而不是在会话域：别的域的 UI 行（技能、模型选择、命令）都要"当前会话"与
// "输入区触发源"这两样东西。令牌若定义在会话包里，那些域就得反向依赖会话聚合层——包间的环就是这么来的。
// 令牌类型是 `unknown`：框架层不依赖上游会话包，消费方按自己需要的面断言。
import { InjectionToken } from "@morlay/zephyr";

export { SidebarRightTabs } from "./sidebar-right-tabs.ts";

/** `ctx.sessions`（会话目录；`ui-skill` / `ui-model-selection` 这类上游插件要的面）。 */
export const Sessions = new InjectionToken<unknown>("sessions");

/** `ctx.inputTriggers`（输入区 `/`、`@` 的触发源注册面）。 */
export const InputTriggers = new InjectionToken<unknown>("inputTriggers");

/** `ctx.uiSession`（会话界面服务；右侧面板等行要读它）。 */
export const UiSession = new InjectionToken<unknown>("uiSession");

/** `ctx.sidebarRight`（右侧面板的对外动作面）。 */
export const SidebarRight = new InjectionToken<unknown>("sidebarRight");

/** `ctx.uiConversation`（会话装配面：用户文本规则、绑定、视图）。 */
export const UiConversation = new InjectionToken<unknown>("uiConversation");
