// 用户批准契约：令牌按服务语义命名（上游注册名 `approval`）。
import type { ApprovalService } from "@deepseek-ai/dsh-user-approval";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

/** 能力词汇：批准策略的两档（`ask` 每次问人 / `never` 不问直接放行）。 */
export type { ApprovalPolicy } from "@deepseek-ai/dsh-user-approval";

@Injectable({ name: "approval" })
export abstract class Approval {
  abstract readonly config: ApprovalService["config"];

  abstract readonly setPolicy: ApprovalService["setPolicy"];

  abstract readonly request: ApprovalService["request"];

  abstract readonly overrideOf: ApprovalService["overrideOf"];
}

/**
 * 覆盖守卫（严格）：上游 `ApprovalService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type ApprovalCovered = AssertTrue<AssertCoveredStrict<ApprovalService, Approval>>;
