// `ctx.uiSession.sessionStatus`：上游 `ui-session-status` 行发布的**子服务**（会话未读标记的来源）。
//
// 名字是上游的**带点子服务名**（`uiSession.sessionStatus`）——契约名与上游注册名逐字相同，`fromCordis`
// 取面与上游按名读走的是同一个键。行（`ui/session-status-slots.ts`）与契约同在本包。
//
// 契约类不带成员：消费方（工作区）只把它交给上游插件的 `mount` deps；面见 `UiSessionStatusFace`。
import type { UiSessionStatus as UpstreamUiSessionStatus } from "@deepseek-ai/dsh-client-ui-session-status/client";
import { Injectable } from "@morlay/zephyr";

/** `ctx.uiSession.sessionStatus` 的面（上游状态服务）。 */
export type UiSessionStatusFace = UpstreamUiSessionStatus;

/** `ctx.uiSession.sessionStatus`（未读标记的子服务）：面见 `UiSessionStatusFace`。 */
@Injectable({ name: "uiSession.sessionStatus" })
export abstract class UiSessionStatus {}
