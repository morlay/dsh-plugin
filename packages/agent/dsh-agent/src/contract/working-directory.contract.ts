// 工作目录契约：令牌按服务语义命名（上游注册名 `workingDirectory`）。
import { WorkingDirectoryService } from "@deepseek-ai/dsh-working-directory";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

@Injectable({ name: "workingDirectory" })
export abstract class WorkingDirectory {
  abstract readonly get: WorkingDirectoryService["get"];

  abstract readonly ensure: WorkingDirectoryService["ensure"];

  abstract readonly set: WorkingDirectoryService["set"];

  abstract readonly defaultDirectory: WorkingDirectoryService["defaultDirectory"];
}

/**
 * 覆盖守卫（严格）：上游 `WorkingDirectoryService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type WorkingDirectoryCovered = AssertTrue<AssertCoveredStrict<WorkingDirectoryService, WorkingDirectory>>;
