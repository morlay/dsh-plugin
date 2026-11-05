// session-projection seam 的契约：令牌按服务语义命名（上游注册名 `sessionProjections`）。
import type { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

/** 能力词汇：一次投影登记的句柄（读某个会话的投影状态、或卸掉这次登记）。 */
export type { ProjectionHandle } from "@deepseek-ai/dsh-session-projection";

/**
 * 契约面：上游 `SessionProjectionRegistry` 的**全部**公开成员（登记、读状态、快照与 checkpoint）。
 *
 * 成员一个都不能少——上游插件按 `ctx.sessionProjections.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SessionProjectionStoreCovered = AssertTrue<
  AssertCovered<SessionProjectionRegistry, SessionProjectionStore>
>;

/** 投影注册表：按会话状态键登记投影，并读取当前快照。 */
@Injectable()
export abstract class SessionProjectionStore {
  abstract readonly register: SessionProjectionRegistry["register"];

  abstract readonly onChanged: SessionProjectionRegistry["onChanged"];

  abstract readonly stateOf: SessionProjectionRegistry["stateOf"];

  abstract readonly snapshot: SessionProjectionRegistry["snapshot"];

  abstract readonly cachedSnapshot: SessionProjectionRegistry["cachedSnapshot"];

  abstract readonly checkpoint: SessionProjectionRegistry["checkpoint"];

  abstract readonly restoreFloor: SessionProjectionRegistry["restoreFloor"];

  abstract readonly viewCheckpoint: SessionProjectionRegistry["viewCheckpoint"];

  abstract readonly restore: SessionProjectionRegistry["restore"];

  abstract readonly hydrate: SessionProjectionRegistry["hydrate"];

  abstract readonly summaryKeys: SessionProjectionRegistry["summaryKeys"];

  /** 投影事件变化的订阅口（上游按它把 `session/event` 的投影变化喂给订阅者）。 */
  abstract readonly onEventChanged: SessionProjectionRegistry["onEventChanged"];
}
