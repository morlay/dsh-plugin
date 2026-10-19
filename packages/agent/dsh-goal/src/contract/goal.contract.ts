// 目标契约：令牌按服务语义命名（上游注册名 `goal`）。
import type GoalService from "@deepseek-ai/dsh-goal";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `GoalService` 的**全部**公开成员。
 *
 * 上游插件按 `ctx.goal.<member>` 取用，缺一个那条插件在运行期读到的就是 `undefined`；
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type GoalCovered = AssertTrue<AssertCovered<GoalService, Goal>>;

@Injectable()
export abstract class Goal {
  abstract readonly get: GoalService["get"];

  abstract readonly create: GoalService["create"];

  abstract readonly disarm: GoalService["disarm"];

  abstract readonly block: GoalService["block"];

  abstract readonly clear: GoalService["clear"];

  abstract readonly complete: GoalService["complete"];

  abstract readonly edit: GoalService["edit"];

  abstract readonly pause: GoalService["pause"];

  abstract readonly resume: GoalService["resume"];

  abstract readonly remoteExportCreate: GoalService["remoteExportCreate"];

  abstract readonly typertRemote: GoalService["typertRemote"];
}

