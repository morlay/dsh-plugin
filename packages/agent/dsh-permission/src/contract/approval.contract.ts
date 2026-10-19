// 用户批准契约：令牌按服务语义命名（上游注册名 `approval`）。
import type { ApprovalService } from "@deepseek-ai/dsh-user-approval";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `ApprovalService` 的全部公开成员，与上游同名同签名。
 *
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type ApprovalCovered = AssertTrue<AssertCovered<ApprovalService, Approval>>;

@Injectable()
export abstract class Approval {
  abstract readonly config: ApprovalService["config"];

  abstract readonly setPolicy: ApprovalService["setPolicy"];

  abstract readonly request: ApprovalService["request"];

  abstract readonly overrideOf: ApprovalService["overrideOf"];
}

