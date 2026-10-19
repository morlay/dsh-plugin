// 计划模式契约：令牌按服务语义命名（上游注册名 `planMode`）。
import type PlanModeController from "@deepseek-ai/dsh-plan-mode";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `PlanModeController` 的**全部**公开成员。
 *
 * 上游插件按 `ctx.planMode.<member>` 取用，缺一个就是运行期 `undefined`。
 * `PlanMode` 之前是空令牌（只有名字、没有面）：上游是真类，消费方按成员取用，
 * 空面等于「谁用谁崩」。下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type PlanModeCovered = AssertTrue<AssertCovered<PlanModeController, PlanMode>>;

@Injectable()
export abstract class PlanMode {
  abstract readonly get: PlanModeController["get"];

  abstract readonly set: PlanModeController["set"];
}

