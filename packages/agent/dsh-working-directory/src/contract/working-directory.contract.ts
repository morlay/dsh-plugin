// 工作目录契约：令牌按服务语义命名（上游注册名 `workingDirectory`）。
import { WorkingDirectoryService } from "@deepseek-ai/dsh-working-directory";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `WorkingDirectoryService` 的**全部**公开成员。
 *
 * 上游插件按 `ctx.workingDirectory.<member>` 取用，缺一个那条插件在运行期读到的就是 `undefined`；
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type WorkingDirectoryCovered = AssertTrue<
  AssertCovered<WorkingDirectoryService, WorkingDirectory>
>;

@Injectable()
export abstract class WorkingDirectory {
  abstract readonly get: WorkingDirectoryService["get"];

  abstract readonly ensure: WorkingDirectoryService["ensure"];

  abstract readonly set: WorkingDirectoryService["set"];

  abstract readonly defaultDirectory: WorkingDirectoryService["defaultDirectory"];
}

