import { type ProviderFeature, type ProviderList } from "@morlay/zephyr";
import { provideApiSession } from "./api-session.provide.ts";
import { provideSessionReference } from "./session-reference.provide.ts";
import { provideSessionRemote } from "./session-remote.provide.ts";

/**
 * 对话域的**宿主半**：一份清单装完本包的宿主面。
 *
 * 三段各自的归属与顺序（同一次调用的内部顺序）：
 * 1. 会话数据面（store / 投影 / 查询）+ `toolResults`（`provideSessionRemote`，**自带三份 root**）；
 * 2. 会话引用解析（`sessionReferenceResolver`）；
 * 3. 会话端点（上游 `SessionController` 一族，要 agent / 附件 / 上传 / 工作区 / working-directory）。
 *
 * **不要再并列装 `provideSession()`**：第 1 段已经带了真 store 行，重复注册会抛
 * `service "sessions" has been registered`。
 *
 * @param sessionRemoteFeatures - 只作用于第 1 段的清单变换（应用里会 `without(SessionQuerySqlite)` 换成 RDB 查询）。
 * @returns provider 清单。
 */
export function provideConversationServer(
  ...sessionRemoteFeatures: ProviderFeature[]
): ProviderList {
  return [
    ...provideSessionRemote(...sessionRemoteFeatures),
    ...provideSessionReference(),
    ...provideApiSession(),
  ];
}
