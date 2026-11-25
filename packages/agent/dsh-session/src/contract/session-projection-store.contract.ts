// session-projection seam 的契约：令牌按服务语义命名（上游注册名 `sessionProjections`）。
import type { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

/** 能力词汇：一次投影登记的句柄（读某个会话的投影状态、或卸掉这次登记）。 */
export type { ProjectionHandle } from "@deepseek-ai/dsh-session-projection";

/** 投影注册表：按会话状态键登记投影，并读取当前快照。 */
@Injectable({ name: "sessionProjections" })
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

/**
 * 覆盖守卫（严格）：上游 `SessionProjectionRegistry` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type SessionProjectionStoreCovered = AssertTrue<AssertCoveredStrict<SessionProjectionRegistry, SessionProjectionStore>>;
