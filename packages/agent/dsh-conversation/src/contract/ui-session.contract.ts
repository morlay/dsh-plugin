// `ctx.uiSession`：会话界面服务（上游 `ui-session` 行发布的服务面）。
//
// home 在会话界面的契约面：上游 `ui-session` 的适配行（`ui/session-layout.ts`）就在本包，行与契约同一个
// owner；别的域（技能、工作区）只认令牌，不反向依赖行。
//
// 名字是**上游注册名**（`uiSession`，显式写出来，不靠类名派生）。契约类不带成员：消费方只把实例交给
// 上游插件的 `mount` deps，没有一处读成员；面见 `UiSessionFace`。
import type { UiSessionService } from "@deepseek-ai/dsh-client-ui-session/client";
import { Injectable } from "@morlay/zephyr";

/** `ctx.uiSession` 的面（上游 `UiSessionService`：选中、绑定、会话作用域源注册）。 */
export type UiSessionFace = UiSessionService;

/** `ctx.uiSession`（会话界面服务）：面见 `UiSessionFace`。 */
@Injectable({ name: "uiSession" })
export abstract class UiSession {}
