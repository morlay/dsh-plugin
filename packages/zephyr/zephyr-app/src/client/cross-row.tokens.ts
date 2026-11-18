// 跨行令牌：**框架层放中立令牌**，业务域提供实现、其它域只认令牌。
//
// 为什么令牌在框架层而不是在会话域：别的域的 UI 行（技能、模型选择、命令）都要"当前会话"与
// "输入区触发源"这两样东西。令牌若定义在会话包里，那些域就得反向依赖会话聚合层——包间的环就是这么来的。
//
// **令牌面按「这一行到底是哪个外部面」写**：能派生的派生（见 `SidebarRightFace`），派生不出来的
// 才留 `unknown`——那种令牌的消费方只能按自己需要的面断言。
import type { Context as ZephyrContext } from "@morlay/zephyr";
import { InjectionToken } from "@morlay/zephyr";
// 只为把上游的 `declare module '@deepseek-ai/cordis'`（`ctx.sidebarRight` / `ctx.sidebarRightTabs`）
// 带进 program：下面的 `SidebarRightFace` 从那份声明派生。
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";

export { SidebarRightTabs } from "./sidebar-right-tabs.ts";

/** `ctx.sessions`（会话目录；`ui-skill` / `ui-model-selection` 这类上游插件要的面）。 */
export const Sessions = new InjectionToken<unknown>("sessions");

/** `ctx.inputTriggers`（输入区 `/`、`@` 的触发源注册面）。 */
export const InputTriggers = new InjectionToken<unknown>("inputTriggers");

/** `ctx.uiSession`（会话界面服务；右侧面板等行要读它）。 */
export const UiSession = new InjectionToken<unknown>("uiSession");

/**
 * 右侧面板的对外动作面：**上游 `ctx.sidebarRight` 的那个面**。
 *
 * 上游在 `apply` 里 `ctx.reflect.provide('sidebarRight', controller)` 发布的就是它。为什么派生
 * 而不是手抄成员表：那个类的类型没出现在上游 `/client` 出口上（出口只导 `ISidebarRight`，漏了
 * `commandTarget` / `openTabFromTarget` 这类上游插件真的会调的成员），而 `declare module` 里
 * 写的就是实例的真面——派生它，上游加成员时这里自动跟上。
 */
export type SidebarRightFace = ZephyrContext["sidebarRight"];

/** `ctx.sidebarRight`：面见 `SidebarRightFace`（上游发布的那个实例）。 */
export const SidebarRight = new InjectionToken<SidebarRightFace>("sidebarRight");

/** `ctx.uiConversation`（会话装配面：用户文本规则、绑定、视图）。 */
export const UiConversation = new InjectionToken<unknown>("uiConversation");
