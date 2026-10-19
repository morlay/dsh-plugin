// session-projection seam 的契约：令牌按服务语义命名（上游注册名 `sessionProjections`）。
import type { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

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
  /**
   * 上游注册名：上游按 `ctx.get('sessionProjections')` 读投影快照（`sessionQuery` 的观测、
   * `agentLoop` 的投影登记都走它）。名字视图按它建条目；少了它上游就把「投影没装」当真
   * （症状：`requires a projected Session observation`）。
   */
  static readonly serviceName = "sessionProjections";

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
}
